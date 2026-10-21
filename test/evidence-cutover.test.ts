import test from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../src/db.ts'
import { registerUser } from '../src/auth.ts'
import { adventureFor, createStudent, listStates, loadAttempts, reviewAnswer, submitAnswer } from '../src/services.ts'
import { cutoverLearningEvidence } from '../src/evidence-cutover.ts'
import { independent, masteryMet } from '../src/engine/mastery.ts'
import { weeklyScoreboard } from '../src/engine/scoreboard.ts'
import { reduceState } from '../src/engine/mastery.ts'
import { evidenceAnswer, evidenceItem } from './fixtures/evidence-history.ts'

const when = (day: number) => new Date(`2026-10-${String(day).padStart(2,'0')}T12:00:00Z`)
const concept = 'math.primary.1.add'
async function fixture() {
  const db = openDb(':memory:')
  const user = await registerUser(db, 'cutover@example.invalid', 'synthetic-password'); assert.ok(user.ok)
  const student = await createStudent(db, user.userId, { displayName: 'Synthetic learner', grade: 3, sessionCapMinutes: 10 }, when(1))
  await db.prepare('UPDATE students SET evidence_policy = NULL WHERE id = ?').run(student)
  return { db, owner: user.userId, student }
}

test('explicit cutover preserves earned state, due dates and milestone receipts on repeated replay', async () => {
  const f = await fixture()
  try {
    for (const day of [1,2,3,12]) await evidenceAnswer(f.db, f.owner, f.student, `earned-${day}`, when(day), { legacy: true, mixed: true })
    const before = (await listStates(f.db, f.student, when(13))).find(s => s.conceptId === concept)!
    const milestones = await adventureFor(f.db, f.owner, f.student)
    const priorBoard = weeklyScoreboard({ attempts: await loadAttempts(f.db, f.student), states: [], weekStart: '2026-10-02', today: '2026-10-13' })
    assert.equal(before.bloomLevel, 2); assert.ok(milestones.some(m => m.kind === 'retention'))
    const first = await cutoverLearningEvidence(f.db, f.owner, f.student, 'synthetic-cutover-1', when(13))
    const again = await cutoverLearningEvidence(f.db, f.owner, f.student, 'synthetic-cutover-2', when(14))
    assert.deepEqual(again, first)
    assert.deepEqual((await listStates(f.db, f.student, when(13))).find(s => s.conceptId === concept), before)
    assert.deepEqual(await adventureFor(f.db, f.owner, f.student), milestones)
    const attempts = await loadAttempts(f.db, f.student)
    assert.deepEqual(weeklyScoreboard({ attempts, states: [], weekStart: '2026-10-02', today: '2026-10-13' }), priorBoard, 'earned mastery dates cannot move to the first historical attempt')
    assert.equal(reduceState('math.primary.1.subtract', attempts, '2026-10-13', 'screen').bloomLevel, 0, 'one concept receipt never awards mastery to another concept')
    assert.ok((await loadAttempts(f.db, f.student)).every(a => a.evidencePolicy === 0 && independent(a)))
  } finally { f.db.close() }
})

test('suspect old mixed flags and unversioned writers cannot newly promote; a real v1 mixed win can', async () => {
  const f = await fixture()
  try {
    for (const day of [1,2]) for (const root of [concept, 'math.primary.1.subtract'])
      await evidenceAnswer(f.db, f.owner, f.student, `ready-${root}-${day}`, when(day), { concept: root, legacy: true, mixed: true })
    await cutoverLearningEvidence(f.db, f.owner, f.student, 'synthetic-cutover', when(3))
    await evidenceAnswer(f.db, f.owner, f.student, 'new-unmixed', when(4))
    await evidenceAnswer(f.db, f.owner, f.student, 'old-writer', when(5), { legacy: true, mixed: true })
    const oldWriter = (await loadAttempts(f.db, f.student)).find(a => a.promptKey?.includes('old-writer'))!
    assert.equal(oldWriter.evidencePolicy, 'unversioned'); assert.ok(independent(oldWriter))
    assert.equal(masteryMet((await loadAttempts(f.db, f.student)).filter(a => a.conceptId === concept), 2), false)
    const partner = await evidenceItem(f.db, f.student, 'real-partner', when(6), { concept: 'math.primary.1.subtract', mode: 'session' })
    const target = await evidenceItem(f.db, f.student, 'real-target', new Date(when(6).getTime() + 5000), { mode: 'session', session: String(partner.session_id), position: 2 })
    await submitAnswer(f.db, f.owner, String(partner.session_id), { itemId: String(partner.id), answer: '4' }, new Date(when(6).getTime() + 1000))
    const { acknowledgeFeedback } = await import('../src/services.ts')
    await acknowledgeFeedback(f.db, f.owner, String(partner.session_id))
    await submitAnswer(f.db, f.owner, String(target.session_id), { itemId: String(target.id), answer: '4' }, new Date(when(6).getTime() + 6000))
    const attempts = (await loadAttempts(f.db, f.student)).filter(a => a.conceptId === concept)
    assert.ok(attempts.at(-1)!.mixed); assert.ok(masteryMet(attempts, 2))
  } finally { f.db.close() }
})

test('open drafts and pending grades retain v0 identity; late grading is idempotent', async () => {
  const f = await fixture()
  try {
    const draft = await evidenceItem(f.db, f.student, 'open-draft', when(1), { legacy: true })
    await f.db.prepare("UPDATE session_items SET draft_answer = 'saved synthetic draft' WHERE id = ?").run(draft.id)
    const pending = await evidenceItem(f.db, f.student, 'pending-grade', when(1), { legacy: true, pending: true, level: 3 })
    await submitAnswer(f.db, f.owner, String(pending.session_id), { itemId: String(pending.id), answer: 'My two reasons.' }, when(1))
    await cutoverLearningEvidence(f.db, f.owner, f.student, 'pending-cutover', when(2))
    const saved = await f.db.prepare('SELECT * FROM session_items WHERE id = ?').get(draft.id)
    assert.equal(saved!.draft_answer, 'saved synthetic draft'); assert.equal(saved!.evidence_policy, 0)
    await reviewAnswer(f.db, f.owner, String(pending.session_id), { itemId: String(pending.id), correct: true }, when(3))
    await reviewAnswer(f.db, f.owner, String(pending.session_id), { itemId: String(pending.id), correct: true }, when(4))
    const attempts = await loadAttempts(f.db, f.student)
    assert.equal(attempts.length, 1); assert.equal(attempts[0].evidencePolicy, 0); assert.equal(attempts[0].task, undefined)
  } finally { f.db.close() }
})
