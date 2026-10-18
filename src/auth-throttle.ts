import type { IncomingMessage } from 'node:http'
import { createHash } from 'node:crypto'
import type { Database } from './database.ts'

export function throttleKey(kind: string, value: string) {
  return `${kind}:${createHash('sha256').update(value).digest('hex')}`
}
export function networkSource(req: IncomingMessage) {
  if (process.env.TUTOR_CLOUD === '1') {
    const forwarded = req.headers['x-forwarded-for']
    return String(Array.isArray(forwarded) ? forwarded[0] : forwarded ?? '').split(',')[0].trim() || 'unknown'
  }
  return req.socket?.remoteAddress || 'unknown'
}
export async function reserveThrottle(db: Database, key: string, limit: number, windowMs: number, now = new Date(), owner: string | null = null) {
  const cutoff = new Date(now.getTime() - windowMs).toISOString()
  return Boolean(await db.prepare(`INSERT INTO auth_throttle (key, window_start, count, owner_user_id) VALUES (?, ?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET owner_user_id = coalesce(auth_throttle.owner_user_id, excluded.owner_user_id), window_start = CASE WHEN auth_throttle.window_start <= ? THEN excluded.window_start ELSE auth_throttle.window_start END,
    count = CASE WHEN auth_throttle.window_start <= ? THEN 1 ELSE auth_throttle.count + 1 END
    WHERE auth_throttle.window_start <= ? OR auth_throttle.count < ? RETURNING count`).get(key, now.toISOString(), owner, cutoff, cutoff, cutoff, limit))
}
/** A correct password or PIN clears that account's counter, so a parent who locks and unlocks often is never shut out. */
export async function clearThrottle(db: Database, key: string) {
  await db.prepare('DELETE FROM auth_throttle WHERE key = ?').run(key)
}
