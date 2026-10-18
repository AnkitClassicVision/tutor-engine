import { execFileSync } from 'node:child_process'
import { codexPhoneProxy } from '../src/codex-phone-proxy.ts'

// Owner-only gateway for the local ChatGPT plan test server (npm run start:chatgpt on loopback 8789).
const status=JSON.parse(execFileSync('tailscale',['status','--json'],{encoding:'utf8'}))
const owner=status.User?.[String(status.Self?.UserID)]?.LoginName
if(status.BackendState!=='Running'||!owner||status.Self?.Tags?.length)throw new Error('An owner-signed-in Tailscale device is required.')
const server=codexPhoneProxy(owner, Number(process.env.TUTOR_PORT ?? 8789), 'ChatGPT plan test preview')
server.listen(8798,'127.0.0.1',()=>console.log('Private owner-only ChatGPT test gateway ready on loopback port 8798.'))
