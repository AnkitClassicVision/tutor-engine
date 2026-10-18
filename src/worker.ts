import { sweepPrivateFiles } from "./file-erasures.ts"
import { openDb } from './db.ts'
import { startWorker } from './jobs.ts'
import { jobHandlers, resumeBuilds } from './server.ts'
import { flushMail } from './accounts.ts'
import { enqueueWeeklyDigests } from './digest.ts'
const db = openDb(process.env.TUTOR_DB || 'data/tutor.sqlite')
const options = { db, uploadsDir: process.env.TUTOR_UPLOADS || 'data/uploads' }
await resumeBuilds(db)
const stop = (await startWorker(db, jobHandlers(options)))
let mailing = false
const mailTimer = setInterval(async () => {
  if (mailing) return
  mailing = true
  try { await sweepPrivateFiles(db, options.uploadsDir); await flushMail(db) } catch { console.error('Email delivery failed; queued messages remain saved.') } finally { mailing = false }
}, 5000)
const digestTimer = setInterval(() => { enqueueWeeklyDigests(db).catch(() => console.error('Weekly digest scheduling paused; it retries next minute.')) }, 60_000)
process.on('SIGTERM', async () => { clearInterval(mailTimer); clearInterval(digestTimer); await stop(); db.close(); process.exit(0) })
process.on('SIGINT', async () => { clearInterval(mailTimer); clearInterval(digestTimer); await stop(); db.close(); process.exit(0) })
