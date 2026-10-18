import { UserError } from "./errors.ts"
import { randomBytes } from 'node:crypto'
import type { Database } from './database.ts'
import { hashPassword, verifyPassword, hashToken, openAuthSession, needsRehash } from './auth.ts'
import { assertStudent } from './services.ts'
import { reserveThrottle, clearThrottle, throttleKey } from './auth-throttle.ts'
import { encryptSecret } from './secrets.ts'
import { withWrite } from './transaction.ts'

export async function configureStudentAccess(db: Database, owner: string, student: string, pin: string, disable = false) {
  return withWrite(db, async () => {
    await assertStudent(db, owner, student)
    if (!disable && !/^\d{6}$/.test(pin)) throw new UserError('Choose a six-digit student PIN.')
    const code = disable ? '' : randomBytes(24).toString('base64url')
    // The link is kept encrypted (so a parent can see it again) and found by its hash, so a database copy alone cannot sign a child in.
    await db.prepare('UPDATE students SET access_code = ?, access_code_hash = ?, access_pin_hash = ? WHERE id = ?').run(code ? encryptSecret(code) : '', code ? hashToken(code) : '', disable ? '' : hashPassword(pin), student)
    await db.prepare('DELETE FROM auth_sessions WHERE selected_student = ? AND student_only = 1').run(student)
    return code
  })
}

export async function studentLogin(db: Database, code: string, pin: string, now = new Date(), source = "unknown") {
  if (!/^[A-Za-z0-9_-]{32}$/.test(code) || !/^\d{6}$/.test(pin)) return null
  return withWrite(db, async () => {
    let student = await db.prepare('SELECT id, owner_user_id, access_pin_hash FROM students WHERE access_code_hash = ?').get(hashToken(code))
    if (!student) {
      // A link made before links were hashed is found once by its old form, then stored the new way.
      student = await db.prepare("SELECT id, owner_user_id, access_pin_hash FROM students WHERE access_code = ? AND access_code_hash = ''").get(code)
      if (student) await db.prepare('UPDATE students SET access_code = ?, access_code_hash = ? WHERE id = ?').run(encryptSecret(code), hashToken(code), student.id)
    }
    if (!(await reserveThrottle(db, throttleKey('auth-source', source), 100, 15 * 60000, now))) return null
    if (!(await reserveThrottle(db, throttleKey('student', hashToken(code)), 5, 15 * 60000, now, student ? String(student.owner_user_id) : null))) return null
    if (!student || !student.access_pin_hash || !verifyPassword(pin, String(student.access_pin_hash))) {
      return null
    }
    await clearThrottle(db, throttleKey('student', hashToken(code)))
    if (needsRehash(String(student.access_pin_hash))) await db.prepare('UPDATE students SET access_pin_hash = ? WHERE id = ?').run(hashPassword(pin), student.id)
    const session = await openAuthSession(db, String(student.owner_user_id), now)
    const expires = new Date(now.getTime() + 12 * 60 * 60000)
    await db.prepare('UPDATE auth_sessions SET selected_student = ?, student_only = 1, parent_unlocked_until = NULL, expires_at = ? WHERE token_hash = ?').run(student.id, expires.toISOString(), hashToken(session.token))
    return { ...session, expires, studentId: String(student.id) }
  })
}
