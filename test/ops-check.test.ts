import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.ts'
import { registerUser } from '../src/auth.ts'
import { handle } from '../src/server.ts'
import { findProblems, runOpsCheck, type OpsMail } from '../src/ops-check.ts'

const at = (iso: string) => new Date(iso)
const NOW = at('2026-10-20T12:00:00.000Z')
const minutesBefore = (minutes: number, from = NOW) => new Date(from.getTime() - minutes * 60_000).toISOString()

async function setup() {
  const db = openDb(':memory:')
  const user = await registerUser(db, `ops-${crypto.randomUUID()}@example.invalid`, 'synthetic-parent-password')
  if (!user.ok) throw new Error('fixture')
  const sent: { id: string; subject: string; text: string }[] = []
  const mail: OpsMail = async message => { sent.push(message) }
  const job = (status: string, created: string, updated = created, lease: string | null = null) => db.prepare(`INSERT INTO jobs (id, owner_user_id, kind, payload, idempotency_key, status, created_at, updated_at, lease_until)
    VALUES (?, ?, 'extract', '{}', ?, ?, ?, ?, ?)`).run(crypto.randomUUID(), user.userId, crypto.randomUUID(), status, created, updated, lease)
  return { db, owner: user.userId, sent, mail, job }
}

test('a healthy store has no problems and sends nothing', async () => {
  const f = await setup()
  f.job('succeeded', minutesBefore(90)); f.job('queued', minutesBefore(5)); f.job('failed', minutesBefore(20))
  assert.deepEqual(await findProblems(f.db, NOW), [])
  const result = await runOpsCheck(f.db, f.mail, NOW, 'https://synthetic.example')
  assert.equal(result.emailed, false); assert.equal(f.sent.length, 0)
})

test('a stuck job alerts once, reminds after a day, and reports when it clears', async () => {
  const f = await setup()
  f.job('queued', minutesBefore(45))
  f.job('queued', minutesBefore(45), minutesBefore(45), minutesBefore(-30)) // waiting out a retry: not stuck
  f.job('running', minutesBefore(60), minutesBefore(60), minutesBefore(15)) // past its lease by 15 minutes
  f.job('running', minutesBefore(60), minutesBefore(60), minutesBefore(5)) // within the grace period
  const first = await runOpsCheck(f.db, f.mail, NOW, 'https://synthetic.example')
  assert.deepEqual(first.started, ['jobs_stuck']); assert.equal(f.sent.length, 1)
  assert.match(f.sent[0].subject, /1 problem/); assert.match(f.sent[0].text, /2 jobs are stuck/)
  assert.doesNotMatch(f.sent[0].text, /example\.invalid|@/, 'no family address in an alert')
  const later = new Date(NOW.getTime() + 15 * 60_000)
  assert.equal((await runOpsCheck(f.db, f.mail, later)).emailed, false); assert.equal(f.sent.length, 1)
  const nextDay = new Date(NOW.getTime() + 25 * 3_600_000)
  const reminder = await runOpsCheck(f.db, f.mail, nextDay)
  assert.deepEqual(reminder.ongoing, ['jobs_stuck']); assert.match(f.sent[1].text, /Still happening/)
  await f.db.prepare("UPDATE jobs SET status = 'succeeded'").run()
  const clear = await runOpsCheck(f.db, f.mail, new Date(nextDay.getTime() + 60_000))
  assert.deepEqual(clear.cleared, ['jobs_stuck']); assert.match(f.sent[2].subject, /all clear/)
  assert.equal((await runOpsCheck(f.db, f.mail, new Date(nextDay.getTime() + 120_000))).emailed, false)
  // A new occurrence after clearing is new again.
  f.job('queued', minutesBefore(45, nextDay))
  assert.deepEqual((await runOpsCheck(f.db, f.mail, new Date(nextDay.getTime() + 180_000))).started, ['jobs_stuck'])
})

test('a burst of failed jobs and unsent email are problems; a lone failure is not', async () => {
  const f = await setup()
  f.job('failed', minutesBefore(90), minutesBefore(10))
  assert.deepEqual(await findProblems(f.db, NOW), [])
  f.job('failed', minutesBefore(90), minutesBefore(20)); f.job('failed', minutesBefore(90), minutesBefore(30))
  await f.db.prepare('INSERT INTO mail_outbox (id, user_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), f.owner, 'verify', 'sealed', minutesBefore(40))
  await f.db.prepare('INSERT INTO mail_outbox (id, user_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), f.owner, 'verify', 'sealed', minutesBefore(5))
  assert.deepEqual(await findProblems(f.db, NOW), [{ code: 'jobs_failing', count: 3 }, { code: 'mail_backlog', count: 1 }])
  const result = await runOpsCheck(f.db, f.mail, NOW)
  assert.equal(f.sent.length, 1); assert.match(f.sent[0].subject, /2 problems/); assert.match(f.sent[0].text, /sign-up and password links/)
  assert.deepEqual(result.started, ['jobs_failing', 'mail_backlog'])
})

test('a cleared problem does not say all clear while another is still open', async () => {
  const f = await setup()
  f.job('queued', minutesBefore(45))
  for (let i = 0; i < 3; i++) f.job('failed', minutesBefore(90), minutesBefore(10))
  await runOpsCheck(f.db, f.mail, NOW)
  await f.db.prepare("UPDATE jobs SET status = 'succeeded' WHERE status = 'queued'").run()
  await runOpsCheck(f.db, f.mail, new Date(NOW.getTime() + 60_000))
  assert.equal(f.sent[1].subject, 'Tutor site: 1 cleared, 1 still open')
})

test('a failed send leaves the alert to the next run; without a recipient nothing is sent', async () => {
  const f = await setup()
  f.job('queued', minutesBefore(45))
  await assert.rejects(runOpsCheck(f.db, async () => { throw new Error('synthetic provider outage') }, NOW))
  assert.deepEqual((await runOpsCheck(f.db, f.mail, NOW)).started, ['jobs_stuck'])
  const g = await setup()
  g.job('queued', minutesBefore(45))
  assert.equal((await runOpsCheck(g.db, undefined, NOW)).emailed, false)
  // Once a recipient is configured, the problem that was never sent is sent.
  assert.deepEqual((await runOpsCheck(g.db, g.mail, new Date(NOW.getTime() + 60_000))).ongoing, ['jobs_stuck'])
})

test('an unreachable database is reported at most once an hour', async () => {
  const sent: string[] = []
  const broken = { prepare() { throw new Error('synthetic connection refused') } } as any
  const mail: OpsMail = async message => { sent.push(message.id) }
  const result = await runOpsCheck(broken, mail, NOW)
  assert.deepEqual(result.problems, [{ code: 'database_unreachable', count: 1 }])
  await runOpsCheck(broken, mail, new Date(NOW.getTime() + 15 * 60_000))
  assert.equal(new Set(sent).size, 1, 'the same delivery id within the hour, so the provider sends it once')
  await runOpsCheck(broken, mail, new Date(NOW.getTime() + 61 * 60_000))
  assert.equal(new Set(sent).size, 2)
})

test('the ops-check route needs the cron secret and reports counts only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tutor-ops-')), db = openDb(join(dir, 'test.sqlite'))
  const saved = { secret: process.env.CRON_SECRET, alert: process.env.TUTOR_ALERT_EMAIL }
  const server = createServer((req, res) => { handle(req, res, { db, uploadsDir: join(dir, 'uploads') }).catch(() => { res.writeHead(500); res.end() }) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); if (!address || typeof address === 'string') throw new Error()
  const get = (path: string, token?: string) => fetch(`http://127.0.0.1:${address.port}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  try {
    delete process.env.CRON_SECRET; delete process.env.TUTOR_ALERT_EMAIL
    assert.equal((await get('/cron/ops-check')).status, 404)
    process.env.CRON_SECRET = 'synthetic-cron-secret'
    assert.equal((await get('/cron/ops-check')).status, 401)
    assert.equal((await get('/cron/ops-check', 'wrong')).status, 401)
    const ok = await get('/cron/ops-check', 'synthetic-cron-secret')
    assert.equal(ok.status, 200)
    assert.deepEqual(await ok.json(), { alertsConfigured: false, problems: [], started: [], ongoing: [], cleared: [], emailed: false })
    assert.equal((await get('/cron/ops-check?test=1', 'synthetic-cron-secret')).status, 409, 'a test alert needs a recipient')
  } finally {
    if (saved.secret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved.secret
    if (saved.alert === undefined) delete process.env.TUTOR_ALERT_EMAIL; else process.env.TUTOR_ALERT_EMAIL = saved.alert
    server.close(); db.close(); rmSync(dir, { recursive: true, force: true })
  }
})
