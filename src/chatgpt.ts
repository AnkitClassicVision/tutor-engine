// Sign in with ChatGPT: a parent authorizes Kids Tutor to use their ChatGPT plan for
// AI requests. Hosted use needs an OpenAI-issued client; the local mode follows the
// documented dynamic registration with a 127.0.0.1 callback and is never public.
// https://developers.openai.com/siwc
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { Database as DatabaseSync } from './database.ts'
import { hashToken } from './auth.ts'
import { decryptSecret, encryptSecret } from './secrets.ts'

export const RESOURCE = 'https://api.openai.com/v1'
export const MANAGE_USAGE_URL = 'https://chatgpt.com/settings/usage'
const PLAN_SCOPE = 'chatgpt.tokens.use.direct'
const DEFAULT_SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
const AGENT_NAME = 'Kids Tutor'
const UNUSABLE_REFRESH = ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']

export interface ChatGptConfig { mode: 'hosted' | 'local'; clientId: string; clientSecret: string; redirectUri: string; scopes: string; issuer: string; apiBase: string; hostId: string }
export interface ChatGptCredential { v: 1; clientId: string; sub: string; email: string; idToken: string; accessToken: string; refreshToken: string; expiresAt: number; refreshAt: number; scopes: string[]; reconnect?: boolean }
export interface ChatGptModel { slug: string; name: string }
export type ChatGptProblem = 'reconnect' | 'limit' | 'not_eligible' | 'temporary' | 'unsupported' | 'config' | 'flow'

const MESSAGES: Record<ChatGptProblem, string> = {
  reconnect: 'ChatGPT needs to be connected again. A parent can reconnect in AI settings.',
  limit: 'The family ChatGPT plan reached its usage limit. A parent can review it under Manage usage in ChatGPT settings.',
  not_eligible: 'This ChatGPT account cannot use its plan in bubble. A parent can connect another way in AI settings.',
  temporary: 'ChatGPT is not available right now. Your work is saved; try again later.',
  unsupported: 'ChatGPT could not accept this request. A parent can choose another ChatGPT model in AI settings.',
  config: 'The ChatGPT connection is not set up for this site. A parent can connect another way in AI settings.',
  flow: 'ChatGPT sign-in did not finish. Nothing changed; try Continue with ChatGPT again.',
}

export class ChatGptError extends Error {
  kind: ChatGptProblem
  /** True when ChatGPT named the plan's usage limit itself, not just a 429 (WF-01: only a named limit is lasting). */
  usageLimit = false
  constructor(kind: ChatGptProblem, message = MESSAGES[kind]) { super(message); this.kind = kind }
}

export function chatgptConfig(): ChatGptConfig | null {
  const issuer = (process.env.TUTOR_CHATGPT_ISSUER || 'https://auth.openai.com').replace(/\/$/, '')
  const apiBase = (process.env.TUTOR_CHATGPT_API_BASE || RESOURCE).replace(/\/$/, '')
  const scopes = process.env.TUTOR_CHATGPT_SCOPES || DEFAULT_SCOPES
  const origin = process.env.TUTOR_ORIGIN || 'http://127.0.0.1:8787'
  if (process.env.TUTOR_CHATGPT_CLIENT_ID) {
    return { mode: 'hosted', clientId: process.env.TUTOR_CHATGPT_CLIENT_ID, clientSecret: process.env.TUTOR_CHATGPT_CLIENT_SECRET || '', scopes, issuer, apiBase,
      redirectUri: process.env.TUTOR_CHATGPT_REDIRECT_URI || new URL('/connections/chatgpt/callback', origin).toString(), hostId: process.env.TUTOR_CHATGPT_HOST_ID || '' }
  }
  if (process.env.TUTOR_CHATGPT_LOCAL === '1' && process.env.TUTOR_PUBLIC !== '1') {
    // The dynamic flow only accepts an HTTP loopback callback on 127.0.0.1, on the port this
    // server listens on, even when parents browse through a private HTTPS address.
    const port = process.env.TUTOR_PORT || new URL(origin).port || '8787'
    return { mode: 'local', clientId: '', clientSecret: '', scopes, issuer, apiBase, redirectUri: `http://127.0.0.1:${port}/auth/callback`, hostId: localHost().hostId }
  }
  return null
}

// Refresh shortly before expiry, never before OpenAI's earliest_refresh_at, and never
// so early that a short-lived token is refreshed on every request.
function lifetime(tokens: Record<string, unknown>) {
  const now = Date.now(), ttl = Number(tokens.expires_in ?? 3600) * 1000, expiresAt = now + ttl
  const earliest = Number(tokens.earliest_refresh_at ?? 0) * 1000
  return { expiresAt, refreshAt: Math.min(expiresAt - 5000, Math.max(expiresAt - Math.min(120000, ttl / 2), earliest)) }
}

export function readCredential(stored: string): ChatGptCredential | null {
  if (!stored) return null
  try {
    const value = JSON.parse(decryptSecret(stored))
    return value?.v === 1 ? value as ChatGptCredential : null
  } catch { return null }
}

// One host ID per local installation, plus the client ID OpenAI issued to each family,
// kept beside the credential key so later sign-ins reuse the same registration.
function localHostPath() { return join(process.env.TUTOR_SECRET_DIR || 'data', 'chatgpt-host.json') }
function localHost(): { hostId: string; clients: Record<string, string> } {
  const path = localHostPath()
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'))
  const host = { hostId: `urn:uuid:${randomUUID()}`, clients: {} }
  writeLocalHost(host)
  return host
}
function writeLocalHost(host: { hostId: string; clients: Record<string, string> }) {
  const path = localHostPath()
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
  writeFileSync(`${path}.tmp`, JSON.stringify(host), { mode: 0o600 })
  renameSync(`${path}.tmp`, path)
}

interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string; revocation_endpoint?: string }
const discoveries = new Map<string, Promise<Discovery>>()
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function discover(issuer: string): Promise<Discovery> {
  let pending = discoveries.get(issuer)
  if (!pending) {
    pending = (async () => {
      const response = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10000) })
      if (!response.ok) throw new ChatGptError('temporary')
      const body = await response.json() as Discovery
      if (body.issuer !== issuer || !body.authorization_endpoint || !body.token_endpoint || !body.jwks_uri) throw new ChatGptError('config')
      return body
    })()
    pending.catch(() => discoveries.delete(issuer))
    discoveries.set(issuer, pending)
  }
  return pending
}

function requireConfig() {
  const config = chatgptConfig()
  if (!config) throw new ChatGptError('config')
  return config
}

function tokenHeaders(config: ChatGptConfig) {
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }
  if (config.mode === 'hosted' && config.clientSecret) {
    const form = (value: string) => new URLSearchParams({ value }).toString().slice('value='.length)
    headers.Authorization = `Basic ${Buffer.from(`${form(config.clientId)}:${form(config.clientSecret)}`).toString('base64')}`
  }
  return headers
}

function logFailure(what: string, response: Response, code = '') {
  console.error(`ChatGPT ${what} failed`, { status: response.status, code, requestId: response.headers.get('openai-request-id') ?? response.headers.get('x-request-id') })
}

/** Create a one-use, parent-session-bound sign-in transaction and return the OpenAI URL. */
export async function startChatGpt(db: DatabaseSync, auth: { id: string; userId: string }) {
  const config = requireConfig(), endpoints = await discover(config.issuer)
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url'), nonce = randomBytes(32).toString('base64url')
  const clientId = config.mode === 'hosted' ? config.clientId : localHost().clients[auth.userId] ?? ''
  await db.prepare('INSERT INTO oauth_states (state_hash, user_id, auth_session_id, verifier, expires_at, provider, nonce, client_id, redirect_uri) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(hashToken(state), auth.userId, auth.id, encryptSecret(verifier), new Date(Date.now() + 10 * 60000).toISOString(), 'chatgpt', nonce, clientId, config.redirectUri)
  const params = new URLSearchParams({
    client_id: clientId || 'dynamic_agent_client', redirect_uri: config.redirectUri, response_type: 'code', scope: config.scopes, resource: RESOURCE,
    state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  })
  if (config.mode === 'local' && !clientId) params.set('agent_name_hint', AGENT_NAME)
  if (config.hostId) params.set('ext_agent_host_id', config.hostId)
  const current = readCredential(String((await db.prepare("SELECT ai_key FROM users WHERE id = ? AND ai_provider = 'chatgpt'").get(auth.userId))?.ai_key ?? ''))
  // The email hint is enough to preselect the account; tokens never go into browser URLs.
  if (current?.email && clientId && current.clientId === clientId) params.set('login_hint', current.email)
  const target = new URL(endpoints.authorization_endpoint)
  target.search = params.toString()
  return target.toString()
}

/** Validate the callback, exchange the code and verify identity and plan permission. */
export async function finishChatGpt(db: DatabaseSync, auth: { id: string; userId: string }, url: URL): Promise<{ credential: ChatGptCredential; models: ChatGptModel[] }> {
  const state = await db.prepare("DELETE FROM oauth_states WHERE state_hash = ? AND user_id = ? AND auth_session_id = ? AND provider = 'chatgpt' AND expires_at > ? RETURNING *")
    .get(hashToken(url.searchParams.get('state') ?? ''), auth.userId, auth.id, new Date().toISOString())
  if (!state) throw new ChatGptError('flow', 'Connection request expired or does not match this parent session.')
  if (url.searchParams.get('error') === 'access_denied') throw new ChatGptError('flow', 'ChatGPT access was not approved, so nothing changed.')
  const code = url.searchParams.get('code')
  if (url.searchParams.has('error') || !code) throw new ChatGptError('flow')
  const config = requireConfig(), endpoints = await discover(config.issuer)
  if (String(state.redirect_uri) !== config.redirectUri) throw new ChatGptError('flow')
  let clientId = String(state.client_id)
  const returned = url.searchParams.get('client_id')
  if (!clientId && config.mode === 'local') {
    if (!returned || returned === 'dynamic_agent_client') throw new ChatGptError('flow')
    clientId = returned
    // Keep the new registration even if the code exchange below fails, so a retry
    // signs in to the same registered app instead of registering another one.
    const host = localHost(); host.clients[auth.userId] = clientId; writeLocalHost(host)
  } else if (!clientId || (returned && returned !== clientId) || (config.mode === 'hosted' && clientId !== config.clientId)) throw new ChatGptError('flow')
  const response = await fetch(endpoints.token_endpoint, { method: 'POST', signal: AbortSignal.timeout(15000), headers: tokenHeaders(config), body: new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, client_id: clientId, code_verifier: decryptSecret(String(state.verifier)), resource: RESOURCE,
  }) })
  if (!response.ok) { logFailure('code exchange', response); throw new ChatGptError('flow') }
  const tokens = await response.json() as Record<string, unknown>
  if (typeof tokens.id_token !== 'string' || typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') throw new ChatGptError('flow')
  let identity: Record<string, unknown>
  try {
    let keys = keySets.get(endpoints.jwks_uri)
    if (!keys) keySets.set(endpoints.jwks_uri, keys = createRemoteJWKSet(new URL(endpoints.jwks_uri)))
    identity = (await jwtVerify(tokens.id_token, keys, { issuer: endpoints.issuer, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5 })).payload
  } catch { throw new ChatGptError('flow', 'ChatGPT sign-in could not be verified, so nothing changed.') }
  if (identity.nonce !== String(state.nonce) || typeof identity.sub !== 'string' || !identity.sub) throw new ChatGptError('flow', 'ChatGPT sign-in could not be verified, so nothing changed.')
  const scopes = String(tokens.scope ?? '').split(/\s+/).filter(Boolean)
  if (!scopes.includes(PLAN_SCOPE)) {
    await revokeToken(config, endpoints, tokens.refresh_token, clientId)
    throw new ChatGptError('flow', 'ChatGPT plan use was not allowed, so your current AI connection is unchanged. Choose Continue with ChatGPT again and allow plan use.')
  }
  const credential: ChatGptCredential = {
    v: 1, clientId, sub: identity.sub, email: typeof identity.email === 'string' ? identity.email : '',
    // The raw ID token is verified above and not kept.
    idToken: '', accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
    ...lifetime(tokens), scopes,
  }
  return { credential, models: await listChatGptModels(credential.accessToken).catch(() => []) }
}

export async function listChatGptModels(accessToken: string): Promise<ChatGptModel[]> {
  const response = await fetch(`${requireConfig().apiBase}/models`, { signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) throw await responseError(response)
  const body = await response.json() as { models?: Array<{ slug?: string; display_name?: string; visibility?: string }> }
  return (body.models ?? []).filter(model => model.visibility === 'list' && model.slug).map(model => ({ slug: String(model.slug), name: String(model.display_name || model.slug) }))
}

/** A current access token, refreshed with at most one refresh per family at a time. */
export async function chatgptAccessToken(db: DatabaseSync, userId: string): Promise<string> {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const row = await db.prepare('SELECT ai_provider, ai_key FROM users WHERE id = ?').get(userId)
    const credential = row?.ai_provider === 'chatgpt' ? readCredential(String(row.ai_key)) : null
    if (!credential || credential.reconnect || !credential.refreshToken) throw new ChatGptError('reconnect')
    if ((credential.refreshAt ?? credential.expiresAt - 120000) > Date.now()) return credential.accessToken
    const now = new Date()
    const lease = await db.prepare('UPDATE users SET ai_refresh_lease = ? WHERE id = ? AND ai_key = ? AND (ai_refresh_lease IS NULL OR ai_refresh_lease < ?) RETURNING id')
      .get(new Date(now.getTime() + 30000).toISOString(), userId, row!.ai_key, now.toISOString())
    if (!lease) { await new Promise(resolve => setTimeout(resolve, 250)); continue }
    let next: ChatGptCredential
    try { next = await refresh(credential) } catch (error) {
      if (error instanceof ChatGptError && error.kind === 'reconnect') {
        const cleared: ChatGptCredential = { ...credential, accessToken: '', refreshToken: '', reconnect: true }
        await db.prepare('UPDATE users SET ai_key = ?, ai_refresh_lease = NULL WHERE id = ? AND ai_key = ?').run(encryptSecret(JSON.stringify(cleared)), userId, row!.ai_key)
      } else await db.prepare('UPDATE users SET ai_refresh_lease = NULL WHERE id = ?').run(userId)
      throw error
    }
    await db.prepare('UPDATE users SET ai_key = ?, ai_refresh_lease = NULL WHERE id = ? AND ai_key = ?').run(encryptSecret(JSON.stringify(next)), userId, row!.ai_key)
    return next.accessToken
  }
  throw new ChatGptError('temporary')
}

async function refresh(credential: ChatGptCredential): Promise<ChatGptCredential> {
  const config = requireConfig(), endpoints = await discover(config.issuer)
  let response: Response
  try {
    response = await fetch(endpoints.token_endpoint, { method: 'POST', signal: AbortSignal.timeout(15000), headers: tokenHeaders(config),
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: credential.clientId, refresh_token: credential.refreshToken, resource: RESOURCE }) })
  } catch { throw new ChatGptError('temporary') }
  const body = await response.json().catch(() => ({})) as Record<string, any>
  if (!response.ok) {
    const code = String(body.error?.code ?? body.error ?? '')
    logFailure('token refresh', response, code)
    if (UNUSABLE_REFRESH.includes(code)) throw new ChatGptError('reconnect')
    throw new ChatGptError(code === 'invalid_client' ? 'config' : 'temporary')
  }
  if (typeof body.access_token !== 'string') throw new ChatGptError('temporary')
  return { ...credential, accessToken: body.access_token, refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : credential.refreshToken,
    ...lifetime(body), scopes: typeof body.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean) : credential.scopes }
}

/** Revoke the renewable session. Returns whether OpenAI confirmed it. */
export async function revokeChatGpt(stored: string): Promise<boolean> {
  const credential = readCredential(stored), config = chatgptConfig()
  if (!credential?.refreshToken || !config) return false
  let endpoints: Discovery
  try { endpoints = await discover(config.issuer) } catch { return false }
  return revokeToken(config, endpoints, credential.refreshToken, credential.clientId)
}

async function revokeToken(config: ChatGptConfig, endpoints: Discovery, token: string, clientId: string) {
  if (!endpoints.revocation_endpoint) return false
  for (const wait of [0, 250, 1000]) {
    await new Promise(resolve => setTimeout(resolve, wait))
    try {
      const response = await fetch(endpoints.revocation_endpoint, { method: 'POST', signal: AbortSignal.timeout(8000), headers: tokenHeaders(config),
        body: new URLSearchParams({ token, token_type_hint: 'refresh_token', client_id: clientId }) })
      if (response.ok) return true
      if (response.status < 500) return false
    } catch {}
  }
  return false
}

export type ChatGptContent = Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }>

/** One Responses API request under the plan-usage rules: store false, streamed, completed only on response.completed. */
export async function askChatGpt(accessToken: string, model: string, instructions: string, content: ChatGptContent, signal: AbortSignal): Promise<string> {
  if (!model) throw new ChatGptError('unsupported', 'Choose a ChatGPT model in AI settings before starting.')
  let response: Response
  try {
    response = await fetch(`${requireConfig().apiBase}/responses`, { method: 'POST', signal, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ model, instructions, input: [{ role: 'user', content }], store: false, stream: true }) })
  } catch (error) { if (signal.aborted) throw error; throw new ChatGptError('temporary') }
  if (!response.ok || !response.body) throw await responseError(response)
  const decoder = new TextDecoder()
  let buffer = '', text = '', done = ''
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = events.pop() ?? ''
    for (const event of events) {
      const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
      if (!data || data === '[DONE]') continue
      let parsed: any
      try { parsed = JSON.parse(data) } catch { continue }
      if (parsed.type === 'response.output_text.delta') text += String(parsed.delta ?? '')
      else if (parsed.type === 'response.output_text.done') done = String(parsed.text ?? '')
      else if (parsed.type === 'response.completed') return text || done
      else if (parsed.type === 'response.failed' || parsed.type === 'error') throw problemFor(response.status, String(parsed.response?.error?.code ?? parsed.error?.code ?? parsed.code ?? ''), response)
      else if (parsed.type === 'response.incomplete') throw new ChatGptError('temporary', 'The ChatGPT answer stopped early. Your work is saved; try again.')
    }
  }
  throw new ChatGptError('temporary', 'The ChatGPT answer was interrupted. Your work is saved; try again.')
}

async function responseError(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: { code?: string; param?: string }; detail?: unknown }
  if (body.error?.param) console.error('ChatGPT request field rejected', { param: body.error.param })
  // Direct-admission bodies carry only {detail}; use it when it names a documented code.
  const detail = typeof body.detail === 'string' && /^(subscription_sharing|chatpass_v2)_[a-z_]+$/.test(body.detail) ? body.detail : ''
  return problemFor(response.status, String(body.error?.code ?? detail), response)
}

/** After OpenAI rejects an access token, refresh before the next request instead of reusing it. */
export async function distrustChatGptToken(db: DatabaseSync, userId: string) {
  const row = await db.prepare("SELECT ai_key FROM users WHERE id = ? AND ai_provider = 'chatgpt'").get(userId)
  const credential = readCredential(String(row?.ai_key ?? ''))
  if (!credential || credential.reconnect) return
  await db.prepare('UPDATE users SET ai_key = ? WHERE id = ? AND ai_key = ?').run(encryptSecret(JSON.stringify({ ...credential, refreshAt: 0 })), userId, row!.ai_key)
}

function problemFor(status: number, code: string, response: Response) {
  logFailure('request', response, code)
  if (code === 'subscription_sharing_usage_limit_exceeded') return Object.assign(new ChatGptError('limit'), { usageLimit: true })
  if (status === 429) return new ChatGptError('limit')
  if (code === 'subscription_sharing_user_not_eligible') return new ChatGptError('not_eligible')
  if (code === 'subscription_sharing_usage_unavailable' || code === 'subscription_sharing_user_unavailable') return new ChatGptError('temporary')
  if (code === 'subscription_sharing_unsupported_capability') return new ChatGptError('unsupported')
  if (code === 'subscription_sharing_invalid_user' || status === 401) return new ChatGptError('reconnect')
  if (status === 403) return new ChatGptError('config')
  if (status === 400) return new ChatGptError('unsupported')
  return new ChatGptError('temporary')
}
