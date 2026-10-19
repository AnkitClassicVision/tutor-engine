// Children's personal data is encrypted per family before it reaches the database. Each family has its own
// random data key, stored only wrapped by the deployment's master key (TUTOR_ENCRYPTION_KEY, held outside the
// database). Values are AES-256-GCM with the family id bound as associated data, so a value cannot be relabelled to
// open under another family's key. Reads decrypt transparently in the database layer (src/db.ts, src/postgres.ts), so the rest of the app
// sees plain values. Deleting a family deletes its key, which also makes any stray copy of its values unreadable.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import type { Database, Row } from "./database.ts"
import { decryptSecret, encryptSecret } from "./secrets.ts"

export const SEALED_PREFIX = "fam:v1:"
/** Put in a query to read sealed values as they are stored, for work that never needs the text (deleting a family). */
export const STILL_SEALED = "/* still sealed */"
// Unwrapped keys by their wrapped form, and the last key seen for each family (used by reads only). A family whose
// stored key changes (a restore) is noticed: writes always check the stored key, and a read retries once.
const unwrapped = new Map<string, Buffer>()
const keys = new Map<string, Buffer>()

/** The columns sealed per family, by table. Only text that describes a child or what a family wrote. */
export const FAMILY_FIELDS: Record<string, { owner: "id" | "student" | "session" | "material" | "question" | "user"; columns: string[] }> = {
  students: { owner: "id", columns: ["display_name", "birth_date"] },
  parent_notes: { owner: "student", columns: ["body"] },
  material_questions: { owner: "material", columns: ["child_prompt"] },
  subject_maps: { owner: "student", columns: ["map_json"] },
  changed_minds: { owner: "student", columns: ["before_prompt", "before_answer", "after_prompt", "after_answer"] },
  planner_messages: { owner: "student", columns: ["body"] },
  talk_messages: { owner: "student", columns: ["body"] },
  lesson_messages: { owner: "session", columns: ["body"] },
  guided_attempts: { owner: "question", columns: ["body"] },
  session_items: { owner: "session", columns: ["given_answer", "draft_answer", "grading_doubt"] },
  recaps: { owner: "session", columns: ["learned", "hard", "tell_friend"] },
  school_results: { owner: "student", columns: ["title", "notes"] },
  digests: { owner: "user", columns: ["subject", "body"] },
  decision_records: { owner: "student", columns: ["details"] },
}

export function isSealed(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(SEALED_PREFIX)
}

function seal(key: Buffer, owner: string, value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(Buffer.from(owner))
  const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  return `${SEALED_PREFIX}${owner}:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${bytes.toString("base64url")}`
}

function open(key: Buffer, value: string) {
  const [owner, iv, tag, bytes] = value.slice(SEALED_PREFIX.length).split(":")
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"))
  decipher.setAAD(Buffer.from(owner)); decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(bytes, "base64url")), decipher.final()]).toString("utf8")
}

const ownerOf = (value: string) => value.slice(SEALED_PREFIX.length, value.indexOf(":", SEALED_PREFIX.length))
function unwrap(wrapped: string) {
  let key = unwrapped.get(wrapped)
  if (!key) { key = Buffer.from(decryptSecret(wrapped), "base64"); unwrapped.set(wrapped, key) }
  return key
}

/** The family's data key, created on first use. Two writers racing both end up with the key that was stored first. */
async function familyKey(db: Database, owner: string) {
  let row = await db.prepare("SELECT data_key FROM users WHERE id = ?").get(owner) as Row | undefined
  if (!row) throw new Error("Family not found.")
  if (!row.data_key) {
    await db.prepare("UPDATE users SET data_key = ? WHERE id = ? AND data_key = ''").run(encryptSecret(randomBytes(32).toString("base64")), owner)
    row = await db.prepare("SELECT data_key FROM users WHERE id = ?").get(owner) as Row
  }
  const key = unwrap(String(row.data_key))
  keys.set(owner, key)
  return key
}

/** Seal one value for a family. Empty values and values that are already sealed are returned unchanged. */
export async function sealFor(db: Database, owner: string, value: unknown): Promise<string> {
  if (value == null) return value as unknown as string
  const text = String(value)
  if (!text || isSealed(text)) return text
  return seal(await familyKey(db, owner), owner, text)
}

/** The owner of a student, for writes that only know the student. A student never changes family. */
const studentOwners = new Map<string, string>()
export async function ownerOfStudent(db: Database, studentId: string) {
  const known = studentOwners.get(studentId)
  if (known) return known
  const row = await db.prepare("SELECT owner_user_id FROM students WHERE id = ?").get(studentId) as Row | undefined
  if (!row) throw new Error("Student not found.")
  studentOwners.set(studentId, String(row.owner_user_id))
  return String(row.owner_user_id)
}
export async function sealForStudent(db: Database, studentId: string, value: unknown) {
  return sealFor(db, await ownerOfStudent(db, studentId), value)
}
export async function sealForSession(db: Database, sessionId: string, value: unknown) {
  const row = await db.prepare("SELECT student_id FROM tutor_sessions WHERE id = ?").get(sessionId) as Row | undefined
  if (!row) throw new Error("Session not found.")
  return sealForStudent(db, String(row.student_id), value)
}

/** Families with sealed values in these rows whose key is not known yet (or every one, when `all`). */
function ownersIn(rows: Row[], all: boolean) {
  const owners = new Set<string>()
  for (const row of rows) for (const value of Object.values(row)) if (isSealed(value) && (all || !keys.has(ownerOf(value)))) owners.add(ownerOf(value))
  return [...owners]
}
function remember(owners: string[], loaded: Row[]) {
  for (const owner of owners) keys.delete(owner)
  for (const r of loaded) if (r.data_key) keys.set(String(r.id), unwrap(String(r.data_key)))
}
/** Decrypt sealed values in rows in place; false when a remembered key no longer opens a value. */
function openRows(rows: Row[]) {
  for (const row of rows) for (const [column, value] of Object.entries(row)) {
    if (!isSealed(value)) continue
    const key = keys.get(ownerOf(value))
    // A family whose key is gone (deleted) keeps an unreadable value rather than failing the whole page.
    if (!key) { row[column] = ""; continue }
    try { row[column] = open(key, value) } catch { return false }
  }
  return true
}
const tampered = () => new Error("A saved value failed its integrity check.")

export function openRowsSync(rows: Row[], query: (sql: string, ...values: string[]) => Row[]) {
  const load = (owners: string[]) => { if (owners.length) remember(owners, query(`SELECT id, data_key FROM users WHERE id IN (${owners.map(() => "?").join(",")})`, ...owners)) }
  load(ownersIn(rows, false))
  if (openRows(rows)) return rows
  load(ownersIn(rows, true))
  if (openRows(rows)) return rows
  throw tampered()
}

export async function openRowsAsync(rows: Row[], query: (sql: string, values: string[]) => Promise<Row[]>) {
  const load = async (owners: string[]) => { if (owners.length) remember(owners, await query(`SELECT id, data_key FROM users WHERE id = ANY($1)`, [owners as unknown as string])) }
  await load(ownersIn(rows, false))
  if (openRows(rows)) return rows
  await load(ownersIn(rows, true))
  if (openRows(rows)) return rows
  throw tampered()
}

export function forgetFamilyKey(owner: string) { keys.delete(owner) }

/** Seal any plain values left from before encryption, a few hundred at a time. Safe to run repeatedly. */
export async function sealExistingFamilyData(db: Database, limit = 500) {
  const ownerSql: Record<string, string> = {
    id: "owner_user_id",
    user: "owner_user_id",
    student: "(SELECT owner_user_id FROM students s WHERE s.id = t.student_id)",
    session: "(SELECT s.owner_user_id FROM students s JOIN tutor_sessions ts ON ts.student_id = s.id WHERE ts.id = t.session_id)",
    material: "(SELECT s.owner_user_id FROM students s JOIN materials m ON m.student_id = s.id WHERE m.id = t.material_id)",
    question: "(SELECT s.owner_user_id FROM students s JOIN materials m ON m.student_id = s.id JOIN material_questions q ON q.material_id = m.id WHERE q.id = t.question_id)",
  }
  let sealed = 0
  for (const [table, field] of Object.entries(FAMILY_FIELDS)) {
    for (const column of field.columns) {
      // Rows whose family is gone are skipped, so they cannot fill every batch.
      const rows = await db.prepare(`SELECT rid, owner, value FROM (SELECT t.rowid AS rid, ${ownerSql[field.owner]} AS owner, t.${column} AS value FROM ${table} t
        WHERE t.${column} IS NOT NULL AND t.${column} <> '' AND t.${column} NOT LIKE 'fam:v1:%') plain WHERE owner IS NOT NULL LIMIT ${limit}`).all() as Row[]
      for (const row of rows) {
        await db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ? AND ${column} = ?`).run(await sealFor(db, String(row.owner), row.value), row.rid, row.value)
        sealed++
      }
    }
  }
  return sealed
}

/** Seal everything left plain, batch by batch. Run at startup; costs one scan per column when nothing is left. */
export async function sealAllFamilyData(db: Database) {
  let total = 0
  for (let batch = 0; batch < 1000; batch++) {
    const sealed = await sealExistingFamilyData(db)
    total += sealed
    if (!sealed) break
  }
  return total
}
