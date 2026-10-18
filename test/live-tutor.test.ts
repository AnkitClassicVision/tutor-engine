import test from 'node:test'
import assert from 'node:assert/strict'
import { connectLiveTutor, liveAvailability } from '../src/live-tutor.ts'

test('live activation, provider and offer gates prevent requests; the server keeps the key and sanitizes failures', async () => {
  const previous = process.env.TUTOR_LIVE_TUTOR_ENABLED, model = process.env.TUTOR_LIVE_MODEL
  const ai = { provider: 'openai' as const, apiKey: 'synthetic-server-key', model: 'text-model' }
  let calls = 0
  const request: typeof fetch = async (url, input) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/realtime/calls')
    assert.equal((input!.headers as any).Authorization, 'Bearer synthetic-server-key')
    assert.match((input!.headers as any)['OpenAI-Safety-Identifier'], /^[a-f0-9]{64}$/)
    const body = input!.body as FormData, config = JSON.parse(String(body.get('session')))
    assert.equal(body.get('sdp'), 'v=0\r\nsynthetic-offer')
    assert.equal(config.model, 'gpt-realtime-2.1'); assert.equal(config.type, 'realtime')
    assert.equal(config.audio.input.turn_detection.interrupt_response, true)
    assert.match(config.instructions, /Do not ask for personal information/)
    assert.doesNotMatch(JSON.stringify(config), /synthetic-owner|synthetic-student|synthetic-server-key/)
    return new Response('v=0\r\nsynthetic-answer')
  }
  try {
    delete process.env.TUTOR_LIVE_TUTOR_ENABLED; delete process.env.TUTOR_LIVE_MODEL
    assert.match(liveAvailability({ provider: 'openai', hasKey: true }), /waiting/)
    await assert.rejects(connectLiveTutor(ai, 'synthetic-owner', 'synthetic-student', 'v=0', request), /waiting/)
    process.env.TUTOR_LIVE_TUTOR_ENABLED = '1'
    await assert.rejects(connectLiveTutor({ ...ai, provider: 'openrouter' }, '', '', 'v=0', request), /OpenAI API key/)
    await assert.rejects(connectLiveTutor({ ...ai, apiKey: '' }, '', '', 'v=0', request), /OpenAI API key/)
    await assert.rejects(connectLiveTutor(ai, '', '', 'bogus', request), /offer was invalid/)
    await assert.rejects(connectLiveTutor(ai, '', '', 'v=0' + 'x'.repeat(64000), request), /offer was invalid/)
    assert.equal(calls, 0)
    assert.equal(await connectLiveTutor(ai, 'synthetic-owner', 'synthetic-student', 'v=0\r\nsynthetic-offer', request), 'v=0\r\nsynthetic-answer')
    assert.equal(calls, 1)
    await assert.rejects(connectLiveTutor(ai, '', '', 'v=0', async () => new Response('private provider details', { status: 401 })), /^Error: The live AI connection could not start/)
    await assert.rejects(connectLiveTutor(ai, '', '', 'v=0', async () => new Response('not an SDP')), /invalid answer/)
  } finally {
    if (previous === undefined) delete process.env.TUTOR_LIVE_TUTOR_ENABLED; else process.env.TUTOR_LIVE_TUTOR_ENABLED = previous
    if (model === undefined) delete process.env.TUTOR_LIVE_MODEL; else process.env.TUTOR_LIVE_MODEL = model
  }
})
