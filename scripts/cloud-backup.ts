import { withPostgres, closePostgres } from '../src/postgres.ts'
import { createCloudBackup, restoreCloudBackup, verifyCloudBackup } from '../src/cloud-backup.ts'
const [operation, directory] = process.argv.slice(2)
if (!directory || !['create', 'verify', 'restore'].includes(operation)) throw new Error('Usage: cloud-backup.ts create|verify|restore DIRECTORY. Stop web and worker writes first. Restore requires an empty, migrated database and the original encryption key.')
try {
  const result = operation === 'verify' ? await verifyCloudBackup(directory) : await withPostgres(db => operation === 'create' ? createCloudBackup(db, directory, '/tmp/tutor-private') : restoreCloudBackup(db, directory, '/tmp/tutor-private'))
  if ('tables' in result) console.log(JSON.stringify({ verified: true, students: result.tables.students.length, attempts: result.tables.attempts.length, filesVerified: Object.keys(result.files).length }))
  else console.log(JSON.stringify(result))
} catch {
  console.error('Cloud backup operation did not complete. Check connectivity, protected backup files, original encryption key and the empty destination. Private record details are not logged.')
  process.exitCode = 1
} finally { await closePostgres() }
