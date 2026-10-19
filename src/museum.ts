// The museum of changed minds: when a child misses an idea and later in the same mission explains it
// correctly at a higher level, both answers are kept. It shows thinking that grew, not a score.
import type { Database as DatabaseSync } from "./database.ts"
import { sealForStudent } from "./family-crypto.ts"

export async function noteChangedMind(db: DatabaseSync, sessionId: string, itemId: string, now = new Date()) {
  const items = (await db.prepare("SELECT i.id, i.position, i.concept_id, i.bloom_level, i.prompt, i.given_answer, i.correct, i.answered, s.student_id FROM session_items i JOIN tutor_sessions s ON s.id = i.session_id WHERE i.session_id = ? ORDER BY i.position").all(sessionId)) as Array<Record<string, any>>
  const after = items.find((item) => item.id === itemId)
  if (!after || after.correct !== 1 || Number(after.bloom_level) < 4 || !String(after.given_answer ?? "").trim()) return false
  const before = items.find((item) => item.position < after.position && item.concept_id === after.concept_id && item.answered === 1 && item.correct === 0 && String(item.given_answer ?? "").trim())
  if (!before) return false
  const student = String(after.student_id)
  const seal = (text: string) => sealForStudent(db, student, text.slice(0, 2000))
  await db.prepare(`INSERT INTO changed_minds (id, student_id, session_id, concept_id, before_prompt, before_answer, after_prompt, after_answer, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (session_id, concept_id) DO NOTHING`)
    .run(crypto.randomUUID(), student, sessionId, String(after.concept_id), await seal(String(before.prompt)), await seal(String(before.given_answer)), await seal(String(after.prompt)), await seal(String(after.given_answer)), now.toISOString())
  return true
}

export async function changedMinds(db: DatabaseSync, studentId: string, limit = 6) {
  return (await db.prepare("SELECT concept_id, before_answer, after_answer, created_at FROM changed_minds WHERE student_id = ? ORDER BY created_at DESC LIMIT ?").all(studentId, limit)) as Array<{ concept_id: string; before_answer: string; after_answer: string; created_at: string }>
}
