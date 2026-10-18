import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { withPostgres, closePostgres } from '../src/postgres.ts'
import { handle, jobHandlers } from '../src/server.ts'
import { runNextJob } from '../src/jobs.ts'
import { deletePrivateFile } from '../src/storage.ts'

if (process.env.TUTOR_TEST_CLOUD !== '1') throw new Error('Explicit synthetic cloud test mode is required.')
process.env.TUTOR_STORAGE = 'blob'
process.env.TUTOR_PUBLIC = '0'
// This fixture runs on local HTTP; production-only secure cookies do not apply.
process.env.TUTOR_SECURE = '0'
process.env.TUTOR_ENCRYPTION_KEY = randomBytes(32).toString('base64')
const schema = `tutor_browser_${crypto.randomUUID().replaceAll('-', '')}`
const root = await mkdtemp(join(tmpdir(), 'tutor-cloud-browser-'))
const scoped = <T>(fn: Parameters<typeof withPostgres<T>>[0]) => withPostgres(async db => {
  await db.exec(`SET search_path TO ${schema}`)
  return fn(db)
})
await withPostgres(async db => { await db.exec(`CREATE SCHEMA ${schema}`) })
await scoped(async db => {
  for (const file of ['001-postgres.sql', '002-upload-intents.sql', '003-school-learning.sql', '004-school-result-requests.sql', '005-student-access.sql', '006-feedback-flow.sql']) await db.exec(await readFile(new URL(`../src/migrations/${file}`, import.meta.url), 'utf8'))
})
// Only model calls are deterministic fixtures. PostgreSQL and Blob remain real.
const realFetch = globalThis.fetch
const fixtureFetch = async (_input: any, init: any) => {
  const body = JSON.parse(init.body), content = body.messages.at(-1).content
  const system = body.messages[0]?.content ?? body.system ?? ''
  let result: any
  if (system.includes('# Read school material')) result = { questions: [{ number: '12b', prompt: 'What is 2 + 2?', figure: '', visibleWork: '5', answerKey: '4', teacherMark: '', conceptId: 'math.4.nbt.b.4', readable: true, confidence: .98 }] }
  else if (typeof content === 'string' && content.startsWith('Make a curriculum for')) result = { reason: 'Use the parent-selected sample test to practise addition.', topics: [{ title: 'Add and subtract multi-digit numbers', recall: 'Add with regrouping.', example: '12 plus 8 is 20.', nonExample: 'Ignoring place value.', questions: [{ prompt: 'What is 13 + 8?', answer: '21', bloomLevel: 3 }, { prompt: 'Create an addition question with a sum of 30 and solve it.', answer: 'Rubric: Give an addition problem whose terms add to 30 and show its solution.', bloomLevel: 6 }] }] }
  else if (system.includes('# Review school homework')) result = system.includes('For guidance') && typeof content === 'string' && content.includes('transcript') ? { reply: 'You counted one extra. What happens if you group two and two?' } : { verdict: 'needs_work', explanation: 'Two and two make four. Check the extra count.', confidence: .99 }
  else result = { correct: true, reason: 'The response meets the stored rubric.', confidence: .99, errorType: null }
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }), { status: 200 })
}
globalThis.fetch = ((input: any, init: any) => /https:\/\/(?:api\.openai\.com|openrouter\.ai|api\.anthropic\.com|api\.x\.ai)\//.test(String(input)) ? fixtureFetch(input, init) : realFetch(input, init)) as typeof fetch
let working = false
const timer = setInterval(() => {
  if (working) return
  working = true
  void scoped(async db => { await runNextJob(db, jobHandlers({ db, uploadsDir: root, runWorker: false })) })
    .catch(error => console.error('Synthetic cloud worker failed.', /^[A-Z0-9]{5}$/.test(error.code) ? error.code : error.name))
    .finally(() => { working = false })
}, 250)
const server = createServer((req, res) => {
  const completed = new Promise<void>(resolve => { res.once('finish', resolve); res.once('close', resolve) })
  void scoped(async db => {
    if (res.destroyed || res.writableEnded) return
    await handle(req, res, { db, uploadsDir: root, runWorker: false })
    await completed
  }).catch(error => { if (res.destroyed) return; console.error('Synthetic cloud request failed.', /^[A-Z0-9]{5}$/.test(error.code) ? error.code : error.name); if (!res.headersSent) res.writeHead(500); res.end('Synthetic cloud request failed.') })
})
server.listen(Number(process.env.TUTOR_TEST_CLOUD_PORT || 8799), '127.0.0.1')
let closing = false
async function cleanup() {
  if (closing) return
  closing = true; clearInterval(timer)
  server.close(); server.closeAllConnections()
  while (working) await new Promise(resolve => setTimeout(resolve, 50))
  try {
    await scoped(async db => {
      const paths = (await db.prepare('SELECT stored_path FROM upload_intents').all()).map(x => String(x.stored_path))
      for (const job of await db.prepare("SELECT result FROM jobs WHERE kind = 'pdf' AND status = 'succeeded'").all()) {
        const result = JSON.parse(String(job.result)); if (result.storedPath) paths.push(result.storedPath)
      }
      for (const path of new Set(paths)) await deletePrivateFile(path, root)
    })
    await withPostgres(async db => { await db.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE`) })
    console.log('Synthetic cloud browser fixtures cleaned up.')
  } finally { await rm(root, { recursive: true, force: true }); await closePostgres() }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void cleanup().then(() => process.exit(0)) })
