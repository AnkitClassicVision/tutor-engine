import { test, expect, type Page } from '@playwright/test'
import { settledAudit } from './settled-audit.ts'

const birthday = (years: number) => new Date(Date.now() - years * 365.25 * 86400000).toISOString().slice(0, 10)

async function speechStub(page: Page) {
  await page.addInitScript(() => {
    ;(window as any).__spoken = []
    Object.defineProperty(window, 'speechSynthesis', { value: { speak: (u: any) => (window as any).__spoken.push(u.text), cancel: () => {} }, configurable: true })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class { text: string; constructor(text: string) { this.text = text } }, configurable: true })
  })
}

async function onboard(page: Page, years: number) {
  await page.goto('/')
  await page.getByText('Create an account', { exact: true }).click()
  const form = page.locator('form[action="/register"]')
  await expect(form.locator('[name="csrf"]')).not.toHaveValue('')
  await form.getByLabel('Email').fill(`bands-${crypto.randomUUID()}@example.invalid`)
  await form.getByLabel('Password', { exact: true }).fill('long-bands-fixture-password')
  await form.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Synthetic learner')
  await page.getByLabel('Birthday', { exact: true }).fill(birthday(years))
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  await page.waitForURL(u => /^\/(students\/|welcome\/ai)/.test(u.pathname)); if (new URL(page.url()).pathname === '/welcome/ai') await page.getByRole('link', { name: 'Skip for now', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Synthetic learner/ }).first()).toBeVisible()
  return page.url().split('/').at(-1)!
}

test('ages 5–7 hear the question on arrival, answer first checks with tiles, and can turn reading off', async ({ page }) => {
  await speechStub(page)
  const student = await onboard(page, 6.5)
  await expect(page.locator('[data-band="5-7"]')).toBeVisible()
  await page.goto(`/students/${student}/map`)
  await page.getByRole('button', { name: 'Try a harder one' }).first().click()
  await expect(page.locator('form.answer')).toBeVisible()
  const question = (await page.locator('.question-text').innerText()).replace(/[\u2022\u25A0-\u25FF\u2600-\u27BF]/g, ' ').replace(/\s+/g, ' ').trim()
  await expect.poll(() => page.evaluate(() => (window as any).__spoken.length)).toBeGreaterThan(0)
  expect(await page.evaluate(() => (window as any).__spoken[0])).toBe(question)
  expect((await (await settledAudit(page)).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map((v) => v.id)).toEqual([])
  // Reading off is remembered on this device: the next load stays quiet.
  await page.getByLabel('Read questions to me', { exact: true }).uncheck()
  await page.reload()
  await expect(page.locator('form.answer')).toBeVisible()
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => (window as any).__spoken.length)).toBe(0)
  await expect(page.getByLabel('Read questions to me', { exact: true })).not.toBeChecked()
  // Find a number question in this first check: it is answered with large tiles.
  for (let i = 0; i < 6 && !(await page.locator('fieldset.choices').count()) && await page.locator('form.answer').count(); i++) {
    await page.getByRole('textbox', { name: /^(Answer|Your steps)$/ }).fill('7')
    await page.getByRole('button', { name: 'Check', exact: true }).click()
    const ready = page.getByRole('button', { name: 'Ready for a fresh question', exact: true })
    if (await ready.count()) await ready.click()
    const next = page.getByRole('link', { name: 'See your next step' })
    if (await next.count()) await next.click()
  }
  const tiles = page.locator('fieldset.choices .choice')
  await expect(tiles).toHaveCount(4)
  const box = (await tiles.first().boundingBox())!
  expect(box.height).toBeGreaterThanOrEqual(64)
})

test('reading aloud stays on with reduced motion, and each child on a shared device keeps their own choice', async ({ page, context }) => {
  await speechStub(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const openQuestion = async (student: string) => {
    await page.goto(`/students/${student}/map`)
    await page.getByRole('button', { name: 'Try a harder one' }).first().click()
    await expect(page.locator('form.answer')).toBeVisible()
  }
  // Less motion does not mean less reading: the question is still read on arrival.
  await openQuestion(await onboard(page, 6.5))
  await expect.poll(() => page.evaluate(() => (window as any).__spoken.length)).toBeGreaterThan(0)
  await page.getByLabel('Read questions to me', { exact: true }).uncheck()
  // A sibling on the same device starts with reading on.
  await context.clearCookies()
  await openQuestion(await onboard(page, 6))
  await expect(page.getByLabel('Read questions to me', { exact: true })).toBeChecked()
  await expect.poll(() => page.evaluate(() => (window as any).__spoken.length)).toBeGreaterThan(0)
})

test('ages 5–7 bring a photo without filling in a form', async ({ page }) => {
  const student = await onboard(page, 6.5)
  await page.goto(`/students/${student}/materials/new`)
  // Only the photo is asked for; the details have defaults a grown-up can change.
  await expect(page.getByLabel('Give it a name')).toBeHidden()
  await page.getByText('About this page (a grown-up can change this)', { exact: true }).click()
  await expect(page.getByLabel('Give it a name')).toHaveValue('My homework page')
  expect((await (await settledAudit(page)).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map((v) => v.id)).toEqual([])
})

test('ages 11–14 keep typed answers and no reading on arrival', async ({ page }) => {
  await speechStub(page)
  const student = await onboard(page, 12)
  await expect(page.locator('[data-band="11-14"]')).toBeVisible()
  await page.goto(`/students/${student}/map`)
  // The browser notes when the question is actually on screen.
  const seen = page.waitForRequest(request => request.url().endsWith('/seen') && JSON.parse(request.postData() ?? '{}').what === 'question')
  await page.getByRole('button', { name: 'Try a harder one' }).first().click()
  await expect(page.locator('form.answer')).toBeVisible()
  expect(JSON.parse((await seen).postData() ?? '{}').itemId).toBe(await page.locator('form.answer [name=itemId]').inputValue())
  await expect(page.locator('fieldset.choices')).toHaveCount(0)
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => (window as any).__spoken.length)).toBe(0)
  // Choosing to hear the question is noted as access support on that question.
  const noted = page.waitForRequest(request => request.url().endsWith('/access') && request.method() === 'POST')
  await page.locator('.prompt').getByRole('button', { name: 'Read aloud', exact: true }).click()
  const body = JSON.parse((await noted).postData() ?? '{}')
  expect(body.kind).toBe('read_aloud'); expect(body.itemId).toBe(await page.locator('form.answer [name=itemId]').inputValue())
  expect((await (await noted).response())?.status()).toBe(200)
})
