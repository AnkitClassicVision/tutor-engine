import { test, expect, type Page } from '@playwright/test'
import { settledAudit } from './settled-audit.ts'
import { devices } from '../device-fixture.ts'

async function livePage(page: Page) {
  await devices(page, true)
  await page.addInitScript(() => {
    class AudioContext {
      createAnalyser() { return { fftSize: 256, getByteTimeDomainData: (a: Uint8Array) => a.fill(128) } }
      createMediaStreamSource() { return { connect() {} } }
      close() { return Promise.resolve() }
    }
    Object.defineProperty(window, 'AudioContext', { value: AudioContext, configurable: true })
    ;(window as any).__peers = []
    class Peer {
      connectionState = 'new'; closed = false; audioTracks: any[] = []; sent: any[] = []
      ontrack: any; onconnectionstatechange: any
      channel: any
      constructor() { (window as any).__peers.push(this) }
      addTrack(track: any) { this.audioTracks.push(track) }
      createDataChannel() { const peer = this; return this.channel = { readyState: 'connecting', bufferedAmount: 0, send(value: string) { const event = JSON.parse(value); peer.sent.push(event); if (event.type === 'conversation.item.create') this.onmessage?.({ data: JSON.stringify({ type: 'conversation.item.added', item: event.item }) }) }, close() { this.readyState = 'closed'; this.onclose?.() }, onopen: null, onmessage: null, onclose: null } }
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\nsynthetic-offer' } }
      async setLocalDescription() {}
      async setRemoteDescription() { this.connectionState = 'connected'; this.channel.readyState = 'open'; this.channel.onopen?.() }
      close() { this.closed = true; this.connectionState = 'closed'; this.onconnectionstatechange?.() }
    }
    Object.defineProperty(window, 'RTCPeerConnection', { value: Peer, configurable: true })
  })
  await page.goto('/')
  await page.getByText('Create an account', { exact: true }).click()
  const form = page.locator('form[action="/register"]')
  await expect(form.locator('[name="csrf"]')).not.toHaveValue('')
  await form.getByLabel('Email').fill(`live-${crypto.randomUUID()}@example.invalid`)
  await form.getByLabel('Password', { exact: true }).fill('long-live-fixture-password')
  await form.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Synthetic learner')
  await page.getByLabel('Birthday', { exact: true }).fill('2018-03-04')
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  await page.waitForURL(u => /^\/(students\/|welcome\/ai)/.test(u.pathname)); if (new URL(page.url()).pathname === '/welcome/ai') await page.getByRole('link', { name: 'Skip for now', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Hey, Synthetic learner/ })).toBeVisible()
  const student = page.url().split('/').at(-1)!
  await page.goto(`/students/${student}/parent`)
  await page.getByRole('link', { name: 'Live tutor · camera and voice' }).click()
  await expect(page.getByRole('heading', { name: 'Talk and show your work' })).toBeVisible()
  return student
}

test('live device check sends no AI request, supports mute/camera controls and releases devices', async ({ page }) => {
  await livePage(page)
  expect(await page.evaluate(() => (window as any).__camera.calls.length)).toBe(0)
  await expect(page.getByRole('button', { name: 'Start live tutor' })).toBeDisabled()
  let calls = 0; page.on('request', r => { if (r.method() === 'POST' && /\/live$/.test(new URL(r.url()).pathname)) calls++ })
  await page.getByRole('button', { name: 'Check camera and microphone' }).click()
  await expect(page.locator('[data-live-status]')).toContainText('Nothing is sent')
  await page.getByRole('button', { name: 'Mute microphone', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__deviceStream.getAudioTracks()[0].enabled)).toBe(false)
  await page.getByRole('button', { name: 'Unmute microphone' }).click()
  expect(await page.evaluate(() => (window as any).__deviceStream.getAudioTracks()[0].enabled)).toBe(true)
  await page.getByRole('button', { name: 'Turn camera off' }).click()
  expect(await page.evaluate(() => (window as any).__deviceStream.getVideoTracks().length)).toBe(0)
  await page.getByRole('button', { name: 'Turn camera on' }).click()
  await expect(page.getByRole('button', { name: 'Turn camera off' })).toBeVisible()
  expect((await (await settledAudit(page)).analyze()).violations).toEqual([])
  await page.getByRole('button', { name: 'Stop device check' }).click()
  expect(await page.evaluate(() => (window as any).__camera.stops)).toBe(3)
  expect(calls).toBe(0)
  await expect(page.locator('[data-live-status]')).toContainText('are off')
})

test('synthetic live transport shares audio and periodic images, prunes old images and stops on end', async ({ page }) => {
  const student = await livePage(page)
  let connections = 0
  await page.route(`**/students/${student}/live`, async route => {
    if (route.request().method() !== 'POST') return route.continue()
    const body = route.request().postDataJSON(); expect(body.csrf).toBeTruthy(); expect(body.sdp).toContain('synthetic-offer'); connections++
    await route.fulfill({ json: { sdp: 'v=0\r\nsynthetic-answer' } })
  })
  // Only this fixture enables the UI. The production server activation gate stays off.
  await page.evaluate(() => { document.querySelector<HTMLElement>('[data-live-tutor]')!.dataset.available = 'true'; (document.querySelector('[data-live-start]') as HTMLButtonElement).disabled = false })
  await page.clock.install()
  await page.getByRole('button', { name: 'Start live tutor' }).click()
  await expect(page.locator('[data-live-status]')).toContainText('connected')
  expect(connections).toBe(1)
  expect(await page.evaluate(() => (window as any).__peers[0].audioTracks.length)).toBe(1)
  await page.clock.runFor(10000)
  const sent = await page.evaluate(() => (window as any).__peers[0].sent)
  expect(sent.filter((e: any) => e.type === 'conversation.item.create').length).toBeGreaterThanOrEqual(4)
  expect(sent.some((e: any) => e.type === 'conversation.item.delete')).toBe(true)
  expect(sent[0].item.content[0].image_url).toMatch(/^data:image\/jpeg;base64,/)
  await page.evaluate(() => (window as any).__peers[0].channel.onmessage({ data: JSON.stringify({ type: 'response.output_audio_transcript.done', transcript: 'Synthetic tutor reply' }) }))
  await expect(page.locator('[data-live-caption]')).toHaveText('Synthetic tutor reply')
  await page.getByRole('button', { name: 'Turn camera off' }).click()
  const imageCount = await page.evaluate(() => (window as any).__peers[0].sent.filter((e: any) => e.type === 'conversation.item.create').length)
  await page.clock.fastForward(6000)
  expect(await page.evaluate(() => (window as any).__peers[0].sent.filter((e: any) => e.type === 'conversation.item.create').length)).toBe(imageCount)
  await page.getByRole('button', { name: 'End conversation' }).click()
  expect(await page.evaluate(() => (window as any).__peers[0].closed)).toBe(true)
  expect(await page.evaluate(() => (window as any).__camera.stops)).toBe(2)
  await expect(page.locator('[data-live-caption]')).toBeEmpty()
})

test('live permission denial, canceled late grants, connection failures and five-minute timeout release devices', async ({ page }) => {
  const student = await livePage(page)
  await page.evaluate(() => { (window as any).__camera.deny = true })
  await page.getByRole('button', { name: 'Check camera and microphone' }).click()
  await expect(page.locator('[data-live-status]')).toContainText('denied')
  await page.evaluate(() => { (window as any).__camera.deny = false; (window as any).__camera.pending = true })
  await page.getByRole('button', { name: 'Check camera and microphone' }).click()
  await page.getByRole('button', { name: 'Stop device check' }).click()
  await page.evaluate(() => (window as any).__camera.resolve())
  await expect.poll(() => page.evaluate(() => (window as any).__camera.stops)).toBe(2)
  await expect(page.locator('[data-live-preview]')).toBeHidden()
  await page.evaluate(() => { (window as any).__camera.pending = false; document.querySelector<HTMLElement>('[data-live-tutor]')!.dataset.available = 'true'; (document.querySelector('[data-live-start]') as HTMLButtonElement).disabled = false })
  await page.route(`**/students/${student}/live`, route => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { error: 'Synthetic failure' } }) : route.continue())
  await page.getByRole('button', { name: 'Start live tutor' }).click()
  await expect(page.locator('[data-live-status]')).toContainText('Could not start')
  expect(await page.evaluate(() => (window as any).__camera.stops)).toBe(4)
  await page.clock.install()
  await page.getByRole('button', { name: 'Check camera and microphone' }).click()
  await expect(page.locator('[data-live-status]')).toContainText('Device check:')
  await page.clock.fastForward(300001)
  await expect(page.locator('[data-live-status]')).toContainText('Five minutes finished')
  expect(await page.evaluate(() => (window as any).__camera.stops)).toBe(6)
})
