// Local synthetic ChatGPT OAuth server and plan-usage Responses API.
import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

export type ResponsesScenario = 'ok' | 'limit_prestream' | 'detail_401' | 'not_eligible' | 'unavailable_503' | 'unsupported_400' | 'failed_midstream' | 'incomplete' | 'truncated'
export interface IssueCodeInput { clientId: string; redirectUri: string; codeChallenge: string; nonce: string; scope?: string; sub?: string; email?: string }
export interface IdTokenOverrides { iss?: string; aud?: string; nonce?: string; expired?: boolean; wrongKey?: boolean; omitSub?: boolean }
export interface OpenAiFixture {
  issuer: string; apiBase: string
  close(): Promise<void>
  issueCode(input: IssueCodeInput): string
  idTokenOverrides: IdTokenOverrides
  scenario: ResponsesScenario
  accessTokenTtl: number; refreshDelayMs: number; revokeStatus: number; refreshError: string | null
  models: Array<{ slug: string; display_name: string; visibility: string }>
  tokenRequests: Array<{ form: Record<string, string>; authorization: string | null }>
  revocations: Array<Record<string, string>>
  responsesRequests: Array<{ authorization: string | null; body: any }>
  modelRequests: number; refreshCount: number
}

interface Grant { clientId: string; scope: string; refreshToken: string; valid: boolean }
const resource = 'https://api.openai.com/v1'
const defaultScope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
const opaque = () => randomBytes(32).toString('base64url')

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}
function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body))
}

export async function startOpenAiFixture(options: { clientSecret?: string } = {}): Promise<OpenAiFixture> {
  const [keys, wrongKeys] = await Promise.all([generateKeyPair('RS256'), generateKeyPair('RS256')])
  const publicJwk = { ...await exportJWK(keys.publicKey), kid: 'synthetic-key', alg: 'RS256', use: 'sig' }
  const codes = new Map<string, Required<IssueCodeInput> & { used: boolean }>()
  const refreshTokens = new Map<string, Grant>()
  const accessTokens = new Map<string, { grant: Grant; expiresAt: number }>()
  const fixture: OpenAiFixture = {
    issuer: '', apiBase: '', idTokenOverrides: {}, scenario: 'ok', accessTokenTtl: 3600,
    refreshDelayMs: 0, revokeStatus: 200, refreshError: null,
    models: [
      { slug: 'gpt-synthetic-a', display_name: 'Synthetic A', visibility: 'list' },
      { slug: 'gpt-synthetic-b', display_name: 'Synthetic B', visibility: 'list' },
      { slug: 'gpt-synthetic-hidden', display_name: 'Synthetic hidden', visibility: 'hide' },
    ],
    tokenRequests: [], revocations: [], responsesRequests: [], modelRequests: 0, refreshCount: 0,
    issueCode(input) {
      const code = opaque()
      codes.set(code, { ...input, scope: input.scope ?? defaultScope, sub: input.sub ?? 'user-synthetic-1', email: input.email ?? 'parent@example.com', used: false })
      return code
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve()); server.closeAllConnections()
    }),
  }

  function rotate(grant: Grant) {
    const access_token = opaque(), refresh_token = opaque(), now = Math.floor(Date.now() / 1000)
    grant.refreshToken = refresh_token
    refreshTokens.set(refresh_token, grant)
    accessTokens.set(access_token, { grant, expiresAt: Date.now() + fixture.accessTokenTtl * 1000 })
    return { access_token, refresh_token, token_type: 'Bearer', expires_in: fixture.accessTokenTtl, scope: grant.scope, earliest_refresh_at: now }
  }
  function liveBearer(request: IncomingMessage) {
    const authorization = request.headers.authorization
    const access = authorization?.startsWith('Bearer ') ? accessTokens.get(authorization.slice(7)) : undefined
    return access && access.grant.valid && access.expiresAt > Date.now()
  }
  async function route(request: IncomingMessage, response: ServerResponse) {
    const path = new URL(request.url ?? '/', fixture.issuer).pathname
    if (request.method === 'GET' && path === '/.well-known/openid-configuration') {
      const issuer = fixture.issuer
      return json(response, 200, { issuer, authorization_endpoint: issuer + '/api/accounts/authorize', token_endpoint: issuer + '/api/accounts/oauth/token', jwks_uri: issuer + '/.well-known/jwks.json', revocation_endpoint: issuer + '/api/accounts/oauth/revoke' })
    }
    if (request.method === 'GET' && path === '/.well-known/jwks.json') return json(response, 200, { keys: [publicJwk] })
    if (request.method === 'POST' && path === '/api/accounts/oauth/token') {
      const form = Object.fromEntries(new URLSearchParams(await readBody(request)))
      const authorization = request.headers.authorization ?? null
      fixture.tokenRequests.push({ form, authorization })
      if (options.clientSecret !== undefined && (Object.hasOwn(form, 'client_secret') || authorization !== 'Basic ' + Buffer.from(`${form.client_id ?? ''}:${options.clientSecret}`).toString('base64'))) {
        return json(response, 401, { error: 'invalid_client' })
      }
      if (form.grant_type === 'authorization_code') {
        const code = codes.get(form.code)
        if (!code || code.used || form.client_id !== code.clientId || form.redirect_uri !== code.redirectUri || form.resource !== resource || form.code_verifier === undefined || createHash('sha256').update(form.code_verifier).digest('base64url') !== code.codeChallenge) {
          return json(response, 400, { error: 'invalid_grant' })
        }
        code.used = true
        const overrides = fixture.idTokenOverrides, now = Math.floor(Date.now() / 1000)
        const id_token = await new SignJWT({
          iss: overrides.iss ?? fixture.issuer, aud: overrides.aud ?? code.clientId,
          ...(overrides.omitSub ? {} : { sub: code.sub }), email: code.email,
          nonce: overrides.nonce ?? code.nonce, iat: now, exp: now + (overrides.expired ? -3600 : 3600),
        }).setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid }).sign(overrides.wrongKey ? wrongKeys.privateKey : keys.privateKey)
        return json(response, 200, { ...rotate({ clientId: code.clientId, scope: code.scope, refreshToken: '', valid: true }), id_token })
      }
      if (form.grant_type === 'refresh_token') {
        if (fixture.refreshDelayMs > 0) await delay(fixture.refreshDelayMs)
        if (fixture.refreshError !== null) return json(response, 400, { error: fixture.refreshError })
        const grant = refreshTokens.get(form.refresh_token)
        if (!grant || form.client_id !== grant.clientId || form.resource !== resource) return json(response, 400, { error: 'invalid_grant' })
        if (form.refresh_token !== grant.refreshToken) {
          grant.valid = false; return json(response, 400, { error: 'refresh_token_reused' })
        }
        if (!grant.valid) return json(response, 400, { error: 'invalid_grant' })
        fixture.refreshCount++
        return json(response, 200, rotate(grant))
      }
      return json(response, 400, { error: 'unsupported_grant_type' })
    }
    if (request.method === 'POST' && path === '/api/accounts/oauth/revoke') {
      fixture.revocations.push(Object.fromEntries(new URLSearchParams(await readBody(request))))
      response.writeHead(fixture.revokeStatus); response.end(); return
    }
    if (request.method === 'GET' && path === '/v1/models') {
      if (!liveBearer(request)) return json(response, 401, { detail: 'Unauthorized' })
      fixture.modelRequests++; return json(response, 200, { models: fixture.models })
    }
    if (request.method === 'POST' && path === '/v1/responses') {
      if (!liveBearer(request)) return json(response, 401, { detail: 'Unauthorized' })
      let body: any
      try { body = JSON.parse(await readBody(request)) } catch { return json(response, 400, { error: 'invalid_request' }) }
      fixture.responsesRequests.push({ authorization: request.headers.authorization ?? null, body })
      const scenario = fixture.scenario
      switch (scenario) {
        case 'limit_prestream': return json(response, 429, { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'Usage limit reached', param: null } })
        case 'detail_401': return json(response, 401, { detail: 'Signed identity not accepted' })
        case 'not_eligible': return json(response, 403, { error: { code: 'subscription_sharing_user_not_eligible', message: 'Not eligible' } })
        case 'unavailable_503': return json(response, 503, { detail: 'Direct routing unavailable' })
        case 'unsupported_400': return json(response, 400, { error: { code: 'subscription_sharing_unsupported_capability', param: 'temperature', message: 'Unsupported' } })
      }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const event = (type: string, data: Record<string, unknown>) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
      if (scenario === 'ok') event('response.created', { response: { status: 'in_progress' } })
      event('response.output_text.delta', { delta: '{"reply":' })
      if (scenario === 'ok') {
        event('response.output_text.delta', { delta: '"Synthetic answer"}' })
        event('response.completed', { response: { status: 'completed' } })
      } else if (scenario === 'failed_midstream') {
        event('response.failed', { response: { status: 'failed', error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'Usage limit reached' } } })
      } else if (scenario === 'incomplete') {
        event('response.incomplete', { response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } })
      }
      response.end(); return
    }
    response.writeHead(404); response.end()
  }
  const server = createServer((request, response) => {
    void route(request, response).catch(() => {
      if (response.headersSent) response.destroy()
      else json(response, 500, { error: 'fixture_error' })
    })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('ChatGPT fixture did not start.')
  fixture.issuer = `http://127.0.0.1:${address.port}`; fixture.apiBase = fixture.issuer + '/v1'
  return fixture
}
