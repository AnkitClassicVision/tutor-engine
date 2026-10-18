import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const WORLDS = ['cartoon', '8bit', 'toybox', 'sticker', 'princess', 'booklet']

async function onboard(page: Page) {
  await page.goto('/')
  await page.getByText('Create an account', { exact: true }).click()
  const form = page.locator('form[action="/register"]')
  await expect(form.locator('[name="csrf"]')).not.toHaveValue('')
  await form.getByLabel('Email').fill(`worlds-${crypto.randomUUID()}@example.invalid`)
  await form.getByLabel('Password', { exact: true }).fill('long-worlds-fixture-password')
  await form.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Synthetic learner')
  await page.getByLabel('Birthday', { exact: true }).fill('2016-05-04')
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  await page.waitForURL(u => /^\/(students\/|welcome\/ai)/.test(u.pathname)); if (new URL(page.url()).pathname === '/welcome/ai') await page.getByRole('link', { name: 'Skip for now', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Hey, Synthetic learner/ })).toBeVisible()
  return page.url().split('/').at(-1)!
}

test('every world can be picked, styles the whole app and passes the accessibility audit', async ({ page }) => {
  test.setTimeout(180000)
  const student = await onboard(page)
  // New families start in Cartoon Club.
  await expect(page.locator('[data-world="cartoon"]').first()).toBeAttached()
  for (const world of WORLDS) {
    await page.goto(`/students/${student}`)
    await page.getByRole('link', { name: 'Change world', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Pick your world', exact: true })).toBeVisible()
    await page.locator(`[data-world-tile="${world}"]`).click()
    await expect(page).toHaveURL(new RegExp(`/students/${student}$`))
    await expect(page.locator(`[data-world="${world}"]`).first()).toBeAttached()
    // The mascot art for this world loads (same-origin, CSP-safe).
    const mascot = await page.locator('.today-greeting .companion').evaluate(el => getComputedStyle(el).backgroundImage)
    expect(mascot).toContain(`/worlds/${world}/bloop-wave.webp`)
    const art = await page.request.get(`/worlds/${world}/bloop-wave.webp`)
    expect(art.status()).toBe(200)
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(v => `${world}: ${v.id}`)).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})
