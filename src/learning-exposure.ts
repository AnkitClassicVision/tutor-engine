import { learningNow } from './learning-clock.ts'
import { createHash } from 'node:crypto'
import type { Database, Row } from './database.ts'

/** No answers, prompts, audio or learner names. Unknown delivery is retained conservatively. */
export async function recordExposure(db: Database, studentId: string, sessionId: string, item: Row, kind: 'question' | 'lesson' | 'hint' | 'answer' | 'feedback', now = learningNow(), confirmed = false) {
  const id = createHash('sha256').update(JSON.stringify([sessionId, item.id, item.revision_id ?? 'v0', kind, kind === 'hint' ? item.hints_used : 0, now.toISOString()])).digest('hex')
  await db.prepare('INSERT OR IGNORE INTO learning_exposures (id, student_id, session_id, item_id, revision_id, concept_id, bloom_level, kind, at, confirmed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, studentId, sessionId, item.id, item.revision_id ?? null, item.concept_id, item.bloom_level, kind, now.toISOString(), confirmed ? 1 : 0)
  if (confirmed) await db.prepare('UPDATE learning_exposures SET confirmed = 1, at = ? WHERE id = ? AND confirmed = 0').run(now.toISOString(), id)
}
