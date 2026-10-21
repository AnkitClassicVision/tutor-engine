import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.ts'
import { registerUser, openAuthSession } from '../src/auth.ts'
import { handle } from '../src/server.ts'
import { assessmentOpen, openAssessment } from '../src/assessment.ts'
import { feedbackState } from '../src/session-feedback.ts'
import { createJob, ownedJob } from '../src/jobs.ts'
import { waitingReview, answerWaitingReview } from '../src/waiting-review.ts'
import { createStudent, startTutorSession, sessionItems, getOwnedSession, useHint, submitAnswer, reviewAnswer,
  finishAssessment, resumeSession, saveAiSettings, loadAttempts, addLearning } from '../src/services.ts'

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'tutor-assessment-')), db = openDb(join(dir, 'test.sqlite'))
  const user = await registerUser(db, 'assessment@example.invalid', 'synthetic-assessment-password')
  assert.ok(user.ok)
  const owner = user.userId, auth = await openAuthSession(db, owner)
  const student = await createStudent(db, owner, { displayName: 'Synthetic learner', grade: 5, sessionCapMinutes: 10 })
  const learning = await startTutorSession(db, owner, student, new Date(), { arc: false })
  const session = await startTutorSession(db, owner, student, new Date(), { mode: 'assessment' })
  await db.prepare('DELETE FROM session_items WHERE session_id = ?').run(session)
  for (let n = 1; n <= 4; n++) await db.prepare(`INSERT INTO session_items
    (id, session_id, position, beat, concept_id, bloom_level, prompt, answer, hints_json, surface, interleaved, hints_used, answered, format)
    VALUES (?, ?, ?, 'frontier', 'math.5.nf.a.1', 3, ?, '4', ?, 'screen', 0, 0, 0, 'number')`)
    .run(crypto.randomUUID(), session, n, `Synthetic assessment ${n}: two groups of two.`, JSON.stringify(['PRIVATE_HINT', 'SECOND_HINT', 'LAST_HINT']))
  const server = createServer((req, res) => { void handle(req, res, { db, uploadsDir: join(dir, 'uploads') }).catch(() => { res.writeHead(500); res.end('Request failed') }) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const request = (path: string, data?: Record<string, unknown>) => fetch(`http://127.0.0.1:${address.port}${path}`, {
    redirect: 'manual', method: data ? 'POST' : 'GET', headers: { Cookie: `tutor_session=${auth.token}`, ...(data ? { 'Content-Type': 'application/json', Accept: 'application/json' } : {}) },
    body: data ? JSON.stringify({ csrf: auth.csrf, ...data }) : undefined,
  })
  const items = await sessionItems(db, session)
  return { db, owner, student, learning, session, items, request, async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); rmSync(dir, { recursive: true, force: true }) } }
}

function noTeaching(html: string) {
  assert.doesNotMatch(html, /PRIVATE_HINT|SECOND_HINT|LAST_HINT|class="feedback-review"|class="verdict"|Key or rubric:|Show me how|Want to talk it through|Yes! That holds|Needs another look/)
}

test('assessment saves neutral answers and blocks help through the service and alternate routes', async () => {
  const f = await fixture()
  try {
    const first = f.items[0]
    const result = await f.request(`/session/${f.session}/answer`, { itemId: first.id, answer: '5' })
    assert.equal(result.status, 303); assert.equal(result.headers.get('location'), `/session/${f.session}?saved=answer`)
    const html = await (await f.request(result.headers.get('location')!)).text()
    assert.match(html, /Answer saved\./); assert.match(html, /Save and continue/); noTeaching(html)
    await assert.rejects(useHint(f.db, f.owner, f.session, String(f.items[1].id)), /Finish your assessment/)
    const old = (await sessionItems(f.db, f.learning))[0]
    await assert.rejects(useHint(f.db, f.owner, f.learning, String(old.id)), /Finish your assessment/)
    for (const action of ['hint', 'ask', 'feedback', 'recap', 'lesson']) {
      const blocked = await f.request(`/session/${f.session}/${action}`, { itemId: f.items[1].id, message: 'Explain this', learned: 'idea', hard: 'step', tellFriend: 'try' })
      assert.equal(blocked.status, 409, action)
      assert.equal((await blocked.json()).location, `/session/${f.session}`)
    }
    for (const path of [`/session/${f.learning}`, `/students/${f.student}/map`, `/students/${f.student}/insights`, `/students/${f.student}/materials`, `/students/${f.student}/live`]) {
      assert.equal((await f.request(path)).headers.get('location'), `/session/${f.session}`, path)
    }
    assert.equal((await f.request(`/session/${f.session}/seen`, { itemId: first.id, what: 'feedback' })).status, 400)
    assert.equal((await f.db.prepare('SELECT hints_used FROM session_items WHERE id = ?').get(f.items[1].id))!.hints_used, 0)
  } finally { await f.close() }
})

test('a pause and attention stop retain the assessment, drafts and hidden feedback until final submission', async () => {
  const f = await fixture()
  try {
    await f.request(`/session/${f.session}/answer`, { itemId: f.items[0].id, answer: '5' })
    await f.request(`/session/${f.session}/draft`, { itemId: f.items[1].id, answer: 'my saved response' })
    await f.request(`/session/${f.session}/pause`, {})
    let html = await (await f.request(`/session/${f.session}`)).text()
    assert.match(html, /Resume assessment/); noTeaching(html)
    assert.equal((await f.db.prepare('SELECT count(*) n FROM lesson_messages WHERE session_id = ?').get(f.session))!.n, 0)
    await f.request(`/session/${f.session}/resume`, {})
    await f.db.prepare('UPDATE tutor_sessions SET started_at = ? WHERE id = ?').run(new Date(Date.now() - 11 * 60000).toISOString(), f.session)
    html = await (await f.request(`/session/${f.session}`)).text()
    assert.match(html, /Resume assessment/); noTeaching(html)
    const late = await f.request(`/session/${f.session}/answer`, { itemId: f.items[1].id, answer: 'my completed response after the timer' })
    assert.equal(late.headers.get('location'), `/session/${f.session}`)
    assert.doesNotMatch(await (await f.request(`/session/${f.session}`)).text(), /Answer saved\./)
    assert.equal(await resumeSession(f.db, f.owner, f.session), f.session)
    assert.equal((await sessionItems(f.db, f.session))[1].draft_answer, 'my completed response after the timer')
    assert.deepEqual((await sessionItems(f.db, f.session)).map(i => i.id), f.items.map(i => i.id))
    await f.request(`/session/${f.session}/finish`, {})
    html = await (await f.request(`/session/${f.session}`)).text()
    assert.match(html, /Assessment complete/); assert.match(html, /3 questions were left unanswered/); assert.match(html, /Needs another look/)
    assert.equal(await openAssessment(f.db, f.owner, f.student), undefined)
    assert.equal(await resumeSession(f.db, f.owner, f.session), f.session)
    await f.request(`/session/${f.session}/answer`, { itemId: f.items[1].id, answer: '4' })
    assert.equal((await sessionItems(f.db, f.session))[1].answered, 0, 'feedback cannot be used to resume the check')
    assert.equal((await f.request(`/session/${f.session}/draft`, { itemId: f.items[1].id, answer: '4' })).status, 400)
    assert.equal((await loadAttempts(f.db, f.student)).filter(a => a.sessionId === f.session).length, 1)
  } finally { await f.close() }
})

test('written assessment answers continue without a grading wait; grades and pending work appear only at completion', async () => {
  const f = await fixture()
  try {
    await saveAiSettings(f.db, f.owner, { provider: 'openai', model: 'synthetic', apiKey: 'synthetic-key' })
    for (const item of [f.items[0], f.items[1], f.items[3]]) await f.db.prepare("UPDATE session_items SET bloom_level = 5, format = 'written', answer = 'Rubric: justify the choice.' WHERE id = ?").run(item.id)
    const declared = await sessionItems(f.db, f.session)
    for (const item of f.items.slice(0, 2)) {
      const reply = await f.request(`/session/${f.session}/answer`, { itemId: item.id, answer: 'I choose this method because the groups have the same size.' })
      assert.equal(reply.status, 303); assert.equal(reply.headers.get('location'), `/session/${f.session}?saved=answer`)
      noTeaching(await (await f.request(reply.headers.get('location')!)).text())
    }
    const jobs = await f.db.prepare("SELECT id FROM jobs WHERE student_id = ? AND kind = 'grade'").all(f.student)
    assert.equal(jobs.length, 2)
    assert.equal((await f.request(`/jobs/${jobs[0].id}/status`)).headers.get('location'), `/session/${f.session}`)
    await reviewAnswer(f.db, f.owner, f.session, { itemId: String(f.items[0].id), correct: false, reason: 'The justification needs a valid comparison.' })
    noTeaching(await (await f.request(`/session/${f.session}`)).text())
    assert.deepEqual((await sessionItems(f.db, f.session)).slice(2).map(i => [i.prompt, i.bloom_level]), declared.slice(2).map(i => [i.prompt, i.bloom_level]))
    await f.request(`/session/${f.session}/answer`, { itemId: f.items[2].id, answer: '4' })
    const finalAnswer = 'I choose this method because the groups have the same size.'
    await f.request(`/session/${f.session}/answer`, { itemId: f.items[3].id, answer: finalAnswer })
    assert.equal((await getOwnedSession(f.db, f.owner, f.session)).end_reason, 'assessment_submitted')
    await f.request(`/session/${f.session}/answer`, { itemId: f.items[3].id, answer: 'A different answer after a lost reply' })
    assert.equal((await sessionItems(f.db, f.session))[3].given_answer, finalAnswer)
    assert.equal((await f.db.prepare("SELECT count(*) n FROM jobs WHERE student_id = ? AND kind = 'grade'").get(f.student))!.n, 3, 'retrying the final written answer reuses its grading job')
    const html = await (await f.request(`/session/${f.session}`)).text()
    assert.match(html, /Assessment complete/); assert.match(html, /Needs another look/)
    assert.equal(feedbackState('assessment', await sessionItems(f.db, f.session), 0).entries.length, 4)
    assert.equal((await f.db.prepare('SELECT count(*) n FROM attempts WHERE session_id = ?').get(f.session))!.n, 2, 'pending grading is not an incorrect attempt')
  } finally { await f.close() }
})

test('leaving questions unanswered completes the declared check without invented failure evidence', async () => {
  const f = await fixture()
  try {
    for (const item of f.items) {
      for (let retry = 0; retry < 2; retry++) {
        const result = await f.request(`/session/${f.session}/answer`, { itemId: item.id, skip: '1', answer: 'this draft should not be graded' })
        assert.equal(result.status, 303, 'retrying a skipped question cannot skip the next one')
      }
    }
    const html = await (await f.request(`/session/${f.session}`)).text()
    assert.match(html, /Assessment complete/); assert.match(html, /4 questions were left unanswered/)
    assert.equal((await loadAttempts(f.db, f.student)).filter(a => a.sessionId === f.session).length, 0)
    assert.equal(await openAssessment(f.db, f.owner, f.student), undefined)
    assert.equal((await getOwnedSession(f.db, f.owner, f.session)).end_reason, 'assessment_submitted')
  } finally { await f.close() }
})

test('waiting activities and earlier job feedback cannot teach during a check', async () => {
  const f = await fixture()
  try {
    const id = await createJob(f.db, f.owner, f.student, 'grade', { sessionId: f.session }, 'synthetic-assessment-job')
    const job = await ownedJob(f.db, f.owner, id)
    assert.equal(await waitingReview(f.db, f.owner, job, true), null)
    assert.equal(await answerWaitingReview(f.db, f.owner, job, '4', 'old-ref'), 'changed')
    const preparation = { ...job, kind: 'fresh_practice', payload: JSON.stringify({ options: { mode: 'assessment' } }) }
    await finishAssessment(f.db, f.owner, f.session)
    assert.equal(await waitingReview(f.db, f.owner, preparation, true), null)
  } finally { await f.close() }
})

test('legacy completed or continued checks cannot be reopened after their feedback is available', async () => {
  const f = await fixture()
  try {
    for (const reason of ['recap', 'continued']) {
      await f.db.prepare('UPDATE tutor_sessions SET ended_at = ?, end_reason = ? WHERE id = ?').run(new Date().toISOString(), reason, f.session)
      assert.equal(await openAssessment(f.db, f.owner, f.student), undefined)
      assert.match(await (await f.request(`/session/${f.session}`)).text(), /Assessment complete/)
      await resumeSession(f.db, f.owner, f.session)
      assert.equal((await getOwnedSession(f.db, f.owner, f.session)).end_reason, reason)
      await submitAnswer(f.db, f.owner, f.session, { itemId: String(f.items[0].id), answer: '4' })
      assert.equal((await sessionItems(f.db, f.session))[0].answered, 0)
    }
  } finally { await f.close() }
})

test('assessment access controls follow the measured skill; ordinary learning still allows help', async () => {
  const f = await fixture()
  try {
    const first = String(f.items[0].id)
    assert.equal((await f.request(`/session/${f.session}/access`, { itemId: first, kind: 'read_aloud' })).status, 200)
    const reading = await addLearning(f.db, f.owner, f.student, { purpose: 'year', subject: 'Reading', title: 'Decode a word', recall: 'Read the written word.' })
    await f.db.prepare('UPDATE session_items SET concept_id = ? WHERE id = ?').run(reading, first)
    let html = await (await f.request(`/session/${f.session}`)).text()
    assert.doesNotMatch(html, /data-hear>Read aloud/)
    assert.equal((await f.request(`/session/${f.session}/access`, { itemId: first, kind: 'read_aloud' })).status, 400)
    const spelling = await addLearning(f.db, f.owner, f.student, { purpose: 'year', subject: 'Spelling', title: 'Spell a word', recall: 'Write the word.' })
    await f.db.prepare('UPDATE session_items SET concept_id = ? WHERE id = ?').run(spelling, first)
    html = await (await f.request(`/session/${f.session}`)).text()
    assert.doesNotMatch(html, /data-talk/)
    assert.match(html, /spellcheck="false" autocorrect="off" autocapitalize="off"/)
    assert.equal((await f.request(`/session/${f.session}/access`, { itemId: first, kind: 'voice_entry' })).status, 400)
    await finishAssessment(f.db, f.owner, f.session)
    const old = (await sessionItems(f.db, f.learning))[0]
    await useHint(f.db, f.owner, f.learning, String(old.id))
    assert.equal((await sessionItems(f.db, f.learning))[0].hints_used, 1)
    assert.equal(assessmentOpen(await getOwnedSession(f.db, f.owner, f.session), await sessionItems(f.db, f.session)), false)
  } finally { await f.close() }
})
