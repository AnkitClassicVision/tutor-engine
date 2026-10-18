import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import type { Database as DatabaseSync } from "./database.ts"
import { reserveThrottle, clearThrottle, throttleKey } from "./auth-throttle.ts"

// OWASP's scrypt guidance offers equal-strength settings; N=2^15, r=8, p=3 needs 32 MiB per check instead of
// 128 MiB, which matters when one server instance handles many sign-ins at once. Older, cheaper hashes still
// verify and are upgraded at the next correct sign-in. Tests may lower the cost through TUTOR_SCRYPT_N; production cannot.
export const SCRYPT_N = process.env.TUTOR_PUBLIC === '1' || process.env.TUTOR_CLOUD === '1' ? 32768 : Number(process.env.TUTOR_SCRYPT_N) || 32768
export const SCRYPT_P = 3
const SCRYPT_MAXMEM = 64 * 1024 * 1024

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url")
  const hash = scryptSync(password, salt, 32, { N: SCRYPT_N, r: 8, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM }).toString("base64url")
  return `scrypt$${SCRYPT_N}$8$${SCRYPT_P}$${salt}$${hash}`
}

/** A stored hash made with a lower total cost than today's is replaced after the next correct sign-in. */
export function needsRehash(stored: string) {
  const [kind, n, , p] = stored.split("$")
  return kind !== "scrypt" || !(Number(n) * Number(p) >= SCRYPT_N * SCRYPT_P)
}

export function verifyPassword(password: string, stored: string): boolean {
  if (password.length > 1024) return false
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return false
  const [, nRaw, rRaw, pRaw, salt, expected] = parts
  const actual = scryptSync(password, salt, 32, {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
    maxmem: Math.max(SCRYPT_MAXMEM, 128 * Number(rRaw) * Number(nRaw) * 2),
  })
  const expectedBuf = Buffer.from(expected, "base64url")
  if (actual.length !== expectedBuf.length) return false
  return timingSafeEqual(actual, expectedBuf)
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url")
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200
}

export async function registerUser(db: DatabaseSync, email: string, password: string, now = new Date()) {
  const normalized = normalizeEmail(email)
  if (!validEmail(normalized)) return { ok: false as const, error: "Use a real email address." }
  if (password.length > 1024) return { ok: false as const, error: "Keep the password under 1025 characters." }
  if (password.length < 10) return { ok: false as const, error: "Use a password of at least 10 characters." }
  const existing = (await db.prepare("SELECT id FROM users WHERE email = ?").get(normalized)) as { id: string } | undefined
  if (existing) return { ok: false as const, error: "That email is already registered." }
  const id = crypto.randomUUID()
  await db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    normalized,
    hashPassword(password),
    now.toISOString(),
  )
  return { ok: true as const, userId: id }
}

let dummyHash = ""
function timingHash() { return dummyHash ||= hashPassword(randomBytes(16).toString("hex")) }

export async function loginUser(
  db: DatabaseSync,
  email: string,
  password: string,
  now = new Date(),
  limit = 5,
  source = "unknown",
) {
  const normalized = normalizeEmail(email)
  const user = (await db.prepare("SELECT id, password_hash FROM users WHERE email = ?").get(normalized)) as { id: string; password_hash: string } | undefined
  const sourceAllowed = await reserveThrottle(db, throttleKey('auth-source', source), 100, 15 * 60000, now)
  const accountAllowed = sourceAllowed && await reserveThrottle(db, throttleKey('parent', normalized), limit, 15 * 60000, now, user?.id ?? null)
  if (!accountAllowed) return { ok: false as const, error: "Too many tries. Wait 15 minutes." }
  // An unknown address still pays for one hash, so response time does not reveal which emails have accounts.
  if (!user || !verifyPassword(password, user.password_hash)) {
    if (!user) verifyPassword(password, timingHash())
    return { ok: false as const, error: "Email or password does not match." }
  }
  await clearThrottle(db, throttleKey('parent', normalized))
  if (needsRehash(user.password_hash)) await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), user.id)
  // A correct password does not use up the shared network allowance either.
  await db.prepare('UPDATE auth_throttle SET count = count - 1 WHERE key = ? AND count > 0').run(throttleKey('auth-source', source))
  return { ok: true as const, userId: user.id }
}

export async function openAuthSession(db: DatabaseSync, userId: string, now = new Date()) {
  const token = randomBytes(32).toString("base64url")
  const csrf = randomBytes(24).toString("base64url")
  const id = crypto.randomUUID()
  const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
  await db.prepare(
    "INSERT INTO auth_sessions (id, user_id, token_hash, csrf_token, created_at, expires_at, parent_unlocked_until) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, userId, hashToken(token), csrf, now.toISOString(), expires.toISOString(), new Date(now.getTime() + 15 * 60000).toISOString())
  return { token, csrf, expires }
}

export async function readAuthSession(db: DatabaseSync, token: string, now = new Date()) {
  const row = (await db.prepare(
    "SELECT id, user_id, csrf_token, expires_at, selected_student, parent_unlocked_until, student_only FROM auth_sessions WHERE token_hash = ?",
  ).get(hashToken(token))) as { id: string; user_id: string; csrf_token: string; expires_at: string; selected_student: string | null; parent_unlocked_until: string | null; student_only: number } | undefined
  if (!row) return null
  if (row.expires_at <= now.toISOString()) return null
  if (row.student_only === 1 && !row.selected_student) return null
  return { studentOnly: row.student_only === 1, id: row.id, userId: row.user_id, csrf: row.csrf_token, selectedStudent: row.selected_student, parentUnlocked: row.student_only !== 1 && Boolean(row.parent_unlocked_until && row.parent_unlocked_until > now.toISOString()) }
}

export async function destroyAuthSession(db: DatabaseSync, token: string) {
  await db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(hashToken(token))
}
