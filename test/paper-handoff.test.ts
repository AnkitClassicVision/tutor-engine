import test from 'node:test'
import assert from 'node:assert/strict'
import { learningRouteFixture, FRACTION_TARGET } from './fixtures/learning-routes.ts'
import { createSheet, getSheet, scoreSheet, reviewAnswer, saveSheetPhoto, loadAttempts } from '../src/services.ts'
import { readTask, taskMatches } from '../src/task-evidence.ts'
import { sheetPage } from '../src/view.ts'
import type { Item } from '../src/engine/types.ts'
import { independent } from '../src/engine/mastery.ts'
import { readPaperWork } from '../src/paper-work.ts'

const conditions = { version: 1 as const, basis: 'self-reported' as const, help: 'none' as const, confirmed: true }
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='

test('paper follows the current target and retains question identity, controls and the authored rubric through review and retries', async () => {
  const f = await learningRouteFixture()
  try {
    const sheet = await f.within(() => createSheet(f.db, f.owner, f.student))
    const payload = JSON.parse(String((await getSheet(f.db, f.owner, sheet)).spec_json))
    const items = payload.items as Item[]
    assert.ok(items.every(item => item.conceptId === FRACTION_TARGET))
    const answers = items.map((item, index) => ({ boxIndex: index + 1, answer: item.rubric?.examples.meets ?? item.answer }))
    const results = await f.within(() => scoreSheet(f.db, f.owner, sheet, answers, f.clock(), conditions))
    const pending = results.find(result => result.boxIndex === 4)!
    assert.equal(pending.pendingReview, true, 'analysis waits for a rubric verdict')
    for (const [index, original] of items.entries()) {
      const delivered = (await f.db.prepare('SELECT * FROM session_items WHERE id = ?').get(original.itemId))!
      assert.equal(delivered.prompt, original.prompt)
      assert.equal(delivered.format, original.responseFormat ?? 'text')
      assert.equal(delivered.choices_json, original.choices ? JSON.stringify(original.choices) : null)
      assert.equal(delivered.rubric_json, original.rubric ? JSON.stringify(original.rubric) : null)
      assert.ok(taskMatches(delivered))
      assert.equal(delivered.revision_id, payload.tasks[original.itemId].revision, 'the printed revision survives submission')
      if (original.bloomLevel >= 3) assert.ok(readTask(delivered.task_evidence)?.parallelFormId)
      if (original.responseFormat === 'choice') {
        assert.equal(results[index].pendingReview, false, 'a choice retains its authored grading control')
        assert.equal(results[index].correct, true)
      }
    }
    const analysis = items[3]
    assert.equal((await f.attempts()).some(a => a.attemptId === analysis.itemId), false)
    await f.within(() => reviewAnswer(f.db, f.owner, pending.reviewSessionId, { itemId: analysis.itemId, correct: true }))
    const attempt = (await f.attempts()).find(a => a.attemptId === analysis.itemId)!
    assert.equal(attempt.task?.origin, 'paper'); assert.equal(attempt.task?.sourceId, sheet)
    assert.equal(attempt.evidenceCertainty, 'confirmed')
    assert.deepEqual(attempt.paperConditions, conditions)
    assert.ok(attempt.task?.parallelFormId)
    assert.deepEqual(await f.within(() => scoreSheet(f.db, f.owner, sheet, [{ boxIndex: 4, answer: 'different' }])), results)
    await f.within(() => reviewAnswer(f.db, f.owner, pending.reviewSessionId, { itemId: analysis.itemId, correct: true }))
    assert.equal((await f.attempts()).filter(a => a.attemptId === analysis.itemId).length, 1)
    const html = sheetPage({ sheetId: sheet, studentName: 'Synthetic paper learner', spec: payload.spec, items, qrSvg: '' })
    for (const item of items) for (const choice of item.choices ?? []) assert.ok(html.includes(choice))
    assert.ok(!html.includes(analysis.rubric!.examples.meets), 'the printed task does not reveal its answer or rubric examples')
    assert.ok(html.includes('Selecting a photo does not save it here.'))
    assert.ok(!html.includes('stored on this computer'))
  } finally { await f.close() }
})

test('paper photo retries preserve one attachment, ownership and unreadable entries without grading them', async () => {
  const f = await learningRouteFixture(), stranger = await learningRouteFixture()
  try {
    const sheet = await f.within(() => createSheet(f.db, f.owner, f.student)), path = '/sheet/' + sheet
    const upload = { mime: 'image/png', base64: PNG }
    const first = await f.request(path + '/upload', upload), next = await f.request(path + '/upload', upload)
    assert.equal(first.status, 201); assert.equal(next.status, 201)
    assert.equal((await first.json()).uploadId, (await next.json()).uploadId)
    const row = await getSheet(f.db, f.owner, sheet), work = readPaperWork(JSON.parse(String(row.spec_json)).work)!
    assert.equal(work.photos.length, 1); assert.equal(work.completedReportedAt, null, 'uploading is not a report of completed work')
    assert.equal((await f.db.prepare('SELECT count(*) n FROM uploads').get())?.n, 1)
    assert.equal((await f.attempts()).length, 0)
    await assert.rejects(saveSheetPhoto(f.db, stranger.owner, sheet, upload, '/var/tmp/unused-paper-owner-check'), /not found/)
    assert.equal((await f.request(path + '/score', { 'box-3': '0' })).status, 400)
    const unclear = await f.request(path + '/score', { 'box-3': '?', completed: '1', confirmed: '1', paperHelp: 'none' })
    assert.equal(unclear.status, 400); assert.match((await unclear.json()).error, /not readable/)
    assert.equal((await getSheet(f.db, f.owner, sheet)).score_results, null)
    assert.equal((await f.attempts()).length, 0)
    assert.equal((await f.request('/uploads/' + work.photos[0].id)).status, 200)
  } finally { await f.close(); await stranger.close() }
})

test('unknown paper conditions cannot claim independence; reported help stays supported, and blanks remain unanswered', async () => {
  const f = await learningRouteFixture({ ai: false })
  try {
    for (const help of ['unknown', 'content', 'none'] as const) {
      const sheet = await f.within(() => createSheet(f.db, f.owner, f.student))
      const items: Item[] = JSON.parse(String((await getSheet(f.db, f.owner, sheet)).spec_json)).items
      const target = items[2]
      const results = await f.within(() => scoreSheet(f.db, f.owner, sheet, [{ boxIndex: 3, answer: target.answer }], f.clock(), { ...conditions, help }))
      assert.equal(results.filter(r => r.unanswered).length, 3)
      assert.equal(results.filter(r => r.pendingReview).length, 0)
      const attempt = (await loadAttempts(f.db, f.student)).find(a => a.attemptId === target.itemId)!
      assert.equal(attempt.evidenceCertainty, help === 'unknown' ? 'unresolved' : 'confirmed')
      assert.equal(attempt.supportUsed, help === 'content' ? 'outside' : 'none')
      assert.equal(independent(attempt), help === 'none')
      assert.equal(attempt.measurementStartedAt, (await getSheet(f.db, f.owner, sheet)).created_at)
    }
    assert.equal((await f.attempts()).length, 3, 'empty boxes create no attempts or pending grades')
    const sheet = await f.within(() => createSheet(f.db, f.owner, f.student))
    const items: Item[] = JSON.parse(String((await getSheet(f.db, f.owner, sheet)).spec_json)).items
    const response = await f.request('/sheet/' + sheet + '/score', { 'box-4': items[3].rubric!.examples.meets, completed: '1', confirmed: '1', paperHelp: 'none' })
    assert.equal(response.status, 200)
    assert.equal((await f.db.prepare("SELECT count(*) n FROM jobs WHERE kind = 'grade'").get())?.n, 0, 'no AI connection creates no doomed grade job')
    assert.match(await (await f.request('/sheet/' + sheet)).text(), /awaiting a check/)
  } finally { await f.close() }
})

test('an unsubmitted printed sheet prevents an unrefreshed claim and its questions cannot reappear in the independent check', async () => {
  const f = await learningRouteFixture({ ai: false })
  try {
    const begin = async (goal: string) => {
      const response = await f.request('/students/' + f.student + '/session', { mode: 'assessment', goal, focusConceptId: FRACTION_TARGET })
      assert.equal(response.status, 303)
      return response.headers.get('location')!
    }
    const answer = async (path: string, row: Record<string, any>) => {
      await f.request(path); await f.request(path + '/seen', { itemId: row.id, what: 'question' })
      f.advance(15000)
      assert.equal((await f.request(path + '/answer', { itemId: row.id, revision: row.revision_id, answer: row.answer, receipt: '1' })).status, 200)
    }
    const first = await begin('independent_check')
    for (const row of (await f.items(first.split('/').at(-1)!)).slice(0, 2)) await answer(first, row)
    await f.request(first + '/finish', {})
    f.advance(6 * 86400000)
    const sheet = await f.within(() => createSheet(f.db, f.owner, f.student))
    const items: Item[] = JSON.parse(String((await getSheet(f.db, f.owner, sheet)).spec_json)).items
    const exposed = await f.db.prepare('SELECT * FROM learning_exposures WHERE session_id = ?').all(sheet)
    assert.equal(exposed.length, 4); assert.ok(exposed.every(row => row.confirmed === 0))
    f.advance(86400000)
    const delayed = await begin('delayed_check')
    await assert.rejects(f.within(() => createSheet(f.db, f.owner, f.student)), /Finish your assessment/)
    await assert.rejects(f.within(() => scoreSheet(f.db, f.owner, sheet, [])), /Finish your assessment/)
    assert.equal((await f.request('/sheet/' + sheet)).status, 303, 'the open independent check also fences paper delivery')
    const later = await f.items(delayed.split('/').at(-1)!)
    assert.equal(later.length, 2)
    assert.ok(later.every(row => !items.some(item => item.prompt === row.prompt)))
    for (const row of later) await answer(delayed, row)
    const pairs = (await f.retained()).filter(pair => pair.after.sessionId === delayed.split('/').at(-1))
    assert.equal(pairs.length, 2)
    assert.ok(pairs.every(pair => !pair.unrefreshed && pair.comparison === 'validated'))
    assert.equal((await getSheet(f.db, f.owner, sheet)).score_results, null, 'no paper submission was manufactured')
  } finally { await f.close() }
})
