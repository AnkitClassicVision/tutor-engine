import { test, expect } from '@playwright/test'

// WF-09-A cases 4 and 5: after signing out, Back shows no family data and unsent drafts are gone.
test('signing out clears unsent drafts, and Back shows no parent page', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Create an account', { exact: true }).click()
  const form = page.locator('form[action="/register"]')
  await expect(form.locator('[name="csrf"]')).not.toHaveValue('')
  await form.getByLabel('Email').fill(`shared-${crypto.randomUUID()}@example.invalid`)
  await form.getByLabel('Password', { exact: true }).fill('long-shared-fixture-password')
  await form.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Synthetic sibling')
  await page.getByLabel('Birthday', { exact: true }).fill('2015-05-04')
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  await page.waitForURL(u => /^\/(students\/|welcome\/ai)/.test(u.pathname)); if (new URL(page.url()).pathname === '/welcome/ai') await page.getByRole('link', { name: 'Skip for now', exact: true }).click()
  // An unsent answer is kept as a draft in this tab.
  await page.getByRole('button', { name: 'Let’s go', exact: false }).click()
  await page.getByRole('textbox', { name: /^(Answer|Your steps)$/ }).fill('a draft the next person must not see')
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('draft:')).length)).toBeGreaterThan(0)
  // The parent opens the family page, then signs out.
  await page.goto('/students')
  await expect(page.getByRole('heading', { name: 'Family', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/students'))
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('draft:')).length)).toBe(0)
  // Back does not bring the family page or the learner's name back.
  await page.goBack()
  await page.waitForLoadState('load')
  await expect(page.getByRole('heading', { name: 'Family', exact: true })).toHaveCount(0)
  await expect(page.getByText('Synthetic sibling')).toHaveCount(0)
})
