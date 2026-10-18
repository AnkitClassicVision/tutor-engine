import type { IncomingMessage, ServerResponse } from 'node:http'
import { waitUntil, attachDatabasePool } from '@vercel/functions'
import proxy from './proxy.ts'
import { handleCloud, runCloudWork, runCloudMail } from '../src/cloud-runtime.ts'
import { acceptBody } from '../src/server.ts'
import { postgresPool } from '../src/postgres.ts'

export const config = { maxDuration: 300, api: { bodyParser: false } }
let attached = false
export default async function tutor(req: IncomingMessage, res: ServerResponse) {
  if (process.env.TUTOR_CLOUD !== '1') return proxy(req, res)
  const url = new URL(req.url || '/', 'https://tutor.invalid')
  const routedPath = url.searchParams.get('__path')
  url.searchParams.delete('__path')
  const path = routedPath !== null ? `/${routedPath.replace(/^\/+/, '')}` : url.pathname === '/api/tutor' ? '/' : url.pathname
  req.url = `${path}${url.searchParams.size ? `?${url.searchParams}` : ''}`
  res.setHeader('Cache-Control', 'no-store')
  try {
    if (!(await acceptBody(req, res))) return
    if (!attached) { attachDatabasePool(postgresPool()); attached = true }
    const handled = handleCloud(req, res)
    // Register while the request is active, before handleCloud ends the response.
    // A late registration can leave mail/jobs suspended with an open transaction.
    waitUntil(handled.then(result => result?.owner ? runCloudWork(result.owner) : result?.recoveryMail ? runCloudMail(result.recoveryMail) : undefined).catch(() => console.error('Background work paused; saved jobs can resume on the next request.')))
    await handled
  } catch {
    if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
    res.end('Tutor setup is being completed. Please try again later.')
  }
}
