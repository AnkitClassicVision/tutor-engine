import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

let retained: Promise<unknown>[] = [], responded = false, jobs = 0, mails = 0, pools = 0, fail = false, recoveryMail: string | undefined, owner: string | undefined = 'synthetic-family'
mock.module('@vercel/functions', { namedExports: {
  attachDatabasePool() { pools++ },
  waitUntil(promise: Promise<unknown>) {
    assert.equal(responded, false, 'background lifetime must be registered before the response ends')
    retained.push(promise)
  },
} })
mock.module(new URL('../../src/postgres.ts', import.meta.url).href, { namedExports: { postgresPool() { return {} } } })
mock.module(new URL('../../src/cloud-runtime.ts', import.meta.url).href, { namedExports: {
  async handleCloud(_req: unknown, res: any) {
    await new Promise(resolve => setImmediate(resolve))
    if (fail) throw new Error('Synthetic request failure')
    res.end()
    return { owner, recoveryMail }
  },
  async runCloudMail() { mails++ },
  async runCloudWork() { await new Promise(resolve => setImmediate(resolve)); jobs++ },
} })
const { default: tutor } = await import('../../api/tutor.ts')
test('Vercel retains work before responding and skips work after failed requests', async () => {
  process.env.TUTOR_CLOUD = '1'
  const req = () => ({ url: '/health' } as any)
  const res = () => ({ headersSent: false, setHeader() {}, writeHead() { this.headersSent = true }, end() { responded = true } } as any)
  let status = 0
  const oversized = Readable.from([Buffer.alloc(65_537)]) as any
  Object.assign(oversized, { url: '/api/tutor?__path=login', method: 'POST', headers: { 'content-type': 'application/json' } })
  await tutor(oversized, { ...res(), writeHead(code: number) { status = code } })
  assert.equal(status, 413); assert.equal(pools, 0); assert.equal(retained.length, 0)
  responded = false
  await tutor(req(),res())
  assert.equal(retained.length,1,'runtime must receive a retained promise')
  await Promise.all(retained)
  assert.equal(jobs,1)
  assert.equal(responded,true)
  responded = false; retained = []; owner = undefined
  await tutor(req(), res()); await Promise.all(retained)
  assert.equal(jobs, 1, 'anonymous requests must not start paid work')
  assert.equal(mails, 0, 'anonymous health checks must not send mail')
  responded = false; retained = []; recoveryMail = 'synthetic-family'
  await tutor(req(), res()); await Promise.all(retained)
  assert.equal(jobs, 1); assert.equal(mails, 1, 'a bounded recovery issuance sends only its own mail')
  responded = false; retained = []; fail = true
  const original = console.error; console.error = () => {}
  try { await tutor(req(),res()); assert.equal(retained.length,1); await Promise.all(retained) } finally { console.error = original }
  assert.equal(jobs,1)
  assert.equal(responded,true)
})
