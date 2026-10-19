import { openDb } from '../src/db.ts'
import { jobHandlers } from '../src/server.ts'
import { startWorker } from '../src/jobs.ts'
const db = openDb(process.env.TUTOR_DB!)
const stop = (await startWorker(db, jobHandlers({ db, uploadsDir: process.env.TUTOR_UPLOADS!, judgeResponse: async () => {
  await new Promise(resolve => setTimeout(resolve, 30))
  return { kind: 'graded' as const, path: 'two graders agreed' as const, verdict: { correct: true, confidence: 1, reason: 'Synthetic load verdict', errorType: null } }
} })))
process.on('SIGTERM', async () => { await stop(); db.close(); process.exit(0) })
