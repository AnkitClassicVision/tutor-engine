// Production restore rehearsal: back up the live store, restore it into an isolated schema with fresh file
// copies, prove every table and file came back, then remove the rehearsal copy. Prints counts and timings only.
//
//   TUTOR_BACKUP_KEY_FILE=~/.config/tutor-engine/TUTOR_BACKUP_KEY TUTOR_ENCRYPTION_KEY_FILE=<escrowed deployment key> \
//   node --env-file=.env.vercel-production.local --experimental-strip-types scripts/restore-rehearsal.ts all BACKUP_PARENT_DIR
//
// Each phase runs in its own process so the comparison opens family data from a cold key cache, the way a
// restored deployment would. Production tables are only read; writes go to the rehearsal schema, and restore
// itself refuses a destination that is not empty.
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withPostgres, closePostgres } from '../src/postgres.ts'
import { POSTGRES_MIGRATIONS } from '../src/migrations.ts'
import { applicationTables, createCloudBackup, restoreCloudBackup, verifyCloudBackup } from '../src/cloud-backup.ts'
import { FAMILY_FIELDS, STILL_SEALED, sealAllFamilyData } from '../src/family-crypto.ts'
import { readPrivateFile, deletePrivateFile } from '../src/storage.ts'
import type { Database, Row } from '../src/database.ts'

const UPLOADS = '/tmp/tutor-private'
const SCHEMA = /^restore_rehearsal_[0-9a-f]{12}$/
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable((value as Record<string, unknown>)[key])]))
  return value
}

/** A row as restore is meant to reproduce it: the fields restore deliberately changes are left out. */
function comparable(table: string, source: Row) {
  const row: Row = { ...source }
  delete row.rowid
  if (table === 'users') delete row.data_key
  if (table === 'uploads') delete row.stored_path
  if (table === 'jobs') {
    if (row.result) { try { const result = JSON.parse(String(row.result)); delete result.storedPath; row.result = JSON.stringify(stable(result)) } catch { /* not JSON: compared as is */ } }
    if (row.status === 'running') { row.status = 'queued'; row.run_token = null; row.lease_until = null }
  }
  return JSON.stringify(stable(row))
}
const tableDigest = (table: string, rows: Row[]) => sha(rows.map(row => comparable(table, row)).sort().join('\n'))

async function inSchema<T>(schema: string, fn: (db: Database) => Promise<T>) {
  if (!SCHEMA.test(schema)) throw new Error('Not a rehearsal schema name.')
  return withPostgres(async db => {
    await db.exec(`SET search_path TO ${schema}`)
    const current = await db.prepare('SELECT current_schema() AS s').get()
    if (current?.s !== schema) throw new Error('The rehearsal schema is not selected; refusing to continue.')
    try { return await fn(db) } finally { await db.exec('RESET search_path') }
  }, true)
}

async function backup(directory: string) {
  const snapshot = await withPostgres(async db => {
    await db.exec('SET search_path TO public')
    return createCloudBackup(db, directory, UPLOADS)
  }, true)
  const digests = Object.fromEntries(Object.entries(snapshot.tables).map(([table, rows]) => [table, { rows: rows.length, digest: tableDigest(table, rows) }]))
  await writeFile(join(directory, 'rehearsal-digests.json'), JSON.stringify(digests), { mode: 0o600, flag: 'wx' })
  return { tables: Object.keys(digests).length, rows: Object.values(digests).reduce((n, t) => n + t.rows, 0), files: Object.keys(snapshot.files).length }
}

async function restore(directory: string, schema: string) {
  if (!SCHEMA.test(schema)) throw new Error('Not a rehearsal schema name.')
  await withPostgres(async db => { await db.exec(`CREATE SCHEMA ${schema}`) }, true)
  await inSchema(schema, async db => {
    for (const file of POSTGRES_MIGRATIONS) await db.exec(await readFile(new URL(`../src/migrations/${file}`, import.meta.url), 'utf8'))
  })
  const restored = await inSchema(schema, db => restoreCloudBackup(db, directory, UPLOADS))
  // A restored deployment seals family fields at startup; do the same here.
  const sealed = await inSchema(schema, db => sealAllFamilyData(db))
  return { ...restored, sealedOnRestore: sealed, migrations: POSTGRES_MIGRATIONS.length }
}

async function restoredPaths(db: Database) {
  const paths = (await db.prepare('SELECT stored_path FROM uploads').all()).map(row => String(row.stored_path))
  for (const job of await db.prepare("SELECT result FROM jobs WHERE kind = 'pdf' AND result IS NOT NULL").all()) {
    try { const path = JSON.parse(String(job.result)).storedPath; if (path) paths.push(String(path)) } catch { /* no file */ }
  }
  return [...new Set(paths)]
}

async function compare(directory: string, schema: string) {
  const manifest = await verifyCloudBackup(directory)
  const expected = JSON.parse(await readFile(join(directory, 'rehearsal-digests.json'), 'utf8')) as Record<string, { rows: number; digest: string }>
  return inSchema(schema, async db => {
    const mismatched: string[] = []
    let rows = 0
    for (const table of await applicationTables()) {
      const restored = await db.prepare(`SELECT * FROM ${table}`).all()
      rows += restored.length
      if (restored.length !== expected[table]?.rows || tableDigest(table, restored) !== expected[table]?.digest) mismatched.push(`${table} (${restored.length} of ${expected[table]?.rows ?? 0} rows)`)
    }
    let plain = 0
    for (const [table, field] of Object.entries(FAMILY_FIELDS)) for (const column of field.columns) {
      plain += Number((await db.prepare(`SELECT count(*) AS n FROM ${table} ${STILL_SEALED} WHERE ${column} IS NOT NULL AND ${column} <> '' AND ${column} NOT LIKE 'fam:v1:%'`).get())?.n ?? 0)
    }
    const want = Object.values(manifest.files).map(file => file.sha256).sort()
    const got: string[] = []
    for (const path of await restoredPaths(db)) got.push(sha(await readPrivateFile(path, UPLOADS)))
    got.sort()
    return { tablesChecked: Object.keys(expected).length, rows, mismatchedTables: mismatched, plainFamilyFields: plain, filesExpected: want.length, filesMatched: want.length === got.length && want.every((h, i) => h === got[i]) }
  })
}

async function cleanup(schema: string) {
  if (!SCHEMA.test(schema)) throw new Error('Not a rehearsal schema name.')
  const exists = await withPostgres(async db => Boolean(await db.prepare('SELECT 1 AS ok FROM information_schema.schemata WHERE schema_name = ?').get(schema)), true)
  let filesDeleted = 0
  if (exists) {
    const hasUploads = await withPostgres(async db => Boolean(await db.prepare("SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = ? AND table_name = 'uploads'").get(schema)), true)
    if (hasUploads) for (const path of await inSchema(schema, restoredPaths)) { await deletePrivateFile(path, UPLOADS); filesDeleted++ }
    await withPostgres(async db => { await db.exec(`DROP SCHEMA ${schema} CASCADE`) }, true)
  }
  const gone = !(await withPostgres(async db => await db.prepare('SELECT 1 AS ok FROM information_schema.schemata WHERE schema_name = ?').get(schema), true))
  return { schemaDropped: gone, restoredFilesDeleted: filesDeleted }
}

function safeError(e: any) {
  // Database errors can carry row values in their detail; report only their code, table and constraint.
  return e?.code ? { code: e.code, table: e.table, constraint: e.constraint } : { message: String(e?.message ?? e) }
}

function runPhase(args: string[]) {
  const started = Date.now()
  const child = spawnSync(process.execPath, ['--experimental-strip-types', new URL(import.meta.url).pathname, ...args], { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  const line = child.stdout.trim().split('\n').pop() || '{}'
  return { ok: child.status === 0, seconds: Math.round((Date.now() - started) / 100) / 10, result: JSON.parse(line) }
}

async function all(parent: string) {
  if (!process.env.TUTOR_BACKUP_KEY && process.env.TUTOR_BACKUP_KEY_FILE) process.env.TUTOR_BACKUP_KEY = (await readFile(process.env.TUTOR_BACKUP_KEY_FILE, 'utf8')).trim()
  // Vercel keeps the deployment key write-only; the escrowed copy is a raw 32-byte file.
  if (process.env.TUTOR_ENCRYPTION_KEY_FILE) process.env.TUTOR_ENCRYPTION_KEY = (await readFile(process.env.TUTOR_ENCRYPTION_KEY_FILE)).toString('base64')
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const directory = join(parent, new Date().toISOString().replace(/[:.]/g, '-'))
  const schema = `restore_rehearsal_${randomBytes(6).toString('hex')}`
  const record: Record<string, unknown> = { checkedAt: new Date().toISOString(), source: 'production', destination: 'isolated rehearsal schema in the production database, fresh private file copies' }
  try {
    const b = runPhase(['backup', directory]); record.backup = b
    if (b.ok) { const r = runPhase(['restore', directory, schema]); record.restore = r
      if (r.ok) record.compare = runPhase(['compare', directory, schema]) }
  } finally {
    record.cleanup = runPhase(['cleanup', schema])
  }
  const c = record.compare as { ok: boolean; result: { mismatchedTables: string[]; plainFamilyFields: number; filesMatched: boolean } } | undefined
  const cl = record.cleanup as { ok: boolean; result: { schemaDropped: boolean } }
  record.passed = Boolean(c?.ok && c.result.mismatchedTables.length === 0 && c.result.plainFamilyFields === 0 && c.result.filesMatched && cl.ok && cl.result.schemaDropped)
  return record
}

const [operation, a, b] = process.argv.slice(2)
try {
  const result = operation === 'all' ? await all(a)
    : operation === 'backup' ? await backup(a)
    : operation === 'restore' ? await restore(a, b)
    : operation === 'compare' ? await compare(a, b)
    : operation === 'cleanup' ? await cleanup(a)
    : (() => { throw new Error('Usage: restore-rehearsal.ts all BACKUP_PARENT_DIR') })()
  console.log(JSON.stringify(result))
  if (operation === 'all' && !(result as { passed?: boolean }).passed) process.exitCode = 1
} catch (e) {
  console.log(JSON.stringify({ failed: true, ...safeError(e) }))
  process.exitCode = 1
} finally { await closePostgres() }
