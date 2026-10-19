import { createHash, randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Database, Row } from './database.ts'
import { readPrivateFile, storePrivateFile, deletePrivateFile } from './storage.ts'
import { onWriteRollback, withWrite } from './transaction.ts'
import { keyRing } from './secrets.ts'

const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

// Backups are sealed with their own key (TUTOR_BACKUP_KEY), kept apart from the credential key, so a copied
// backup folder reveals nothing. Each file is AES-256-GCM with its file name as associated data.
const SEALED = Buffer.from('TBK1')
function backupKey() {
  const value = process.env.TUTOR_BACKUP_KEY
  if (!value) throw new Error('Set TUTOR_BACKUP_KEY (32 random bytes, base64) to write or read an encrypted backup. Keep it apart from TUTOR_ENCRYPTION_KEY.')
  const key = Buffer.from(value, 'base64')
  if (key.length !== 32) throw new Error('TUTOR_BACKUP_KEY must encode 32 bytes.')
  return key
}
async function writeSealed(directory: string, name: string, bytes: Buffer | string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', backupKey(), iv)
  cipher.setAAD(Buffer.from(name))
  const body = Buffer.concat([cipher.update(typeof bytes === 'string' ? Buffer.from(bytes) : bytes), cipher.final()])
  await writeFile(join(directory, name), Buffer.concat([SEALED, iv, cipher.getAuthTag(), body]), { mode: 0o600, flag: 'wx' })
}
async function readSealed(directory: string, name: string) {
  const raw = await readFile(join(directory, name))
  // Folders written before sealing existed are still readable; everything new is sealed.
  if (!raw.subarray(0, 4).equals(SEALED)) return raw
  const decipher = createDecipheriv('aes-256-gcm', backupKey(), raw.subarray(4, 16))
  decipher.setAAD(Buffer.from(name)); decipher.setAuthTag(raw.subarray(16, 32))
  try { return Buffer.concat([decipher.update(raw.subarray(32)), decipher.final()]) }
  catch { throw new Error('Backup file checksum mismatch, or the wrong TUTOR_BACKUP_KEY.') }
}
type Snapshot = { version: 1; createdAt: string; encryptionKeySha256?: string; tables: Record<string, Row[]>; files: Record<string, { file: string; sha256: string; owner: string; kind: 'uploads' | 'pdf'; mime: string }>; recordsSha256: string }

export async function applicationTables() {
  const sql = await readFile(new URL('./migrations/001-postgres.sql', import.meta.url), 'utf8')
  return [...sql.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)].map(match => match[1]).concat('upload_intents', 'planner_messages', 'parent_notes', 'digests', 'packs', 'runbook_runs', 'subject_maps', 'changed_minds', 'grading_audits')
}

// Quiesce web and workers first: a database snapshot alone cannot prevent a
// concurrent family deletion from removing its private files during the copy.
export async function createCloudBackup(db: Database, directory: string, uploads: string) {
  await mkdir(directory, { mode: 0o700 })
  const tables: Record<string, Row[]> = {}
  await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ')
  try {
    for (const table of await applicationTables()) tables[table] = await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
    await db.exec('COMMIT')
  } catch (e) { await db.exec('ROLLBACK'); throw e }
  return writeSnapshot(tables, directory, uploads)
}

export async function writeSnapshot(tables: Record<string, Row[]>, directory: string, uploads: string) {
  const files: Snapshot['files'] = {}
  const copy = async (path: string, owner: string, kind: 'uploads' | 'pdf', mime: string) => {
    if (files[path]) return
    const bytes = await readPrivateFile(path, uploads)
    const file = `${randomUUID()}.bin`
    await writeSealed(directory, file, bytes)
    files[path] = { file, sha256: digest(bytes), owner, kind, mime }
  }
  for (const row of tables.uploads ?? []) await copy(String(row.stored_path), String(row.owner_user_id), 'uploads', String(row.stored_path).endsWith('.png') ? 'image/png' : 'image/jpeg')
  for (const job of tables.jobs ?? []) {
    if (job.kind !== 'pdf') continue
    const result = JSON.parse(String(job.result || '{}'))
    if (!result.storedPath && job.status !== 'succeeded') continue
    const path = result.storedPath || join(uploads, String(job.owner_user_id), `${job.id}.pdf`)
    await copy(path, String(job.owner_user_id), 'pdf', 'application/pdf')
    // Normalizes legacy local PDFs without modifying the source database.
    job.result = JSON.stringify({ ...result, storedPath: path })
  }
  // Upload tickets are ephemeral; completed files already appear in uploads.
  tables.upload_intents = []
  const records = JSON.stringify(tables)
  await writeSealed(directory, 'records.json', records)
  const encryptionKeySha256 = process.env.TUTOR_ENCRYPTION_KEY ? digest(Buffer.from(process.env.TUTOR_ENCRYPTION_KEY, 'base64')) : undefined
  const snapshot: Snapshot = { version: 1, createdAt: new Date().toISOString(), encryptionKeySha256, tables: {}, files, recordsSha256: digest(records) }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(snapshot, null, 2), { mode: 0o600, flag: 'wx' })
  return verifyCloudBackup(directory)
}

export async function verifyCloudBackup(directory: string) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as Snapshot
  if (manifest.version !== 1) throw new Error('Unsupported cloud backup.')
  const records = await readSealed(directory, 'records.json')
  if (digest(records) !== manifest.recordsSha256) throw new Error('Backup records checksum mismatch.')
  manifest.tables = JSON.parse(records.toString())
  const expected = await applicationTables()
  if (Object.keys(manifest.tables).some(table => !expected.includes(table)) || expected.some(table => !Array.isArray(manifest.tables[table]))) throw new Error('Backup tables do not match the application schema.')
  for (const file of Object.values(manifest.files)) {
    if (!/^[0-9a-f-]{36}\.bin$/.test(file.file) || !['uploads', 'pdf'].includes(file.kind)) throw new Error('Invalid backup file reference.')
    if (digest(await readSealed(directory, file.file)) !== file.sha256) throw new Error('Backup file checksum mismatch.')
  }
  return manifest
}

// The destination must already have the current migrations and no family data.
// Fresh Blob names keep the source and restored copies independent.
export async function restoreCloudBackup(db: Database, directory: string, uploads: string) {
  const snapshot = await verifyCloudBackup(directory)
  if (snapshot.encryptionKeySha256 && !keyRing().some(key => digest(key) === snapshot.encryptionKeySha256)) throw new Error('Restore requires the original encryption key (as TUTOR_ENCRYPTION_KEY or in TUTOR_ENCRYPTION_KEYS_PREVIOUS).')
  return withWrite(db, async () => {
    const tables = await applicationTables()
    await db.exec(`LOCK TABLE ${tables.join(', ')} IN ACCESS EXCLUSIVE MODE`)
    for (const table of tables) {
      if (Number((await db.prepare(`SELECT count(*) n FROM ${table}`).get())?.n)) throw new Error('Restore requires an empty destination database.')
    }
    const paths = new Map<string, string>()
    for (const [oldPath, file] of Object.entries(snapshot.files)) {
      const extension = file.kind === 'pdf' ? 'pdf' : file.mime === 'image/png' ? 'png' : 'jpg'
      const bytes = await readSealed(directory, file.file)
      const path = await storePrivateFile(uploads, file.owner, `${randomUUID()}.${extension}`, bytes, file.mime, file.kind)
      onWriteRollback(db, () => deletePrivateFile(path, uploads))
      paths.set(oldPath, path)
    }
    for (const table of tables) for (const source of snapshot.tables[table]) {
      const row = { ...source }; delete row.rowid
      if (table === 'uploads') {
        const path = paths.get(String(row.stored_path)); if (!path) throw new Error('Backup is missing a referenced upload.')
        row.stored_path = path
      }
      if (table === 'jobs' && row.result) {
        const result = JSON.parse(String(row.result))
        if (result.storedPath) {
          const path = paths.get(result.storedPath); if (!path) throw new Error('Backup is missing a referenced PDF.')
          row.result = JSON.stringify({ ...result, storedPath: path })
        }
      }
      // An interrupted worker cannot retain a lease on the restored store.
      if (table === 'jobs' && row.status === 'running') { row.status = 'queued'; row.run_token = null; row.lease_until = null }
      // Backups hold family data already opened (inside the sealed file); the restored store seals it again under new family keys.
      if (table === 'users') row.data_key = ''
      const columns = Object.keys(row)
      if (columns.some(column => !/^[a-z_][a-z0-9_]*$/.test(column))) throw new Error('Invalid backup column.')
      await db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...columns.map(column => row[column]))
    }
    return { students: snapshot.tables.students.length, attempts: snapshot.tables.attempts.length, filesVerified: paths.size }
  })
}
