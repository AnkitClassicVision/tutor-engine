import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.ts'
import { registerUser, loginUser, openAuthSession, readAuthSession } from '../src/auth.ts'
import { issueAccountToken, consumeAccountToken, flushMail } from '../src/accounts.ts'
import { parentMailConfigured } from '../src/parent-mail.ts'
import { decryptSecret } from '../src/secrets.ts'

test('Resend outbox retries a lost response with one delivery and working one-use account links', async () => {
  const saved = Object.fromEntries(['TUTOR_MAIL_PROVIDER', 'TUTOR_MAIL_FROM', 'RESEND_API_KEY', 'TUTOR_SECRET_DIR', 'TUTOR_PUBLIC', 'NODE_ENV'].map(k => [k, process.env[k]]))
  const realFetch = globalThis.fetch, root = mkdtempSync(join(tmpdir(), 'tutor-resend-'))
  Object.assign(process.env, { TUTOR_MAIL_PROVIDER: 'resend', TUTOR_MAIL_FROM: 'Synthetic Tutor <account@example.invalid>', RESEND_API_KEY: 'synthetic-provider-key', TUTOR_SECRET_DIR: root, TUTOR_PUBLIC: '0', NODE_ENV: 'production' })
  const db = openDb(':memory:')
  const delivered = new Map<string, string>(), requests: { key: string; payload: string }[] = []
  let loseResponse = true
  globalThis.fetch = async (url: any, options: any) => {
    assert.equal(String(url), 'https://api.resend.com/emails')
    const headers = new Headers(options.headers), key = headers.get('idempotency-key')!
    assert.equal(headers.get('authorization'), 'Bearer synthetic-provider-key')
    assert.ok(options.signal instanceof AbortSignal)
    const payload = String(options.body)
    requests.push({ key, payload })
    if (delivered.has(key)) assert.equal(payload, delivered.get(key))
    else delivered.set(key, payload)
    if (loseResponse) { loseResponse = false; throw new TypeError('Synthetic lost provider response') }
    return new Response(JSON.stringify({ id: 'synthetic-provider-message' }), { status: 200 })
  }
  try {
    const registered = await registerUser(db, 'synthetic@example.invalid', 'original-parent-password')
    assert.ok(registered.ok)
    const owner = registered.userId
    await issueAccountToken(db, owner, 'verify')
    const before = await db.prepare('SELECT id, message FROM mail_outbox').get()
    assert.match(String(before?.message), /^enc:v2:/)
    await assert.rejects(flushMail(db, 1), /Parent email delivery paused/)
    assert.equal((await db.prepare('SELECT sent_at FROM mail_outbox').get())?.sent_at, null)
    await Promise.all([flushMail(db, 1), flushMail(db, 1)])
    assert.equal(delivered.size, 1)
    assert.equal(requests.length, 2)
    assert.equal(requests[0].key, `tutor-parent-mail/${before?.id}`)
    assert.deepEqual(requests[1], requests[0])
    assert.equal((await db.prepare('SELECT message FROM mail_outbox').get())?.message, '')
    const verification = new URL(JSON.parse(decryptSecret(String(before?.message))).url)
    await consumeAccountToken(db, verification.searchParams.get('token')!, 'verify')
    assert.ok((await db.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(owner))?.email_verified_at)
    await assert.rejects(consumeAccountToken(db, verification.searchParams.get('token')!, 'verify'), /already used/)

    const session = await openAuthSession(db, owner)
    await issueAccountToken(db, owner, 'recover')
    const recovery = await db.prepare("SELECT message FROM mail_outbox WHERE kind = 'recover'").get()
    const url = new URL(JSON.parse(decryptSecret(String(recovery?.message))).url)
    await flushMail(db, 1)
    assert.equal(delivered.size, 2)
    assert.match([...delivered.values()][1], /Reset your Tutor password/)
    await consumeAccountToken(db, url.searchParams.get('token')!, 'recover', 'replacement-parent-password')
    assert.equal((await loginUser(db, 'synthetic@example.invalid', 'replacement-parent-password')).ok, true)
    assert.equal((await loginUser(db, 'synthetic@example.invalid', 'original-parent-password')).ok, false)
    assert.equal(await readAuthSession(db, session.token), null)
    await assert.rejects(consumeAccountToken(db, url.searchParams.get('token')!, 'recover', 'another-parent-password'), /already used/)
  } finally {
    globalThis.fetch = realFetch; db.close(); rmSync(root, { recursive: true, force: true })
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
})

test('email configuration rejects an incomplete or unknown selected provider', () => {
  const saved = Object.fromEntries(['TUTOR_MAIL_PROVIDER', 'TUTOR_MAIL_FROM', 'TUTOR_SMTP_URL', 'RESEND_API_KEY'].map(k => [k, process.env[k]]))
  try {
    Object.assign(process.env, { TUTOR_MAIL_FROM: 'Synthetic <account@example.invalid>', TUTOR_SMTP_URL: 'smtp://127.0.0.1:1', TUTOR_MAIL_PROVIDER: 'resend' })
    delete process.env.RESEND_API_KEY
    assert.equal(parentMailConfigured(), false)
    process.env.RESEND_API_KEY = 'synthetic-key'; assert.equal(parentMailConfigured(), true)
    process.env.TUTOR_MAIL_PROVIDER = 'unsupported'; assert.equal(parentMailConfigured(), false)
    process.env.TUTOR_MAIL_PROVIDER = 'smtp'; assert.equal(parentMailConfigured(), true)
    delete process.env.TUTOR_MAIL_FROM; assert.equal(parentMailConfigured(), false)
  } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } }
})
