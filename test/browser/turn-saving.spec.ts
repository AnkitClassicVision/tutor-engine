import { test, expect, type Page } from '@playwright/test'

async function onboard(page: Page, age = 9) {
  await page.goto('/')
  await page.getByText('Create an account', { exact: true }).click()
  const form = page.locator('form[action="/register"]')
  await form.getByLabel('Email').fill(`turn-${crypto.randomUUID()}@example.invalid`)
  await form.getByLabel('Password', { exact: true }).fill('synthetic-turn-password')
  await form.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Synthetic turn learner')
  await page.getByLabel('Birthday', { exact: true }).fill(new Date(Date.now() - age * 365.25 * 86400000).toISOString().slice(0, 10))
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  await page.waitForURL(u => /^\/(students\/|welcome\/ai)/.test(u.pathname))
  if (new URL(page.url()).pathname === '/welcome/ai') await page.getByRole('link', { name: 'Skip for now', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Hey, Synthetic turn learner/ })).toBeVisible()
}

async function question(page: Page) {
  await onboard(page)
  await page.getByRole('button', { name: 'Let’s go' }).click()
  await page.waitForLoadState('load')
  return page.getByRole('textbox', { name: /^(Answer|Your steps)$/ })
}

test('a slow save cannot acknowledge a newer edit, and pause waits for the latest draft', async ({ page }) => {
  const field = await question(page), sent: string[] = []
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/session/*/draft', async route => {
    sent.push(route.request().postDataJSON().answer)
    const response = await route.fetch()
    if (sent.length === 1) await held
    await route.fulfill({ response })
  })
  await field.fill('first draft')
  await expect.poll(() => sent.length).toBe(1)
  await field.fill('the latest reasoning')
  await expect(page.locator('[data-draft-status]')).not.toHaveText('Draft saved.')
  await page.getByRole('button', { name: 'Save & stop', exact: true }).click()
  await expect(field).toHaveValue('the latest reasoning')
  expect(sent).toEqual(['first draft'])
  release()
  await expect(page.getByRole('button', { name: /Pick up where/ })).toBeVisible()
  await page.getByRole('button', { name: /Pick up where/ }).click()
  await expect(field).toHaveValue('the latest reasoning')
  expect(sent).toEqual(['first draft', 'the latest reasoning'])
  await expect(page.locator('[data-draft-status]')).toHaveText('Draft saved.')
  // An already saved draft needs no request; the immediate acknowledgment must still allow pausing.
  await page.getByRole('button', { name: 'Save & stop', exact: true }).click()
  await page.getByRole('button', { name: /Pick up where/ }).click()
  await expect(field).toHaveValue('the latest reasoning')
})

test('failed saves stay editable even when tab storage is disabled, and recovery confirms a server save', async ({ page }) => {
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem', 'removeItem']) Object.defineProperty(Storage.prototype, method, { value() { throw new DOMException('Storage unavailable', 'SecurityError') } })
  })
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const field = await question(page)
  for (const path of ['draft', 'answer']) await page.route(`**/session/*/${path}`, route => route.fulfill({ status: 503, json: { error: 'Synthetic interruption' } }))
  await field.fill('my response survives here')
  await expect(page.locator('[data-draft-status]')).toContainText('Keep this page open')
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  await expect(page.locator('[data-submit-status]')).toContainText('Save not confirmed')
  await expect(field).toHaveValue('my response survives here')
  await expect(page.getByRole('button', { name: 'Check', exact: true })).toBeEnabled()
  await expect(page.locator('[data-session-deadline]')).not.toContainText('saved')
  await page.unroute('**/session/*/draft'); await page.unroute('**/session/*/answer')
  await page.getByRole('button', { name: 'Try saving again', exact: true }).click()
  await expect(page.locator('[data-draft-status]')).toHaveText('Draft saved.')
  await page.reload(); await expect(field).toHaveValue('my response survives here')
  expect(errors).toEqual([])
})

test('Save & stop retains typed work when the enhancement script cannot load', async ({ page }) => {
  const field = await question(page)
  await page.route('**/journey.js', route => route.abort())
  await page.reload()
  await field.fill('my draft without the enhancement script')
  await page.getByRole('button', { name: 'Save & stop', exact: true }).click()
  await page.getByRole('button', { name: /Pick up where/ }).click()
  await expect(field).toHaveValue('my draft without the enhancement script')
})

test('save acknowledgment is neutral, measured after the reply, and format help uses the access route', async ({ page }) => {
  const field = await question(page)
  const access = page.waitForRequest(request => request.url().endsWith('/access') && request.postDataJSON().kind === 'format_help')
  await page.getByText('How to enter an answer', { exact: true }).click()
  await access
  let release!: () => void, ack: any
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/session/*/answer', async route => {
    const response = await route.fetch(); ack = await response.json()
    await held; await route.fulfill({ response })
  })
  const measured = page.waitForRequest(request => request.url().endsWith('/save-seen'))
  await field.fill('I use equal groups because each basket holds the same number.')
  const submit = page.getByRole('button', { name: 'Check', exact: true })
  await submit.focus(); await submit.press('Enter')
  await expect(page.locator('[data-submit-status]')).toHaveText('Saving your answer…')
  await expect.poll(() => ack?.saved).toBe(true)
  expect(Object.keys(ack)).not.toContain('correct')
  const beforeRelease = Date.now(); release()
  const timing = (await measured).postDataJSON()
  expect(timing.elapsedMs).toBeGreaterThan(0)
  expect(Date.now()).toBeGreaterThanOrEqual(beforeRelease)
  expect(Object.keys(timing).sort()).toEqual(['csrf', 'elapsedMs', 'itemId', 'revision'])
  await expect(page).toHaveURL(new RegExp(`${ack.location.replace(/[?]/g, '\\?')}$`))
})

for (const noAi of [false, true]) for (const age of [6, 9, 12]) test(`age ${age}${noAi ? ' without AI' : ''} has its mission and capability notice in the first view`, async ({ page }, info) => {
  if (noAi) {
    await page.goto('/')
    const login = page.locator('form[action="/login"]')
    await login.getByLabel('Email').fill(`no-ai-${info.project.name}@example.invalid`)
    await login.getByLabel('Password', { exact: true }).fill('synthetic-browser-password')
    await login.getByRole('button', { name: 'Enter', exact: true }).click()
    await page.getByRole('link', { name: new RegExp(`Synthetic capability ${age}`) }).first().click()
  } else await onboard(page, age)
  await page.getByRole('button', { name: 'Start student mode', exact: true }).click()
  const navigation = await page.locator('.journey-nav').evaluate(node => ({ fixed: getComputedStyle(node).position === 'fixed', top: node.getBoundingClientRect().top }))
  for (const control of [page.getByRole('button', { name: 'Let’s go' }), page.locator('[data-capability-notice]')]) {
    await expect(control).toBeVisible()
    const box = (await control.boundingBox())!, viewport = page.viewportSize()!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(navigation.fixed ? navigation.top : viewport.height)
  }
  await page.screenshot({ path: `evidence/screenshots/turn-home-${age}-${noAi ? 'no-ai' : 'connected'}-${info.project.name}.png` })
  await expect(page.getByRole('heading', { name: 'Homework help', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Change world', exact: true })).toBeVisible()
})
