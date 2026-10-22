import type { Database } from './database.ts'
import { withWrite, lockFamily } from './transaction.ts'
import { loadAttempts, listStates } from './services.ts'
import { masteryMet } from './engine/mastery.ts'
import { learningMilestones } from './engine/adventure.ts'
import type { BloomLevel } from './engine/types.ts'

/** Explicit maintenance operation. Never called from a migration, request, preview boot or new writer.
 * The caller must separately establish resource isolation and authorization before using a populated store.
 * Tests call this only on disposable synthetic resources. Repeating the cutover preserves its first receipts.
 */
export async function cutoverLearningEvidence(db: Database, owner: string, studentId: string, cutoverId: string, now = new Date()) {
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(cutoverId)) throw new Error('An explicit bounded cutover identifier is required.')
  return withWrite(db, async () => {
    await lockFamily(db, owner)
    const student = await db.prepare('SELECT id, evidence_policy FROM students WHERE id = ? AND owner_user_id = ?').get(studentId, owner)
    if (!student) throw new Error('Learner not found.')
    const recorded = await db.prepare('SELECT * FROM learning_cutovers WHERE student_id = ?').get(studentId)
    if (recorded) return recorded
    if (student.evidence_policy === 1) throw new Error('This learner already started under the current policy.')
    const attempts = await loadAttempts(db, studentId)
    const states = await listStates(db, studentId, now)
    const historical = Object.fromEntries(states.map(state => [state.conceptId, { state,
      levels: ([1,2,3,4,5,6] as BloomLevel[]).filter(level => masteryMet(attempts.filter(a => a.conceptId === state.conceptId), level)),
      attemptIds: attempts.filter(a => a.conceptId === state.conceptId).map(a => a.attemptId) }]))
    const milestones = learningMilestones(attempts)
    const at = now.toISOString()
    await db.prepare('INSERT INTO learning_cutovers (student_id, policy, created_at, attempt_ids_json, states_json, milestones_json) VALUES (?, 1, ?, ?, ?, ?)')
      .run(studentId, at, JSON.stringify({ cutoverId, ids: attempts.map(a => a.attemptId) }), JSON.stringify(historical), JSON.stringify(milestones))
    // Even pending/open rows keep v0 identity; a late callback cannot invent a v1 origin.
    await db.prepare('UPDATE attempts SET evidence_policy = 0 WHERE student_id = ? AND evidence_policy IS NULL').run(studentId)
    await db.prepare("UPDATE session_items SET evidence_policy = 0, revision_id = coalesce(revision_id, id) WHERE session_id IN (SELECT id FROM tutor_sessions WHERE student_id = ?) AND evidence_policy IS NULL").run(studentId)
    await db.prepare('UPDATE students SET evidence_policy = 1 WHERE id = ?').run(studentId)
    return (await db.prepare('SELECT * FROM learning_cutovers WHERE student_id = ?').get(studentId))!
  })
}
