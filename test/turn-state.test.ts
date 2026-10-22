import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { openDb } from '../src/db.ts'
import { openAuthSession, registerUser } from '../src/auth.ts'
import { handle, gradePendingResponses } from '../src/server.ts'
import { createStudent, startTutorSession, sessionItems, saveAiSettings, finishAssessment, reviewAnswer, loadAttempts } from '../src/services.ts'
import { stampTask } from '../src/task-evidence.ts'
import { pendingReviewStates } from '../src/turn-state.ts'

async function fixture() {
  const db = openDb(':memory:'), user = await registerUser(db, 'turn@example.invalid', 'synthetic-turn-password')
  assert.ok(user.ok)
  const owner = user.userId, auth = await openAuthSession(db, owner)
  const student = await createStudent(db, owner, { displayName: 'Synthetic turn', grade: 5, sessionCapMinutes: 10 })
  const session = await startTutorSession(db, owner, student, new Date(), { mode: 'assessment' })
  await db.prepare('DELETE FROM session_items WHERE session_id = ?').run(session)
  for (let n = 1; n <= 3; n++) {
    const id = crypto.randomUUID(), written = n > 1
    await db.prepare(`INSERT INTO session_items (id, session_id, position, beat, concept_id, bloom_level, prompt, answer, hints_json, surface, interleaved, hints_used, answered, format)
      VALUES (?, ?, ?, 'frontier', 'math.primary.3.multiply', ?, ?, ?, '[]', 'screen', 0, 0, 0, ?)`)
      .run(id, session, n, written ? 5 : 3, written ? `Synthetic reasoning ${n}: justify equal groups.` : 'How many are in two groups of two?', written ? 'Rubric: explain equal groups.' : '4', written ? 'text' : 'number')
    await stampTask(db, id, 'designed')
  }
  const server = createServer((req, res) => { void handle(req, res, { db, uploadsDir: '/var/tmp/synthetic-unused-turn-uploads' }).catch(() => { res.writeHead(500); res.end('Request failed') }) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const request = (path: string, data?: Record<string, unknown>, token = auth.token) => fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: data ? 'POST' : 'GET', redirect: 'manual', headers: { Cookie: `tutor_session=${token}`, ...(data ? { 'Content-Type': 'application/json', Accept: 'application/json' } : {}) },
    body: data ? JSON.stringify({ csrf: auth.csrf, ...data }) : undefined,
  })
  const items = await sessionItems(db, session)
  const send = (item: Record<string, any>, answer = 'I use equal groups because each group has the same number.') => request(`/session/${session}/answer`, { itemId: item.id, revision: item.revision_id, answer, activeMs: 4500, receipt: '1' })
  return { db, owner, student, session, items, request, send, async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close() } }
}

test('only the saved revision gets a neutral acknowledgment and answer-free timing; retries preserve the first answer', async () => {
  const f = await fixture()
  try {
    const item = f.items[0], path = `/session/${f.session}`
    assert.equal((await f.request(`${path}/draft`, { itemId: item.id, revision: 'stale', answer: 'old draft' })).status, 400)
    assert.equal((await f.request(`${path}/answer`, { itemId: item.id, revision: 'stale', answer: '4', receipt: '1' })).status, 400)
    const draft = await (await f.request(`${path}/draft`, { itemId: item.id, revision: item.revision_id, answer: '4' })).json()
    assert.deepEqual([draft.saved, draft.itemId, draft.revision], [true, item.id, item.revision_id])
    assert.equal((await f.request(`${path}/save-seen`, { itemId: item.id, revision: item.revision_id, elapsedMs: 1200 })).status, 400)
    assert.equal((await f.request(`${path}/access`, { itemId: item.id, kind: 'format_help' })).status, 200)
    const first = await f.send(item, '4'), receipt = await first.json()
    assert.equal(first.status, 200); assert.equal(receipt.saved, true)
    assert.equal(receipt.location, `${path}?saved=answer`)
    assert.deepEqual(Object.keys(receipt).sort(), ['discardDraft', 'itemId', 'location', 'revision', 'saved'])
    const saved = (await sessionItems(f.db, f.session))[0]
    assert.ok(Date.parse(String(saved.answer_saved_at)) >= Date.parse(String(saved.submitted_at)))
    assert.equal(saved.active_work_ms, 4500); assert.ok(saved.graded_at)
    assert.equal((await f.request(`${path}/draft`, { itemId: item.id, revision: item.revision_id, answer: 'late' })).status, 400)
    assert.equal((await f.request(`${path}/save-seen`, { itemId: item.id, revision: 'stale', elapsedMs: 1200 })).status, 400)
    for (const elapsedMs of [1234, 9999]) assert.equal((await f.request(`${path}/save-seen`, { itemId: item.id, revision: item.revision_id, elapsedMs })).status, 200)
    for (const elapsedMs of [-1, null, '123', 86400001]) assert.equal((await f.request(`${path}/save-seen`, { itemId: item.id, revision: item.revision_id, elapsedMs })).status, 400)
    const other = await registerUser(f.db, 'other-turn@example.invalid', 'synthetic-other-password'); assert.ok(other.ok)
    const stranger = await openAuthSession(f.db, other.userId)
    assert.equal((await f.request(`${path}/save-seen`, { csrf: stranger.csrf, itemId: item.id, revision: item.revision_id, elapsedMs: 1 }, stranger.token)).status, 400)
    await f.send(item, 'changed after losing the reply')
    const retried = (await sessionItems(f.db, f.session))[0]
    assert.equal(retried.given_answer, '4'); assert.equal(retried.answer_saved_at, saved.answer_saved_at); assert.equal(retried.submit_to_save_ms, 1234)
    const attempts = await loadAttempts(f.db, f.student)
    assert.equal(attempts.length, 1); assert.deepEqual(attempts[0].accessSupport, ['format_help']); assert.equal(attempts[0].hintsUsed, 0)
    assert.equal((await f.request(`${path}/seen`, { itemId: item.id, what: 'feedback' })).status, 400, 'timing does not bypass the assessment seal')
  } finally { await f.close() }
})

test('native pause saves the current draft atomically without grading or opening assessment feedback', async () => {
  const f = await fixture()
  try {
    const item = f.items[0], path = `/session/${f.session}`
    for (const changes of [{ revision: 'stale' }, { itemId: f.items[1].id }, { answer: 'x'.repeat(4001) }]) {
      assert.equal((await f.request(`${path}/pause`, { itemId: item.id, revision: item.revision_id, answer: 'native draft', ...changes })).status, 400)
      assert.equal((await f.db.prepare('SELECT paused_at FROM tutor_sessions WHERE id = ?').get(f.session))!.paused_at, null)
    }
    assert.equal((await f.request(`${path}/pause`, { itemId: item.id, revision: item.revision_id, answer: 'native draft' })).status, 303)
    assert.equal((await sessionItems(f.db, f.session))[0].draft_answer, 'native draft')
    assert.ok((await f.db.prepare('SELECT paused_at FROM tutor_sessions WHERE id = ?').get(f.session))!.paused_at)
    assert.equal((await loadAttempts(f.db, f.student)).length, 0)
    assert.equal((await f.request(`${path}/resume`, {})).status, 303)
    assert.match(await (await f.request(path)).text(), /native draft/)
    await finishAssessment(f.db, f.owner, f.session)
    assert.equal((await f.request(`${path}/pause`, { itemId: item.id, revision: item.revision_id, answer: 'late edit' })).status, 400)
    assert.equal((await sessionItems(f.db, f.session))[0].draft_answer, 'native draft')
  } finally { await f.close() }
})

test('queued, running, failed and parent-required checks remain distinct, with actual checker transitions', async () => {
  const f = await fixture()
  try {
    await saveAiSettings(f.db, f.owner, { provider: 'openai', model: 'synthetic', apiKey: 'synthetic-key' })
    await f.send(f.items[0], '4')
    const item = f.items[1], response = await f.send(item)
    assert.equal((await response.json()).saved, true)
    const job = (await f.db.prepare("SELECT id FROM jobs WHERE idempotency_key = ?").get(`grade:${item.id}`))!
    const state = async () => (await pendingReviewStates(f.db, f.student, await sessionItems(f.db, f.session), false)).get(String(item.id))!
    assert.equal((await state()).state, 'queued')
    assert.equal((await pendingReviewStates(f.db, f.student, await sessionItems(f.db, f.session), true)).get(String(item.id))!.state, 'queued', 'an active job is not a parent assignment')
    await f.db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(job.id)
    assert.equal((await state()).state, 'checking')
    await gradePendingResponses(f.db, f.owner, f.session, async () => ({ kind: 'failed' }), [String(item.id)])
    await f.db.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?").run(job.id)
    assert.equal((await state()).state, 'retry')
    let pending = (await sessionItems(f.db, f.session))[1]
    assert.ok(pending.grading_started_at); assert.ok(Date.parse(String(pending.grading_finished_at)) >= Date.parse(String(pending.grading_started_at)))
    assert.equal(pending.graded_at, null); assert.equal((await loadAttempts(f.db, f.student)).length, 1)
    await gradePendingResponses(f.db, f.owner, f.session, async () => ({ kind: 'escalated', doubt: 'Synthetic uncertainty after checking.' }), [String(item.id)])
    await f.db.prepare("UPDATE jobs SET status = 'succeeded' WHERE id = ?").run(job.id)
    assert.equal((await state()).state, 'parent')
    await finishAssessment(f.db, f.owner, f.session)
    const html = await (await f.request(`/session/${f.session}`)).text()
    assert.match(html, /saved for a grown-up to check/)
    await f.request(`/session/${f.session}/seen`, { itemId: item.id, what: 'feedback' })
    assert.equal((await sessionItems(f.db, f.session))[1].feedback_visible_at, null, 'seeing a pending card is not seeing a grade')
    await reviewAnswer(f.db, f.owner, f.session, { itemId: String(item.id), correct: true })
    await f.request(`/session/${f.session}/seen`, { itemId: item.id, what: 'feedback' })
    pending = (await sessionItems(f.db, f.session))[1]
    assert.ok(Date.parse(String(pending.feedback_visible_at)) >= Date.parse(String(pending.graded_at)))
  } finally { await f.close() }
})

test('without an AI connection a stored written answer requires a parent and starts no doomed job', async () => {
  const f = await fixture()
  try {
    await f.db.prepare("UPDATE users SET ai_provider = 'openai', ai_model = '', ai_key = '' WHERE id = ?").run(f.owner)
    await f.send(f.items[0], '4'); const receipt = await (await f.send(f.items[1])).json()
    assert.equal(receipt.saved, true)
    assert.equal((await pendingReviewStates(f.db, f.student, await sessionItems(f.db, f.session), true)).get(String(f.items[1].id))!.state, 'parent')
    assert.equal((await f.db.prepare('SELECT count(*) n FROM jobs WHERE student_id = ?').get(f.student))!.n, 0)
    assert.equal((await loadAttempts(f.db, f.student)).length, 1)
  } finally { await f.close() }
})
