import { createHash } from 'node:crypto'
import type { Database } from '../../src/database.ts'
import type { BloomLevel } from '../../src/engine/types.ts'
import { stampTask } from '../../src/task-evidence.ts'
import { recordExposure } from '../../src/learning-exposure.ts'
import { acknowledgeFeedback, submitAnswer } from '../../src/services.ts'

export const evidenceId = (label: string) => {
  const hex = createHash('sha256').update(label).digest('hex')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`
}
export interface EvidenceFixtureOptions {
  concept?: string; level?: BloomLevel; correct?: boolean; hints?: number; mixed?: boolean
  legacy?: boolean; session?: string; position?: number; mode?: 'session' | 'assessment'; show?: boolean
  pending?: boolean; role?: 'practice' | 'transfer'; prompt?: string; confidence?: 'sure' | 'guess';
}
/** Deterministic synthetic history only. Legacy records model the pre-cutover writer. */
export async function evidenceItem(db: Database, student: string, label: string, at: Date, options: EvidenceFixtureOptions = {}) {
  const id = evidenceId(label), session = options.session ?? evidenceId(`${label}:session`)
  const concept = options.concept ?? 'math.primary.1.add', level = options.level ?? 2
  await db.prepare(`INSERT OR IGNORE INTO tutor_sessions (id, student_id, started_at, requested_at, modality, consecutive_step_downs, cap_minutes, continuity, mode, subject, lesson_done)
    VALUES (?, ?, ?, ?, 'screen', 0, 25, '', ?, 'Math', 1)`).run(session, student, at.toISOString(), at.toISOString(), options.mode ?? 'assessment')
  await db.prepare(`INSERT INTO session_items (id, session_id, position, beat, concept_id, bloom_level, prompt, answer, hints_json, surface, interleaved, hints_used, answered, evidence_kind${options.legacy ? '' : ', evidence_purpose'})
    VALUES (?, ?, ?, 'frontier', ?, ?, ?, ?, '[]', 'screen', ?, ?, 0, ?${options.legacy ? '' : ", 'mixed-check'"})`)
    .run(id, session, options.position ?? 1, concept, level, options.prompt ?? `Synthetic fresh question ${label}`, options.pending ? 'Explain two independent reasons.' : '4', options.mixed ? 1 : 0, options.hints ?? 0, options.role ?? 'practice')
  if (!options.legacy) await stampTask(db, id, 'builtin')
  if (options.show !== false) {
    await db.prepare('UPDATE session_items SET shown_at = ?, visible_at = ? WHERE id = ?').run(at.toISOString(), at.toISOString(), id)
    if (!options.legacy) await recordExposure(db, student, session, (await db.prepare('SELECT * FROM session_items WHERE id = ?').get(id))!, 'question', at, true)
  }
  return (await db.prepare('SELECT * FROM session_items WHERE id = ?').get(id))!
}

export async function evidenceAnswer(db: Database, owner: string, student: string, label: string, at: Date, options: EvidenceFixtureOptions = {}) {
  const item = await evidenceItem(db, student, label, at, options)
  const answered = new Date(at.getTime() + 1000)
  if (options.legacy) {
    await db.prepare('UPDATE session_items SET answered = 1, correct = ?, given_answer = ?, submitted_at = ? WHERE id = ?')
      .run(options.correct === false ? 0 : 1, options.correct === false ? '9' : '4', answered.toISOString(), item.id)
    await db.prepare(`INSERT INTO attempts (id, student_id, session_id, concept_id, bloom_level, day, correct, hints_used, interleaved, time_ms, error_type, modality, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1000, NULL, 'screen', ?)`).run(item.id, student, item.session_id, item.concept_id, item.bloom_level, answered.toISOString().slice(0,10), options.correct === false ? 0 : 1, options.hints ?? 0, options.mixed ? 1 : 0, answered.toISOString())
  } else {
    if (options.mode === 'session') await acknowledgeFeedback(db, owner, String(item.session_id))
    await submitAnswer(db, owner, String(item.session_id), { itemId: String(item.id), answer: options.pending ? 'Two reasons in the synthetic response.' : options.correct === false ? '9' : '4', confidence: options.confidence }, answered)
  }
  return (await db.prepare('SELECT * FROM session_items WHERE id = ?').get(item.id))!
}
