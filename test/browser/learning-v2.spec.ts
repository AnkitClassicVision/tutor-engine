import { test, expect, type Page } from '@playwright/test'
import { settledAudit } from './settled-audit.ts'

async function onboard(page: Page) {
  await page.goto('/')
  await page.getByText('Create an account', { exact: true }).click()
  const form = page.locator('form[action="/register"]')
  await expect(form.locator('[name="csrf"]')).not.toHaveValue('')
  await form.getByLabel('Email').fill(`v2-${crypto.randomUUID()}@example.com`)
  await form.getByLabel('Password', { exact: true }).fill('long-browser-password')
  await form.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name', { exact: true }).fill('June')
  await page.getByLabel('Birthday', { exact: true }).fill('2016-03-04')
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  await page.waitForURL(u => /^\/(students\/|welcome\/ai)/.test(u.pathname)); if (new URL(page.url()).pathname === '/welcome/ai') await page.getByRole('link', { name: 'Skip for now', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Hey, June/ })).toBeVisible()
  const student = page.url().split('/').at(-1)!
  await page.goto('/settings')
  await page.getByLabel('Which AI').selectOption('openai')
  await page.getByRole('textbox', { name: 'API key', exact: true }).fill('fixture-key')
  await page.getByRole('button', { name: 'Save AI' }).click()
  await page.waitForURL(u => u.searchParams.has('notice'))
  return student
}
async function audit(page: Page) {
  const result = await (await settledAudit(page)).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

test('a new subject is researched, reviewed and approved by the parent before teaching', async ({ page }) => {
  const student = await onboard(page)
  await page.goto(`/students/${student}/classes`)
  await expect(page.getByRole('heading', { name: 'Subject maps', exact: true })).toBeVisible()
  const job = await page.evaluate(async (id: string) => {
    const csrf = (document.querySelector('#csrf-store') as HTMLInputElement).value
    const response = await fetch(`/students/${id}/maps`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ csrf, subject: 'Volcanoes' }) })
    return (await response.json()).jobId as string
  }, student)
  await page.goto(`/jobs/${job}`)
  await page.getByRole('link', { name: 'See your next step' }).click({ timeout: 20000 })
  await expect(page).toHaveURL(new RegExp(`/students/${student}/maps/`))
  await expect(page.getByRole('heading', { name: 'Volcanoes: subject map' })).toBeVisible()
  await expect(page.getByText(/without a web search/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Magma and lava' })).toBeVisible()
  await expect(page.getByText('Judging and creating').first()).toBeVisible()
  await audit(page)
  await page.getByRole('button', { name: 'Approve and start teaching' }).click()
  await expect(page).toHaveURL(/\/jobs\//)
  await page.goto(`/students/${student}/classes`)
  await expect(page.locator('.subject-maps').getByRole('link', { name: 'Approved' })).toBeVisible()
})

test('parents see the evidence ladder, fair-check progress, grading checks and comparisons', async ({ page }) => {
  const student = await onboard(page)
  await page.goto(`/students/${student}/scoreboard`)
  await expect(page.getByRole('heading', { name: 'How far the thinking has climbed' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Progress on fair checks' })).toBeVisible()
  await expect(page.getByText(/Needs 12 fair checks/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Is it helping?' })).toBeVisible()
  await audit(page)
  await page.getByRole('button', { name: 'Compare week on, week off' }).first().click()
  await expect(page.getByRole('button', { name: 'Stop comparing' })).toBeVisible()
  await page.getByRole('link', { name: 'Check the tutor’s grading' }).click()
  await expect(page.getByRole('heading', { name: 'Check the tutor’s grading' })).toBeVisible()
  await expect(page.getByText('Nothing to check right now.', { exact: false })).toBeVisible()
  await audit(page)
})

test('a child can say how sure they are before checking, and skip it', async ({ page }) => {
  const student = await onboard(page)
  await page.goto(`/students/${student}`)
  await page.getByRole('button', { name: /Skip the lesson/ }).click()
  const sure = page.getByRole('group', { name: /How sure are you/ })
  await expect(sure).toBeVisible()
  await expect(sure.getByRole('radio')).toHaveCount(3)
  await audit(page)
  await sure.getByRole('radio', { name: 'Sure', exact: true }).check()
  await expect(sure.getByRole('radio', { name: 'Sure', exact: true })).toBeChecked()
})
