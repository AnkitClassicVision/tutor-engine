import test from 'node:test'
import assert from 'node:assert/strict'
import { detectProvider, checkKey, quickConnect, safeNext } from '../src/ai-connect.ts'
import { openDb } from '../src/db.ts'
import { registerUser } from '../src/auth.ts'
import { aiSettings } from '../src/services.ts'

test('keys are recognised by their prefix', () => {
  assert.equal(detectProvider('sk-or-v1-abc'), 'openrouter')
  assert.equal(detectProvider('sk-ant-api03-abc'), 'anthropic')
  assert.equal(detectProvider('xai-abc'), 'xai')
  assert.equal(detectProvider('sk-proj-abc'), 'openai')
  assert.equal(detectProvider('hello'), null)
})

test('only a clear refusal blocks a key; a network hiccup does not', async () => {
  const status = (code: number) => (async () => new Response('{}', { status: code })) as unknown as typeof fetch
  assert.equal(await checkKey('openai', 'sk-x', status(200)), 'ok')
  assert.equal(await checkKey('openai', 'sk-x', status(401)), 'rejected')
  assert.equal(await checkKey('anthropic', 'sk-ant-x', status(403)), 'rejected')
  assert.equal(await checkKey('xai', 'xai-x', status(500)), 'unknown')
  assert.equal(await checkKey('openrouter', 'sk-or-x', (async () => { throw new Error('offline') }) as unknown as typeof fetch), 'unknown')
})

test('a pasted key is saved with the right provider and ready-to-use models; a refused key is not saved', async () => {
  const db = openDb(':memory:')
  try {
    const user = await registerUser(db, 'quick-connect@example.invalid', 'synthetic-password'); assert.ok(user.ok)
    const ok = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    await assert.rejects(quickConnect(db, user.userId, 'sk-or-refused', (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch), /didn’t accept/)
    assert.equal((await aiSettings(db, user.userId)).hasKey, false)
    assert.equal(await quickConnect(db, user.userId, '  sk-or-v1-synthetic  ', ok), 'openrouter')
    const settings = await aiSettings(db, user.userId)
    assert.equal(settings.provider, 'openrouter'); assert.equal(settings.hasKey, true); assert.equal(settings.model, 'openai/gpt-4.1-mini')
    await assert.rejects(quickConnect(db, user.userId, 'sk has spaces', ok), /doesn’t look like an API key/)
  } finally { db.close() }
})

test('the next step after connecting can only be a child page or AI settings', () => {
  assert.equal(safeNext('/students/0f8fad5b-d9cb-469f-a165-70867728950e'), '/students/0f8fad5b-d9cb-469f-a165-70867728950e')
  assert.equal(safeNext('/students/0f8fad5b-d9cb-469f-a165-70867728950e/parent'), '/students/0f8fad5b-d9cb-469f-a165-70867728950e/parent')
  assert.equal(safeNext('https://evil.example/'), '/students')
  assert.equal(safeNext('//evil.example'), '/students')
})
