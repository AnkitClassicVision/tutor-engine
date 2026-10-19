// Operations check for the site owner, run by cron. It looks for problems a family would otherwise report first
// and emails the owner once when one starts, daily while it lasts, and once when it clears. Alerts carry problem
// kinds and counts only: never family names, addresses or content.
import { createHash } from 'node:crypto'
import type { Database } from './database.ts'
import { POSTGRES_MIGRATIONS } from './migrations.ts'

export type OpsCode = 'database_unreachable' | 'migrations_behind' | 'jobs_stuck' | 'jobs_failing' | 'mail_backlog'
export type OpsProblem = { code: OpsCode; count: number }
export type OpsMail = (message: { id: string; subject: string; text: string }) => Promise<void>

const MINUTE = 60_000
export const OPS_LIMITS = { stuckAfterMinutes: 30, leaseGraceMinutes: 10, failedJobsPerHour: 3, mailAfterMinutes: 30, remindAfterHours: 24 }

const DESCRIBE: Record<OpsCode, (count: number) => string> = {
  database_unreachable: () => 'The database could not be reached.',
  migrations_behind: count => `The database is ${count} migration${count === 1 ? '' : 's'} behind the deployed code.`,
  jobs_stuck: count => `${count} job${count === 1 ? ' is' : 's are'} stuck (queued for over ${OPS_LIMITS.stuckAfterMinutes} minutes, or running past ${OPS_LIMITS.leaseGraceMinutes} minutes after its lease).`,
  jobs_failing: count => `${count} jobs failed in the last hour.`,
  mail_backlog: count => `${count} email${count === 1 ? ' has' : 's have'} waited over ${OPS_LIMITS.mailAfterMinutes} minutes to send (sign-up and password links may not be arriving).`,
}

const iso = (date: Date) => date.toISOString()
const count = async (db: Database, sql: string, ...values: string[]) => Number((await db.prepare(sql).get(...values))?.n ?? 0)

/** The problems right now. Throws only when the database itself fails. */
export async function findProblems(db: Database, now = new Date()): Promise<OpsProblem[]> {
  const problems: OpsProblem[] = []
  if ('dialect' in db) {
    const applied = await count(db, 'SELECT max(version) AS n FROM tutor_migrations')
    if (applied < POSTGRES_MIGRATIONS.length) problems.push({ code: 'migrations_behind', count: POSTGRES_MIGRATIONS.length - applied })
  }
  const stuck = await count(db, `SELECT count(*) AS n FROM jobs WHERE (status = 'queued' AND created_at < ? AND (lease_until IS NULL OR lease_until < ?))
    OR (status = 'running' AND lease_until < ?)`, iso(new Date(now.getTime() - OPS_LIMITS.stuckAfterMinutes * MINUTE)), iso(now), iso(new Date(now.getTime() - OPS_LIMITS.leaseGraceMinutes * MINUTE)))
  if (stuck) problems.push({ code: 'jobs_stuck', count: stuck })
  const failed = await count(db, "SELECT count(*) AS n FROM jobs WHERE status = 'failed' AND updated_at > ?", iso(new Date(now.getTime() - 60 * MINUTE)))
  if (failed >= OPS_LIMITS.failedJobsPerHour) problems.push({ code: 'jobs_failing', count: failed })
  const mail = await count(db, 'SELECT count(*) AS n FROM mail_outbox WHERE sent_at IS NULL AND created_at < ?', iso(new Date(now.getTime() - OPS_LIMITS.mailAfterMinutes * MINUTE)))
  if (mail) problems.push({ code: 'mail_backlog', count: mail })
  return problems
}

function compose(started: OpsProblem[], ongoing: OpsProblem[], cleared: OpsCode[], origin: string, stillOpen = 0) {
  const lines: string[] = []
  if (started.length) lines.push('New problems:', ...started.map(p => `- ${DESCRIBE[p.code](p.count)}`), '')
  if (ongoing.length) lines.push('Still happening:', ...ongoing.map(p => `- ${DESCRIBE[p.code](p.count)}`), '')
  if (cleared.length) lines.push('Cleared:', ...cleared.map(code => `- ${code.replaceAll('_', ' ')}`), '')
  lines.push(`Site: ${origin}`, 'Counts only; no family details are included. Check the hosting logs for the cause.')
  const open = started.length + ongoing.length
  const subject = open ? `Tutor site alert: ${open} problem${open === 1 ? '' : 's'}`
    : stillOpen ? `Tutor site: ${cleared.length} cleared, ${stillOpen} still open` : 'Tutor site: all clear'
  return { subject, text: lines.join('\n') }
}

/**
 * Run the check and email the owner when something changed. The alert state lives in ops_alerts; when the
 * database is down there is no state, so that alert is sent at most once an hour (by its delivery id).
 */
export async function runOpsCheck(db: Database, mail: OpsMail | undefined, now = new Date(), origin = process.env.TUTOR_ORIGIN || 'the site') {
  let problems: OpsProblem[]
  try { problems = await findProblems(db, now) }
  catch {
    const hour = iso(now).slice(0, 13)
    if (mail) await mail({ id: `ops-database-${hour}`, ...compose([{ code: 'database_unreachable', count: 1 }], [], [], origin) })
    return { problems: [{ code: 'database_unreachable' as const, count: 1 }], emailed: Boolean(mail) }
  }
  const active = new Map((await db.prepare('SELECT * FROM ops_alerts WHERE resolved_at IS NULL').all()).map(row => [String(row.code), row]))
  const started: OpsProblem[] = [], ongoing: OpsProblem[] = []
  for (const problem of problems) {
    const row = active.get(problem.code)
    if (!row) started.push(problem)
    else if (!row.last_sent_at || String(row.last_sent_at) < iso(new Date(now.getTime() - OPS_LIMITS.remindAfterHours * 60 * MINUTE))) ongoing.push(problem)
  }
  const cleared = [...active.keys()].filter(code => !problems.some(p => p.code === code)) as OpsCode[]
  const changed = started.length + ongoing.length + cleared.length > 0
  if (changed && mail) {
    const id = 'ops-' + createHash('sha256').update(JSON.stringify([iso(now), started, ongoing, cleared])).digest('hex').slice(0, 24)
    await mail({ id, ...compose(started, ongoing, cleared, origin, problems.length) })
  }
  // Record after sending: a failed send throws, leaves the state unchanged, and the next run tries again.
  for (const problem of problems) {
    const sent = started.includes(problem) || ongoing.includes(problem)
    if (active.has(problem.code)) await db.prepare(`UPDATE ops_alerts SET last_count = ?${sent && mail ? ', last_sent_at = ?' : ''} WHERE code = ?`).run(...[problem.count, ...(sent && mail ? [iso(now)] : []), problem.code])
    else await db.prepare(`INSERT INTO ops_alerts (code, first_seen_at, last_sent_at, last_count, resolved_at) VALUES (?, ?, ?, ?, NULL)
      ON CONFLICT(code) DO UPDATE SET first_seen_at = excluded.first_seen_at, last_sent_at = excluded.last_sent_at, last_count = excluded.last_count, resolved_at = NULL`).run(problem.code, iso(now), mail ? iso(now) : null, problem.count)
  }
  for (const code of cleared) await db.prepare('UPDATE ops_alerts SET resolved_at = ? WHERE code = ?').run(iso(now), code)
  return { problems, started: started.map(p => p.code), ongoing: ongoing.map(p => p.code), cleared, emailed: changed && Boolean(mail) }
}

/** The owner's alert sender, or undefined when alerts are not configured. */
export async function ownerAlertMail(): Promise<OpsMail | undefined> {
  const to = process.env.TUTOR_ALERT_EMAIL
  const { parentMailConfigured, parentMailer } = await import('./parent-mail.ts')
  if (!to || !parentMailConfigured()) return undefined
  return async message => {
    const transport = await parentMailer()
    try { await transport.send(message.id, { to, subject: message.subject, text: message.text }) } finally { transport.close() }
  }
}
