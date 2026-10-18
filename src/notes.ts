import { sealForStudent } from "./family-crypto.ts"
import type { Database as DatabaseSync } from "./database.ts"
import { recordDecision } from "./decisions.ts"
import { assertStudent } from "./services.ts"
import { withWrite } from "./transaction.ts"

export const NOTE_LIMIT = 200

/** One unread note at a time: a new note replaces an unread one. */
export async function leaveNote(db: DatabaseSync, ownerUserId: string, studentId: string, body: string) {
  const text = body.replace(/\s+/g, " ").trim()
  if (!text) throw new Error("Write a short note first.")
  if (text.length > NOTE_LIMIT) throw new Error(`Keep the note under ${NOTE_LIMIT} characters.`)
  return withWrite(db, async () => {
    await assertStudent(db, ownerUserId, studentId)
    await db.prepare("DELETE FROM parent_notes WHERE student_id = ? AND read_at IS NULL").run(studentId)
    const id = crypto.randomUUID()
    await db.prepare("INSERT INTO parent_notes (id, student_id, body, created_at) VALUES (?, ?, ?, ?)").run(id, studentId, await sealForStudent(db, studentId, text), new Date().toISOString())
    await recordDecision(db, studentId, "parent_note_left", "A parent left a short note for the learner's home screen.", { noteId: id, body: text })
    return id
  })
}

export async function unreadNote(db: DatabaseSync, studentId: string) {
  return (await db.prepare("SELECT id, body, created_at FROM parent_notes WHERE student_id = ? AND read_at IS NULL ORDER BY created_at LIMIT 1").get(studentId)) as
    | { id: string; body: string; created_at: string }
    | undefined
}

export async function dismissNote(db: DatabaseSync, studentId: string, noteId: string) {
  const result = await db.prepare("UPDATE parent_notes SET read_at = ? WHERE id = ? AND student_id = ? AND read_at IS NULL").run(new Date().toISOString(), noteId, studentId)
  if (Number(result.changes) > 0) await recordDecision(db, studentId, "parent_note_read", "The learner read the parent's note.", { noteId })
  return Number(result.changes) > 0
}

export async function withdrawNote(db: DatabaseSync, studentId: string, noteId: string) {
  const result = await db.prepare("DELETE FROM parent_notes WHERE id = ? AND student_id = ? AND read_at IS NULL").run(noteId, studentId)
  return Number(result.changes) > 0
}
