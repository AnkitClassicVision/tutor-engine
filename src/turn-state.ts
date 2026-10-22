import { learningNow } from './learning-clock.ts'
import type { Database } from './database.ts'
import { UserError } from './errors.ts'

/** Durations reported by the browser are observations, never scoring or mastery inputs. */
export function observedDuration(value: unknown, maximum = 24 * 60 * 60 * 1000): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum ? Math.round(value) : null
}

/** Called after submitAnswer's transaction commits. Retries retain the first durable acknowledgment. */
export async function acknowledgeAnswer(db: Database, sessionId: string, itemId: string, now = learningNow()) {
  await db.prepare('UPDATE session_items SET answer_saved_at = coalesce(answer_saved_at, ?) WHERE session_id = ? AND id = ? AND answered = 1 AND skipped = 0')
    .run(now.toISOString(), sessionId, itemId)
  const item = await db.prepare('SELECT id, revision_id, answer_saved_at FROM session_items WHERE session_id = ? AND id = ?').get(sessionId, itemId)
  return { saved: Boolean(item?.answer_saved_at), itemId, revision: String(item?.revision_id ?? '') }
}

/** The caller checks family ownership. Only the already saved revision may acquire a timing sample. */
export async function acknowledgeSaveVisible(db: Database, sessionId: string, itemId: string, revision: string, elapsed: unknown) {
  const ms = observedDuration(elapsed)
  if (ms === null) throw new UserError('Invalid save timing.')
  const result = await db.prepare(`UPDATE session_items SET submit_to_save_ms = coalesce(submit_to_save_ms, ?)
    WHERE session_id = ? AND id = ? AND coalesce(revision_id, '') = ? AND answered = 1 AND answer_saved_at IS NOT NULL`).run(ms, sessionId, itemId, revision)
  if (!result.changes) throw new UserError('This saved answer is no longer current.')
}

export type ReviewState = 'queued' | 'checking' | 'retry' | 'parent' | 'waiting'
/** A pending grade alone does not mean the parent has been asked to grade it. */
export async function pendingReviewStates(db: Database, studentId: string, items: Array<Record<string, any>>, aiUnavailable: boolean) {
  const jobs = await db.prepare("SELECT id, payload, status FROM jobs WHERE student_id = ? AND kind = 'grade' ORDER BY created_at DESC, id DESC").all(studentId)
  const result = new Map<string, { state: ReviewState; jobId?: string }>()
  for (const item of items.filter(i => Number(i.answered) && i.correct == null && !Number(i.disputed) && !Number(i.skipped))) {
    if (item.grading_doubt) { result.set(String(item.id), { state: 'parent' }); continue }
    const job = jobs.find(row => {
      try { const p = JSON.parse(String(row.payload)); return p.sessionId === item.session_id && (!p.itemIds || (Array.isArray(p.itemIds) && p.itemIds.includes(item.id))) } catch { return false }
    })
    const state: ReviewState = job?.status === 'queued' ? 'queued' : job?.status === 'running' ? 'checking'
      : aiUnavailable ? 'parent' : job ? 'retry' : 'waiting'
    result.set(String(item.id), { state, ...(job ? { jobId: String(job.id) } : {}) })
  }
  return result
}

export const REVIEW_LABELS: Record<ReviewState, string> = {
  queued: 'Your answer is saved. Checking is queued.', checking: 'Your answer is saved. The checker is working.',
  retry: 'Your answer is saved. Checking did not finish; it can be retried.',
  parent: 'Your answer is saved for a grown-up to check.', waiting: 'Your answer is saved. Checking has not started yet.',
}
