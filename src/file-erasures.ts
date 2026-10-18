import type { Database } from './database.ts'
import { deletePrivateFile } from './storage.ts'
import { withWrite, withDatabaseScope } from './transaction.ts'

export async function queueFileErasure(db: Database, owner: string, path: string, uploadId: string | null = null, retainUntil = new Date().toISOString()) {
  const now = new Date().toISOString()
  await db.prepare(`INSERT INTO file_erasures (id, owner_user_id, stored_path, upload_id, retain_until, retry_after) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_user_id, stored_path) DO UPDATE SET retain_until = CASE WHEN excluded.retain_until > file_erasures.retain_until THEN excluded.retain_until ELSE file_erasures.retain_until END,
    retry_after = excluded.retry_after, upload_id = coalesce(excluded.upload_id, file_erasures.upload_id)`).run(crypto.randomUUID(), owner, path, uploadId, retainUntil, now)
}
export function ticketRetention(expires: string) { return new Date(Date.parse(expires) + 15 * 60000).toISOString() }
export async function eraseLateUpload(db: Database, owner: string, id: string, root: string, remove = deletePrivateFile) {
  const task = await withDatabaseScope(db, async () => db.prepare('SELECT * FROM file_erasures WHERE owner_user_id = ? AND upload_id = ?').get(owner, id))
  if (!task) return false
  try { await remove(String(task.stored_path), root) }
  catch { await withDatabaseScope(db, async () => { await db.prepare('UPDATE file_erasures SET retry_after = ? WHERE id = ?').run(new Date().toISOString(), task.id) }) }
  return true
}
export async function sweepPrivateFiles(db: Database, root: string, remove = deletePrivateFile, now = new Date(), owner?: string) {
  if (!owner) await purgeExpiredSecurity(db, now).catch(() => console.error('Expired security records will be removed on the next sweep.'))
  const stamp = now.toISOString()
  const expired = await withDatabaseScope(db, async () => db.prepare(`SELECT * FROM upload_intents WHERE completed_at IS NULL AND expires_at <= ?${owner ? ' AND owner_user_id = ?' : ''} LIMIT 20`).all(stamp, ...(owner ? [owner] : [])))
  for (const intent of expired) await withWrite(db, async () => {
    if (!(await db.prepare(`SELECT id FROM users WHERE id = ?${'dialect' in db ? ' FOR UPDATE' : ''}`).get(intent.owner_user_id))) return
    const current = await db.prepare('SELECT * FROM upload_intents WHERE id = ? AND completed_at IS NULL').get(intent.id)
    if (!current) return
    await queueFileErasure(db, String(current.owner_user_id), String(current.stored_path), String(current.id), ticketRetention(String(current.expires_at)))
    await db.prepare('DELETE FROM upload_intents WHERE id = ?').run(current.id)
  })
  const tasks = await withDatabaseScope(db, async () => db.prepare(`SELECT * FROM file_erasures WHERE retry_after <= ?${owner ? ' AND owner_user_id = ?' : ''} ORDER BY retry_after LIMIT 100`).all(stamp, ...(owner ? [owner] : [])))
  for (const task of tasks) {
    try {
      await remove(String(task.stored_path), root)
      await withDatabaseScope(db, async () => {
        if (String(task.retain_until) <= stamp) await db.prepare('DELETE FROM file_erasures WHERE id = ? AND retain_until <= ?').run(task.id, stamp)
        else await db.prepare('UPDATE file_erasures SET attempts = attempts + 1, retry_after = retain_until WHERE id = ?').run(task.id)
      })
    } catch {
      await withDatabaseScope(db, async () => { await db.prepare('UPDATE file_erasures SET attempts = attempts + 1, retry_after = ? WHERE id = ?').run(new Date(now.getTime() + 60000).toISOString(), task.id) })
      console.error('Private file erasure will retry.')
    }
  }
}

/** Expired security state is removed instead of kept until the family leaves: sessions, one-time links, sign-in starts and counters. */
export async function purgeExpiredSecurity(db: Database, now = new Date()) {
  const stamp = now.toISOString(), dayAgo = new Date(now.getTime() - 86400000).toISOString()
  await withDatabaseScope(db, async () => {
    await db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(stamp)
    await db.prepare('DELETE FROM account_tokens WHERE expires_at < ?').run(dayAgo)
    await db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(stamp)
    await db.prepare('DELETE FROM auth_throttle WHERE window_start < ?').run(dayAgo)
  })
}
