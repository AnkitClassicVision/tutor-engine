import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDb } from '../src/db.ts'
import { registerUser, openAuthSession, hashToken } from '../src/auth.ts'
import { createStudent, saveAiSettings, aiConfigFor, aiSettings, aiConnectionProblem, isAiConnectionError } from '../src/services.ts'
import { handle } from '../src/server.ts'
import { decryptSecret, encryptSecret } from '../src/secrets.ts'
import { askModel, askPhoto } from '../src/ai.ts'
import { ChatGptError, chatgptAccessToken, chatgptConfig } from '../src/chatgpt.ts'
import { startOpenAiFixture, type OpenAiFixture, type ResponsesScenario } from './chatgpt-fixture.ts'
import { writeFileSync } from 'node:fs'

process.env.TUTOR_SECRET_DIR = mkdtempSync(join(tmpdir(), 'tutor-chatgpt-secrets-'))
const ENV = ['TUTOR_CHATGPT_CLIENT_ID', 'TUTOR_CHATGPT_CLIENT_SECRET', 'TUTOR_CHATGPT_ISSUER', 'TUTOR_CHATGPT_API_BASE', 'TUTOR_CHATGPT_LOCAL', 'TUTOR_ORIGIN', 'TUTOR_PUBLIC', 'TUTOR_CHATGPT_REDIRECT_URI', 'TUTOR_PORT']
const quietly = async <T>(work: () => Promise<T>) => { const error = console.error; console.error = () => {}; try { return await work() } finally { console.error = error } }

async function app(options: { clientSecret?: string; enabled?: boolean } = {}) {
  const saved = Object.fromEntries(ENV.map(name => [name, process.env[name]]))
  for (const name of ENV) delete process.env[name]
  const dir = mkdtempSync(join(tmpdir(), 'tutor-chatgpt-')), db = openDb(join(dir, 'test.sqlite'))
  const user = await registerUser(db, 'chatgpt@example.com', 'long-chatgpt-password'); if (!user.ok) throw new Error()
  const auth = await openAuthSession(db, user.userId)
  const student = await createStudent(db, user.userId, { displayName: 'Synthetic learner', grade: 3, sessionCapMinutes: 10 })
  const server = createServer((req, res) => { handle(req, res, { db, uploadsDir: join(dir, 'uploads') }).catch(() => { res.writeHead(500); res.end() }) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); if (!address || typeof address === 'string') throw new Error()
  const origin = `http://127.0.0.1:${address.port}`
  const openai: OpenAiFixture = await startOpenAiFixture({ clientSecret: options.clientSecret })
  process.env.TUTOR_ORIGIN = origin
  if (options.enabled !== false) {
    process.env.TUTOR_CHATGPT_CLIENT_ID = 'oaiapp_synthetic'
    process.env.TUTOR_CHATGPT_ISSUER = openai.issuer
    process.env.TUTOR_CHATGPT_API_BASE = openai.apiBase
    if (options.clientSecret) process.env.TUTOR_CHATGPT_CLIENT_SECRET = options.clientSecret
  }
  const request = (path: string, data?: any, token = auth.token, csrf = auth.csrf) => fetch(`${origin}${path}`, { redirect: 'manual', method: data ? 'POST' : 'GET',
    headers: { Cookie: `tutor_session=${token}`, ...(data ? { 'Content-Type': 'application/json', Accept: 'application/json' } : {}) }, body: data ? JSON.stringify({ csrf, ...data }) : undefined })
  const row = async () => (await db.prepare('SELECT ai_provider, ai_model, photo_model, ai_key FROM users WHERE id = ?').get(user.userId))!
  // Start a sign-in, let the fake OpenAI issue a code for exactly what was requested, and return the callback path.
  const authorize = async (overrides: Partial<{ scope: string; sub: string }> = {}) => {
    const started = await request('/connections/chatgpt', {})
    assert.equal(started.status, 303)
    const target = new URL(started.headers.get('location')!)
    const code = openai.issueCode({ clientId: target.searchParams.get('client_id')!, redirectUri: target.searchParams.get('redirect_uri')!, codeChallenge: target.searchParams.get('code_challenge')!, nonce: target.searchParams.get('nonce')!, ...overrides })
    return { target, callback: `/connections/chatgpt/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(target.searchParams.get('state')!)}` }
  }
  const close = async () => {
    server.close(); db.close(); await openai.close()
    for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value
  }
  return { db, owner: user.userId, auth, student, origin, openai, request, row, authorize, close }
}

test('the connection stays hidden and unreachable until the issued client is configured', async () => {
  const f = await app({ enabled: false })
  try {
    assert.equal(chatgptConfig(), null)
    const policy = (await f.request('/settings')).headers.get('content-security-policy')!
    assert.match(policy, /form-action 'self' https:\/\/openrouter\.ai https:\/\/auth\.openai\.com[;\s]/, 'browsers may follow a connect redirect to the provider sign-in')
    const page = await (await f.request('/settings')).text()
    assert.doesNotMatch(page, /Continue with ChatGPT/)
    assert.match(page, /Hosted ChatGPT subscription connection awaits approval/)
    assert.equal((await f.request('/connections/chatgpt', {})).status, 404)
    assert.equal((await f.request('/connections/chatgpt/callback?state=x&code=y')).status, 404)
    assert.equal((await f.request('/connections/chatgpt/welcome', {})).status, 404)
    assert.equal(f.openai.tokenRequests.length, 0)
    await assert.rejects(saveAiSettings(f.db, f.owner, { provider: 'chatgpt', model: 'x', apiKey: '' }), /Continue with ChatGPT/)
    process.env.TUTOR_CHATGPT_LOCAL = '1'; process.env.TUTOR_PUBLIC = '1'
    assert.equal(chatgptConfig(), null, 'public mode never offers dynamic registration')
    delete process.env.TUTOR_PUBLIC
    assert.equal(chatgptConfig()?.mode, 'local')
    assert.match(chatgptConfig()!.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/)
    process.env.TUTOR_PORT = '8789'; process.env.TUTOR_ORIGIN = 'https://device.example.ts.net:9443'
    assert.equal(chatgptConfig()!.redirectUri, 'http://127.0.0.1:8789/auth/callback', 'a private HTTPS address keeps the loopback callback on the listening port')
  } finally { await f.close() }
})

test('a parent connects with a one-use, session-bound PKCE transaction and verified identity', async () => {
  const f = await app()
  try {
    const { target, callback } = await f.authorize()
    assert.equal(target.origin + target.pathname, `${f.openai.issuer}/api/accounts/authorize`)
    assert.equal(target.searchParams.get('client_id'), 'oaiapp_synthetic')
    assert.equal(target.searchParams.get('redirect_uri'), `${f.origin}/connections/chatgpt/callback`)
    assert.equal(target.searchParams.get('response_type'), 'code')
    assert.equal(target.searchParams.get('resource'), 'https://api.openai.com/v1')
    assert.equal(target.searchParams.get('code_challenge_method'), 'S256')
    assert.match(target.searchParams.get('scope')!, /\bchatgpt\.tokens\.use\.direct\b/)
    const state = target.searchParams.get('state')!
    const saved = (await f.db.prepare('SELECT * FROM oauth_states WHERE state_hash = ?').get(hashToken(state)))!
    assert.equal(saved.provider, 'chatgpt'); assert.match(String(saved.verifier), /^enc:v2:/)
    assert.ok(Date.parse(String(saved.expires_at)) - Date.now() <= 10 * 60000)
    assert.equal((await f.request('/connections/chatgpt/callback?state=forged&code=bad')).status, 400)
    assert.equal(f.openai.tokenRequests.length, 0, 'a forged state never reaches the token endpoint')
    const other = await openAuthSession(f.db, f.owner)
    assert.equal((await f.request(callback, undefined, other.token)).status, 400, 'another parent session cannot complete it')
    const done = await f.request(callback)
    assert.equal(done.status, 303); assert.match(done.headers.get('location')!, /notice=ChatGPT%20connected/)
    assert.equal((await f.request(callback)).status, 400, 'a state is consumed once')
    assert.equal(f.openai.tokenRequests.length, 1)
    const exchange = f.openai.tokenRequests[0].form
    assert.equal(exchange.grant_type, 'authorization_code'); assert.equal(exchange.client_id, 'oaiapp_synthetic')
    assert.equal(exchange.redirect_uri, `${f.origin}/connections/chatgpt/callback`); assert.equal(exchange.resource, 'https://api.openai.com/v1')
    assert.equal(exchange.code_verifier, decryptSecret(String(saved.verifier)))
    const stored = await f.row()
    assert.equal(stored.ai_provider, 'chatgpt'); assert.equal(stored.ai_model, 'gpt-synthetic-a'); assert.equal(stored.photo_model, 'gpt-synthetic-a')
    assert.match(String(stored.ai_key), /^enc:v2:/)
    const credential = JSON.parse(decryptSecret(String(stored.ai_key)))
    assert.equal(credential.clientId, 'oaiapp_synthetic'); assert.equal(credential.sub, 'user-synthetic-1'); assert.equal(credential.idToken, '')
    const page = await (await f.request('/settings')).text()
    assert.match(page, /Using ChatGPT plan/); assert.match(page, /href="https:\/\/chatgpt\.com\/settings\/usage"/)
    assert.match(page, /You're using your ChatGPT plan/); assert.match(page, /Got it/)
    assert.match(page, /<option value="gpt-synthetic-b"/); assert.doesNotMatch(page, /hidden-model|gpt-synthetic-hidden/)
    for (const secret of [credential.accessToken, credential.refreshToken]) assert.ok(!page.includes(secret), 'tokens never reach the browser')
    assert.equal((await f.request('/connections/chatgpt/welcome', {})).status, 303)
    assert.doesNotMatch(await (await f.request('/settings')).text(), /You're using your ChatGPT plan/)
    assert.equal((await f.request('/connections/chatgpt/models', { model: 'gpt-synthetic-b', photoModel: 'not-offered' })).status, 303)
    assert.equal((await f.row()).ai_model, 'gpt-synthetic-b'); assert.equal((await f.row()).photo_model, 'gpt-synthetic-b')
    await f.request('/connections/chatgpt/models', { model: 'not-offered' })
    assert.equal((await f.row()).ai_model, 'gpt-synthetic-b', 'only offered models are accepted')
  } finally { await f.close() }
})

test('a confidential client authenticates only with HTTP Basic', async () => {
  const f = await app({ clientSecret: 'synthetic-secret' })
  try {
    const { callback } = await f.authorize()
    assert.equal((await f.request(callback)).status, 303)
    const exchange = f.openai.tokenRequests[0]
    assert.equal(exchange.authorization, `Basic ${Buffer.from('oaiapp_synthetic:synthetic-secret').toString('base64')}`)
    assert.equal(exchange.form.client_secret, undefined)
    assert.equal((await f.row()).ai_provider, 'chatgpt')
  } finally { await f.close() }
})

test('invalid identity, a declined grant or missing plan permission leaves the existing connection unchanged', async () => {
  const f = await app()
  try {
    await saveAiSettings(f.db, f.owner, { provider: 'openrouter', model: 'kept/text', photoModel: 'kept/photo', apiKey: 'kept-key' })
    const before = await f.row()
    const cases: Array<[string, Record<string, unknown>]> = [['issuer', { iss: 'https://evil.example' }], ['audience', { aud: 'oaiapp_other' }], ['nonce', { nonce: 'replayed' }], ['expiry', { expired: true }], ['signature', { wrongKey: true }], ['subject', { omitSub: true }]]
    for (const [name, overrides] of cases) {
      f.openai.idTokenOverrides = overrides
      const { callback } = await f.authorize()
      const result = await quietly(() => f.request(callback))
      assert.equal(result.status, 303, name); assert.match(result.headers.get('location')!, /error=/, name)
      assert.deepEqual(await f.row(), before, `${name} failure saves nothing`)
    }
    f.openai.idTokenOverrides = {}
    const scopeless = await f.authorize({ scope: 'openid profile email offline_access' })
    assert.match((await f.request(scopeless.callback)).headers.get('location')!, /plan%20use%20was%20not%20allowed/)
    assert.equal(f.openai.revocations.length, 1, 'tokens from a grant without plan use are revoked at once')
    assert.deepEqual(await f.row(), before)
    const exchanges = f.openai.tokenRequests.length
    const denied = await f.authorize()
    const deniedPath = denied.callback.replace(/code=[^&]+/, 'error=access_denied')
    assert.match((await f.request(deniedPath)).headers.get('location')!, /not%20approved/)
    assert.equal(f.openai.tokenRequests.length, exchanges, 'a declined grant is never exchanged')
    assert.deepEqual(await f.row(), before)
  } finally { await f.close() }
})

test('requests use the Responses API plan-usage contract for text and photos', async () => {
  const f = await app()
  try {
    assert.equal((await f.request((await f.authorize()).callback)).status, 303)
    const ai = await aiConfigFor(f.db, f.owner)
    assert.equal(ai.provider, 'chatgpt')
    const prompt = join(process.env.TUTOR_SECRET_DIR!, 'prompt.txt'); writeFileSync(prompt, 'Synthetic question')
    const raw = await askModel(prompt, '{}', 'Synthetic system', 10000, ai, { maxTokens: 50 })
    assert.deepEqual(JSON.parse(raw).structuredOutput, { reply: 'Synthetic answer' })
    const sent = f.openai.responsesRequests.at(-1)!
    assert.match(String(sent.authorization), /^Bearer /)
    assert.equal(sent.body.store, false); assert.equal(sent.body.stream, true); assert.equal(sent.body.model, 'gpt-synthetic-a')
    assert.match(sent.body.instructions, /Synthetic system/); assert.ok(Array.isArray(sent.body.input))
    assert.equal(sent.body.input.some((item: any) => item.role === 'system'), false)
    for (const field of ['background', 'conversation', 'max_output_tokens', 'max_tool_calls', 'metadata', 'moderation', 'prompt', 'safety_identifier', 'temperature', 'top_p', 'truncation', 'user', 'previous_response_id', 'tools'])
      assert.equal(field in sent.body, false, `${field} is not sent`)
    assert.deepEqual(await askPhoto(ai, 'Read it', 'What does this page say?', 'image/png', 'iVBORw0KGgo='), { reply: 'Synthetic answer' })
    const photo = f.openai.responsesRequests.at(-1)!.body.input[0].content
    assert.deepEqual(photo.map((part: any) => part.type), ['input_text', 'input_image'])
    assert.equal(photo[1].image_url, 'data:image/png;base64,iVBORw0KGgo=')
    const expected: Array<[ResponsesScenario, string]> = [['limit_prestream', 'limit'], ['detail_401', 'reconnect'], ['not_eligible', 'not_eligible'], ['unavailable_503', 'temporary'], ['unsupported_400', 'unsupported'], ['failed_midstream', 'limit'], ['incomplete', 'temporary'], ['truncated', 'temporary']]
    for (const [scenario, kind] of expected) {
      f.openai.scenario = scenario
      const error = await quietly(() => askModel(prompt, '{}', 'Synthetic system', 10000, ai).then(() => null, (e: unknown) => e))
      assert.ok(error instanceof ChatGptError, scenario); assert.equal(error.kind, kind, scenario)
    }
    f.openai.scenario = 'detail_401'
    await quietly(() => askModel(prompt, '{}', 'Synthetic system', 10000, ai).catch(() => {}))
    const refreshes = f.openai.refreshCount
    f.openai.scenario = 'ok'
    const fresh = await aiConfigFor(f.db, f.owner)
    assert.equal(f.openai.refreshCount, refreshes + 1, 'a rejected token is refreshed instead of reused')
    assert.notEqual(fresh.apiKey, ai.apiKey)
    const realFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'subscription_sharing_user_not_eligible' }), { status: 403 })
    try {
      const error = await quietly(() => askModel(prompt, '{}', 'Synthetic system', 10000, fresh).then(() => null, (e: unknown) => e))
      assert.ok(error instanceof ChatGptError); assert.equal(error.kind, 'not_eligible', 'a documented code in {detail} is honoured')
    } finally { globalThis.fetch = realFetch }
    assert.equal(isAiConnectionError(new ChatGptError('reconnect')), true)
    assert.equal(isAiConnectionError(new ChatGptError('limit')), false)
  } finally { await f.close() }
})

test('tokens refresh once per family across concurrent requests and recover from unusable grants', async () => {
  const f = await app()
  try {
    f.openai.accessTokenTtl = 60
    assert.equal((await f.request((await f.authorize()).callback)).status, 303)
    const first = JSON.parse(decryptSecret(String((await f.row()).ai_key)))
    assert.equal(await chatgptAccessToken(f.db, f.owner), first.accessToken, 'a short-lived token is used until its refresh point')
    assert.equal(f.openai.refreshCount, 0)
    const expire = async () => {
      const value = JSON.parse(decryptSecret(String((await f.row()).ai_key)))
      await f.db.prepare('UPDATE users SET ai_key = ? WHERE id = ?').run(encryptSecret(JSON.stringify({ ...value, refreshAt: Date.now() - 1000, expiresAt: Date.now() + 1000 })), f.owner)
    }
    await expire()
    f.openai.refreshDelayMs = 300
    const [a, b, c] = await Promise.all([chatgptAccessToken(f.db, f.owner), chatgptAccessToken(f.db, f.owner), chatgptAccessToken(f.db, f.owner)])
    assert.equal(f.openai.refreshCount, 1, 'one refresh serves every waiting request')
    assert.equal(a, b); assert.equal(b, c); assert.notEqual(a, first.accessToken)
    assert.equal(await chatgptAccessToken(f.db, f.owner), a); assert.equal(f.openai.refreshCount, 1, 'the refreshed 60-second token is not refreshed again at once')
    const refreshed = JSON.parse(decryptSecret(String((await f.row()).ai_key)))
    assert.notEqual(refreshed.refreshToken, first.refreshToken, 'the rotated refresh token replaces the old one')
    const refresh = f.openai.tokenRequests.at(-1)!.form
    assert.equal(refresh.grant_type, 'refresh_token'); assert.equal(refresh.client_id, 'oaiapp_synthetic'); assert.equal(refresh.resource, 'https://api.openai.com/v1'); assert.equal(refresh.scope, undefined)
    f.openai.refreshDelayMs = 0
    f.openai.refreshError = 'server_error'
    await expire()
    await quietly(() => assert.rejects(chatgptAccessToken(f.db, f.owner), (e: any) => e instanceof ChatGptError && e.kind === 'temporary'))
    assert.equal(JSON.parse(decryptSecret(String((await f.row()).ai_key))).refreshToken, refreshed.refreshToken, 'a temporary failure keeps credentials')
    f.openai.refreshError = 'invalid_grant'
    await quietly(() => assert.rejects(chatgptAccessToken(f.db, f.owner), (e: any) => e instanceof ChatGptError && e.kind === 'reconnect'))
    const cleared = JSON.parse(decryptSecret(String((await f.row()).ai_key)))
    assert.equal(cleared.reconnect, true); assert.equal(cleared.accessToken, ''); assert.equal(cleared.refreshToken, '')
    assert.match(aiConnectionProblem(await aiSettings(f.db, f.owner)), /connected again/)
    const reconnectPage = await (await f.request('/settings')).text()
    assert.match(reconnectPage, /ChatGPT needs to be connected again/)
    assert.doesNotMatch(reconnectPage, /Using ChatGPT plan/, 'a refused refresh no longer claims the plan is in use')
    f.openai.refreshError = null
    assert.equal((await f.request((await f.authorize()).callback)).status, 303, 'the parent can reconnect')
    assert.equal(aiConnectionProblem(await aiSettings(f.db, f.owner)), '')
  } finally { await f.close() }
})

test('disconnect revokes the renewable session and clears tokens even when revocation is unconfirmed', async () => {
  const f = await app()
  try {
    assert.equal((await f.request((await f.authorize()).callback)).status, 303)
    const credential = JSON.parse(decryptSecret(String((await f.row()).ai_key)))
    const done = await f.request('/connections/disconnect', {})
    assert.equal(done.headers.get('location'), '/settings?notice=Disconnected')
    assert.deepEqual(f.openai.revocations.at(-1), { token: credential.refreshToken, token_type_hint: 'refresh_token', client_id: 'oaiapp_synthetic' })
    assert.equal((await f.row()).ai_key, '')
    assert.equal((await f.request((await f.authorize()).callback)).status, 303)
    f.openai.revokeStatus = 503
    const unconfirmed = await f.request('/connections/disconnect', {})
    assert.match(decodeURIComponent(unconfirmed.headers.get('location')!), /OpenAI did not confirm/)
    assert.equal((await f.row()).ai_key, '')
  } finally { await f.close() }
})

test('a locked parent area or student session cannot start, finish or change the connection', async () => {
  const f = await app()
  try {
    assert.equal((await f.request('/parent/lock', { studentId: f.student })).status, 303)
    for (const [path, data] of [['/connections/chatgpt', {}], ['/connections/chatgpt/models', { model: 'gpt-synthetic-a' }], ['/connections/chatgpt/welcome', {}]] as const)
      assert.equal((await f.request(path, data)).status, 403, path)
    const locked = await f.request('/connections/chatgpt/callback?state=x&code=y')
    assert.equal(locked.status, 303); assert.equal(locked.headers.get('location'), '/parent/unlock')
    assert.equal((await f.request('/connections/chatgpt', {}, f.auth.token, 'wrong-csrf')).status, 403)
    assert.equal(f.openai.tokenRequests.length, 0)
  } finally { await f.close() }
})

test('local mode registers dynamically on 127.0.0.1 and reuses the issued client and host', async () => {
  const f = await app({ enabled: false })
  try {
    process.env.TUTOR_CHATGPT_LOCAL = '1'; process.env.TUTOR_CHATGPT_ISSUER = f.openai.issuer; process.env.TUTOR_CHATGPT_API_BASE = f.openai.apiBase
    const { request: raw } = await import('node:http')
    const viaOtherHost = await new Promise<string>((resolve, reject) => {
      const port = new URL(f.origin).port, body = JSON.stringify({ csrf: f.auth.csrf })
      const req = raw({ host: '127.0.0.1', port, path: '/connections/chatgpt', method: 'POST', headers: { Host: `device.example.ts.net:${port}`, Cookie: `tutor_session=${f.auth.token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => { res.resume(); resolve(String(res.headers.location)) })
      req.on('error', reject); req.end(body)
    })
    assert.match(decodeURIComponent(viaOtherHost), /open http:\/\/127\.0\.0\.1:\d+\/settings/, 'a local sign-in started from another address explains where to connect')
    assert.equal(f.openai.tokenRequests.length, 0)
    const begin = async () => new URL((await f.request('/connections/chatgpt', {})).headers.get('location')!)
    const codeFor = (target: URL, clientId = 'oaiapp_dynamic_issued') => f.openai.issueCode({ clientId, redirectUri: target.searchParams.get('redirect_uri')!, codeChallenge: target.searchParams.get('code_challenge')!, nonce: target.searchParams.get('nonce')! })
    const first = await begin()
    assert.equal(first.searchParams.get('client_id'), 'dynamic_agent_client')
    assert.equal(first.searchParams.get('agent_name_hint'), 'Kids Tutor')
    assert.match(first.searchParams.get('ext_agent_host_id')!, /^urn:uuid:[0-9a-f-]{36}$/)
    assert.equal(first.searchParams.get('redirect_uri'), `${f.origin}/auth/callback`)
    const missing = await f.request(`/auth/callback?code=${codeFor(first)}&state=${first.searchParams.get('state')}`)
    assert.match(missing.headers.get('location')!, /error=/, 'a new registration without an issued client ID is incomplete')
    const second = await begin()
    assert.equal(second.searchParams.get('client_id'), 'dynamic_agent_client')
    const failed = await quietly(() => f.request(`/auth/callback?code=expired-code&state=${second.searchParams.get('state')}&client_id=oaiapp_dynamic_issued`))
    assert.match(failed.headers.get('location')!, /error=/, 'a failed code exchange saves no connection')
    assert.equal((await f.row()).ai_key, '')
    const retry = await begin()
    assert.equal(retry.searchParams.get('client_id'), 'oaiapp_dynamic_issued', 'a retry reuses the issued registration instead of registering again')
    assert.equal(retry.searchParams.get('agent_name_hint'), null)
    assert.equal(retry.searchParams.get('ext_agent_host_id'), first.searchParams.get('ext_agent_host_id'))
    const done = await f.request(`/auth/callback?code=${codeFor(retry)}&state=${retry.searchParams.get('state')}`)
    assert.match(done.headers.get('location')!, /notice=ChatGPT%20connected/)
    assert.equal(f.openai.tokenRequests.at(-1)!.form.client_id, 'oaiapp_dynamic_issued')
    assert.equal(JSON.parse(decryptSecret(String((await f.row()).ai_key))).idToken, '', 'the raw ID token is not kept')
    const again = await begin()
    assert.equal(again.searchParams.get('id_token_hint'), null, 'tokens never go into browser URLs')
    assert.equal(again.searchParams.get('login_hint'), 'parent@example.com')
    const swapped = await f.request(`/auth/callback?code=x&state=${again.searchParams.get('state')}&client_id=oaiapp_someone_else`)
    assert.match(swapped.headers.get('location')!, /error=/, 'a different client ID on reauthorization is rejected')
  } finally { await f.close() }
})
