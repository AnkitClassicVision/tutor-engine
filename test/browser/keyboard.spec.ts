import { test, expect, type Page } from '@playwright/test'

// WF-02-A: a mission can be started, answered and saved with the keyboard alone.
async function tabTo(page: Page, name: RegExp) {
  await page.waitForLoadState('load')
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab')
    // A form sent with Enter may still be navigating; wait for the new page and keep tabbing.
    const label = await page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? (el.getAttribute('aria-label') || el.innerText || (el as HTMLInputElement).value || el.getAttribute('name') || '').trim() : '' }).catch(async () => { await page.waitForLoadState('load'); return '' })
    if (name.test(label)) return
  }
  throw new Error(`Could not reach ${name} with Tab`)
}

test('a mission starts, takes an answer and saves with the keyboard alone', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Safari moves Tab focus only to form fields unless its "press Tab to highlight each item" setting is on')
  await page.goto('/')
  await page.getByText('Create an account', { exact: true }).click()
  const form = page.locator('form[action="/register"]')
  await expect(form.locator('[name="csrf"]')).not.toHaveValue('')
  await form.getByLabel('Email').fill(`keys-${crypto.randomUUID()}@example.invalid`)
  await form.getByLabel('Password', { exact: true }).fill('long-keys-fixture-password')
  await form.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Synthetic keys')
  await page.getByLabel('Birthday', { exact: true }).fill('2015-05-04')
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  await page.waitForURL(u => /^\/(students\/|welcome\/ai)/.test(u.pathname)); if (new URL(page.url()).pathname === '/welcome/ai') await page.getByRole('link', { name: 'Skip for now', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Hey, Synthetic keys/ })).toBeVisible()
  // From here on, only the keyboard.
  await tabTo(page, /let.s go/i)
  await page.keyboard.press('Enter')
  await expect(page.locator('form.answer')).toBeVisible()
  await tabTo(page, /^answer$/i)
  await page.keyboard.type('I would work through the quantities in the question in order.')
  // Enter in a steps box adds a line. Tab to Check and activate it with Enter for either response control.
  await tabTo(page, /^check$/i)
  await Promise.all([page.waitForEvent('domcontentloaded'), page.keyboard.press('Enter')])
  // A written answer goes to the checking page; the keyboard path back is "Return to my saved work".
  if (new URL(page.url()).pathname.startsWith('/jobs/')) { await tabTo(page, /return to my saved work/i); await page.keyboard.press('Enter'); await page.waitForURL(u => u.pathname.startsWith('/session/')) }
  await tabTo(page, /save & stop/i)
  await page.keyboard.press('Enter')
  await expect(page.getByText('Your unfinished mission is waiting.', { exact: false })).toBeVisible()
  // Focus is always visible while tabbing.
  await page.keyboard.press('Tab')
  const outline = await page.evaluate(() => { const el = document.activeElement as HTMLElement; const s = getComputedStyle(el); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 })
  expect(outline).toBe(true)
})
