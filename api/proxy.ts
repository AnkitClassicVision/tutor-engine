import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// Vercel serves the public origin; the persistent backend owns records and jobs.
export const config = { maxDuration: 300, api: { bodyParser: false } }
export default async function proxy(req: IncomingMessage, res: ServerResponse) {
  const configured = process.env.TUTOR_BACKEND_ORIGIN
  if (!configured) {
    res.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
    res.end('Tutor is awaiting its persistent backend. Configure TUTOR_BACKEND_ORIGIN in Vercel.'); return
  }
  const backend = new URL(configured)
  if (backend.protocol !== 'https:' || backend.username || backend.password || backend.search || backend.pathname !== '/') {
    res.writeHead(503); res.end('Backend origin must be an HTTPS origin.'); return
  }
  const incoming = new URL(req.url || '/', 'https://proxy.invalid')
  const path = incoming.searchParams.get('__path') ?? ''
  incoming.searchParams.delete('__path')
  // Concatenation keeps every request on the configured origin, including //paths.
  const target = new URL(`${backend.origin}/${path.replace(/^\/+/, '')}`)
  target.search = incoming.search
  const headers = new Headers()
  for (const name of ['cookie', 'content-type', 'accept', 'last-event-id']) {
    const value = req.headers[name]
    if (typeof value === 'string') headers.set(name, value)
  }
  const controller = new AbortController()
  res.on('close', () => controller.abort())
  try {
    const response = await fetch(target, { method: req.method, headers, redirect: 'manual', signal: controller.signal,
      ...(!['GET', 'HEAD'].includes(req.method ?? 'GET') ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' } : {}) } as RequestInit)
    res.statusCode = response.status
    for (const [name, value] of response.headers) {
      if (!['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(name)) res.setHeader(name, value)
    }
    res.setHeader('Cache-Control', 'no-store')
    if (response.headers.getSetCookie().length) res.setHeader('Set-Cookie', response.headers.getSetCookie())
    if (response.body) await pipeline(Readable.fromWeb(response.body as any), res)
    else res.end()
  } catch {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
    res.end('The tutor connection paused. Your saved work remains on the backend. Try again.')
  }
}
