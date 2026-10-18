import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDb } from '../src/db.ts'
import { registerUser, openAuthSession } from '../src/auth.ts'
import { acknowledgeFeedback, createStudent, startTutorSession, sessionItems, submitAnswer, loadAttempts, listStates } from '../src/services.ts'
import { createJob, ownedJob } from '../src/jobs.ts'
import { handle } from '../src/server.ts'
import { needsJudgment } from '../src/engine/score.ts'
import { dayStamp } from '../src/engine/dates.ts'
import { answerWaitingReview, chooseReview, waitingReview } from '../src/waiting-review.ts'

/** A learner who solved a mission alone ten days ago, so a review is genuinely due now. */
async function learnerWithDueReview() {
  const dir = mkdtempSync(join(tmpdir(), 'tutor-review-')), db = openDb(join(dir, 'test.sqlite'))
  const u = await registerUser(db, 'review@example.com', 'long-review-password'); if (!u.ok) throw new Error()
  const student = await createStudent(db, u.userId, { displayName: 'Synthetic learner', grade: 3, sessionCapMinutes: 25 })
  const past = new Date(Date.now() - 10 * 86400000)
  const session = await startTutorSession(db, u.userId, student, past, { focusConceptId: 'math.primary.3.multiply' })
  // Answer in order with the key; written items wait for a verdict and feedback pauses are acknowledged.
  for (let guard = 0; guard < 20; guard++) {
    const item = (await sessionItems(db, session)).find((i) => i.answered === 0)
    if (!item) break
    await acknowledgeFeedback(db, u.userId, session)
    const written = needsJudgment({ answer: String(item.answer), format: String(item.format), choices: null }, Number(item.bloom_level))
    await submitAnswer(db, u.userId, session, { itemId: String(item.id), answer: written ? 'Equal groups of the same size, counted together.' : String(item.answer) }, past)
  }
  const today = dayStamp(new Date())
  assert.ok((await listStates(db, student)).some((s) => s.nextDue <= today && s.independentChecks), 'fixture has a due review')
  const jobId = await createJob(db, u.userId, student, 'lesson', { input: {} }, `lesson:${crypto.randomUUID()}`)
  return { dir, db, owner: u.userId, student, job: await ownedJob(db, u.userId, jobId) }
}

test('a child waiting on new work answers one due review, scored once as real evidence', async () => {
  const f = await learnerWithDueReview()
  try {
    assert.equal(await waitingReview(f.db, f.owner, f.job, false), null, 'never offered on a parent-unlocked page')
    const card = await waitingReview(f.db, f.owner, f.job, true)
    assert.ok(card && card.state === 'ask')
    const missionsBefore = (await f.db.prepare("SELECT count(*) n FROM tutor_sessions").get())!.n
    const attemptsBefore = (await loadAttempts(f.db, f.student)).length
    assert.equal(await answerWaitingReview(f.db, f.owner, f.job, '12', 'not-the-shown-question'), 'changed', 'an answer is never scored against a different question')
    assert.equal(await answerWaitingReview(f.db, f.owner, f.job, 'idk', card.ref), 'reask')
    assert.equal((await f.db.prepare("SELECT count(*) n FROM tutor_sessions").get())!.n, missionsBefore, 'nothing is stored before a real answer')
    const chosen = (await chooseReview(f.db, f.owner, f.job))!
    assert.equal(chosen.item.prompt, card.prompt, 'the server regenerates the same question')
    assert.equal(await answerWaitingReview(f.db, f.owner, f.job, chosen.item.answer, card.ref), 'scored')
    assert.equal(await answerWaitingReview(f.db, f.owner, f.job, chosen.item.answer, card.ref), 'scored')
    const attempts = await loadAttempts(f.db, f.student)
    assert.equal(attempts.length, attemptsBefore + 1, 'recorded exactly once')
    assert.ok(attempts.at(-1)!.correct)
    const done = await waitingReview(f.db, f.owner, f.job, true)
    assert.deepEqual(done && done.state, 'done'); assert.ok(done && done.state === 'done' && done.correct)
    const session = (await f.db.prepare("SELECT ended_at, end_reason, goal FROM tutor_sessions WHERE goal LIKE 'waiting_review:%'").get())!
    assert.ok(session.ended_at); assert.equal(session.end_reason, 'waiting_review')
    const counted = (await f.db.prepare("SELECT count(*) n FROM tutor_sessions s WHERE student_id = ? AND coalesce(s.goal, '') NOT LIKE 'waiting_review:%'").get(f.student))!.n
    assert.equal(counted, missionsBefore, 'the review is not counted as a mission')
  } finally { f.db.close() }
})

test('a missed review shows a clue, never the answer, and the card leaves with a finished job', async () => {
  const f = await learnerWithDueReview()
  try {
    const card = (await waitingReview(f.db, f.owner, f.job, true))!
    assert.equal(card.state, 'ask')
    const chosen = (await chooseReview(f.db, f.owner, f.job))!
    assert.equal(await answerWaitingReview(f.db, f.owner, f.job, String(Number(chosen.item.answer) + 7), card.state === 'ask' ? card.ref : ''), 'scored')
    const done = (await waitingReview(f.db, f.owner, f.job, true))!
    assert.ok(done.state === 'done' && !done.correct && done.clue)
    await f.db.prepare("UPDATE jobs SET status = 'succeeded' WHERE id = ?").run(f.job.id)
    assert.equal(await waitingReview(f.db, f.owner, await ownedJob(f.db, f.owner, f.job.id), true), null, 'the answered card also leaves when the job finishes')
    const other = await ownedJob(f.db, f.owner, await createJob(f.db, f.owner, f.student, 'lesson', { input: {} }, `lesson:${crypto.randomUUID()}`))
    await f.db.prepare("UPDATE jobs SET status = 'succeeded' WHERE id = ?").run(other.id)
    assert.equal(await waitingReview(f.db, f.owner, await ownedJob(f.db, f.owner, other.id), true), null, 'no new card once the job is finished')
  } finally { f.db.close() }
})

test('the job page offers the card only to the child, and parents cannot answer for them', async () => {
  const f = await learnerWithDueReview()
  const auth = await openAuthSession(f.db, f.owner)
  const server = createServer((req, res) => { handle(req, res, { db: f.db, uploadsDir: join(f.dir, 'uploads') }).catch(() => { res.writeHead(500); res.end() }) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as any).port}`
  const request = (path: string, data?: any) => fetch(`${origin}${path}`, { redirect: 'manual', method: data ? 'POST' : 'GET', headers: { Cookie: `tutor_session=${auth.token}`, ...(data ? { 'Content-Type': 'application/json', Accept: 'application/json' } : {}) }, body: data ? JSON.stringify({ csrf: auth.csrf, ...data }) : undefined })
  try {
    assert.doesNotMatch(await (await request(`/jobs/${f.job.id}`)).text(), /Remember this one\?/, 'a parent-unlocked page shows no child question')
    assert.equal((await request(`/jobs/${f.job.id}/review`, { answer: '12', ref: 'x' })).status, 403)
    assert.equal((await request('/parent/lock', { studentId: f.student })).status, 303)
    const page = await (await request(`/jobs/${f.job.id}`)).text()
    assert.match(page, /Remember this one\?/); assert.doesNotMatch(page, /A tiny learning moment/, 'the review replaces the passive nugget')
    const ref = page.match(/name="ref" value="([^"]+)"/)![1]
    const reask = await request(`/jobs/${f.job.id}/review`, { answer: '?', ref })
    assert.equal(reask.headers.get('location'), `/jobs/${f.job.id}?review=reask#review`)
    assert.match(await (await request(`/jobs/${f.job.id}?review=reask`)).text(), /Have a go\. A guess is fine\./)
    const chosen = (await chooseReview(f.db, f.owner, f.job))!
    assert.equal((await request(`/jobs/${f.job.id}/review`, { answer: chosen.item.answer, ref })).headers.get('location'), `/jobs/${f.job.id}#review`)
    assert.match(await (await request(`/jobs/${f.job.id}`)).text(), /Yes! You remembered\./)
  } finally { server.close(); f.db.close() }
})

test('two answers arriving together for the same review are scored once', async () => {
  const f = await learnerWithDueReview()
  try {
    const card = (await waitingReview(f.db, f.owner, f.job, true))!
    const chosen = (await chooseReview(f.db, f.owner, f.job))!
    const before = (await loadAttempts(f.db, f.student)).length
    const ref = card.state === 'ask' ? card.ref : ''
    assert.deepEqual(await Promise.all([answerWaitingReview(f.db, f.owner, f.job, chosen.item.answer, ref), answerWaitingReview(f.db, f.owner, f.job, chosen.item.answer, ref)]), ['scored', 'scored'])
    assert.equal((await loadAttempts(f.db, f.student)).length, before + 1)
    assert.equal((await f.db.prepare("SELECT count(*) n FROM tutor_sessions WHERE goal LIKE 'waiting_review:%'").get())!.n, 1)
  } finally { f.db.close() }
})
