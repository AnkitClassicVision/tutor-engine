import type { Database } from './database.ts'
import { withWrite, lockFamily } from './transaction.ts'
import { UserError } from './errors.ts'

export const UPLOAD_LIMITS = { count: 12, bytes: 180_000_000, file: 15_000_000 }
export async function reserveUpload(db: Database, owner: string, student: string, id: string, path: string, mime: string, bytes = UPLOAD_LIMITS.file, now = new Date()) {
  return withWrite(db, async () => {
    await lockFamily(db, owner)
    if (!(await db.prepare('SELECT id FROM students WHERE id = ? AND owner_user_id = ?').get(student, owner))) throw new UserError('Student not found.')
    const pending = (await db.prepare('SELECT count(*) n, coalesce(sum(reserved_bytes), 0) bytes FROM upload_intents WHERE owner_user_id = ? AND completed_at IS NULL AND expires_at > ?').get(owner, now.toISOString()))!
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > UPLOAD_LIMITS.file) throw new UserError('Photo must be under 15 MB.')
    if (Number(pending.n) >= UPLOAD_LIMITS.count || Number(pending.bytes) + bytes > UPLOAD_LIMITS.bytes) throw new UserError('Your family has enough photos waiting. Finish those uploads before adding more.')
    const expires = new Date(now.getTime() + 15 * 60000).toISOString()
    await db.prepare('INSERT INTO upload_intents (id, owner_user_id, student_id, stored_path, mime, created_at, expires_at, reserved_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, owner, student, path, mime, now.toISOString(), expires, bytes)
    return expires
  })
}
