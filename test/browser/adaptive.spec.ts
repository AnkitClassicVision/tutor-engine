import { test, expect, type Page } from '@playwright/test'
import { settledAudit } from './settled-audit.ts'

async function sendAnswer(page: Page, value: string) {
  await page.getByLabel('Answer', { exact: true }).fill(value)
  const responsePromise = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/answer'))
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  const response = await responsePromise
  const destination = response.headers().location
  expect(destination).toBeTruthy()
  await page.waitForURL(new URL(destination, page.url()).href)
  if (new URL(page.url()).pathname.startsWith('/jobs/')) await page.getByRole('link', { name: 'See your next step' }).click()
}

test('adaptive choices, harder probe, teaching recovery and saved summary', async ({ page }, info) => {
  await page.goto('/')
  await page.getByText('Create an account', { exact: true }).click()
  const form = page.locator('form[action="/register"]')
  await expect(form.locator('[name="csrf"]')).not.toHaveValue('')
  await form.getByLabel('Email').fill(`adaptive-browser-${crypto.randomUUID()}@example.com`)
  await form.getByLabel('Password', { exact: true }).fill('synthetic-browser-password')
  await form.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill('Synthetic learner')
  await page.getByLabel('Birthday', { exact: true }).fill('2018-03-04')
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  await page.waitForURL(u => /^\/(students\/|welcome\/ai)/.test(u.pathname)); if (new URL(page.url()).pathname === '/welcome/ai') await page.getByRole('link', { name: 'Skip for now', exact: true }).click()
  const home = page.url()
  await page.goto('/settings')
  await page.getByLabel('Which AI').selectOption('openai')
  await page.getByRole('textbox', { name: 'API key', exact: true }).fill('synthetic-fixture-key')
  await page.getByRole('button', { name: 'Save AI' }).click()
  await page.waitForURL(u => u.searchParams.has('notice'))
  await page.goto(home)
  await expect(page.getByRole('heading', { name: 'More to do' })).toBeVisible()
  await expect(page.getByText('Your first keepsake is waiting', { exact: false })).toBeVisible()
  await page.screenshot({ path: `evidence/screenshots/adaptive-${info.project.name}-home.png`, fullPage: true })
  await page.getByRole('link', { name: 'Another topic', exact: false }).click()
  await expect(page.getByRole('button', { name: 'Try a harder one' }).first()).toBeVisible()
  const audit = await (await settledAudit(page)).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(audit.violations.map(v => v.id)).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `evidence/screenshots/adaptive-${info.project.name}-map.png`, fullPage: true })
  await page.getByRole('button', { name: 'Try a harder one' }).first().click()
  await expect(page.locator('form.answer')).toBeVisible()
  const question = await page.locator('.question-text').innerText()
  await sendAnswer(page, 'definitely wrong 12345')
  await expect(page.getByText('Show me how', { exact: true }).first()).toBeVisible()
  for (const opener of await page.getByText('Show me how', { exact: true }).all()) await opener.click()
  await expect(page.getByText('The answer:', { exact: false }).first()).toBeVisible()
  const ready = page.getByRole('button', { name: 'Ready for a fresh question', exact: true })
  // Wait for the fresh question's page, or the typed draft lands on the page being replaced.
  if (await ready.count()) { await ready.click(); await expect(ready).toHaveCount(0) }
  await page.getByLabel('Answer', { exact: true }).fill('saved thinking')
  await page.getByRole('button', { name: 'Save & stop', exact: true }).click()
  await page.getByRole('button', { name: 'Pick up where I left off', exact: false }).click()
  await expect(page.getByLabel('Answer', { exact: true })).toHaveValue('saved thinking')
  expect(await page.locator('.question-text').innerText()).not.toEqual(question)
  // Wrong tries until the mission closes; a teaching reset can end it early.
  for (let i = 0; i < 6 && await page.getByLabel('Answer', { exact: true }).count(); i++) {
    await sendAnswer(page, 'definitely wrong 12345')
    if (await ready.count()) await ready.click()
  }
  await expect(page.getByRole('heading', { name: 'Look what you did', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next mission:', exact: false })).toBeVisible()
  // A planned finish leads with Done for today; other paths wait behind one tap.
  const done = page.getByRole('link', { name: 'Done for today', exact: true })
  await expect(done).toBeVisible(); await expect(done).not.toHaveClass(/ghost/)
  await expect(page.getByRole('button', { name: 'Next mission:', exact: false })).toHaveClass(/ghost/)
  await done.click()
  await expect(page.getByRole('status').filter({ hasText: 'All done for today. Your work is saved.' })).toBeVisible()
  await page.goto(home)
  await expect(page.getByText('Your first keepsake is waiting', { exact: false })).toBeVisible()
})
