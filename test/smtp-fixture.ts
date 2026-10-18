import { createServer, type Socket } from 'node:net'
import { once } from 'node:events'

// Local SMTP sink. No email leaves the test process or reaches a recipient.
export async function smtpFixture() {
  const sockets = new Set<Socket>(), messages: string[] = []
  const server = createServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket))
    let buffer = '', body = '', data = false
    socket.write('220 synthetic SMTP ready\r\n')
    socket.on('data', bytes => {
      buffer += bytes.toString()
      let end: number
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2)
        if (data) {
          if (line === '.') { messages.push(body); body = ''; data = false; socket.write('250 accepted\r\n') }
          else body += line + '\n'
        } else if (/^EHLO|^HELO/.test(line)) socket.write('250 synthetic\r\n')
        else if (line === 'DATA') { data = true; socket.write('354 enter message\r\n') }
        else if (line === 'QUIT') socket.end('221 goodbye\r\n')
        else socket.write('250 ok\r\n')
      }
    })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('SMTP fixture did not start.')
  return { url: `smtp://127.0.0.1:${address.port}`, messages, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}
