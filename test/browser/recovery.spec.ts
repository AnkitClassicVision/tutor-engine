import { test, expect, type Page } from '@playwright/test'

async function onboard(page: Page) {
  await page.goto('/')
  await page.getByText('Create an account', { exact: true }).click()
  const form = page.locator('form[action="/register"]')
  await form.getByLabel('Email').fill(`recovery-${crypto.randomUUID()}@example.com`)
  await form.getByLabel('Password', { exact: true }).fill('long-browser-password')
  await form.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name', { exact: true }).fill('June')
  await page.getByLabel('Birthday', { exact: true }).fill('2018-03-04')
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  await page.waitForURL(u => /^\/(students\/|welcome\/ai)/.test(u.pathname)); if (new URL(page.url()).pathname === '/welcome/ai') await page.getByRole('link', { name: 'Skip for now', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Hey, June/ })).toBeVisible()
  return page.url().split('/').at(-1)!
}

test('an answer survives a failed submission even when autosave also fails', async ({ page }) => {
  await onboard(page)
  await page.getByRole('button', { name: 'Let’s go' }).click()
  const mission = page.url()
  const answer = page.getByLabel('Answer', { exact: true })
  await expect(answer).toBeVisible()
  await page.waitForLoadState('load')
  await page.route('**/session/*/draft', route => route.abort('internetdisconnected'))
  await page.route('**/session/*/answer', route => route.abort('internetdisconnected'))
  await answer.fill('My unsaved reasoning survives the connection failure')
  const failed = page.waitForEvent('requestfailed', request => request.url().endsWith('/answer'))
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  await failed
  // Native aborted-form error navigation settles after requestfailed in Chromium.
  await expect(async () => {
    await page.goto(mission)
    await expect(answer).toHaveValue('My unsaved reasoning survives the connection failure')
  }).toPass({ timeout: 15000, intervals: [250, 500] })
  await page.unroute('**/session/*/draft')
  await page.unroute('**/session/*/answer')
  await page.getByRole('button', { name: 'Save & stop' }).click()
  await page.getByRole('button', { name: /Pick up where/ }).click()
  await expect(answer).toHaveValue('My unsaved reasoning survives the connection failure')
})

test('retrying a photo save after a lost response creates one schoolwork record', async ({ page }) => {
  const student = await onboard(page)
  await page.goto(`/students/${student}/materials/new`)
  await page.getByLabel('Give it a name').fill('Recovered homework')
  await page.locator('[data-pages]').setInputFiles({ name: 'homework.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nO3NQQkAAAgEsOtvODPYxBQ+hMH+S02fikAgEAgEAoFAIPgSLOeI7HlLIQSFAAAAAElFTkSuQmCC', 'base64') })
  await expect(page.getByRole('img', { name: 'Preview of page 1' })).toBeVisible()
  const requests: { requestId: string; pages: unknown }[] = []
  await page.route(`**/students/${student}/materials`, async route => {
    requests.push(route.request().postDataJSON())
    if (requests.length === 1) {
      const saved = await route.fetch()
      expect(saved.status()).toBe(201)
      await route.abort('internetdisconnected')
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'Save my pages' }).click()
  await expect(page.locator('[data-upload-status]')).toContainText('Connection paused')
  await expect(page.getByRole('img', { name: 'Preview of page 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Save my pages' }).click()
  await expect(page.getByRole('heading', { name: 'Recovered homework', exact: true })).toBeVisible()
  expect(requests).toHaveLength(2)
  expect(requests[1].requestId).toBe(requests[0].requestId)
  expect(requests[1].pages).toEqual(requests[0].pages)
  await page.goto(`/students/${student}/materials`)
  await expect(page.getByRole('heading', { name: 'Recovered homework', exact: true })).toHaveCount(1)
})

test('a late queued status cannot remove a completed job destination', async ({ page }) => {
  await page.addInitScript(() => {
    class Events {
      listener: any; onerror: any
      constructor() { (window as any).__jobEvents = this }
      addEventListener(_name: string, listener: any) { this.listener = listener }
      close() {}
    }
    Object.defineProperty(window, 'EventSource', { value: Events, configurable: true })
  })
  const student = await onboard(page), csrf = await page.locator('#csrf-store').inputValue()
  const created = await page.request.post(`/students/${student}/sheet`, { form: { csrf }, maxRedirects: 0 })
  expect(created.status()).toBe(303); await page.goto(created.headers().location)
  let release!: () => void, delivered!: () => void
  const hold = new Promise<void>(resolve => { release = resolve }), arrived = new Promise<void>(resolve => { delivered = resolve })
  await page.route('**/jobs/*/status', async route => {
    await hold
    await route.fulfill({ json: { status: 'queued', stage: 'Waiting to start', createdAt: new Date().toISOString(), result: null } })
    delivered()
  })
  await page.getByRole('button', { name: 'Download a PDF', exact: true }).click()
  await expect(page.locator('[data-job]')).toBeVisible()
  // The panel can render before the page scripts attach the stream; wait for the listener itself.
  await page.waitForFunction(() => typeof (window as any).__jobEvents?.listener === 'function')
  await page.evaluate(() => (window as any).__jobEvents.listener({ data: JSON.stringify({ status: 'succeeded', stage: 'Completed', createdAt: new Date().toISOString(), result: { file: true } }) }))
  const next = page.getByRole('link', { name: 'See your next step' })
  await expect(next).toBeVisible()
  release(); await arrived
  // Let the late fetch callback and its DOM rendering finish, without a timed sleep.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(next).toBeVisible(); await expect(page.locator('[data-job-stage]')).toHaveText('Completed')
})
