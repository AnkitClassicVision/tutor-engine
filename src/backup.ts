import { DatabaseSync, backup } from 'node:sqlite'
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs'
import { join, resolve, sep, dirname } from 'node:path'
import { createHash } from 'node:crypto'

export async function backupFamilyStore(db: DatabaseSync, uploads: string, destination: string, secretDir = process.env.TUTOR_SECRET_DIR || 'data') {
  mkdirSync(destination, { recursive: true, mode: 0o700 })
  const dbFile = join(destination, 'tutor.sqlite')
  if (existsSync(dbFile)) throw new Error('Use a new backup directory.')
  await backup(db, dbFile)
  const snapshot = new DatabaseSync(dbFile, { readOnly: true })
  const root = resolve(uploads) + sep, files = snapshot.prepare('SELECT stored_path FROM uploads').all().map(r => String(r.stored_path))
  if (snapshot.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'jobs'").get()) {
    for (const job of snapshot.prepare("SELECT id, owner_user_id FROM jobs WHERE kind = 'pdf' AND status = 'succeeded'").all()) files.push(join(uploads, String(job.owner_user_id), `${job.id}.pdf`))
  }
  const checksums: Record<string, string> = {}
  for (const file of files) {
    const source = resolve(file)
    if (!source.startsWith(root)) throw new Error('Upload outside the private storage root.')
    const relative = source.slice(root.length), target = join(destination, 'uploads', relative)
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 }); copyFileSync(source, target)
    checksums[relative] = createHash('sha256').update(readFileSync(target)).digest('hex')
  }
  snapshot.close()
  // The credential key is never copied next to the data it protects; keep it (or TUTOR_ENCRYPTION_KEY) separately.
  writeFileSync(join(destination, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), uploadRoot: resolve(uploads), encryptionKey: process.env.TUTOR_ENCRYPTION_KEY ? 'external: restore requires the original deployment secret' : 'kept apart: restore requires the original .credential-key from TUTOR_SECRET_DIR', checksums }, null, 2), { mode: 0o600 })
  return verifyBackup(destination)
}
export function verifyBackup(directory: string) {
  const db = new DatabaseSync(join(directory, 'tutor.sqlite'), { readOnly: true })
  const integrity = db.prepare('PRAGMA integrity_check').get()!, foreignKeys = db.prepare('PRAGMA foreign_key_check').all()
  if (integrity.integrity_check !== 'ok' || foreignKeys.length) throw new Error('Backup database failed integrity checks.')
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
  for (const [relative, checksum] of Object.entries(manifest.checksums)) {
    const root = resolve(directory, 'uploads') + sep, target = resolve(directory, 'uploads', relative)
    if (!target.startsWith(root)) throw new Error('Invalid backup path.')
    if (createHash('sha256').update(readFileSync(target)).digest('hex') !== checksum) throw new Error('Backup upload checksum mismatch.')
  }
  const report = { integrity: 'ok', foreignKeys: foreignKeys.length, uploadsVerified: Object.keys(manifest.checksums).length, students: Number(db.prepare('SELECT count(*) n FROM students').get()!.n), attempts: Number(db.prepare('SELECT count(*) n FROM attempts').get()!.n) }
  db.close(); return report
}
export function restoreStore(source: string, destination: string) {
  const report = verifyBackup(source)
  if (existsSync(destination)) throw new Error('Restore destination must be a new, empty path. Stop web and worker before switching stores.')
  cpSync(source, destination, { recursive: true })
  const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'))
  const db = new DatabaseSync(join(destination, 'tutor.sqlite'))
  const root = resolve(manifest.uploadRoot) + sep
  for (const row of db.prepare('SELECT id, stored_path FROM uploads').all()) {
    const previous = resolve(String(row.stored_path))
    if (!previous.startsWith(root)) throw new Error('Restore upload is outside the recorded root.')
    db.prepare('UPDATE uploads SET stored_path = ? WHERE id = ?').run(resolve(destination, 'uploads', previous.slice(root.length)), row.id)
  }
  db.close()
  return report
}
