import { createServer, request, type IncomingHttpHeaders } from 'node:http'

export function phoneOwnerAllowed(headers: IncomingHttpHeaders, owner: string) {
  return Boolean(owner) && typeof headers['tailscale-user-login'] === 'string' && headers['tailscale-user-login'] === owner
}

/** Trust identity only from Tailscale Serve, with this gateway bound to loopback. */
export function codexPhoneProxy(owner: string, backendPort = 8788, name = 'Codex test preview') {
  if (!owner) throw new Error('A Tailscale owner identity is required.')
  return createServer((req, res) => {
    if (!phoneOwnerAllowed(req.headers, owner)) {
      res.writeHead(403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
      res.end(`This ${name} is available only to its owner’s Tailscale account.`)
      return
    }
    const upstream = request({ hostname: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode ?? 502, response.headers)
      response.pipe(res)
    })
    upstream.setTimeout(300000, () => upstream.destroy())
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end('The local tutor is unavailable. Your saved work remains available.')
    })
    req.on('aborted', () => upstream.destroy())
    req.pipe(upstream)
  })
}
