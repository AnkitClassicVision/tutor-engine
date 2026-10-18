import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDb } from '../src/db.ts'
import { registerUser, openAuthSession } from '../src/auth.ts'
import { missionArc } from '../src/engine/arc.ts'
import { acknowledgeFeedback, createStudent, startTutorSession, sessionItems, submitAnswer, loadAttempts, pauseSession, resumeSession, enforceSessionTime } from '../src/services.ts'
import { freshEvidence } from '../src/engine/mastery.ts'
import { needsJudgment } from '../src/engine/score.ts'
import { handle } from '../src/server.ts'
import type { QueueSlot } from '../src/engine/types.ts'

const slot = (beat: QueueSlot['beat'], conceptId: string): QueueSlot => ({ beat, conceptId, bloomLevel: 2, interleaved: beat === 'warmup', partnerConceptId: null, scored: true })

test('the arc runs guided, faded, independent, one review; shorter missions drop independent work first', () => {
  const queue = [slot('warmup', 'review.a'), slot('warmup', 'review.b'), ...Array.from({ length: 7 }, () => slot('frontier', 'main')), slot('stretch', 'main')]
  const ten = missionArc(queue, 10)
  assert.deepEqual(ten.map((s) => s.beat), ['guided', 'faded', 'frontier', 'frontier', 'frontier', 'frontier', 'review'])
  assert.equal(ten[0].conceptId, 'main'); assert.equal(ten.at(-1)!.conceptId, 'review.a')
  const three = missionArc(queue, 3)
  assert.deepEqual(three.map((s) => s.beat), ['guided', 'faded', 'frontier', 'review'], 'the review stays in the shortest mission')
  assert.equal(missionArc(queue, 25).filter((s) => s.beat === 'frontier' || s.beat === 'stretch').length, 10)
  assert.deepEqual(missionArc(queue.filter((s) => s.beat !== 'warmup'), 5).map((s) => s.beat), ['guided', 'faded', 'frontier', 'frontier'], 'no review is invented when none is due')
})

/** A learner with real history: earlier missions answered alone on two days, so practice is no longer a first check. */
async function experienced() {
  const dir = mkdtempSync(join(tmpdir(), 'tutor-arc-')), db = openDb(join(dir, 'test.sqlite'))
  const u = await registerUser(db, 'arc@example.com', 'long-arc-password'); if (!u.ok) throw new Error()
  const student = await createStudent(db, u.userId, { displayName: 'Synthetic learner', grade: 3, sessionCapMinutes: 25 })
  for (const [concept, daysAgo] of [['math.primary.2.add', 12], ['math.primary.3.multiply', 11], ['math.primary.3.multiply', 9]] as const) {
    const at = new Date(Date.now() - daysAgo * 86400000)
    const session = await startTutorSession(db, u.userId, student, at, { focusConceptId: concept })
    for (let guard = 0; guard < 20; guard++) {
      const item = (await sessionItems(db, session)).find((i) => i.answered === 0); if (!item) break
      await acknowledgeFeedback(db, u.userId, session)
      const written = needsJudgment({ answer: String(item.answer), format: String(item.format), choices: null }, Number(item.bloom_level))
      await submitAnswer(db, u.userId, session, { itemId: String(item.id), answer: written ? 'Equal groups of the same size, counted together.' : String(item.answer) }, at)
    }
  }
  return { dir, db, owner: u.userId, student }
}

test('a practice mission opens with a lesson and counts guided and faded work as help, never as independent evidence', async () => {
  const f = await experienced()
  try {
    const now = new Date()
    const id = await startTutorSession(f.db, f.owner, f.student, now, { intent: 'practice', focusConceptId: 'math.primary.3.multiply', durationMinutes: 5 })
    const items = await sessionItems(f.db, id)
    assert.deepEqual(items.slice(0, 2).map((i) => i.beat), ['guided', 'faded'])
    assert.ok(items.slice(0, 2).every((i) => Number(i.hints_used) === 1 && String(i.hint_text)), 'guided and faded items start with a hint showing')
    assert.equal(items.filter((i) => i.beat === 'frontier' || i.beat === 'stretch').length, 2, 'five minutes gives two independent items')
    assert.ok(['review', 'frontier', 'stretch'].includes(String(items.at(-1)!.beat)))
    assert.equal((await f.db.prepare('SELECT lesson_done FROM tutor_sessions WHERE id = ?').get(id))!.lesson_done, 0)
    const before = (await loadAttempts(f.db, f.student)).length
    for (const item of items.slice(0, 2)) {
      await acknowledgeFeedback(f.db, f.owner, id)
      if (needsJudgment({ answer: String(item.answer), format: String(item.format), choices: null }, Number(item.bloom_level))) continue
      await submitAnswer(f.db, f.owner, id, { itemId: String(item.id), answer: String(item.answer) }, now)
    }
    const added = (await loadAttempts(f.db, f.student)).slice(before)
    assert.ok(added.every((a) => a.hintsUsed > 0), 'supported attempts are recorded as help')
    assert.equal(freshEvidence(added).filter((a) => a.hintsUsed === 0 && a.correct).length, 0)
    const pack = await startTutorSession(f.db, f.owner, f.student, now, { intent: 'practice', focusConceptId: 'math.primary.3.multiply', arc: false })
    assert.equal((await sessionItems(f.db, pack)).some((i) => i.beat === 'guided'), false, 'packs and other missions keep their own shape')
  } finally { f.db.close() }
})

test('the lesson card comes first, then the guided question', async () => {
  const f = await experienced()
  const auth = await openAuthSession(f.db, f.owner)
  const server = createServer((req, res) => { handle(req, res, { db: f.db, uploadsDir: join(f.dir, 'uploads') }).catch(() => { res.writeHead(500); res.end() }) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as any).port}`
  const request = (path: string, data?: any) => fetch(`${origin}${path}`, { redirect: 'manual', method: data ? 'POST' : 'GET', headers: { Cookie: `tutor_session=${auth.token}`, ...(data ? { 'Content-Type': 'application/json', Accept: 'application/json' } : {}) }, body: data ? JSON.stringify({ csrf: auth.csrf, ...data }) : undefined })
  try {
    const id = await startTutorSession(f.db, f.owner, f.student, new Date(), { intent: 'practice', focusConceptId: 'math.primary.3.multiply' })
    const lesson = await (await request(`/session/${id}`)).text()
    assert.match(lesson, /First, the idea/); assert.match(lesson, /Let’s try one together/); assert.doesNotMatch(lesson, /form method="post" action="\/session\/[^"]+\/answer"/)
    assert.equal((await request(`/session/${id}/lesson`, {})).headers.get('location'), `/session/${id}`)
    const first = await (await request(`/session/${id}`)).text()
    assert.match(first, /Let’s do this one together/); assert.match(first, /action="\/session\/[^"]+\/answer"/)
  } finally { server.close(); f.db.close() }
})

test('a first check cut short continues next time, and a pause stops the clock', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tutor-probe-')), db = openDb(join(dir, 'test.sqlite'))
  try {
    const u = await registerUser(db, 'probe@example.com', 'long-probe-password'); if (!u.ok) throw new Error()
    const student = await createStudent(db, u.userId, { displayName: 'Synthetic learner', grade: 3, sessionCapMinutes: 25 })
    const start = new Date(Date.now() - 60 * 60000)
    const first = await startTutorSession(db, u.userId, student, start, { focusConceptId: 'math.primary.3.multiply', goal: 'harder_probe', durationMinutes: 5 })
    const item = (await sessionItems(db, first))[0]
    await submitAnswer(db, u.userId, first, { itemId: String(item.id), answer: '12345' }, start)
    await enforceSessionTime(db, u.userId, first)
    assert.equal((await db.prepare('SELECT end_reason FROM tutor_sessions WHERE id = ?').get(first))!.end_reason, 'attention')
    const remaining = (await sessionItems(db, first)).filter((i) => i.answered === 0).map((i) => String(i.prompt))
    const next = await startTutorSession(db, u.userId, student, new Date(), { focusConceptId: 'math.primary.3.multiply', goal: 'harder_probe', durationMinutes: 5 })
    assert.notEqual(next, first)
    assert.deepEqual((await sessionItems(db, next)).map((i) => String(i.prompt)), remaining, 'the same check carries on')
    assert.equal((await db.prepare('SELECT end_reason FROM tutor_sessions WHERE id = ?').get(first))!.end_reason, 'continued')
    // Pausing: time away does not end the mission, and resuming moves the clock on.
    const paused = await startTutorSession(db, u.userId, student, new Date(Date.now() - 2 * 60000), { focusConceptId: 'math.primary.2.add', durationMinutes: 5 })
    await pauseSession(db, u.userId, paused)
    await db.prepare('UPDATE tutor_sessions SET paused_at = ? WHERE id = ?').run(new Date(Date.now() - 60 * 60000 + 2 * 60000).toISOString(), paused)
    await db.prepare('UPDATE tutor_sessions SET started_at = ? WHERE id = ?').run(new Date(Date.now() - 60 * 60000).toISOString(), paused)
    assert.equal((await enforceSessionTime(db, u.userId, paused)).ended_at, null, 'an hour away while paused does not use up five minutes')
    assert.equal(await resumeSession(db, u.userId, paused), paused)
    const resumed = (await db.prepare('SELECT started_at, paused_at, ended_at FROM tutor_sessions WHERE id = ?').get(paused))!
    assert.equal(resumed.paused_at, null); assert.equal(resumed.ended_at, null)
    assert.ok(Date.now() - Date.parse(String(resumed.started_at)) < 3 * 60000, 'two minutes used before the pause remain used')
  } finally { db.close() }
})

test('a first check interrupted twice still carries on, and answering after a pause keeps the clock fair', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tutor-probe2-')), db = openDb(join(dir, 'test.sqlite'))
  try {
    const u = await registerUser(db, 'probe2@example.com', 'long-probe-password'); if (!u.ok) throw new Error()
    const student = await createStudent(db, u.userId, { displayName: 'Synthetic learner', grade: 3, sessionCapMinutes: 25 })
    const cut = async (id: string) => { await db.prepare('UPDATE tutor_sessions SET started_at = ? WHERE id = ?').run(new Date(Date.now() - 60 * 60000).toISOString(), id); await enforceSessionTime(db, u.userId, id) }
    const first = await startTutorSession(db, u.userId, student, new Date(), { focusConceptId: 'math.primary.3.multiply', goal: 'harder_probe', durationMinutes: 5 })
    await submitAnswer(db, u.userId, first, { itemId: String((await sessionItems(db, first))[0].id), answer: '12345' })
    await cut(first)
    const second = await startTutorSession(db, u.userId, student, new Date(), { focusConceptId: 'math.primary.3.multiply', goal: 'harder_probe', durationMinutes: 5 })
    const left = (await sessionItems(db, second)).filter((i) => i.answered === 0)
    await db.prepare('UPDATE tutor_sessions SET feedback_cursor = 99 WHERE id = ?').run(second)
    await submitAnswer(db, u.userId, second, { itemId: String(left[0].id), answer: '12345' })
    await cut(second)
    const remaining = (await sessionItems(db, second)).filter((i) => i.answered === 0).map((i) => String(i.prompt))
    const third = await startTutorSession(db, u.userId, student, new Date(), { focusConceptId: 'math.primary.3.multiply', goal: 'harder_probe', durationMinutes: 5 })
    assert.deepEqual((await sessionItems(db, third)).map((i) => String(i.prompt)), remaining, 'the second interruption also carries on')
    // Interrupted again before answering anything in the carried-on mission: still the same check.
    const untouched = (await sessionItems(db, third)).map((i) => String(i.prompt))
    await cut(third)
    const fourth = await startTutorSession(db, u.userId, student, new Date(), { focusConceptId: 'math.primary.3.multiply', goal: 'harder_probe', durationMinutes: 5 })
    assert.deepEqual((await sessionItems(db, fourth)).map((i) => String(i.prompt)), untouched, 'an untouched carried-on check carries on too')
    // An answer given after an hour paused is taken, not refused for time.
    const paused = await startTutorSession(db, u.userId, student, new Date(), { focusConceptId: 'math.primary.2.add', durationMinutes: 5 })
    await db.prepare('UPDATE tutor_sessions SET started_at = ?, paused_at = ? WHERE id = ?').run(new Date(Date.now() - 62 * 60000).toISOString(), new Date(Date.now() - 60 * 60000).toISOString(), paused)
    const result = await submitAnswer(db, u.userId, paused, { itemId: String((await sessionItems(db, paused))[0].id), answer: '12345' })
    assert.equal('ended' in result && result.ended, false)
  } finally { db.close() }
})
