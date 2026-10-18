import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { codexPhoneProxy, phoneOwnerAllowed } from '../src/codex-phone-proxy.ts'

test('phone access rejects missing, other-account and ambiguous identities', () => {
 assert.equal(phoneOwnerAllowed({},'synthetic-owner@example.invalid'),false)
 assert.equal(phoneOwnerAllowed({'tailscale-user-login':'other@example.invalid'},'synthetic-owner@example.invalid'),false)
 assert.equal(phoneOwnerAllowed({'tailscale-user-login':['synthetic-owner@example.invalid','other@example.invalid']},'synthetic-owner@example.invalid'),false)
 assert.equal(phoneOwnerAllowed({'tailscale-user-login':'synthetic-owner@example.invalid'},'synthetic-owner@example.invalid'),true)
})

test('owner gateway blocks requests before forwarding and preserves authorized forms/cookies', async () => {
 let calls=0
 const backend=createServer((req,res)=>{calls++;let body='';req.on('data',b=>body+=b);req.on('end',()=>{res.setHeader('Set-Cookie','synthetic_session=ok; Secure; HttpOnly');res.end(JSON.stringify({url:req.url,method:req.method,body,cookie:req.headers.cookie}))})})
 await new Promise<void>(r=>backend.listen(0,'127.0.0.1',r))
 const proxy=codexPhoneProxy('synthetic-owner@example.invalid',(backend.address() as any).port)
 await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r))
 const origin=`http://127.0.0.1:${(proxy.address() as any).port}`
 try{
  assert.equal((await fetch(origin+'/settings')).status,403);assert.equal(calls,0)
  const response=await fetch(origin+'/student-login',{method:'POST',headers:{'tailscale-user-login':'synthetic-owner@example.invalid',cookie:'synthetic_csrf=ok'},body:'csrf=ok&pin=123456'})
  assert.equal(response.status,200);assert.equal(calls,1);assert.match(response.headers.get('set-cookie')!,/Secure; HttpOnly/)
  assert.deepEqual(await response.json(),{url:'/student-login',method:'POST',body:'csrf=ok&pin=123456',cookie:'synthetic_csrf=ok'})
 }finally{await Promise.all([new Promise<void>(r=>proxy.close(()=>r())),new Promise<void>(r=>backend.close(()=>r()))])}
})
