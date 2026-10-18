import { sweepPrivateFiles } from "./file-erasures.ts"
import type { IncomingMessage, ServerResponse } from 'node:http'
import { withPostgres, migratePostgres } from './postgres.ts'
import { sealAllFamilyData } from './family-crypto.ts'
import { handle, jobHandlers, resumeBuilds, acceptBody } from './server.ts'
import { runNextJob } from './jobs.ts'
import { flushMail } from './accounts.ts'
import { encryptSecret } from './secrets.ts'
import { enqueueWeeklyDigests } from './digest.ts'
import { parentMailConfigured } from './parent-mail.ts'

export function assertCloudConfiguration() {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL_UNPOOLED || !process.env.BLOB_READ_WRITE_TOKEN || process.env.TUTOR_STORAGE !== 'blob') throw new Error('Persistent storage is not configured.')
  if (process.env.TUTOR_PUBLIC !== '1' || process.env.TUTOR_SECURE !== '1' || !process.env.TUTOR_ORIGIN?.startsWith('https://')) throw new Error('Secure public origin is not configured.')
  if (!parentMailConfigured()) throw new Error('Parent email delivery is not configured.')
  // Validates the deployment key without reading any family credentials.
  encryptSecret('configuration-check')
}
let initialized: Promise<void> | undefined
export async function initializeCloud() {
  assertCloudConfiguration()
  // Children's data saved before per-family encryption is sealed once the schema is current.
  if (!initialized) initialized = migratePostgres().then(() => withPostgres(async db => { await sealAllFamilyData(db) })).catch(e => { initialized = undefined; throw e })
  await initialized
}
export async function handleCloud(req: IncomingMessage, res: ServerResponse) {
  // A browser can cancel while the database connection is being acquired.
  // Observe completion before that await so a cancelled request cannot leak it.
  const completed = new Promise<void>(resolve => { res.once('finish', resolve); res.once('close', resolve) })
  if (!(await acceptBody(req, res))) return
  await initializeCloud()
  let owner: string | undefined, recoveryMail: string | undefined
  await withPostgres(async db => {
    if (res.destroyed || res.writableEnded) return
    await handle(req, res, { db, uploadsDir: '/tmp/tutor-private', runWorker: false, onAuthenticated: id => { owner = id }, onRecoveryMail: id => { recoveryMail = id } })
    // Streaming status must finish before returning its connection to the pool.
    await completed
  })
  return { owner, recoveryMail }
}
export async function runCloudMail(owner: string) {
  if (owner) await withPostgres(async db => { await flushMail(db, 1, owner, 'recover') })
}
export async function runCloudWork(owner: string) {
  if (!owner) return
  await withPostgres(async db => {
    if (!(await db.prepare('SELECT id FROM users WHERE id = ?').get(owner))) return
    const options = { db, uploadsDir: '/tmp/tutor-private', runWorker: false }
    await sweepPrivateFiles(db, options.uploadsDir)
    await flushMail(db, 1)
    await resumeBuilds(db)
    await enqueueWeeklyDigests(db).catch(() => console.error('Weekly digest scheduling paused; the next request retries.'))
    // One leased job per invocation stays inside the function duration. More jobs
    // are picked up by subsequent requests/status polls; expired leases recover.
    await runNextJob(db, jobHandlers(options))
  })
}
