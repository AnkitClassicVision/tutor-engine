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
test('read-aloud and spoken answers are recorded as access support, apart from help, without changing scoring', async () => {
  const f = await fixture()
  try {
    const { loadAttempts, submitAnswer } = await import('../src/services.ts')
    const session = (await startTutorSession(f.db, f.owner, f.student, new Date(), { focusConceptId: 'math.primary.3.multiply' }))
    // Answer the written questions first, so a short-answer question is the current one.
    const items = await f.db.prepare('SELECT id, answer FROM session_items WHERE session_id = ? AND answered = 0 ORDER BY position').all(session) as Array<{ id: string; answer: string }>
    const short = items.findIndex(i => !/^rubric:/i.test(String(i.answer)))
    assert.ok(short >= 0, 'the mission has a short-answer question')
    for (const before of items.slice(0, short)) await submitAnswer(f.db, f.owner, session, { itemId: before.id, answer: 'my words' })
    const item = items[short]
    for (const kind of ['read_aloud', 'read_aloud', 'voice_entry']) assert.equal((await f.request(`/session/${session}/access`, { itemId: item.id, kind })).status, 200)
    assert.equal((await f.db.prepare('SELECT access_support FROM session_items WHERE id = ?').get(item.id))!.access_support, 'read_aloud,voice_entry')
    assert.equal((await f.request(`/session/${session}/access`, { itemId: item.id, kind: 'hint' })).status, 400)
    // The child can record it from student mode.
    assert.equal((await f.request('/parent/lock', { studentId: f.student })).status, 303)
    assert.equal((await f.request(`/session/${session}/access`, { itemId: item.id, kind: 'read_aloud' })).status, 200)
    await submitAnswer(f.db, f.owner, session, { itemId: String(item.id), answer: String(item.answer) })
    const attempt = (await loadAttempts(f.db, f.student)).find(a => a.attemptId === item.id)
    assert.ok(attempt); assert.deepEqual(attempt!.accessSupport, ['read_aloud', 'voice_entry'])
    assert.equal(attempt!.supportUsed, 'none', 'access support is not teaching help')
    assert.equal((await f.request(`/session/${session}/access`, { itemId: item.id, kind: 'read_aloud' })).status, 400, 'an answered question takes no more support')
  } finally { f.server.close(); f.db.close() }
})
test('what the learner saw is timed in the browser, and paused time is kept apart from the start', async () => {
  const f = await fixture()
  try {
    const { pauseSession, resumeSession } = await import('../src/services.ts')
    const session = (await startTutorSession(f.db, f.owner, f.student, new Date(), { focusConceptId: 'math.primary.3.multiply' }))
    const row = () => f.db.prepare('SELECT started_at, requested_at, paused_ms FROM tutor_sessions WHERE id = ?').get(session)!
    const start = row()
    assert.equal(start.requested_at, start.started_at); assert.equal(Number(start.paused_ms), 0)
    const item = (await f.db.prepare('SELECT id FROM session_items WHERE session_id = ? AND answered = 0 ORDER BY position LIMIT 1').get(session))!
    assert.equal((await f.request(`/session/${session}/seen`, { itemId: item.id, what: 'question' })).status, 200)
    const seen = f.db.prepare('SELECT visible_at FROM session_items WHERE id = ?').get(item.id)!.visible_at
    assert.ok(seen)
    await f.request(`/session/${session}/seen`, { itemId: item.id, what: 'question' })
    assert.equal(f.db.prepare('SELECT visible_at FROM session_items WHERE id = ?').get(item.id)!.visible_at, seen, 'only the first time counts')
    await f.request(`/session/${session}/seen`, { itemId: item.id, what: 'feedback' })
    assert.equal(f.db.prepare('SELECT feedback_visible_at FROM session_items WHERE id = ?').get(item.id)!.feedback_visible_at, null, 'no feedback before an answer')
    assert.equal((await f.request(`/session/${session}/seen`, { itemId: item.id, what: 'other' })).status, 400)
    // A pause moves the cap's clock but not the original request time; the pause is recorded on its own.
    await pauseSession(f.db, f.owner, session)
    f.db.prepare('UPDATE tutor_sessions SET paused_at = ? WHERE id = ?').run(new Date(Date.now() - 60_000).toISOString(), session)
    await resumeSession(f.db, f.owner, session)
    const after = row()
    assert.equal(after.requested_at, start.requested_at)
    assert.ok(Number(after.paused_ms) >= 59_000, String(after.paused_ms))
    assert.ok(Date.parse(String(after.started_at)) > Date.parse(String(start.started_at)))
  } finally { f.server.close(); f.db.close() }
})
test('a repeated send of the same question to the tutor creates one message and one job', async () => {
  const f = await fixture()
  try {
    const session = (await startTutorSession(f.db, f.owner, f.student, new Date(), { focusConceptId: 'math.primary.3.multiply' }))
    const sendId = crypto.randomUUID()
    const first = await f.request(`/session/${session}/ask`, { message: 'Why does this work?', sendId })
    const again = await f.request(`/session/${session}/ask`, { message: 'Why does this work?', sendId })
    assert.equal(first.status, again.status); assert.equal(first.headers.get('location'), again.headers.get('location'))
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM lesson_messages WHERE session_id = ? AND role = 'student'").get(session)!.n, 1)
    // A new question gets its own send.
    await f.request(`/session/${session}/ask`, { message: 'And this one?', sendId: crypto.randomUUID() })
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM lesson_messages WHERE session_id = ? AND role = 'student'").get(session)!.n, 2)
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

test('WF-05: help starts only after the child checks or fixes the question; the original reading is kept', async () => {
  const f = await fixture()
  try {
    const material = crypto.randomUUID()
    f.db.prepare(`INSERT INTO materials (id, student_id, kind, title, subject, work_state, revision, created_at) VALUES (?, ?, 'homework', 'Synthetic homework', 'Math', 'partial', 1, ?)`).run(material, f.student, new Date().toISOString())
    const question = (prompt: string, readable = 1, confidence = 0.95) => { const id = crypto.randomUUID(); f.db.prepare(`INSERT INTO material_questions (id, material_id, revision, number, prompt, readable, confidence) VALUES (?, ?, 1, ?, ?, ?, ?)`).run(id, material, String(Math.random()).slice(2, 4), prompt, readable, confidence); return id }
    // Realistic values: the reader marks a question readable only at 0.8 or above.
    const clear = question('What is 2 + 2?'), fraction = question('Sam ate 1/2 of a pizza. How much is left?', 0, 0.6), unreadable = question('', 0, 0.1), close = question('Write 0.25 as a fraction.', 1, 0.85)
    const tutorLines = (id: string) => Number(f.db.prepare("SELECT count(*) AS n FROM guided_attempts WHERE question_id = ?").get(id)!.n)
    // 1. Clear question: the reading is shown; no tutor message exists before Yes.
    const page = await (await f.request(`/questions/${clear}/help`)).text()
    assert.match(page, /Is this the question\?/); assert.match(page, /What is 2 \+ 2\?/); assert.doesNotMatch(page, /might have read this wrong/)
    assert.equal(tutorLines(clear), 0)
    assert.equal((await f.request(`/questions/${clear}/help`, { message: 'skip ahead' })).status, 400, 'help cannot start before Yes')
    // 5. Repeated Yes: one confirmation, one opening message.
    for (let i = 0; i < 2; i++) assert.equal((await f.request(`/questions/${clear}/confirm`, { choice: 'yes' })).status, 303)
    assert.match(await (await f.request(`/questions/${clear}/help`)).text(), /One thinking step at a time/)
    await f.request(`/questions/${clear}/help`)
    assert.equal(tutorLines(clear), 1)
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM decision_records WHERE student_id = ? AND kind = 'homework_question_confirmed'").get(f.student)!.n, 1)
    // 2. Ambiguous fraction (too uncertain to use alone): shown pre-filled with a warning; the child's fix is used and the original kept.
    const unsurePage = await (await f.request(`/questions/${fraction}/help`)).text()
    assert.match(unsurePage, /might have read this wrong/); assert.match(unsurePage, /<textarea[^>]*>Sam ate 1\/2 of a pizza/)
    assert.match(await (await f.request(`/questions/${close}/help`)).text(), /might have read this wrong\. Check the numbers/, 'a usable but close reading also warns')
    assert.match(await (await f.request(`/questions/${close}/help?fix=1`)).text(), /Change anything I got wrong/)
    await f.request(`/questions/${fraction}/confirm`, { choice: 'fix', prompt: 'Sam ate 1/3 of a pizza. How much is left?' })
    const fixed = f.db.prepare('SELECT prompt, child_prompt FROM material_questions WHERE id = ?').get(fraction)!
    assert.equal(fixed.prompt, 'Sam ate 1/2 of a pizza. How much is left?')
    assert.match(String(fixed.child_prompt), /1\/3/)
    assert.match(await (await f.request(`/questions/${fraction}/help`)).text(), /Sam ate 1\/3 of a pizza/)
    // Accepting an uncertain reading unchanged is a check, not a fix.
    const accepted = question('Write 3/4 as a decimal.', 0, 0.7)
    await f.request(`/questions/${accepted}/confirm`, { choice: 'fix', prompt: 'Write 3/4 as a decimal.' })
    assert.match(await (await f.request(`/questions/${accepted}/help`)).text(), /Write 3\/4 as a decimal/)
    // Help that began before this check existed is not credited to anyone.
    const legacy = question('What is 10 - 3?')
    f.db.prepare('UPDATE material_questions SET confirmed_revision = revision WHERE id = ?').run(legacy)
    // Once help has begun, the question cannot be changed underneath it.
    await f.request(`/questions/${fraction}/confirm`, { choice: 'fix', prompt: 'Something else entirely' })
    assert.match(await (await f.request(`/questions/${fraction}/help`)).text(), /Sam ate 1\/3 of a pizza/)
    // 3. Several questions: confirming one does not confirm another.
    assert.match(await (await f.request(`/questions/${unreadable}/help`)).text(), /I couldn’t read this one/)
    // 4. Unreadable: the child types it, and help starts; nothing is graded.
    await f.request(`/questions/${unreadable}/confirm`, { choice: 'fix', prompt: 'What is 7 x 8?' })
    assert.match(await (await f.request(`/questions/${unreadable}/help`)).text(), /What is 7 x 8\?/)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM homework_reviews WHERE question_id = ?').get(unreadable)!.n, 0)
    // The material page shows the child's version, and the parent sees the original reading.
    const materialPage = await (await f.request(`/materials/${material}`)).text()
    // These checks were made in parent mode, so they are labelled as the parent's, never the child's.
    assert.match(materialPage, /Fixed by a parent/); assert.match(materialPage, /Checked by a parent/);
    assert.equal((materialPage.match(/data-confirm="fixed"/g) ?? []).length, 2, 'two real fixes; the unchanged uncertain reading is a check')
    assert.equal((materialPage.match(/data-confirm="yes"/g) ?? []).length, 2, 'two checks; the legacy question has no tag'); assert.doesNotMatch(materialPage, /by Synthetic learner/); assert.match(materialPage, /What the photo reading said/)
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM decision_records WHERE student_id = ? AND reason LIKE 'A parent%' AND kind LIKE 'homework_question_%'").get(f.student)!.n, 4)
    // 6. A new reading of the page asks again.
    f.db.prepare('UPDATE materials SET revision = 2 WHERE id = ?').run(material); f.db.prepare('UPDATE material_questions SET revision = 2 WHERE material_id = ?').run(material)
    assert.match(await (await f.request(`/questions/${clear}/help`)).text(), /Is this the question\?/)
    // 10. Ages 5–7: one short question with Hear this, and no extra photo link on the screen.
    f.db.prepare("UPDATE students SET presentation = '5-7' WHERE id = ?").run(f.student)
    const young = await (await f.request(`/questions/${clear}/help`)).text()
    assert.match(young, /Is this it\?/); assert.match(young, /Hear this/); assert.match(young, /No, fix it/); assert.doesNotMatch(young, /Take another photo/)
    // 7. Another family cannot confirm it, and a child in student mode can.
    const other = await registerUser(f.db, 'other-wf05@example.com', 'long-http-password'); if (!other.ok) throw new Error()
    const { confirmQuestion } = await import('../src/schoolwork.ts')
    await assert.rejects(confirmQuestion(f.db, other.userId, clear, 'yes'), /not found/i)
    const sibling = await createStudent(f.db, f.owner, { displayName: 'Sibling fixture', grade: 4, sessionCapMinutes: 5 })
    const theirs = crypto.randomUUID(), theirQuestion = crypto.randomUUID()
    f.db.prepare(`INSERT INTO materials (id, student_id, kind, title, subject, work_state, revision, created_at) VALUES (?, ?, 'homework', 'Sibling homework', 'Math', 'partial', 1, ?)`).run(theirs, sibling, new Date().toISOString())
    f.db.prepare(`INSERT INTO material_questions (id, material_id, revision, number, prompt, readable, confidence) VALUES (?, ?, 1, '1', 'What is 9 - 4?', 1, 0.95)`).run(theirQuestion, theirs)
    assert.equal((await f.request('/parent/lock', { studentId: f.student })).status, 303)
    assert.equal((await f.request(`/questions/${theirQuestion}/confirm`, { choice: 'yes' })).status, 403, 'a sibling question is out of reach in student mode')
    assert.equal((await f.request(`/questions/${clear}/confirm`, { choice: 'yes' })).status, 303)
    assert.equal((await f.request(`/questions/${clear}/confirm`, { choice: 'maybe' })).status, 400)
    // In student mode the check is the child's own.
    await f.request(`/questions/${close}/confirm`, { choice: 'yes' })
    assert.equal(f.db.prepare('SELECT confirmed_by FROM material_questions WHERE id = ?').get(close)!.confirmed_by, f.student)
  } finally { f.server.close(); f.db.close() }
})
