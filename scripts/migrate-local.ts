import { prepareLocalMigration } from '../src/local-migration.ts'
import { restoreCloudBackup } from '../src/cloud-backup.ts'
import { withPostgres, closePostgres } from '../src/postgres.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
const [operation, directory] = process.argv.slice(2)
if (!directory || !['prepare', 'import'].includes(operation)) throw new Error('Usage: migrate-local.ts prepare|import NEW_PROTECTED_BACKUP_DIRECTORY. Import requires an empty, migrated Neon database.')
try {
  if (operation === 'prepare') {
    console.log(JSON.stringify(await prepareLocalMigration(process.env.TUTOR_DB || 'data/tutor.sqlite', process.env.TUTOR_UPLOADS || 'data/uploads', directory, process.env.TUTOR_SECRET_DIR || 'data')))
  } else {
    if (!process.env.TUTOR_ENCRYPTION_KEY) process.env.TUTOR_ENCRYPTION_KEY = (await readFile(join(process.env.TUTOR_SECRET_DIR || 'data', '.credential-key'))).toString('base64')
    console.log(JSON.stringify(await withPostgres(db => restoreCloudBackup(db, join(directory, 'cloud-import'), '/tmp/tutor-private'))))
  }
} catch {
  console.error('Migration did not complete. Check source paths, backup checksums, the encryption key and the empty destination. Original local data is preserved; private details are not logged.')
  process.exitCode = 1
} finally { await closePostgres() }
