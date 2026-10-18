import type { Database as DatabaseSync } from "./database.ts"
import { dayStamp } from "./engine/dates.ts"

export interface AssessmentEvidence {
  day: string
  subject: string
  conceptId: string
  bloomLevel: number
  held: number
  checked: number
  excluded: number
  pending: number
}

/** Comparable slices, excluding repeated prompts and assisted work from the score. */
export async function assessmentEvidence(db: DatabaseSync, studentId: string): Promise<AssessmentEvidence[]> {
  const items = (await db.prepare(`SELECT i.*, s.mode, s.subject, s.started_at FROM session_items i
    JOIN tutor_sessions s ON s.id = i.session_id WHERE s.student_id = ? AND i.answered = 1
    ORDER BY coalesce(i.submitted_at, s.started_at), s.rowid, i.position`).all(studentId))
  const seen = new Set<string>()
  const rows = new Map<string, AssessmentEvidence>()
  for (const item of items) {
    const prompt = String(item.prompt).trim().toLowerCase().replace(/\s+/g, " ")
    const reused = seen.has(prompt)
    seen.add(prompt)
    if (item.mode !== "assessment") continue
    const day = dayStamp(new Date(String(item.submitted_at ?? item.started_at)))
    const conceptId = String(item.concept_id), bloomLevel = Number(item.bloom_level), subject = String(item.subject)
    const key = JSON.stringify([day, subject, conceptId, bloomLevel])
    const row = rows.get(key) ?? { day, subject, conceptId, bloomLevel, held: 0, checked: 0, excluded: 0, pending: 0 }
    if (reused || Number(item.hints_used) > 0) row.excluded += 1
    else if (item.correct == null) row.pending += 1
    else { row.checked += 1; if (item.correct === 1) row.held += 1 }
    rows.set(key, row)
  }
  return [...rows.values()].reverse().slice(0, 30)
}
