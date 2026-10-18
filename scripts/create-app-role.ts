// Creates, or gives a new password to, the least-privilege database role the app uses for requests and jobs
// (read and write rows only: no schema changes, no roles, no other databases), checks it, and stores its connection
// string in Vercel as TUTOR_APP_DATABASE_URL. Migrations keep using the owner connection. Prints no credentials.
//   node --env-file=.env.vercel-production.local --experimental-strip-types scripts/create-app-role.ts
import { Client } from 'pg'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const ROLE = 'tutor_app'
// Your Vercel team, when the project is not under your personal account.
const scope = process.env.VERCEL_SCOPE ? ['--scope', process.env.VERCEL_SCOPE] : []
const owner = process.env.DATABASE_URL_UNPOOLED, pooled = process.env.DATABASE_URL
if (!owner || !pooled) throw new Error('Run with the production environment file (DATABASE_URL and DATABASE_URL_UNPOOLED).')
const verified = (url: string) => { const u = new URL(url); u.searchParams.set('sslmode', 'verify-full'); return u.toString() }
const password = randomBytes(30).toString('base64url')

const admin = new Client({ connectionString: verified(owner) })
await admin.connect()
try {
  const { rows: [{ me, db }] } = await admin.query('SELECT current_user AS me, current_database() AS db')
  const exists = (await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE])).rowCount
  // The password is random base64url, so it cannot break out of the literal.
  await admin.query(`${exists ? 'ALTER' : 'CREATE'} ROLE ${ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`)
  for (const sql of [
    `REVOKE ALL ON DATABASE "${db}" FROM ${ROLE}`,
    `GRANT CONNECT ON DATABASE "${db}" TO ${ROLE}`,
    `REVOKE CREATE ON SCHEMA public FROM ${ROLE}`,
    `GRANT USAGE ON SCHEMA public TO ${ROLE}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`,
    // Tables added by later migrations (run as the owner) are usable by the app without another grant.
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${me}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${me}" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ROLE}`,
  ]) await admin.query(sql)
} finally { await admin.end() }

const url = new URL(verified(pooled)); url.username = ROLE; url.password = password
const app = new Client({ connectionString: url.toString() })
await app.connect()
try {
  const users = (await app.query('SELECT count(*)::int AS n FROM users')).rows[0].n
  let blocked = false
  try { await app.query('CREATE TABLE tutor_app_probe (x int)') } catch { blocked = true }
  if (!blocked) { await app.query('DROP TABLE tutor_app_probe'); throw new Error('The app role can still change the schema.') }
  console.log(`App role ready: reads ${users} accounts; schema changes refused.`)
} finally { await app.end() }

spawnSync('vercel', ['env', 'rm', 'TUTOR_APP_DATABASE_URL', 'production', ...scope, '--yes'], { stdio: 'ignore' })
const added = spawnSync('vercel', ['env', 'add', 'TUTOR_APP_DATABASE_URL', 'production', '--sensitive', ...scope], { input: url.toString(), stdio: ['pipe', 'ignore', 'inherit'] })
if (added.status !== 0) throw new Error('Could not store TUTOR_APP_DATABASE_URL in Vercel.')
console.log('Stored TUTOR_APP_DATABASE_URL for production. Redeploy for it to take effect.')
