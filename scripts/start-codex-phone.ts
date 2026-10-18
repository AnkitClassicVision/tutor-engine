import { execFileSync } from 'node:child_process'
import { codexPhoneProxy } from '../src/codex-phone-proxy.ts'

const status=JSON.parse(execFileSync('tailscale',['status','--json'],{encoding:'utf8'}))
const owner=status.User?.[String(status.Self?.UserID)]?.LoginName
if(status.BackendState!=='Running'||!owner||status.Self?.Tags?.length)throw new Error('An owner-signed-in Tailscale device is required.')
const server=codexPhoneProxy(owner)
server.listen(8789,'127.0.0.1',()=>console.log('Private owner-only Codex phone gateway ready on loopback port 8789.'))
