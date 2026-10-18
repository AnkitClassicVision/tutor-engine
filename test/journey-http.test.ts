import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { openDb } from '../src/db.ts'
import { registerUser, openAuthSession, hashToken } from '../src/auth.ts'
import { createStudent, startTutorSession, saveAiSettings } from '../src/services.ts'
import { handle } from '../src/server.ts'
import { decryptSecret } from '../src/secrets.ts'

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'tutor-http-')), db = openDb(join(dir, 'test.sqlite'))
  const user = (await registerUser(db, 'http@example.com', 'long-http-password')); if (!user.ok) throw new Error()
  const auth = (await openAuthSession(db, user.userId)), student = (await createStudent(db, user.userId, { displayName: 'Synthetic learner', grade: 3, sessionCapMinutes: 10 }))
  const server = createServer(async (req, res) => { handle(req, res, { db, uploadsDir: join(dir, 'uploads') }).catch(() => { res.writeHead(500); res.end('Unexpected request error') }) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); if (!address || typeof address === 'string') throw new Error()
  const realFetch = globalThis.fetch
  const request = (path: string, data?: any) => realFetch(`http://127.0.0.1:${address.port}${path}`, { redirect: 'manual', method: data ? 'POST' : 'GET', headers: { Cookie: `tutor_session=${auth.token}`, ...(data ? { 'Content-Type': 'application/json', Accept: 'application/json' } : {}) }, body: data ? JSON.stringify({ csrf: auth.csrf, ...data }) : undefined })
  return { server, db, owner: user.userId, auth, student, request }
}
test('live tutor requires ownership, CSRF, parent unlock and activation before any provider request', async () => {
  const f = await fixture(), realFetch = globalThis.fetch, previous = process.env.TUTOR_LIVE_TUTOR_ENABLED
  try {
    delete process.env.TUTOR_LIVE_TUTOR_ENABLED
    let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('A provider request must not happen') }
    const path = `/students/${f.student}/live`
    assert.equal((await f.request(path)).status, 200)
    assert.equal((await f.request(path, { sdp: 'v=0' })).status, 400)
    assert.equal((await f.request(path, { sdp: 'v=0', csrf: 'wrong' })).status, 403)
    assert.equal((await f.request(`/students/${crypto.randomUUID()}/live`, { sdp: 'v=0' })).status, 400)
    await f.request('/parent/lock', { studentId: f.student })
    assert.equal((await f.request(path, { sdp: 'v=0' })).status, 403)
    assert.match((await f.request(path)).headers.get('location')!, /parent\/unlock.*returnTo=/)
    assert.equal(calls, 0)
    await f.request('/parent/unlock', { password: 'long-http-password' })
    await saveAiSettings(f.db, f.owner, { provider: 'openai', model: 'fixture', apiKey: 'synthetic-live-key' })
    process.env.TUTOR_LIVE_TUTOR_ENABLED = '1'
    globalThis.fetch = async (url: any, init: any) => {
      calls++; assert.equal(url, 'https://api.openai.com/v1/realtime/calls')
      assert.equal(init.headers.Authorization, 'Bearer synthetic-live-key')
      assert.equal(init.body.get('sdp'), 'v=0\r\nsynthetic-offer')
      return new Response('v=0\r\nsynthetic-answer')
    }
    const connected = await f.request(path, { sdp: 'v=0\r\nsynthetic-offer' })
    assert.equal(connected.status, 200)
    assert.deepEqual(await connected.json(), { sdp: 'v=0\r\nsynthetic-answer' })
    assert.equal(calls, 1)
  } finally { globalThis.fetch = realFetch; if (previous === undefined) delete process.env.TUTOR_LIVE_TUTOR_ENABLED; else process.env.TUTOR_LIVE_TUTOR_ENABLED = previous; f.server.close(); f.db.close() }
})
test('OpenRouter PKCE is bound to the parent session, encrypted, one-use and state-checked', async () => {
  const f = await fixture(), realFetch = globalThis.fetch
  try {
    await saveAiSettings(f.db, f.owner, { provider: 'openrouter', model: 'selected/text', photoModel: 'selected/photo', apiKey: 'old-fixture-key' })
    const started = await f.request('/connections/openrouter', {})
    assert.equal(started.status, 303)
    const url = new URL(started.headers.get('location')!), state = new URL(url.searchParams.get('callback_url')!).searchParams.get('state')!
    const saved = (await f.db.prepare('SELECT verifier FROM oauth_states WHERE state_hash = ?').get(hashToken(state)))!
    assert.match(String(saved.verifier), /^enc:v2:/)
    assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(decryptSecret(String(saved.verifier))).digest('base64url'))
    assert.equal((await f.request('/connections/openrouter/callback?state=forged&code=bad')).status, 400)
    let exchanges = 0
    globalThis.fetch = async (_url: any, init: any) => {
      assert.equal(String(_url), 'https://openrouter.ai/api/v1/auth/keys')
      const body = JSON.parse(init.body); assert.equal(body.code_challenge_method, 'S256'); assert.equal(body.code_verifier, decryptSecret(String(saved.verifier)))
      exchanges++; return new Response(JSON.stringify({ key: 'synthetic-oauth-key' }), { status: 200 })
    }
    const returned = new URL(url.searchParams.get('callback_url')!)
    returned.searchParams.set('code', 'synthetic-code')
    const callback = returned.pathname + returned.search
    assert.equal((await f.request(callback)).status, 303)
    assert.equal((await f.request(callback)).status, 400)
    assert.equal(exchanges, 1)
    const models = await f.db.prepare('SELECT ai_model, photo_model FROM users WHERE id = ?').get(f.owner)
    assert.equal(models!.ai_model, 'selected/text'); assert.equal(models!.photo_model, 'selected/photo')
    assert.equal(decryptSecret(String((await f.db.prepare('SELECT ai_key FROM users WHERE id = ?').get(f.owner))!.ai_key)), 'synthetic-oauth-key')
  } finally { globalThis.fetch = realFetch; f.server.close(); f.db.close() }
})
test('student mode blocks parent APIs and sibling sessions after refresh and permits password recovery', async () => {
  const f = await fixture()
  try {
    const sibling = (await createStudent(f.db, f.owner, { displayName: 'Sibling fixture', grade: 4, sessionCapMinutes: 5 })), other = (await startTutorSession(f.db, f.owner, sibling))
    assert.equal((await f.request('/parent/lock', { studentId: f.student })).status, 303)
    assert.equal((await f.request('/settings', { provider: 'openai', apiKey: 'forged' })).status, 403)
    assert.equal((await f.request(`/session/${other}/answer`, { itemId: 'forged', answer: 'forged' })).status, 403)
    assert.equal((await f.request(`/students/${sibling}`)).headers.get('location'), '/parent/unlock')
    assert.equal((await f.request('/account/recover')).status, 200)
    const unlock = await f.request('/parent/unlock', { password: 'long-http-password' })
    assert.equal(unlock.status, 303); assert.equal((await f.request('/settings')).status, 200)
  } finally { f.server.close(); f.db.close() }
})
test('answer submissions return 202 before model work and durable drafts survive a reload', async () => {
  const f = await fixture()
  try {
    const session = (await startTutorSession(f.db, f.owner, f.student, new Date(), { mode: 'assessment', focusConceptId: 'math.primary.3.multiply' }))
    const item = (await f.db.prepare('SELECT id FROM session_items WHERE session_id = ? ORDER BY position LIMIT 1').get(session))!
    assert.equal((await f.request(`/session/${session}/draft`, { itemId: item.id, answer: 'My saved draft' })).status, 200)
    assert.match(await (await f.request(`/session/${session}`)).text(), /My saved draft/)
    const response = await f.request(`/session/${session}/answer`, { itemId: item.id, answer: 'My reasoning', timeMs: 1000 })
    assert.equal(response.status, 202)
    const job = await response.json() as any
    assert.ok(job.jobId)
    assert.equal((await f.db.prepare('SELECT correct FROM session_items WHERE id = ?').get(item.id))!.correct, null)
    const status = await (await f.request(`/jobs/${job.jobId}/status`)).json() as any
    assert.equal(status.status, 'queued')
    assert.equal(JSON.stringify(status).includes('My reasoning'), false)
  } finally { f.server.close(); f.db.close() }
})
test('an existing local parent gets a verification link after public login', async () => {
  const f = await fixture(), oldPublic = process.env.TUTOR_PUBLIC, oldKey = process.env.TUTOR_ENCRYPTION_KEY
  try {
    process.env.TUTOR_PUBLIC = '1'; process.env.TUTOR_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
    const address = f.server.address(); if (!address || typeof address === 'string') throw new Error()
    const csrf = 'synthetic-login-csrf'
    const response = await fetch(`http://127.0.0.1:${address.port}/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', Cookie: `tutor_csrf=${csrf}` }, body: JSON.stringify({ csrf, email: 'http@example.com', password: 'long-http-password' }) })
    assert.equal(response.status, 303)
    const mail = await f.db.prepare('SELECT kind, message FROM mail_outbox WHERE user_id = ?').get(f.owner)
    assert.equal(mail?.kind, 'verify'); assert.match(decryptSecret(String(mail?.message)), /account\/verify/)
  } finally {
    if (oldPublic === undefined) delete process.env.TUTOR_PUBLIC; else process.env.TUTOR_PUBLIC = oldPublic
    if (oldKey === undefined) delete process.env.TUTOR_ENCRYPTION_KEY; else process.env.TUTOR_ENCRYPTION_KEY = oldKey
    f.server.close(); f.db.close()
  }
})

test('parent unlock keeps an allowed destination and rejects external and sibling destinations', async () => {
  const f = await fixture()
  try {
    await f.request('/parent/lock', { studentId: f.student })
    assert.equal((await f.request('/settings')).headers.get('location'), '/parent/unlock?returnTo=%2Fsettings')
    assert.equal((await f.request('/parent/unlock', { password: 'long-http-password', returnTo: '/settings' })).headers.get('location'), '/settings')
    await f.request('/parent/lock', { studentId: f.student })
    const scorePath = `/students/${f.student}/parent?section=school-results&subject=Science%20%26%20Space`
    assert.equal((await f.request(scorePath)).headers.get('location'), `/parent/unlock?returnTo=${encodeURIComponent(scorePath + '#school-results')}`)
    assert.equal((await f.request('/parent/unlock', { password: 'long-http-password', returnTo: scorePath + '#school-results' })).headers.get('location'), scorePath + '#school-results')
    const scorePage = (await f.request(scorePath)).headers.get('location')!
    assert.equal(scorePage, `/students/${f.student}/school?subject=Science+%26+Space#school-results`, 'the old section link opens the school results page')
    assert.match(await (await f.request(scorePage.split('#')[0])).text(), /name="subject" value="Science &amp; Space"/)
    await f.request('/parent/lock', { studentId: f.student })
    const hostedScore = `/students/${f.student}/parent?section=school-results&subject=Science`
    const routedScore = `${hostedScore}&path=${encodeURIComponent(`students/${f.student}/parent`)}`
    assert.equal((await f.request(routedScore)).headers.get('location'), `/parent/unlock?returnTo=${encodeURIComponent(hostedScore + '#school-results')}`)
    assert.equal((await f.request('/parent/unlock', { password: 'long-http-password', returnTo: routedScore + '#school-results' })).headers.get('location'), hostedScore + '#school-results')
    await f.request('/parent/lock', { studentId: f.student })
    assert.equal((await f.request('/parent/unlock', { password: 'long-http-password', returnTo: 'https://example.invalid' })).headers.get('location'), `/students/${f.student}/parent`)
    await f.request('/parent/lock', { studentId: f.student })
    assert.equal((await f.request('/parent/unlock', { password: 'long-http-password', returnTo: `/students/${crypto.randomUUID()}/parent` })).headers.get('location'), `/students/${f.student}/parent`)
  } finally { f.server.close(); f.db.close() }
})

test('parent planning errors and profile updates return to parent context', async () => {
  const f = await fixture()
  try {
    const failed = await f.request(`/students/${f.student}/talk`, { subject: 'Math', message: '' })
    assert.match(failed.headers.get('location')!, new RegExp(`/students/${f.student}/classes\\?talk=Math&error=`))
    const profile = await f.request(`/students/${f.student}/profile`, { birthDate: '2018-03-04', gradeHold: '0' })
    assert.equal(profile.headers.get('location'), `/students/${f.student}/classes`)
    const html = await (await f.request(`/students/${f.student}/classes?talk=new`)).text()
    assert.match(html,new RegExp(`data-progress-url="/students/${f.student}/progress"`))
    assert.match(html, /Add a class/); assert.match(html, /Next focus for this class/)
    assert.doesNotMatch(html, /Plan a class/); assert.doesNotMatch(html, /panel-update/)
    assert.match(html, /class="planner-drawer is-open"/); assert.match(html, />Add a class called <\/textarea>/)
    const change = await (await f.request(`/students/${f.student}/classes?talk=Math`)).text()
    assert.match(change, />Change the Math class: <\/textarea>/)
    assert.match(await (await f.request(`/students/${f.student}/parent?planner=open&say=Hello%20planner`)).text(), />Hello planner<\/textarea>/)
    assert.doesNotMatch(await (await f.request(`/students/${f.student}/parent`)).text(), /planner-drawer is-open/)
    await f.db.prepare("UPDATE users SET ai_provider = 'openai', ai_key = '' WHERE id = ?").run(f.owner)
    const named = await f.request(`/students/${f.student}/planner/message`, { title: 'Biology', message: 'Cells and energy.' })
    assert.equal(named.status, 200)
    const thread = await (await f.request(`/students/${f.student}/planner`)).text()
    assert.match(thread, /Add a class called Biology\. Cells and energy\./)
  } finally { f.server.close(); f.db.close() }
})
test('using school pages for learning is parent-only and preserves the source on validation failure', async () => {
  const f = await fixture()
  try {
    await f.request(`/students/${f.student}`)
    const saved = await (await f.request(`/students/${f.student}/materials`, { title: 'Synthetic sample test', subject: 'Math', kind: 'practice_exam', workState: 'blank', transcription: '1. Add two and two.' })).json()
    const material = saved.materialId
    const invalid = await f.request(`/materials/${material}/learning`, { purpose: 'test', testTitle: 'Math', testDate: '2099-02-30' })
    assert.equal(invalid.status, 400)
    assert.equal((await f.db.prepare('SELECT learning_version FROM materials WHERE id = ?').get(material))!.learning_version, 0)
    const started = await f.request(`/materials/${material}/learning`, { purpose: 'test', testTitle: 'Math', testDate: '2099-10-09' })
    assert.equal(started.status, 303); assert.match(started.headers.get('location')!, /^\/jobs\//)
    await f.request('/parent/lock', {})
    const denied = await f.request(`/materials/${material}/learning`, { purpose: 'learning' })
    assert.equal(denied.status, 403)
    assert.equal((await f.db.prepare('SELECT learning_purpose FROM materials WHERE id = ?').get(material))!.learning_purpose, 'test')
    const html = await (await f.request(`/materials/${material}`)).text()
    assert.ok(!html.includes('data-learning-source'))
  } finally { f.server.close(); f.db.close() }
})

test('teacher-result photo API preserves validation, retries, ownership and parent lock', async () => {
  const f = await fixture()
  try {
    const path = `/students/${f.student}/school-results`
    const input = { requestId: 'photo-result', title: 'Synthetic marked result', date: '2026-10-02', earned: 8, possible: 10, pages: [{ mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=' }] }
    assert.equal((await f.request(path, { ...input, earned: 11 })).status, 400)
    const saved = await f.request(path, input); assert.equal(saved.status, 201)
    const result = await saved.json() as any
    assert.equal(result.location, `/students/${f.student}/insights#school-results`)
    assert.equal((await (await f.request(path, input)).json() as any).resultId, result.resultId)
    const row = (await f.db.prepare('SELECT * FROM school_results WHERE id = ?').get(result.resultId))!
    const sibling = await createStudent(f.db, f.owner, { displayName: 'Synthetic sibling', grade: 4, sessionCapMinutes: 5 })
    assert.equal((await f.request(`/students/${sibling}/school-results`, { ...input, pages: [], materialId: row.material_id })).status, 400)
    assert.match(await (await f.request(result.location)).text(), /View marked pages/)
    await f.request('/parent/lock', { studentId: f.student })
    assert.equal((await f.request(path, { ...input, requestId: 'forged' })).status, 403)
    assert.equal((await f.db.prepare('SELECT count(*) n FROM school_results').get())!.n, 1)
    assert.equal((await f.db.prepare('SELECT count(*) n FROM attempts').get())!.n, 0)
  } finally { f.server.close(); f.db.close() }
})

test('the planner drawer renders only for unlocked parents on parent surfaces and answers without an AI', async () => {
  const f = await fixture()
  try {
    await f.db.prepare("UPDATE users SET ai_provider = 'openai', ai_key = '' WHERE id = ?").run(f.owner)
    const parent = await (await f.request(`/students/${f.student}/parent`)).text()
    assert.match(parent, /data-planner-drawer/); assert.match(parent, /planner-drawer\.js/); assert.match(parent, /class="week-note"/); assert.match(parent, new RegExp(`href="/students/${f.student}/controls"`)); assert.match(parent, new RegExp(`href="/students/${f.student}/note"`))
    assert.match(await (await f.request(`/students/${f.student}/controls`)).text(), /id="controls"/); assert.match(await (await f.request(`/students/${f.student}/note`)).text(), /id="note"/)
    assert.equal((parent.match(/<h1[\s>]/g) ?? []).length, 1)
    const session: any = await startTutorSession(f.db, f.owner, f.student, new Date(), { subject: 'Math' })
    const sessionPage = await (await f.request(`/session/${session.sessionId ?? session.id ?? session}`)).text()
    assert.doesNotMatch(sessionPage, /data-planner-drawer/)
    const fragment = await (await f.request(`/students/${f.student}/planner`)).text()
    assert.match(fragment, /data-planner-form/); assert.match(fragment, /Things you can ask/)
    const empty = await f.request(`/students/${f.student}/planner/message`, { message: '  ' })
    assert.equal(empty.status, 400)
    const answered = await f.request(`/students/${f.student}/planner/message`, { message: 'Make missions 15 minutes' })
    assert.equal(answered.status, 200)
    const result = await answered.json()
    assert.equal(result.ai.connected, false); assert.equal(result.proposal.intent, 'set_minutes_presentation')
    const missing = await f.request(`/students/${f.student}/planner/apply/${crypto.randomUUID()}`, {})
    assert.equal(missing.status, 404)
    const applied = await f.request(`/students/${f.student}/planner/apply/${result.messageId}`, {})
    assert.equal(applied.status, 200); assert.equal((await applied.json()).applied, true)
    const replaced = await f.request(`/students/${f.student}/planner/apply/${result.messageId}`, {})
    assert.equal(replaced.status, 200)
    const noteSaved = await f.request(`/students/${f.student}/note`, { text: 'Proud of you.' })
    assert.equal(noteSaved.status, 201)
    const home = await (await f.request(`/students/${f.student}`)).text()
    assert.match(home, /data-parent-note/); assert.match(home, /Proud of you\./)
    await f.request('/parent/lock', { studentId: f.student })
    const locked = await (await f.request(`/students/${f.student}`)).text()
    assert.doesNotMatch(locked, /data-planner-drawer/)
    assert.equal((await f.request(`/students/${f.student}/planner/message`, { message: 'Add a class' })).status, 403)
    assert.equal((await f.request(`/students/${f.student}/note`, { text: 'x' })).status, 403)
    const noteId = String((await f.db.prepare('SELECT id FROM parent_notes WHERE student_id = ? AND read_at IS NULL').get(f.student))?.id)
    const read = await f.request(`/students/${f.student}/note/read`, { id: noteId })
    assert.equal(read.status, 303)
    assert.doesNotMatch(await (await f.request(`/students/${f.student}`)).text(), /data-parent-note/)
  } finally { f.server.close(); f.db.close() }
})

test('undo, weekly digests and the cron route are parent-only and guarded', async () => {
  const f = await fixture()
  const savedSecret = process.env.CRON_SECRET
  try {
    await f.db.prepare("UPDATE users SET ai_provider = 'openai', ai_key = '' WHERE id = ?").run(f.owner)
    const sent = await (await f.request(`/students/${f.student}/planner/message`, { message: 'Make missions 15 minutes' })).json()
    const applied = await (await f.request(`/students/${f.student}/planner/apply/${sent.messageId}`, {})).json()
    const history = await (await f.request(`/students/${f.student}/history`)).text()
    assert.match(history, /Undo this change/)
    const undone = await f.request(`/students/${f.student}/undo`, { decisionId: applied.decisionId })
    assert.equal(undone.status, 200); assert.match((await undone.json()).message, /10 minutes/)
    const twice = await f.request(`/students/${f.student}/undo`, { decisionId: applied.decisionId })
    assert.equal(twice.status, 409)
    assert.match(await (await f.request(`/students/${f.student}/history`)).text(), /Undone/)
    const digests = await f.request('/family/digests')
    assert.equal(digests.status, 200); assert.match(await digests.text(), /The first digest arrives on Sunday/)
    delete process.env.CRON_SECRET
    assert.equal((await f.request('/cron/weekly-digest')).status, 404)
    process.env.CRON_SECRET = 'synthetic-cron-secret'
    assert.equal((await f.request('/cron/weekly-digest')).status, 401)
    await f.request('/parent/lock', { studentId: f.student })
    assert.equal((await f.request(`/students/${f.student}/undo`, { decisionId: applied.decisionId })).status, 403)
    assert.equal((await f.request('/family/digests')).status, 303)
  } finally {
    if (savedSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = savedSecret
    f.server.close(); f.db.close()
  }
})

test('learning packs: a child asks for themselves only, never sees keys, and parent actions stay parent-only', async () => {
  const f = await fixture()
  try {
    const sibling = await createStudent(f.db, f.owner, { displayName: 'Sibling fixture', grade: 4, sessionCapMinutes: 5 })
    const parentHome = await (await f.request(`/students/${f.student}/classes`)).text()
    assert.match(parentHome, /data-pack-ask/); assert.match(await (await f.request(`/students/${f.student}/controls`)).text(), /What Synthetic learner can ask for/)
    assert.equal((await f.request('/parent/lock', { studentId: f.student })).status, 303)
    const home = await (await f.request(`/students/${f.student}`)).text()
    assert.match(home, /What do you want to practise\?/); assert.match(home, /Show me the plan first/)
    const unsafe = await f.request(`/students/${f.student}/packs`, { message: 'how to hurt myself', requestId: crypto.randomUUID() })
    assert.equal(unsafe.status, 200); assert.equal((await unsafe.json()).kind, 'safety')
    assert.equal((await f.request(`/students/${sibling}/packs`, { message: 'times tables for 7', requestId: crypto.randomUUID() })).status, 403)
    const requestId = crypto.randomUUID()
    const asked = await f.request(`/students/${f.student}/packs`, { message: 'times tables for 7', requestId })
    assert.equal(asked.status, 202)
    const body = await asked.json()
    assert.equal(body.kind, 'pack'); assert.ok(body.jobId)
    const again = await f.request(`/students/${f.student}/packs`, { message: 'times tables for 7', requestId })
    assert.equal(again.status, 200); assert.equal((await again.json()).packId, body.packId)
    assert.match(await (await f.request(`/packs/${body.packId}`)).text(), /Making your practice/)
    // A held pack shows the child no questions or keys, and only a parent can release it.
    await f.db.prepare("UPDATE packs SET status = 'review', check_json = ? WHERE id = ?").run(JSON.stringify({ final: { interpretation: 'Sevens', lesson: { hook: 'h', steps: ['s'], workedExample: 'w', quickCheck: { question: 'q', answer: 'a' } }, skills: [{ title: 'Sevens', recall: 'r', example: 'e', nonExample: 'n', items: [{ prompt: 'What is 7 x 8?', answer: '56', format: 'number', choices: null, work: '7*8', hints: ['a', 'b', 'c'], explanation: 'Seven eights.', bloom: 1 }] }] }, qa: { published: 1 }, dropped: [] }), body.packId)
    const childView = await (await f.request(`/packs/${body.packId}`)).text()
    assert.match(childView, /A grown-up checks new practice/); assert.doesNotMatch(childView, /7 x 8|Answer:/)
    assert.equal((await f.request(`/packs/${body.packId}/publish`, {})).status, 403)
    assert.equal((await f.request(`/packs/${body.packId}/undo`, {})).status, 403)
    assert.equal((await f.request(`/students/${f.student}/pack-settings`, { requests: 'any' })).status, 403)
    await f.request('/parent/unlock', { password: 'long-http-password' })
    const parentView = await (await f.request(`/packs/${body.packId}`)).text()
    assert.match(parentView, /What is 7 x 8\?/); assert.match(parentView, /Use this practice/)
    assert.equal((await f.request(`/students/${f.student}/pack-settings`, { requests: 'off', approval: 'parent', dailyLimit: '2' })).status, 303)
    await f.request('/parent/lock', { studentId: f.student })
    assert.doesNotMatch(await (await f.request(`/students/${f.student}`)).text(), /data-pack-ask/)
    assert.equal((await f.request(`/students/${f.student}/packs`, { message: 'division', requestId: crypto.randomUUID() })).status, 403)
  } finally { f.server.close(); f.db.close() }
})

test('privacy notice, terms and the source link are public and name the operator', async () => {
  const f = await fixture(), previous = process.env.TUTOR_OPERATOR_NAME
  try {
    process.env.TUTOR_OPERATOR_NAME = 'Synthetic Operator'
    const anonymous = (path: string) => fetch(`http://127.0.0.1:${(f.server.address() as any).port}${path}`, { redirect: 'manual' })
    const privacy = await anonymous('/privacy'), terms = await anonymous('/terms'), home = await anonymous('/')
    assert.equal(privacy.status, 200); assert.equal(terms.status, 200)
    const text = await privacy.text()
    assert.match(text, /Synthetic Operator/); assert.match(text, /AI provider you choose/)
    assert.match(await terms.text(), /GNU Affero General Public License/)
    const page = await home.text()
    assert.match(page, /href="\/privacy"/); assert.match(page, /Source code/)
  } finally { if (previous === undefined) delete process.env.TUTOR_OPERATOR_NAME; else process.env.TUTOR_OPERATOR_NAME = previous; f.server.close(); f.db.close() }
})
