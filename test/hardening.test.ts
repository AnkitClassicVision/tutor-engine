import { stubReply } from './contract-stub.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../src/db.ts'
import { registerUser, openAuthSession, readAuthSession, loginUser, hashToken } from '../src/auth.ts'
import { authorizeStudentPath } from '../src/journey-routes.ts'
import { issueAccountToken, consumeAccountToken, deleteFamily, requestRecovery } from '../src/accounts.ts'
import { decryptSecret } from '../src/secrets.ts'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handle, jobHandlers } from '../src/server.ts'
import { createStudent, saveAiSettings, saveUpload, getUpload } from '../src/services.ts'
import { createMaterial, configureMaterialLearning, currentSchoolSource } from '../src/schoolwork.ts'
import { createJob, runNextJob, changeJob } from '../src/jobs.ts'
import { requestPack, makePlannedPack, setPackSettings } from '../src/pack.ts'
import { reserveUpload } from '../src/upload-reservations.ts'
import { sweepPrivateFiles } from '../src/file-erasures.ts'
import { completeUpload, validateImage } from '../src/direct-uploads.ts'
import { deflateSync, crc32 } from 'node:zlib'
import { Worker } from 'node:worker_threads'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { configureStudentAccess, studentLogin } from '../src/student-access.ts'
import { networkSource, reserveThrottle } from '../src/auth-throttle.ts'

process.env.TUTOR_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString('base64')

async function family() {
  const db = openDb(':memory:')
  const user = await registerUser(db, 'hardening@example.invalid', 'synthetic-password')
  assert.ok(user.ok)
  return { db, owner: user.userId }
}
test('F8: a parent lease expires independently of the selected child; escape routes remain usable', async () => {
  const f = await family(), now = new Date('2026-10-17T12:00:00Z')
  try {
    const session = await openAuthSession(f.db, f.owner, now)
    assert.equal((await readAuthSession(f.db, session.token, now))!.parentUnlocked, true)
    const auth = (await readAuthSession(f.db, session.token, new Date(now.getTime() + 15 * 60000)))!
    assert.equal(auth.parentUnlocked, false)
    for (const path of ['/settings', '/students', '/family/export', '/connections/openrouter', '/family/delete']) assert.equal(await authorizeStudentPath(f.db, auth, path, 'POST'), false, path)
    for (const path of ['/parent/unlock', '/parent/lock', '/logout']) assert.equal(await authorizeStudentPath(f.db, auth, path, 'POST'), true, path)
    await f.db.prepare('UPDATE auth_sessions SET student_only = 1, selected_student = ?, parent_unlocked_until = ? WHERE token_hash = ?').run('synthetic-child', '2099-01-01', hashToken(session.token))
    const child = (await readAuthSession(f.db, session.token, now))!
    assert.equal(child.parentUnlocked, false)
    assert.equal(await authorizeStudentPath(f.db, child, '/parent/unlock', 'POST'), false)
  } finally { f.db.close() }
})
test('F5: successful recovery revokes all other links and sessions, with one-use consumption', async () => {
  const f = await family()
  try {
    const session = await openAuthSession(f.db, f.owner)
    await issueAccountToken(f.db, f.owner, 'recover'); await issueAccountToken(f.db, f.owner, 'recover')
    const tokens = f.db.prepare('SELECT message FROM mail_outbox ORDER BY rowid').all().map(row => new URL(JSON.parse(decryptSecret(String(row.message))).url).searchParams.get('token')!)
    await consumeAccountToken(f.db, tokens[1], 'recover', 'new-synthetic-password')
    await assert.rejects(consumeAccountToken(f.db, tokens[0], 'recover', 'attacker-password'), /expired|used/)
    const reused = await Promise.allSettled([consumeAccountToken(f.db, tokens[1], 'recover', 'another-password'), consumeAccountToken(f.db, tokens[1], 'recover', 'another-password')])
    assert.ok(reused.every(r => r.status === 'rejected'))
    assert.equal(await readAuthSession(f.db, session.token), null)
    assert.ok((await loginUser(f.db, 'hardening@example.invalid', 'new-synthetic-password')).ok)
  } finally { f.db.close() }
})

async function request(db: ReturnType<typeof openDb>, auth: Awaited<ReturnType<typeof openAuthSession>>, path: string, data?: any) {
  const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify({ csrf: auth.csrf, ...data }))]) as IncomingMessage
  Object.assign(req, { url: path, method: data === undefined ? 'GET' : 'POST', headers: { cookie: `tutor_session=${auth.token}`, 'content-type': 'application/json', accept: 'application/json' }, socket: { remoteAddress: '127.0.0.1' } })
  const headers: Record<string, any> = {}; let status = 200, body = ''
  const res = { setHeader(key: string, value: any) { headers[key.toLowerCase()] = value }, writeHead(code: number, values: any = {}) { status = code; for (const [key, value] of Object.entries(values)) headers[key.toLowerCase()] = value }, end(value = '') { body += value }, headersSent: false } as unknown as ServerResponse
  await handle(req, res, { db, uploadsDir: '/tmp/synthetic-hardening', runWorker: false })
  return { status, headers, body }
}
test('F8: unlock, lock and logout work without a child selection', async () => {
  const f = await family()
  try {
    const session = await openAuthSession(f.db, f.owner)
    assert.equal((await request(f.db, session, '/parent/lock', {})).status, 303)
    assert.equal((await readAuthSession(f.db, session.token))!.parentUnlocked, false)
    assert.equal((await request(f.db, session, '/parent/unlock', { password: 'synthetic-password' })).headers.location, '/students')
    assert.equal((await readAuthSession(f.db, session.token))!.parentUnlocked, true)
    await request(f.db, session, '/parent/lock', {})
    await request(f.db, session, '/logout', {})
    assert.equal(await readAuthSession(f.db, session.token), null)
  } finally { f.db.close() }
})
test('F1: locked and student-only material intake/extraction never changes parent scope; parent approval permits it', async () => {
  const f = await family(), realFetch = globalThis.fetch
  try {
    const student = await createStudent(f.db, f.owner, { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 })
    const sibling = await createStudent(f.db, f.owner, { displayName: 'Synthetic sibling', grade: 4, sessionCapMinutes: 10 })
    const other = await registerUser(f.db, 'other-scope@example.invalid', 'synthetic-password'); assert.ok(other.ok)
    const otherStudent = await createStudent(f.db, other.userId, { displayName: 'Synthetic other', grade: 4, sessionCapMinutes: 10 })
    const forbidden = await Promise.all([[f.owner, sibling], [other.userId, otherStudent]].map(async ([owner, id]) => ({ student: id, material: await createMaterial(f.db, owner, id, { kind: 'syllabus', workState: 'blank', transcription: 'Synthetic private source' }, '/tmp/synthetic-hardening') })))
    await saveAiSettings(f.db, f.owner, { provider: 'openai', model: 'fixture', apiKey: 'synthetic-key' })
    globalThis.fetch = async (_url: any, init: any) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(stubReply(JSON.parse(init.body).messages[0].content, { questions: [{ number: '1', prompt: 'Synthetic addition coverage', readable: true, confidence: .99 }] })) } }] }))
    const auth = await openAuthSession(f.db, f.owner)
    for (const studentOnly of [0, 1]) {
      await f.db.prepare('UPDATE auth_sessions SET selected_student = ?, parent_unlocked_until = NULL, student_only = ?').run(student, studentOnly)
      for (const kind of ['syllabus', 'agenda', 'textbook']) {
        const result = await request(f.db, auth, `/students/${student}/materials`, { kind, title: 'Synthetic source', workState: 'blank', transcription: 'Synthetic addition coverage', scopeApproved: true })
        assert.equal(result.status, 201)
        const material = JSON.parse(result.body).materialId
        const extract = await request(f.db, auth, `/materials/${material}/extract`, {})
        assert.equal(extract.status, 202)
        await runNextJob(f.db, jobHandlers({ db: f.db, uploadsDir: '/tmp/synthetic-hardening' }))
        assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE kind = 'curriculum'").get()!.n, 0)
        assert.equal(f.db.prepare('SELECT count(*) n FROM subject_sources').get()!.n, 0)
        assert.equal(f.db.prepare('SELECT scope_approved FROM materials WHERE id = ?').get(material)!.scope_approved, 0)
        assert.equal((await request(f.db, auth, `/materials/${material}/learning`, { purpose: 'learning' })).status, 403)
      }
      await request(f.db, auth, `/students/${student}/targets`, { title: 'Synthetic target', deadline: '2099-01-01', curiosity: '0', conceptIds: 'math.4.nbt.b.4' })
      assert.equal(f.db.prepare("SELECT count(*) n FROM targets WHERE kind = 'target'").get()!.n, 0)
      assert.equal(f.db.prepare("SELECT count(*) n FROM targets WHERE kind = 'curiosity' AND deadline IS NULL").get()!.n, studentOnly + 1)
      for (const forbiddenObject of forbidden) {
        for (const suffix of ['materials', 'targets']) assert.equal((await request(f.db, auth, `/students/${forbiddenObject.student}/${suffix}`, { kind: 'syllabus', workState: 'blank', transcription: 'Synthetic' })).status, 403)
        const denied = await request(f.db, auth, `/materials/${forbiddenObject.material}`)
        if (studentOnly) assert.match(denied.body, /This is your student space/); else assert.equal(denied.headers.location, '/parent/unlock')
        assert.doesNotMatch(denied.body, /Synthetic private source/)
        for (const action of ['extract', 'review', 'learning', 'correct']) assert.equal((await request(f.db, auth, `/materials/${forbiddenObject.material}/${action}`, { purpose: 'learning' })).status, 403)
      }
    }
    const material = String(f.db.prepare('SELECT id FROM materials WHERE student_id = ? LIMIT 1').get(student)!.id)
    await f.db.prepare('UPDATE auth_sessions SET student_only = 0, parent_unlocked_until = ?').run('2099-01-01')
    const approved = await request(f.db, auth, `/materials/${material}/learning`, { purpose: 'learning' })
    assert.equal(approved.status, 303)
    assert.equal(f.db.prepare('SELECT scope_approved FROM materials WHERE id = ?').get(material)!.scope_approved, 1)
    const source = await configureMaterialLearning(f.db, f.owner, material, { purpose: 'learning' })
    assert.ok(await currentSchoolSource(f.db, f.owner, source))
    const parentMaterial = await createMaterial(f.db, f.owner, student, { kind: 'textbook', workState: 'blank', transcription: 'Synthetic coverage' }, '/tmp/synthetic-hardening')
    await createJob(f.db, f.owner, student, 'extract', { materialId: parentMaterial, revision: 1 }, 'parent-extract')
    await runNextJob(f.db, jobHandlers({ db: f.db, uploadsDir: '/tmp/synthetic-hardening' }))
    assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE kind = 'curriculum'").get()!.n, 1)
  } finally { globalThis.fetch = realFetch; f.db.close() }
})

test('F7: making previews rechecks policy, daily admission and active work under the family lock', async () => {
  const f = await family()
  try {
    const student = await createStudent(f.db, f.owner, { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 })
    await saveAiSettings(f.db, f.owner, { provider: 'openai', model: 'fixture', apiKey: 'synthetic-key' })
    await setPackSettings(f.db, f.owner, student, { requests: 'any', dailyLimit: 1 })
    const previews: string[] = []
    for (let i = 0; i < 3; i++) {
      const result = await requestPack(f.db, f.owner, student, { text: 'practise adding fractions', by: 'child', mode: 'plan', requestId: crypto.randomUUID() })
      assert.equal(result.kind, 'pack'); if (result.kind === 'pack') previews.push(result.pack.id)
    }
    await setPackSettings(f.db, f.owner, student, { requests: 'off' })
    await assert.rejects(makePlannedPack(f.db, f.owner, previews[0]), /turned off/)
    await setPackSettings(f.db, f.owner, student, { requests: 'any', approval: 'parent' })
    const made = await makePlannedPack(f.db, f.owner, previews[0])
    assert.equal(made.mode, 'review')
    const concurrent = await Promise.allSettled(previews.slice(1).map(id => makePlannedPack(f.db, f.owner, id)))
    assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 0)
    await f.db.prepare("UPDATE packs SET status = 'discarded' WHERE id = ?").run(previews[0])
    await assert.rejects(makePlannedPack(f.db, f.owner, previews[1]), /today|limit/)
    assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE kind = 'pack'").get()!.n, 1)
  } finally { f.db.close() }
})

test('F4: concurrent wrong guesses consume a shared budget before verification, then unlock and deletion are refused too', async () => {
  const f = await family()
  try {
    const attempts = await Promise.all(Array.from({ length: 20 }, () => loginUser(f.db, 'hardening@example.invalid', 'wrong-synthetic-guess')))
    assert.equal(attempts.filter(r => !r.ok && !/Too many/.test(String(r.error))).length, 5)
    const auth = await openAuthSession(f.db, f.owner)
    await request(f.db, auth, '/parent/lock', {})
    assert.match((await request(f.db, auth, '/parent/unlock', { password: 'synthetic-password' })).headers.location, /Too%20many/)
    await f.db.prepare('UPDATE auth_sessions SET parent_unlocked_until = ?').run('2099-01-01')
    await request(f.db, auth, '/family/delete', { password: 'synthetic-password' })
    assert.ok(f.db.prepare('SELECT id FROM users WHERE id = ?').get(f.owner))
  } finally { f.db.close() }
})
test('F6: recovery has an address cooldown and cap; known and unknown addresses receive identical replies', async () => {
  const f = await family()
  try {
    const auth = await openAuthSession(f.db, f.owner)
    const replies = await Promise.all(Array.from({ length: 20 }, () => request(f.db, auth, '/account/recover', { email: 'hardening@example.invalid' })))
    const unknown = await request(f.db, auth, '/account/recover', { email: 'unknown@example.invalid' })
    assert.ok(replies.every(r => r.status === unknown.status && r.body === unknown.body))
    assert.equal(f.db.prepare("SELECT count(*) n FROM mail_outbox WHERE kind = 'recover'").get()!.n, 1)
  } finally { f.db.close() }
})

test('F9: streaming ordinary bodies are rejected with 413 before CSRF or any database work', async () => {
  for (const path of ['/login', '/register', '/account/recover', '/parent/unlock', '/settings']) {
    let reads = 0
    const req = Readable.from((async function* () { yield Buffer.alloc(65_537, 32); reads++; yield Buffer.alloc(100_000) })()) as IncomingMessage
    Object.assign(req, { url: path, method: 'POST', headers: { 'content-type': 'application/json' } })
    let status = 0
    const res = { writeHead(code: number) { status = code }, end() {}, setHeader() {} } as unknown as ServerResponse
    const db = { prepare() { throw Error('Database must not be touched') } } as unknown as ReturnType<typeof openDb>
    await handle(req, res, { db, uploadsDir: '/tmp/synthetic-hardening', runWorker: false })
    assert.equal(status, 413, path)
    assert.ok(reads <= 1)
  }
})

test('F11: database exception text never reaches JSON or redirect notices; expected validation remains useful', async () => {
  const f = await family(), logged: any[] = [], realError = console.error
  try {
    const student = await createStudent(f.db, f.owner, { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 })
    const auth = await openAuthSession(f.db, f.owner)
    const injected = 'synthetic-internal-constraint-and-private-value'
    const db = new Proxy(f.db, { get(target, key) { if (key === 'prepare') return (sql: string) => { if (/INSERT INTO (materials|students)/.test(sql)) throw Error(injected); return target.prepare(sql) }; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value } })
    console.error = (...args: any[]) => { logged.push(args) }
    const json = await request(db, auth, `/students/${student}/materials`, { kind: 'homework', workState: 'blank', transcription: 'Synthetic text' })
    assert.doesNotMatch(json.body, new RegExp(injected))
    assert.match(json.body, /Could not finish/)
    const redirect = await request(db, auth, '/students', { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 })
    assert.doesNotMatch(decodeURIComponent(redirect.headers.location), new RegExp(injected))
    assert.match(decodeURIComponent(redirect.headers.location), /Could not finish/)
    const expected = await request(f.db, auth, `/students/${student}/materials`, { kind: 'invalid', workState: 'blank' })
    assert.match(expected.body, /Choose the kind/)
    assert.equal(logged.length, 2)
    assert.doesNotMatch(JSON.stringify(logged), new RegExp(injected))
  } finally { console.error = realError; f.db.close() }
})

test('F2: family active jobs and student hourly paid creation are bounded; retries have a ceiling', async () => {
  const f = await family()
  try {
    const student = await createStudent(f.db, f.owner, { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 })
    const results = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => createJob(f.db, f.owner, student, 'grade', {}, `budget-${i}`)))
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 20)
    assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get()!.n, 20)
    const job = String(f.db.prepare('SELECT id FROM jobs LIMIT 1').get()!.id)
    await f.db.prepare("UPDATE jobs SET status = 'failed', attempts = 3 WHERE id = ?").run(job)
    await assert.rejects(changeJob(f.db, f.owner, job, 'retry'), /retry|tries/)
    await f.db.prepare("UPDATE jobs SET status = 'succeeded'").run()
    for (let i = 20; i < 30; i++) { const id = await createJob(f.db, f.owner, student, 'grade', {}, `budget-${i}`); await f.db.prepare("UPDATE jobs SET status = 'succeeded' WHERE id = ?").run(id) }
    await assert.rejects(createJob(f.db, f.owner, student, 'grade', {}, 'over-hour'), /hour/)
    const other = await registerUser(f.db, 'other-budget@example.invalid', 'synthetic-password'); assert.ok(other.ok)
    const otherStudent = await createStudent(f.db, other.userId, { displayName: 'Synthetic other', grade: 4, sessionCapMinutes: 10 })
    assert.ok(await createJob(f.db, other.userId, otherStudent, 'grade', {}, 'other-budget'))
  } finally { f.db.close() }
})

test('F2: concurrent family upload reservations enforce count/bytes and expired tickets release admission', async () => {
  const f = await family(), now = new Date()
  try {
    const student = await createStudent(f.db, f.owner, { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 })
    const result = await Promise.allSettled(Array.from({ length: 20 }, () => { const id = crypto.randomUUID(); return reserveUpload(f.db, f.owner, student, id, `blob:families/${f.owner}/uploads/${id}.png`, 'image/png') }))
    assert.equal(result.filter(r => r.status === 'fulfilled').length, 12)
    assert.equal(f.db.prepare('SELECT sum(reserved_bytes) bytes FROM upload_intents').get()!.bytes, 180_000_000)
    await f.db.prepare('UPDATE upload_intents SET expires_at = ?').run(new Date(now.getTime() - 1).toISOString())
    const id = crypto.randomUUID()
    assert.ok(await reserveUpload(f.db, f.owner, student, id, `blob:families/${f.owner}/uploads/${id}.png`, 'image/png'))
  } finally { f.db.close() }
})

test('F3: family deletion commits a durable private-file erasure manifest before attempting storage', async () => {
  const f = await family(), root = '/tmp/synthetic-hardening'
  try {
    const student = await createStudent(f.db, f.owner, { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 })
    for (let i = 0; i < 2; i++) {
      const id = crypto.randomUUID()
      f.db.prepare('INSERT INTO uploads (id, owner_user_id, student_id, stored_path, created_at) VALUES (?, ?, ?, ?, ?)').run(id, f.owner, student, `${root}/${f.owner}/${id}.png`, new Date().toISOString())
    }
    let deletes = 0
    await (deleteFamily as any)(f.db, f.owner, root, async () => {
      assert.equal(f.db.prepare('SELECT count(*) n FROM users').get()!.n, 0)
      assert.ok(Number(f.db.prepare('SELECT count(*) n FROM file_erasures').get()!.n) > 0)
      deletes++; if (deletes === 2) throw Error('Synthetic storage failure')
    })
    assert.equal(deletes, 2)
    assert.equal(f.db.prepare('SELECT count(*) n FROM file_erasures').get()!.n, 1)
    assert.equal(f.db.prepare('SELECT count(*) n FROM uploads').get()!.n, 0)
  } finally { f.db.close() }
})

test('F3: retries survive cleanup failure and deleted-family completion removes late objects until ticket expiry', async () => {
  const f = await family(), now = new Date(), files = new Set<string>(), root = '/tmp/synthetic-hardening'
  try {
    const student = await createStudent(f.db, f.owner, { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 })
    const id = crypto.randomUUID(), path = `blob:families/${f.owner}/uploads/${id}.png`
    await reserveUpload(f.db, f.owner, student, id, path, 'image/png')
    files.add(path)
    const remove = async (path: string) => { files.delete(path) }
    await deleteFamily(f.db, f.owner, root, async () => { throw Error('Synthetic deletion failure') })
    assert.equal(files.size, 1)
    await sweepPrivateFiles(f.db, root, remove, new Date(now.getTime() + 2 * 60000))
    assert.equal(files.size, 0)
    assert.equal(f.db.prepare('SELECT count(*) n FROM file_erasures').get()!.n, 1)
    files.add(path)
    await assert.rejects(completeUpload(f.db, f.owner, student, id, root, { read: async () => { throw Error('Must not read') }, remove }), /no longer|not found/)
    assert.equal(files.size, 0)
    files.add(path)
    await sweepPrivateFiles(f.db, root, remove, new Date(now.getTime() + 60 * 60000))
    assert.equal(files.size, 0)
    assert.equal(f.db.prepare('SELECT count(*) n FROM file_erasures').get()!.n, 0)
  } finally { f.db.close() }
})

test('F10: magic prefixes, truncated files and trailing garbage are rejected', () => {
  for (const [mime, prefix] of [['image/png', [0x89, 0x50]], ['image/jpeg', [0xff, 0xd8]]] as const) {
    const fake = Buffer.alloc(100); fake.set(prefix)
    assert.throws(() => validateImage(fake, mime), /PNG|JPEG|image/)
  }
})

function pngChunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4), content = Buffer.concat([Buffer.from(type), data])
  length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(content))
  return Buffer.concat([length, content, checksum])
}
function syntheticPng(width = 1, height = 1) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(Buffer.from([0, 120, 80, 40]))), pngChunk('IEND', Buffer.alloc(0))])
}
function syntheticJpeg(width = 1, height = 1) {
  const segment = (marker: number, data: Buffer) => { const header = Buffer.from([255, marker, 0, 0]); header.writeUInt16BE(data.length + 2, 2); return Buffer.concat([header, data]) }
  const frame = Buffer.from([8, 0, 0, 0, 0, 1, 1, 0x11, 0]); frame.writeUInt16BE(height, 1); frame.writeUInt16BE(width, 3)
  const table = (id: number) => Buffer.from([id, 1, ...Array(15).fill(0), 0])
  const exif = Buffer.from('45786966000049492a0008000000010012010300010000000600000000000000', 'hex')
  return Buffer.concat([Buffer.from([255, 216]), segment(0xe1, exif), segment(0xdb, Buffer.from([0, ...Array(64).fill(1)])), segment(0xc0, frame), segment(0xc4, Buffer.concat([table(0), table(0x10)])), segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from([0x3f, 255, 217])])
}
test('F10: bounded complete PNG/JPEG pass, dimensions and all truncations/trailing bytes fail; orientation metadata is retained', () => {
  for (const [mime, bytes, make] of [['image/png', syntheticPng(), syntheticPng], ['image/jpeg', syntheticJpeg(), syntheticJpeg]] as const) {
    assert.deepEqual(validateImage(bytes, mime), { width: 1, height: 1 })
    const original = Buffer.from(bytes)
    for (let i = 0; i < bytes.length; i++) assert.throws(() => validateImage(bytes.subarray(0, i), mime))
    assert.throws(() => validateImage(Buffer.concat([bytes, Buffer.from([0])]), mime))
    assert.throws(() => validateImage(make(12001, 1), mime), /12000/)
    assert.throws(() => validateImage(make(10000, 10000), mime), /megapixels/)
    assert.deepEqual(bytes, original)
  }
  const corrupt = syntheticPng(); corrupt[corrupt.length - 1] ^= 1
  assert.throws(() => validateImage(corrupt, 'image/png'))
  assert.throws(() => validateImage(syntheticPng(2, 1), 'image/png'), /complete/)
})
test('F10/F3: invalid direct images are refused and storage cleanup remains durable on failure', async () => {
  const f = await family()
  try {
    const student = await createStudent(f.db, f.owner, { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 }), id = crypto.randomUUID()
    const path = `blob:families/${f.owner}/uploads/${id}.png`
    await reserveUpload(f.db, f.owner, student, id, path, 'image/png')
    const storage = { read: async () => Buffer.from([0x89, 0x50, ...Array(98).fill(0)]), remove: async () => { throw Error('Synthetic storage failure') } }
    await assert.rejects(completeUpload(f.db, f.owner, student, id, '/tmp/synthetic-hardening', storage), /complete/)
    assert.equal(f.db.prepare('SELECT count(*) n FROM uploads').get()!.n, 0)
    assert.equal(f.db.prepare('SELECT count(*) n FROM upload_intents').get()!.n, 0)
    assert.equal(f.db.prepare('SELECT count(*) n FROM file_erasures').get()!.n, 1)
    let deleted = 0
    await sweepPrivateFiles(f.db, '/tmp/synthetic-hardening', async () => { deleted++ })
    assert.equal(deleted, 1)
  } finally { f.db.close() }
})

test('F4: fifty wrong password and PIN attempts through independent SQLite connections never exceed five verifications', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tutor-hardening-concurrency-')), path = join(root, 'synthetic.sqlite'), db = openDb(path)
  try {
    const user = await registerUser(db, 'parallel@example.invalid', 'synthetic-password'); assert.ok(user.ok)
    const student = await createStudent(db, user.userId, { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 })
    const code = await configureStudentAccess(db, user.userId, student, '246810')
    for (const mode of ['', code]) {
      const gate = new SharedArrayBuffer(4); let ready = 0
      const results = await Promise.all([1, 2].map(() => new Promise<number>((resolve, reject) => {
        const worker = new Worker(new URL('./fixtures/hardening-worker.ts', import.meta.url), { workerData: { path, code: mode, gate } })
        worker.on('error', reject)
        worker.on('message', value => { if (value === 'ready') { if (++ready === 2) { Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0) } } else resolve(value) })
        worker.on('exit', code => { if (code) reject(Error('Synthetic worker failed')) })
      })))
      assert.equal(results.reduce((a, b) => a + b, 0), 5)
    }
  } finally { db.close(); rmSync(root, { recursive: true, force: true }) }
})
test('F4/F6: network sources use only the local socket or cloud first hop; source and recovery windows persist', async () => {
  const oldCloud = process.env.TUTOR_CLOUD, f = await family(), now = new Date()
  try {
    const req = { headers: { 'x-forwarded-for': 'synthetic-platform-hop, untrusted-later-hop' }, socket: { remoteAddress: 'synthetic-socket' } } as unknown as IncomingMessage
    delete process.env.TUTOR_CLOUD; assert.equal(networkSource(req), 'synthetic-socket')
    process.env.TUTOR_CLOUD = '1'; assert.equal(networkSource(req), 'synthetic-platform-hop')
    for (let i = 0; i < 100; i++) assert.equal(await reserveThrottle(f.db, 'synthetic-source', 100, 15 * 60000, now), true)
    assert.equal(await reserveThrottle(f.db, 'synthetic-source', 100, 15 * 60000, now), false)
    assert.equal(await reserveThrottle(f.db, 'synthetic-source', 100, 15 * 60000, new Date(now.getTime() + 15 * 60000)), true)
    for (let minute = 0; minute < 6; minute++) await requestRecovery(f.db, 'hardening@example.invalid', 'synthetic-source', new Date(now.getTime() + minute * 60000))
    assert.equal(f.db.prepare("SELECT count(*) n FROM mail_outbox WHERE kind = 'recover'").get()!.n, 3)
    for (let i = 0; i < 21; i++) await requestRecovery(f.db, `unknown-${i}@example.invalid`, 'source-cap', now)
    assert.equal(f.db.prepare("SELECT count(*) n FROM auth_throttle WHERE key LIKE 'recovery-cooldown:%'").get()!.n, 21)
  } finally { if (oldCloud === undefined) delete process.env.TUTOR_CLOUD; else process.env.TUTOR_CLOUD = oldCloud; f.db.close() }
})
test('F9: upload/transcription routes keep a separate limit and slow bodies do not own the SQLite request queue', async () => {
  const f = await family(); let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  try {
    const student = await createStudent(f.db, f.owner, { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 }), auth = await openAuthSession(f.db, f.owner)
    const larger = await request(f.db, auth, `/students/${student}/materials`, { kind: 'homework', workState: 'blank', pages: Array.from({ length: 7 }, () => ({ transcription: 'x'.repeat(10000) })) })
    assert.equal(larger.status, 201)
    const req = Readable.from((async function* () { yield Buffer.from('{'); await gate; yield Buffer.from('}') })()) as IncomingMessage
    Object.assign(req, { method: 'POST', url: '/login', headers: { 'content-type': 'application/json' } })
    const res = { setHeader() {}, writeHead() {}, end() {} } as unknown as ServerResponse
    const pending = handle(req, res, { db: f.db, uploadsDir: '/tmp/synthetic-hardening' })
    await new Promise(resolve => setImmediate(resolve))
    const result = await Promise.race([request(f.db, auth, '/health'), new Promise<null>(resolve => setTimeout(() => resolve(null), 200))])
    release(); await pending
    assert.equal(result?.status, 200)
  } finally { release(); f.db.close() }
})

test('F1: extracting an existing parent material from child mode requires fresh parent approval', async () => {
  const f = await family(), realFetch = globalThis.fetch
  try {
    const student = await createStudent(f.db, f.owner, { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 }), auth = await openAuthSession(f.db, f.owner)
    await saveAiSettings(f.db, f.owner, { provider: 'openai', model: 'fixture', apiKey: 'synthetic-key' })
    const material = await createMaterial(f.db, f.owner, student, { kind: 'syllabus', workState: 'blank', transcription: 'Synthetic coverage' }, '/tmp/synthetic-hardening')
    assert.equal(f.db.prepare('SELECT scope_approved FROM materials WHERE id = ?').get(material)!.scope_approved, 1)
    await request(f.db, auth, '/parent/lock', { studentId: student })
    assert.equal((await request(f.db, auth, `/materials/${material}/extract`, {})).status, 202)
    globalThis.fetch = async (_url: any, init: any) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(stubReply(JSON.parse(init.body).messages[0].content, { questions: [{ number: '1', prompt: 'Synthetic coverage', readable: true, confidence: .99 }] })) } }] }))
    await runNextJob(f.db, jobHandlers({ db: f.db, uploadsDir: '/tmp/synthetic-hardening' }))
    assert.equal(f.db.prepare('SELECT scope_approved FROM materials WHERE id = ?').get(material)!.scope_approved, 0)
    assert.equal(f.db.prepare('SELECT count(*) n FROM subject_sources').get()!.n, 0)
    assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE kind = 'curriculum'").get()!.n, 0)
    await request(f.db, auth, '/parent/unlock', { password: 'synthetic-password' })
    assert.equal((await request(f.db, auth, `/materials/${material}/learning`, { purpose: 'learning' })).status, 303)
    await runNextJob(f.db, jobHandlers({ db: f.db, uploadsDir: '/tmp/synthetic-hardening' }))
    assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE kind = 'curriculum'").get()!.n, 1)
  } finally { globalThis.fetch = realFetch; f.db.close() }
})
test('F5: concurrent recovery consumes one valid link once', async () => {
  const f = await family()
  try {
    await issueAccountToken(f.db, f.owner, 'recover')
    const mail = f.db.prepare('SELECT message FROM mail_outbox').get()!
    const token = new URL(JSON.parse(decryptSecret(String(mail.message))).url).searchParams.get('token')!
    const result = await Promise.allSettled([consumeAccountToken(f.db, token, 'recover', 'new-synthetic-password'), consumeAccountToken(f.db, token, 'recover', 'other-synthetic-password')])
    assert.equal(result.filter(r => r.status === 'fulfilled').length, 1)
  } finally { f.db.close() }
})
test('F2: an expired final execution lease fails without another handler call', async () => {
  const f = await family()
  try {
    const student = await createStudent(f.db, f.owner, { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 })
    const id = await createJob(f.db, f.owner, student, 'synthetic', {}, 'last-attempt')
    f.db.prepare("UPDATE jobs SET status = 'running', attempts = 3, run_token = 'stale', lease_until = '2000-01-01' WHERE id = ?").run(id)
    let calls = 0
    assert.equal(await runNextJob(f.db, { synthetic: async () => { calls++ } }), false)
    assert.equal(calls, 0)
    assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id = ?').get(id)!.status, 'failed')
  } finally { f.db.close() }
})

test('F10: local uploads and direct completion share validation and preserve JPEG orientation bytes', async () => {
  const f = await family(), root = mkdtempSync(join(tmpdir(), 'tutor-hardening-images-'))
  try {
    const student = await createStudent(f.db, f.owner, { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 })
    const jpeg = syntheticJpeg(2, 1), local = await saveUpload(f.db, f.owner, student, { mime: 'image/jpeg', base64: jpeg.toString('base64') }, root)
    const upload = await getUpload(f.db, f.owner, local)
    assert.deepEqual(readFileSync(upload!.stored_path), jpeg)
    const id = crypto.randomUUID(), path = `blob:families/${f.owner}/uploads/${id}.png`
    await reserveUpload(f.db, f.owner, student, id, path, 'image/png')
    let reads = 0
    const storage = { read: async () => { reads++; return syntheticPng() }, remove: async () => { throw Error('Valid photos must remain') } }
    assert.equal(await completeUpload(f.db, f.owner, student, id, root, storage), id)
    assert.equal(await completeUpload(f.db, f.owner, student, id, root, storage), id)
    assert.equal(reads, 1)
    await assert.rejects(saveUpload(f.db, f.owner, student, { mime: 'image/png', base64: Buffer.alloc(100).toString('base64') }, root), /complete/)
    assert.equal(f.db.prepare('SELECT count(*) n FROM uploads').get()!.n, 2)
  } finally { f.db.close(); rmSync(root, { recursive: true, force: true }) }
})

test('a correct password clears the account counter, so repeated unlocks never lock a parent out', async () => {
  const db = openDb(':memory:')
  await registerUser(db, 'unlock-loop@example.invalid', 'long-unlock-loop-password')
  for (let i = 0; i < 12; i++) assert.equal((await loginUser(db, 'unlock-loop@example.invalid', 'long-unlock-loop-password', new Date(), 5, 'source-a')).ok, true)
  for (let i = 0; i < 5; i++) assert.equal((await loginUser(db, 'unlock-loop@example.invalid', 'wrong-password-guess', new Date(), 5, 'source-a')).ok, false)
  assert.match(String((await loginUser(db, 'unlock-loop@example.invalid', 'long-unlock-loop-password', new Date(), 5, 'source-a')).error), /Too many tries/)
})

test('passwords use the OWASP scrypt cost by default, and an older hash is upgraded at the next correct sign-in', async () => {
  const { needsRehash, hashPassword, verifyPassword } = await import('../src/auth.ts')
  assert.equal(needsRehash('scrypt$1024$8$1$salt$hash'), true)
  assert.equal(needsRehash(hashPassword('synthetic-password')), false)
  const db = openDb(':memory:')
  try {
    const user = await registerUser(db, 'rehash@example.invalid', 'synthetic-password'); assert.ok(user.ok)
    // Store a cheaper legacy hash, then sign in correctly.
    const legacy = 'scrypt$1024$8$1$' + 'c2FsdHNhbHRzYWx0c2FsdA' + '$' + (await import('node:crypto')).scryptSync('synthetic-password', 'c2FsdHNhbHRzYWx0c2FsdA', 32, { N: 1024, r: 8, p: 1 }).toString('base64url')
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(legacy, user.userId)
    assert.equal((await loginUser(db, 'rehash@example.invalid', 'synthetic-password', new Date(), 5, 'rehash-source')).ok, true)
    const stored = String((await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.userId))!.password_hash)
    assert.notEqual(stored, legacy); assert.equal(needsRehash(stored), false); assert.equal(verifyPassword('synthetic-password', stored), true)
  } finally { db.close() }
})

test('the AI sees learning decisions only: never birthdays from profile edits, note text or settings', async () => {
  const { recordDecision, decisionContext } = await import('../src/decisions.ts')
  const db = openDb(':memory:')
  try {
    const user = await registerUser(db, 'context@example.invalid', 'synthetic-password'); assert.ok(user.ok)
    const student = await createStudent(db, user.userId, { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 })
    await recordDecision(db, student, 'profile_changed', 'The parent changed the profile.', { before: { birthDate: '2016-01-02' }, after: { birthDate: '2016-02-03' } })
    await recordDecision(db, student, 'parent_note_left', 'A note was left.', { body: 'synthetic private note text' })
    await recordDecision(db, student, 'answer_scored', 'A fraction answer was scored.', { secretDetail: 'synthetic-detail' })
    const context = await decisionContext(db, user.userId, student)
    assert.match(context, /A fraction answer was scored/)
    assert.doesNotMatch(context, /2016-0|private note|profile|synthetic-detail/)
  } finally { db.close() }
})

test('the family export carries the learning record but no hashes, tokens, storage paths or security bookkeeping', async () => {
  const { exportFamily } = await import('../src/accounts.ts')
  const db = openDb(':memory:')
  try {
    const user = await registerUser(db, 'export@example.invalid', 'synthetic-password'); assert.ok(user.ok)
    const student = await createStudent(db, user.userId, { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 })
    await configureStudentAccess(db, user.userId, student, '246810')
    const out = JSON.stringify(await exportFamily(db, user.userId, '/tmp/tutor-export-test'))
    assert.match(out, /Synthetic learner/)
    assert.doesNotMatch(out, /scrypt\$|_hash"|"access_code"|"stored_path"|"idempotency_key"|auth_throttle|file_erasures|upload_intents/)
  } finally { db.close() }
})

test('a student link is stored encrypted and found by its hash; an old plain link still works once and is upgraded', async () => {
  const db = openDb(':memory:')
  try {
    const user = await registerUser(db, 'link@example.invalid', 'synthetic-password'); assert.ok(user.ok)
    const student = await createStudent(db, user.userId, { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 })
    const code = await configureStudentAccess(db, user.userId, student, '246810')
    const row = await db.prepare('SELECT access_code, access_code_hash FROM students WHERE id = ?').get(student) as any
    assert.ok(String(row.access_code).startsWith('enc:v2:')); assert.notEqual(row.access_code, code); assert.equal(row.access_code_hash, hashToken(code))
    assert.ok(await studentLogin(db, code, '246810', new Date(), 'link-source'))
    // Simulate a link saved before hashing existed.
    await db.prepare("UPDATE students SET access_code = ?, access_code_hash = '' WHERE id = ?").run(code, student)
    assert.ok(await studentLogin(db, code, '246810', new Date(), 'link-source-2'))
    const upgraded = await db.prepare('SELECT access_code, access_code_hash FROM students WHERE id = ?').get(student) as any
    assert.ok(String(upgraded.access_code).startsWith('enc:v2:')); assert.equal(upgraded.access_code_hash, hashToken(code))
  } finally { db.close() }
})

test('expired sessions, one-time links, sign-in starts and old counters are purged by the regular sweep', async () => {
  const db = openDb(':memory:')
  try {
    const user = await registerUser(db, 'purge@example.invalid', 'synthetic-password'); assert.ok(user.ok)
    const old = new Date(Date.now() - 3 * 86400000)
    await openAuthSession(db, user.userId, new Date(Date.now() - 20 * 86400000))
    const live = await openAuthSession(db, user.userId)
    await db.prepare("INSERT INTO account_tokens (token_hash, user_id, kind, expires_at) VALUES ('old-token', ?, 'recover', ?)").run(user.userId, old.toISOString())
    await db.prepare("INSERT INTO auth_throttle (key, window_start, count) VALUES ('old-key', ?, 3)").run(old.toISOString())
    await sweepPrivateFiles(db, '/tmp/tutor-purge-test', async () => {})
    assert.equal(Number((await db.prepare('SELECT count(*) n FROM auth_sessions WHERE user_id = ?').get(user.userId) as any).n), 1)
    assert.ok(await readAuthSession(db, live.token))
    assert.equal(await db.prepare("SELECT 1 FROM account_tokens WHERE token_hash = 'old-token'").get(), undefined)
    assert.equal(await db.prepare("SELECT 1 FROM auth_throttle WHERE key = 'old-key'").get(), undefined)
  } finally { db.close() }
})

test('a backup folder is sealed: no family text is readable without the separate backup key', async () => {
  const { writeSnapshot, verifyCloudBackup, applicationTables } = await import('../src/cloud-backup.ts')
  const { readdirSync, readFileSync, mkdtempSync } = await import('node:fs')
  const old = process.env.TUTOR_BACKUP_KEY
  process.env.TUTOR_BACKUP_KEY = (await import('node:crypto')).randomBytes(32).toString('base64')
  const dir = join(mkdtempSync(join(tmpdir(), 'tutor-sealed-')), 'backup')
  try {
    const tables: Record<string, any[]> = {}
    for (const table of await applicationTables()) tables[table] = []
    tables.students = [{ id: 'synthetic-student', display_name: 'Synthetic Secret Name', birth_date: '2016-01-02' }]
    const { mkdir } = await import('node:fs/promises'); await mkdir(dir, { mode: 0o700 })
    await writeSnapshot(tables, dir, '/tmp/unused')
    for (const file of readdirSync(dir)) assert.doesNotMatch(readFileSync(join(dir, file)).toString('latin1'), /Synthetic Secret Name|2016-01-02/)
    assert.equal((await verifyCloudBackup(dir)).tables.students[0].display_name, 'Synthetic Secret Name')
    process.env.TUTOR_BACKUP_KEY = (await import('node:crypto')).randomBytes(32).toString('base64')
    await assert.rejects(verifyCloudBackup(dir))
  } finally { if (old === undefined) delete process.env.TUTOR_BACKUP_KEY; else process.env.TUTOR_BACKUP_KEY = old; rmSync(dirname(dir), { recursive: true, force: true }) }
})

test('the deployment key can be rotated: old values open with the previous key and are re-encrypted under the new one', async () => {
  const { encryptSecret, decryptSecret, rewrapSecret, keyId } = await import('../src/secrets.ts')
  const original = process.env.TUTOR_ENCRYPTION_KEY, oldKey = Buffer.alloc(32, 7).toString('base64'), newKey = Buffer.alloc(32, 9).toString('base64')
  try {
    process.env.TUTOR_ENCRYPTION_KEY = oldKey
    const sealed = encryptSecret('synthetic-provider-key')
    assert.ok(sealed.startsWith(`enc:v2:${keyId(Buffer.from(oldKey, 'base64'))}:`))
    process.env.TUTOR_ENCRYPTION_KEY = newKey
    assert.throws(() => decryptSecret(sealed), /not configured/)
    process.env.TUTOR_ENCRYPTION_KEYS_PREVIOUS = oldKey
    assert.equal(decryptSecret(sealed), 'synthetic-provider-key')
    const rotated = rewrapSecret(sealed)
    assert.ok(rotated.startsWith(`enc:v2:${keyId(Buffer.from(newKey, 'base64'))}:`))
    assert.equal(rewrapSecret(rotated), rotated)
    delete process.env.TUTOR_ENCRYPTION_KEYS_PREVIOUS
    assert.equal(decryptSecret(rotated), 'synthetic-provider-key')
  } finally { process.env.TUTOR_ENCRYPTION_KEY = original; delete process.env.TUTOR_ENCRYPTION_KEYS_PREVIOUS }
})
