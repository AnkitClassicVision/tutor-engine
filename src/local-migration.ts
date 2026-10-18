import { DatabaseSync } from 'node:sqlite'
import { mkdir, readFile, copyFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { backupFamilyStore } from './backup.ts'
import { applicationTables, writeSnapshot } from './cloud-backup.ts'
import { encryptSecret, decryptSecret } from './secrets.ts'
import { openDb } from './db.ts'
import type { Row } from './database.ts'

// Read-only source access and SQLite online backup preserve the running local
// app. The prepared bundle is protected and never belongs in Git.
export async function prepareLocalMigration(source: string, uploads: string, destination: string, secretDir: string) {
  await mkdir(destination, { mode: 0o700 })
  const db = new DatabaseSync(source, { readOnly: true })
  try { await backupFamilyStore(db, uploads, destination, secretDir) }
  finally { db.close() }
  if (!process.env.TUTOR_ENCRYPTION_KEY) process.env.TUTOR_ENCRYPTION_KEY = (await readFile(join(secretDir, '.credential-key'))).toString('base64')
  // Upgrade a second copy; retain the verified original snapshot for rollback.
  const migratedPath = join(destination, 'migration.sqlite')
  await copyFile(join(destination, 'tutor.sqlite'), migratedPath)
  const snapshot = openDb(migratedPath)
  const tables: Record<string, Row[]> = {}
  try {
    for (const table of await applicationTables()) {
      // A new hostname should not inherit active sessions, links or unsent mail.
      if (['auth_sessions', 'account_tokens', 'oauth_states', 'mail_outbox', 'login_attempts', 'upload_intents'].includes(table)) tables[table] = []
      else tables[table] = snapshot.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
    }
  } finally { snapshot.close() }
  const sourceRoot = resolve(uploads) + sep, privateCopies = resolve(destination, 'uploads')
  for (const upload of tables.uploads) {
    const path = resolve(String(upload.stored_path))
    if (!path.startsWith(sourceRoot)) throw new Error('Migration file is outside the private source root.')
    upload.stored_path = join(privateCopies, path.slice(sourceRoot.length))
  }
  for (const job of tables.jobs) if (job.kind === 'pdf' && job.status === 'succeeded') {
    const result = JSON.parse(String(job.result || '{}'))
    job.result = JSON.stringify({ ...result, storedPath: join(privateCopies, String(job.owner_user_id), `${job.id}.pdf`) })
  }
  // Family data reads back plain from the snapshot; the destination seals it again under new family keys.
  for (const user of tables.users) { user.ai_key = encryptSecret(decryptSecret(String(user.ai_key || ''))); user.data_key = '' }
  for (const job of tables.jobs) {
    if (!['running', 'queued'].includes(String(job.status))) continue
    job.status = 'cancelled'; job.stage = 'Saved before the online move. Retry when ready.'; job.run_token = null; job.lease_until = null
  }
  for (const plan of tables.subject_plans) if (plan.build_status === 'building') {
    plan.build_status = 'failed'; plan.build_note = 'Saved before the online move. Start the build when ready.'
  }
  const directory = join(destination, 'cloud-import')
  await mkdir(directory, { mode: 0o700 })
  const bundle = await writeSnapshot(tables, directory, privateCopies)
  return { students: bundle.tables.students.length, attempts: bundle.tables.attempts.length, filesVerified: Object.keys(bundle.files).length }
}
