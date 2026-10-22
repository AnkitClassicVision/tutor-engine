import type { Database } from './database.ts'

type Session = { mode?: unknown; end_reason?: unknown }
type Item = { answered?: unknown }

/** Stopping the clock is not submission. Older, fully answered checks remain complete. */
export function assessmentOpen(session: Session, items: Item[]): boolean {
  return session.mode === 'assessment' && !['assessment_submitted', 'continued', 'recap'].includes(String(session.end_reason)) && items.some(item => item.answered === 0)
}

/** One learner's unfinished check, including pauses and attention-cap stops. */
export async function openAssessment(db: Database, owner: string, student: string): Promise<{ id: string } | undefined> {
  return await db.prepare(`SELECT s.id FROM tutor_sessions s JOIN students l ON l.id = s.student_id
    WHERE l.owner_user_id = ? AND s.student_id = ? AND s.mode = 'assessment'
      AND coalesce(s.end_reason, '') NOT IN ('assessment_submitted', 'continued', 'recap')
      AND EXISTS (SELECT 1 FROM session_items i WHERE i.session_id = s.id AND i.skipped = 0 AND i.answered = 0)
    ORDER BY s.started_at DESC LIMIT 1`).get(owner, student) as { id: string } | undefined
}
