import { UserError } from "./errors.ts"
import type { Database as DatabaseSync } from "./database.ts"
import { assertStudent, isAiConnectionError } from './services.ts'
import { ChatGptError } from './chatgpt.ts'
import { withWrite, withDatabaseScope, lockFamily } from './transaction.ts'

export interface Job { id: string; owner_user_id: string; student_id: string | null; kind: string; payload: string; status: string; stage: string; result: string | null; error: string | null; run_token: string; created_at: string; started_at: string | null; updated_at: string }
export const JOB_LIMITS = { active: 20, hourly: 30, attempts: 3 }
export async function createJob(db: DatabaseSync, owner: string, student: string | null, kind: string, payload: unknown, key: string) {
  return withWrite(db, async () => {
    await lockFamily(db, owner)
    if (student) await assertStudent(db, owner, student)
    if (!key || key.length > 200) throw new UserError('A request identifier is required.')
    const existing = (await db.prepare('SELECT * FROM jobs WHERE owner_user_id = ? AND idempotency_key = ?').get(owner, key)) as unknown as Job | undefined
    if (existing) {
      if (existing.kind !== kind || existing.student_id !== student || existing.payload !== JSON.stringify(payload)) throw new UserError('This request identifier was already used for different work.')
      return existing.id
    }
    await admitJob(db, owner, student, kind)
    const id = crypto.randomUUID(), now = new Date().toISOString()
    await db.prepare('INSERT OR IGNORE INTO jobs (id, owner_user_id, student_id, kind, payload, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, owner, student, kind, JSON.stringify(payload), key, now, now)
    const saved = (await db.prepare('SELECT * FROM jobs WHERE owner_user_id = ? AND idempotency_key = ?').get(owner, key)) as unknown as Job
    if (saved.kind !== kind || saved.student_id !== student || saved.payload !== JSON.stringify(payload)) throw new UserError('This request identifier was already used for different work.')
    return saved.id
  })
}
/** A job already created for this request identifier, so a repeated send reuses it instead of adding a second message. */
export async function jobForKey(db: DatabaseSync, owner: string, key: string) {
  return ((await db.prepare('SELECT id FROM jobs WHERE owner_user_id = ? AND idempotency_key = ?').get(owner, key)) as { id: string } | undefined)?.id
}
export const sendKey = (value: unknown) => /^[A-Za-z0-9-]{8,64}$/.test(String(value ?? '')) ? String(value) : null
export async function ownedJob(db: DatabaseSync, owner: string, id: string): Promise<Job> {
  const job = (await db.prepare('SELECT * FROM jobs WHERE id = ? AND owner_user_id = ?').get(id, owner)) as unknown as Job | undefined
  if (!job) throw new UserError('Job not found.')
  return job
}
export function jobStatus(job: Job) {
  return { id: job.id, studentId: job.student_id, kind: job.kind, status: job.status, stage: job.stage, error: job.error, createdAt: job.created_at, startedAt: job.started_at, updatedAt: job.updated_at, result: job.result ? JSON.parse(job.result) : null }
}
async function admitJob(db: DatabaseSync, owner: string, student: string | null, kind: string, creation = true) {
  const active = Number((await db.prepare("SELECT count(*) n FROM jobs WHERE owner_user_id = ? AND status IN ('queued', 'running')").get(owner))!.n)
  if (active >= JOB_LIMITS.active) throw new UserError('Your family has enough work waiting. Finish some before adding more.')
  if (creation && student && kind !== 'pdf') {
    const paid = Number((await db.prepare("SELECT count(*) n FROM jobs WHERE student_id = ? AND kind != 'pdf' AND created_at >= ?").get(student, new Date(Date.now() - 60 * 60000).toISOString()))!.n)
    if (paid >= JOB_LIMITS.hourly) throw new UserError('That learner has reached the hourly AI work limit. Try again later.')
  }
}
export async function changeJob(db: DatabaseSync, owner: string, id: string, action: string) {
  return withWrite(db, async () => {
    await lockFamily(db, owner)
    const job = (await ownedJob(db, owner, id))
    if (action === 'cancel' && ['queued', 'running'].includes(job.status)) await db.prepare("UPDATE jobs SET status = 'cancelled', stage = 'Stopped. Your work is saved.', run_token = NULL, updated_at = ? WHERE id = ? AND status IN ('queued', 'running')").run(new Date().toISOString(), id)
    if (action === 'retry' && ['failed', 'cancelled'].includes(job.status)) {
      const row = (await db.prepare('SELECT attempts FROM jobs WHERE id = ?').get(id))!
      if (Number(row.attempts) >= JOB_LIMITS.attempts) throw new UserError('This work has reached its retry limit. Ask a parent to review it.')
      await admitJob(db, owner, job.student_id, job.kind, false)
      await db.prepare("UPDATE jobs SET status = 'queued', stage = 'Waiting to retry', error = NULL, started_at = NULL, run_token = NULL, updated_at = ? WHERE id = ? AND status IN ('failed', 'cancelled')").run(new Date().toISOString(), id)
    }
  })
}
export interface JobContext {
  job: Job
  stage: (text: string) => Promise<void>
  active: () => Promise<boolean>
  commit: (fn: () => void | Promise<void>) => Promise<boolean>
}
export type JobHandler = (context: JobContext, payload: any) => Promise<unknown>
export async function runNextJob(db: DatabaseSync, handlers: Record<string, JobHandler>) {
  const now = new Date().toISOString(), token = crypto.randomUUID()
  await withDatabaseScope(db, async () => { await db.prepare("UPDATE jobs SET status = 'failed', stage = 'Your work is saved', error = 'Retry limit reached. Ask a parent to review.', run_token = NULL, lease_until = NULL WHERE attempts >= ? AND (status = 'queued' OR (status = 'running' AND lease_until < ?))").run(JOB_LIMITS.attempts, now) })
  const job = (await withDatabaseScope(db, async () => db.prepare(`UPDATE jobs SET status = 'running', stage = 'Starting', started_at = coalesce(started_at, ?),
    updated_at = ?, lease_until = ?, run_token = ?, attempts = attempts + 1
    WHERE id = (SELECT id FROM jobs WHERE attempts < 3 AND (status = 'queued' OR (status = 'running' AND lease_until < ?)) ORDER BY created_at LIMIT 1)
    RETURNING *`).get(now, now, new Date(Date.now() + 30000).toISOString(), token, now))) as unknown as Job | undefined
  if (!job) return false
  const active = async () => Boolean((await db.prepare("SELECT id FROM jobs WHERE id = ? AND status = 'running' AND run_token = ?").get(job.id, token)))
  const heartbeat = setInterval(async () => {
    try { await withDatabaseScope(db, async () => { await db.prepare("UPDATE jobs SET lease_until = ?, updated_at = ? WHERE id = ? AND status = 'running' AND run_token = ?").run(new Date(Date.now() + 30000).toISOString(), new Date().toISOString(), job.id, token) }) } catch { /* Expired leases are reclaimed by the next worker. */ }
  }, 5000)
  heartbeat.unref()
  try {
    const handler = handlers[job.kind]
    if (!handler) throw new Error('Unsupported job.')
    const result = await handler({ job, active, async stage(text) {
      await withDatabaseScope(db, async () => { await db.prepare("UPDATE jobs SET stage = ?, updated_at = ? WHERE id = ? AND status = 'running' AND run_token = ?").run(text, new Date().toISOString(), job.id, token) })
    }, async commit(fn) {
      return withWrite(db, async () => {
        await lockFamily(db, job.owner_user_id)
        if (!(await active())) return false
        await fn()
        return true
      })
    } }, JSON.parse(job.payload))
    await withDatabaseScope(db, async () => { await db.prepare("UPDATE jobs SET status = 'succeeded', stage = 'Finished', result = ?, updated_at = ?, lease_until = NULL WHERE id = ? AND status = 'running' AND run_token = ?").run(JSON.stringify(result ?? {}), new Date().toISOString(), job.id, token) })
  } catch (error) {
    const reason = error instanceof ChatGptError && error.kind === 'limit' ? 'The family ChatGPT plan has reached its usage limit for now. Your work is saved. Ask a parent to check it, then try again.'
      : error instanceof ChatGptError && error.kind === 'not_eligible' ? 'The family ChatGPT account cannot use its plan for AI help here. Your work is saved. Ask a parent to check AI settings.'
      : error instanceof ChatGptError && error.kind === 'reconnect' ? 'ChatGPT did not accept this request. Your work is saved. Try again, or ask a parent to reconnect ChatGPT in AI settings.'
      : error instanceof ChatGptError && error.kind === 'temporary' ? 'ChatGPT is busy right now. Your work is saved; try again in a little while.'
      : isAiConnectionError(error) ? 'The AI tutor is not connected yet. Ask a parent to connect an AI in Settings, then try again.' : 'Could not finish. Check the AI connection, retry, or ask a parent to review.'
    await withDatabaseScope(db, async () => { await db.prepare("UPDATE jobs SET status = 'failed', stage = 'Your work is saved', error = ?, updated_at = ?, lease_until = NULL WHERE id = ? AND status = 'running' AND run_token = ?").run(reason, new Date().toISOString(), job.id, token) })
  } finally { clearInterval(heartbeat) }
  return true
}
export function startWorker(db: DatabaseSync, handlers: Record<string, JobHandler>) {
  let busy = false, stopped = false
  let drained: (() => void) | undefined
  const tick = async () => {
    if (busy || stopped) return
    busy = true
    try { while (!stopped && await runNextJob(db, handlers)) {} }
    finally { busy = false; drained?.() }
  }
  const run = () => { void tick().catch(() => console.error('Worker paused; queued work remains saved.')) }
  const timer = setInterval(run, 250)
  run()
  return async () => {
    stopped = true; clearInterval(timer)
    if (busy) await new Promise<void>(resolve => { drained = resolve })
  }
}
