import { sealForStudent } from "./family-crypto.ts"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import type { Database as DatabaseSync } from "./database.ts"

const specRevision = createHash("sha256").update(readFileSync(new URL("../Tutor Engine — The Shape (v1 spec).md", import.meta.url))).digest("hex")

export async function recordDecision(
  db: DatabaseSync, studentId: string, kind: string, reason: string,
  details: Record<string, unknown> = {}, now = new Date(),
) {
  const owner = (await db.prepare(`SELECT users.ai_provider, users.ai_model FROM students
    JOIN users ON users.id = students.owner_user_id WHERE students.id = ?`).get(studentId))
  if (!owner) throw new Error("Student not found.")
  const id = crypto.randomUUID()
  await db.prepare(`INSERT INTO decision_records (id, student_id, kind, reason, details, provider, model, spec_revision, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, studentId, kind, reason, await sealForStudent(db, studentId, JSON.stringify(details)),
      owner.ai_provider ?? "grok", owner.ai_model ?? "", specRevision, now.toISOString())
  return id
}

export async function decisionHistory(db: DatabaseSync, ownerId: string, studentId: string, limit = 100) {
  const owned = (await db.prepare("SELECT id FROM students WHERE id = ? AND owner_user_id = ?").get(studentId, ownerId))
  if (!owned) throw new Error("Student not found.")
  return (await db.prepare(`SELECT id, kind, reason, details, provider, model, spec_revision, created_at
    FROM decision_records WHERE student_id = ? ORDER BY rowid DESC LIMIT ?`).all(studentId, Math.min(200, Math.max(1, limit))))
}

// What the AI may see about past decisions: learning events only, as day, kind and reason. Stored details
// (birthdays from profile edits, note text, settings, raw answers) never leave the app through this path.
const PRIVATE_KINDS = new Set(["profile_changed", "presentation_changed", "ai_settings_changed", "parent_note_left", "parent_note_read", "pack_settings_changed", "change_undone"])

export async function decisionContext(db: DatabaseSync, ownerId: string, studentId: string) {
  return (await decisionHistory(db, ownerId, studentId, 40)).filter((row) => !PRIVATE_KINDS.has(String(row.kind))).slice(0, 20).reverse().map((row) =>
    `${String(row.created_at).slice(0, 10)} | ${row.kind} | ${String(row.reason).slice(0, 300)}`,
  ).join("\n") || "No recorded decisions yet."
}
