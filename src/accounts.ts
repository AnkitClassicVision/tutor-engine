import { UserError } from "./errors.ts"
import { readPrivateFile, deletePrivateFile } from "./storage.ts"
import { withWrite, lockFamily } from './transaction.ts'
import type { Database as DatabaseSync } from "./database.ts"
import { randomBytes } from 'node:crypto'
import { hashToken, hashPassword } from './auth.ts'
import { encryptSecret, decryptSecret } from './secrets.ts'
import { forgetFamilyKey, STILL_SEALED } from './family-crypto.ts'
import { join } from 'node:path'
import { queueFileErasure, sweepPrivateFiles, ticketRetention } from './file-erasures.ts'
import { reserveThrottle, throttleKey } from './auth-throttle.ts'
import { normalizeEmail } from './auth.ts'
import { parentMailConfigured, parentMailer } from './parent-mail.ts'

export async function issueAccountToken(db: DatabaseSync, user: string, kind: 'verify' | 'recover') {
  const token = randomBytes(32).toString('base64url'), now = new Date().toISOString()
  await db.prepare('INSERT INTO account_tokens (token_hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)').run(hashToken(token), user, kind, new Date(Date.now() + 30 * 60000).toISOString())
  const base = process.env.TUTOR_ORIGIN || 'http://127.0.0.1:8787'
  const message = encryptSecret(JSON.stringify({ url: `${base}/account/${kind}?token=${token}`, kind }))
  await db.prepare('INSERT INTO mail_outbox (id, user_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), user, kind, message, now)
}
export async function requestRecovery(db: DatabaseSync, email: string, source: string, now = new Date()) {
  const address = normalizeEmail(email)
  if (!(await reserveThrottle(db, throttleKey('recovery-source', source), 20, 60 * 60000, now))) return
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').get(address)
  const owner = user ? String(user.id) : null
  if (!(await reserveThrottle(db, throttleKey('recovery-cooldown', address), 1, 60 * 1000, now, owner))) return
  if (!(await reserveThrottle(db, throttleKey('recovery-address', address), 3, 60 * 60000, now, owner))) return
  if (owner) await withWrite(db, async () => {
    await lockFamily(db, owner)
    await issueAccountToken(db, owner, 'recover')
  })
  return owner
}
export async function consumeAccountToken(db: DatabaseSync, token: string, kind: string, password?: string) {
  return withWrite(db, async () => {
    const candidate = await db.prepare('SELECT user_id FROM account_tokens WHERE token_hash = ?').get(hashToken(token))
    if (candidate) await lockFamily(db, String(candidate.user_id))
    const row = (await db.prepare('SELECT * FROM account_tokens WHERE token_hash = ? AND kind = ? AND consumed_at IS NULL AND expires_at > ?').get(hashToken(token), kind, new Date().toISOString()))
    if (!row) throw new UserError('This link has expired or was already used.')
    if (kind === 'recover' && (!password || password.length < 10 || password.length > 1024)) throw new UserError('Use at least ten characters.')

    await db.prepare('UPDATE account_tokens SET consumed_at = ? WHERE token_hash = ?').run(new Date().toISOString(), row.token_hash)
    if (kind === 'verify') await db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?').run(new Date().toISOString(), row.user_id)
    else {
      await db.prepare("UPDATE account_tokens SET consumed_at = ? WHERE user_id = ? AND kind = 'recover' AND consumed_at IS NULL").run(new Date().toISOString(), row.user_id)
      await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password!), row.user_id)
      await db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(row.user_id)
    }
  })
}
export async function flushMail(db: DatabaseSync, limit = 10, owner?: string, kind?: string) {
  if (!parentMailConfigured()) return
  const transport = await parentMailer()
  try {
    for (let i = 0; i < limit; i++) {
      const sent = await withWrite(db, async () => {
        const lock = 'dialect' in db ? ' FOR UPDATE OF o SKIP LOCKED' : ''
        const message = await db.prepare(`SELECT o.*, u.email FROM mail_outbox o JOIN users u ON u.id = o.user_id WHERE sent_at IS NULL${owner ? ' AND u.id = ?' : ''}${kind ? ' AND o.kind = ?' : ''} ORDER BY o.created_at LIMIT 1${lock}`).get(...(owner ? [owner] : []), ...(kind ? [kind] : []))
        if (!message) return false
        const content = JSON.parse(decryptSecret(String(message.message)))
        const digest = content.kind === 'digest'
        await transport.send(String(message.id), { to: String(message.email), subject: digest ? String(content.subject) : content.kind === 'verify' ? 'Verify your Tutor family account' : 'Reset your Tutor password', text: digest ? String(content.text) : `Open this link within 30 minutes:\n${content.url}\n\nIf you did not request this, you can ignore this email.` })
        await db.prepare('UPDATE mail_outbox SET sent_at = ?, message = ? WHERE id = ?').run(new Date().toISOString(), '', message.id)
        return true
      })
      if (!sent) break
    }
  } finally { transport.close() }
}
async function familyRows(db: DatabaseSync, owner: string, open = true) {
  const students = (await db.prepare('SELECT id FROM students WHERE owner_user_id = ?').all(owner)).map(s => String(s.id))
  const sessions = (await db.prepare('SELECT id FROM tutor_sessions WHERE student_id IN (SELECT id FROM students WHERE owner_user_id = ?)').all(owner)).map(s => String(s.id))
  const materials = (await db.prepare('SELECT id FROM materials WHERE student_id IN (SELECT id FROM students WHERE owner_user_id = ?)').all(owner)).map(s => String(s.id))
  const questions = (await db.prepare('SELECT id FROM material_questions WHERE material_id IN (SELECT id FROM materials WHERE student_id IN (SELECT id FROM students WHERE owner_user_id = ?))').all(owner)).map(s => String(s.id))
  const data: Record<string, any[]> = {}
  for (const { name } of (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all())) {
    const table = String(name)
    if (['users', 'auth_sessions', 'account_tokens', 'oauth_states', 'mail_outbox', 'login_attempts'].includes(table)) continue
    const cols = (await db.prepare(`PRAGMA table_info(${table})`).all()).map(c => c.name)
    let column: string, ids: string[]
    if (cols.includes('owner_user_id')) { column = 'owner_user_id'; ids = [owner] }
    else if (cols.includes('student_id')) { column = 'student_id'; ids = students }
    else if (cols.includes('session_id')) { column = 'session_id'; ids = sessions }
    else if (cols.includes('material_id')) { column = 'material_id'; ids = materials }
    else if (cols.includes('question_id')) { column = 'question_id'; ids = questions }
    else continue
    data[table] = ids.length ? (await db.prepare(`SELECT * FROM ${table}${open ? '' : ` ${STILL_SEALED}`} WHERE ${column} IN (${ids.map(() => '?').join(',')})`).all(...ids)) : []
  }
  return data
}
const EXPORT_PRIVATE = /(_hash|^verifier$|^nonce$|^csrf_token$|^access_code$|^stored_path$|^idempotency_key$|^request_key$|^request_id$|^lease_until$|^leased_by$|^ai_key$|^data_key$)/
export async function exportFamily(db: DatabaseSync, owner: string, uploadsDir: string) {
  const data = (await familyRows(db, owner))
  data.uploads = await Promise.all((data.uploads ?? []).map(async u => ({
    id: u.id, student_id: u.student_id, created_at: u.created_at,
    base64: (await readPrivateFile(String(u.stored_path), uploadsDir)).toString('base64'),
    mime: String(u.stored_path).endsWith('.png') ? 'image/png' : 'image/jpeg',
  })))
  // The export is the family's own learning record: security and bookkeeping state stays out of it.
  for (const table of ['auth_throttle', 'file_erasures', 'upload_intents']) delete data[table]
  for (const rows of Object.values(data)) for (const row of rows) for (const column of Object.keys(row)) if (EXPORT_PRIVATE.test(column)) delete row[column]
  return { exportedAt: new Date().toISOString(), family: (await db.prepare('SELECT email, created_at FROM users WHERE id = ?').get(owner)), records: data }
}
export async function deleteFamily(db: DatabaseSync, owner: string, uploadsDir: string, remove = deletePrivateFile) {
  await withWrite(db, async () => {
    await lockFamily(db, owner)
    if ('dialect' in db) await db.prepare('SELECT id FROM jobs WHERE owner_user_id = ? FOR UPDATE').all(owner)
    // Deleting needs ids and file references only, never the sealed text.
    const data = (await familyRows(db, owner, false))
    const intents = await db.prepare('SELECT * FROM upload_intents WHERE owner_user_id = ?').all(owner)
    for (const intent of intents) await queueFileErasure(db, owner, String(intent.stored_path), String(intent.id), ticketRetention(String(intent.expires_at)))
    await db.prepare('DELETE FROM upload_intents WHERE owner_user_id = ?').run(owner)
    const ordered = ['learning_exposures', 'learning_cutovers', 'homework_reviews', 'guided_attempts', 'material_questions', 'material_pages', 'materials', 'recaps', 'lesson_messages', 'session_items', 'attempts', 'tutor_sessions', 'uploads', 'sheets', 'jobs', 'followup_missions', 'path_revisions', 'school_results', 'decision_records', 'learning_patterns', 'talk_messages', 'planner_messages', 'parent_notes', 'subject_sources', 'subject_plans', 'practice_items', 'packs', 'runbook_runs', 'subject_maps', 'changed_minds', 'grading_audits', 'custom_concepts', 'learner_states', 'targets', 'students']

    for (const table of ordered) {
      const rows = data[table] ?? []
      const pk = (await db.prepare(`PRAGMA table_info(${table})`).all()).filter(c => Number(c.pk) > 0).map(c => String(c.name))
      for (const row of rows) await db.prepare(`DELETE FROM ${table} WHERE ${pk.map(c => `${c} = ?`).join(' AND ')}`).run(...pk.map(c => row[c]))
    }
    for (const table of ['oauth_states', 'account_tokens', 'mail_outbox', 'auth_sessions']) await db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(owner)
    await db.prepare('DELETE FROM auth_throttle WHERE owner_user_id = ?').run(owner)
    await db.prepare('DELETE FROM digests WHERE owner_user_id = ?').run(owner)
    await db.prepare('DELETE FROM login_attempts WHERE email = (SELECT email FROM users WHERE id = ?)').run(owner)
    await db.prepare('DELETE FROM users WHERE id = ?').run(owner)
    forgetFamilyKey(owner)
    const files = [...new Set([...(data.uploads ?? []), ...intents].map(u => String(u.stored_path)))]
    for (const job of data.jobs ?? []) {
      const result = job.result ? JSON.parse(String(job.result)) : null
      if (result?.storedPath) files.push(String(result.storedPath))
      else if (job.kind === 'pdf') files.push(join(uploadsDir, owner, `${job.id}.pdf`))
    }
    for (const path of files) await queueFileErasure(db, owner, path)
  })
  await sweepPrivateFiles(db, uploadsDir, remove, new Date(), owner)
}
