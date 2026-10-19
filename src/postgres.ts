import { openRowsAsync, STILL_SEALED } from './family-crypto.ts'
import { Pool, types, type PoolClient } from 'pg'
import { readFile } from 'node:fs/promises'
import type { AsyncDatabase, Row } from './database.ts'

// Count and insertion-order fields never exceed safe integer limits in this app.
types.setTypeParser(20, value => {
  const n = Number(value)
  if (!Number.isSafeInteger(n)) throw new Error('Database integer exceeds the supported range.')
  return n
})

// Parameters are always bound. Quoted question marks remain literal SQL text.
export function postgresSql(source: string): string {
  if (/^PRAGMA table_info\([a-z_]+\)$/i.test(source)) {
    const table = source.slice(source.indexOf('(') + 1, -1)
    return `SELECT a.attname AS name, coalesce(array_position(i.indkey::smallint[], a.attnum) - array_lower(i.indkey::smallint[], 1) + 1, 0) AS pk
      FROM pg_attribute a JOIN pg_class t ON t.oid = a.attrelid JOIN pg_namespace n ON n.oid = t.relnamespace
      LEFT JOIN pg_index i ON i.indrelid = t.oid AND i.indisprimary
      WHERE n.nspname = current_schema() AND t.relname = '${table}' AND a.attnum > 0 AND NOT a.attisdropped AND a.attname != 'rowid' ORDER BY a.attnum`
  }
  if (source === "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'") return "SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema() AND tablename != 'tutor_migrations'"
  let sql = source.replace(/BEGIN IMMEDIATE/g, 'BEGIN')
    .replace('ORDER BY created_at LIMIT 1)', 'ORDER BY created_at, rowid LIMIT 1 FOR UPDATE SKIP LOCKED)')
    .replace(/json_extract\(payload, '\$\.([A-Za-z][A-Za-z0-9_]*)'\)/g, (_, field) => `(payload::jsonb ->> '${field}')`)
  if (/^INSERT OR IGNORE /i.test(sql)) sql = sql.replace(/^INSERT OR IGNORE /i, 'INSERT ') + ' ON CONFLICT DO NOTHING'
  let quoted = false, index = 0, result = ''
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    if (c === "'") {
      result += c
      if (quoted && sql[i + 1] === "'") { result += sql[++i]; continue }
      quoted = !quoted
    } else result += c === '?' && !quoted ? `$${++index}` : c
  }
  return result
}

// Each request/worker has its own checked-out connection. A transaction never
// crosses pool clients or shares state with another family's request.
export class PostgresDatabase implements AsyncDatabase {
  readonly dialect = 'postgres' as const
  private transaction = false
  private pending: Promise<unknown> = Promise.resolve()
  private client: PoolClient
  constructor(client: PoolClient) { this.client = client }
  get isTransaction() { return this.transaction }
  private query(sql: string, values?: any[]) {
    const next = this.pending.then(() => this.client.query(sql, values))
    this.pending = next.catch(() => undefined)
    return next
  }
  async settled() { await this.pending }
  // Children's data sealed per family reads back as plain values (src/family-crypto.ts).
  private opened(rows: Row[]) { return openRowsAsync(rows, async (sql, values) => (await this.query(sql, values)).rows) }
  prepare(source: string) {
    const lock = this.isTransaction && (
      source === "SELECT id FROM jobs WHERE id = ? AND status = 'running' AND run_token = ?" ||
      source === "SELECT * FROM students WHERE id = ? AND owner_user_id = ?" ||
      source.includes('WHERE tutor_sessions.id = ? AND students.owner_user_id = ?') ||
      source.startsWith('SELECT * FROM account_tokens WHERE token_hash = ?') ||
      source.startsWith('SELECT m.* FROM materials m JOIN students s')
    )
    const sql = postgresSql(source) + (lock ? ' FOR UPDATE' : '')
    const query = async (values: any[]) => this.query(sql, values)
    const open = source.includes(STILL_SEALED) ? async (rows: Row[]) => rows : (rows: Row[]) => this.opened(rows)
    return {
      get: async (...values: any[]) => (await open((await query(values)).rows))[0] as Row | undefined,
      all: async (...values: any[]) => (await open((await query(values)).rows)) as Row[],
      run: async (...values: any[]) => ({ changes: (await query(values)).rowCount ?? 0 }),
    }
  }
  async exec(source: string) {
    await this.query(postgresSql(source))
    if (/^BEGIN\b/i.test(source)) this.transaction = true
    if (/^(COMMIT|ROLLBACK)$/i.test(source)) this.transaction = false
  }
}

const pools = new Map<boolean, Pool>()
export function postgresPool(direct = false) {
  let pool = pools.get(direct)
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('Persistent database is not configured.')
    // Synthetic schemas need session affinity. Neon's transaction pooler can
    // move SET search_path between connections; tests must use the direct URL.
    // Requests and jobs use the least-privilege app role when one is configured (scripts/create-app-role.ts);
    // migrations and maintenance use the owner's direct connection.
    const connection = direct || process.env.TUTOR_TEST_CLOUD === '1' ? process.env.DATABASE_URL_UNPOOLED : process.env.TUTOR_APP_DATABASE_URL || process.env.DATABASE_URL
    if (!connection) throw new Error('Database migrations and synthetic schemas require the direct database connection.')
    const url = new URL(connection)
    url.searchParams.set('sslmode', 'verify-full')
    pool = new Pool({ connectionString: url.toString(), max: direct ? 1 : 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000, allowExitOnIdle: true })
    pool.on('error', () => console.error('Database connection interrupted. Saved records remain persistent.'))
    pools.set(direct, pool)
  }
  return pool
}
export async function withPostgres<T>(fn: (db: PostgresDatabase) => Promise<T>, direct = false) {
  const client = await postgresPool(direct).connect()
  const db = new PostgresDatabase(client)
  try { return await fn(db) }
  finally {
    await db.settled()
    if (db.isTransaction) await client.query('ROLLBACK').catch(() => {})
    client.release()
  }
}
export async function migratePostgres() {
  const migrations = ['001-postgres.sql', '002-upload-intents.sql', '003-school-learning.sql', '004-school-result-requests.sql', '005-student-access.sql', '006-feedback-flow.sql', '007-parent-planner.sql', '008-learning-packs.sql', '009-chatgpt-plan.sql', '010-panel-round-2.sql', '011-hardening.sql', '012-worlds.sql', '013-student-link-hash.sql', '014-family-keys.sql', '015-runbook-runs.sql', '016-evidence-ladder.sql', '017-subject-maps.sql', '018-changed-minds.sql', '019-grading-audits.sql', '020-grading-doubt.sql', '021-rubrics.sql']
  await withPostgres(async db => {
    await db.exec('BEGIN')
    try {
      await db.prepare('SELECT pg_advisory_xact_lock(?)').get(87871006)
      await db.exec('CREATE TABLE IF NOT EXISTS tutor_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
      for (const [index, file] of migrations.entries()) {
        const version = index + 1
        if (!(await db.prepare('SELECT version FROM tutor_migrations WHERE version = ?').get(version))) {
          await db.exec(await readFile(new URL(`./migrations/${file}`, import.meta.url), 'utf8'))
          await db.prepare('INSERT INTO tutor_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString())
        }
      }
      await db.exec('COMMIT')
    } catch (e) { await db.exec('ROLLBACK'); throw e }
  }, true)
}
export async function closePostgres() { const existing = [...pools.values()]; pools.clear(); await Promise.all(existing.map(pool => pool.end())) }
