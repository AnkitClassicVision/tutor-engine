// Original defect reproductions, promoted to the default suite after the coherent evidence repair.
import test from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../src/db.ts'
import { registerUser } from '../src/auth.ts'
import { createStudent } from '../src/services.ts'
import { learningMeasures } from '../src/learning-metrics.ts'
import { missionArc } from '../src/engine/arc.ts'
import { mixedArc } from '../src/engine/mixed.ts'
import type { QueueSlot } from '../src/engine/types.ts'

const now = new Date('2026-10-21T12:00:00Z')
async function fixture() {
  const db = openDb(':memory:')
  const user = await registerUser(db, 'evidence-probe@example.invalid', 'synthetic-password')
  assert.ok(user.ok)
  const student = await createStudent(db, user.userId, { displayName: 'Synthetic learner', grade: 3, sessionCapMinutes: 10 })
  async function answer(concept: string, day: string, bloom: number, correct: number, hints = 0, confidence: string | null = null) {
    const session = crypto.randomUUID(), item = crypto.randomUUID(), at = `${day}T12:00:00.000Z`
    await db.prepare(`INSERT INTO tutor_sessions (id, student_id, started_at, modality, consecutive_step_downs, cap_minutes, continuity, mode, subject)
      VALUES (?, ?, ?, 'screen', 0, 10, '', 'session', 'Math')`).run(session, student, at)
    await db.prepare(`INSERT INTO session_items (id, session_id, position, beat, concept_id, bloom_level, prompt, answer, hints_json, surface, interleaved, hints_used, answered, correct, submitted_at, given_answer, confidence)
      VALUES (?, ?, 1, 'frontier', ?, ?, ?, '1', '[]', 'screen', 0, ?, 1, ?, ?, '1', ?)`).run(item, session, concept, bloom, `Synthetic independent prompt ${item}`, hints, correct, at, confidence)
    await db.prepare(`INSERT INTO attempts (id, student_id, session_id, concept_id, bloom_level, day, correct, hints_used, interleaved, time_ms, error_type, modality, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 5000, NULL, 'screen', ?)`).run(item, student, session, concept, bloom, day, correct, hints, at)
  }
  return { db, student, answer }
}

test('P2: a short ready arc budgets a real partner and target without claiming credit for a pointer', () => {
  const plain: QueueSlot = { beat: 'frontier', conceptId: 'target', bloomLevel: 2, interleaved: false, partnerConceptId: null, scored: true }
  const queue = [plain, plain, { ...plain, interleaved: true, partnerConceptId: 'partner' }]
  const planned = missionArc(queue, 5)
  const arc = mixedArc(planned, plain, { conceptId: 'partner', bloom: 2 }, 5)
  assert.ok(arc.length <= planned.length)
  assert.deepEqual(arc.map(slot => slot.conceptId), ['partner', 'target'])
  assert.ok(arc.every(slot => !slot.interleaved), 'only actual confirmed delivery can award mixed credit')
})

test('P3: creation misses after understanding wins are insufficient comparable retention, not zero remembered', async () => {
  const f = await fixture()
  try {
    for (let i = 0; i < 5; i++) {
      await f.answer(`synthetic.topic.${i}`, '2026-10-01', 2, 1)
      await f.answer(`synthetic.topic.${i}`, '2026-10-12', 6, 0)
    }
    const measure = (await learningMeasures(f.db, f.student, now)).find(m => m.key === 'retention')!
    assert.equal(measure.enough, false)
    assert.doesNotMatch(measure.value, /^0%$/)
  } finally { f.db.close() }
})

test('P3: supported sure/correct answers cannot establish independent confidence', async () => {
  const f = await fixture()
  try {
    for (let i = 0; i < 5; i++) await f.answer(`synthetic.topic.${i}`, '2026-10-20', 2, 1, 1, 'sure')
    const measure = (await learningMeasures(f.db, f.student, now)).find(m => m.key === 'calibration')!
    assert.equal(measure.enough, false)
  } finally { f.db.close() }
})
