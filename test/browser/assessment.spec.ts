import { test, expect, type Page } from '@playwright/test'
import { settledAudit } from './settled-audit.ts'

async function openCheck(page: Page, project: string, learner: string) {
  await page.goto('/')
  const login = page.locator('form[action="/login"]')
  await login.getByLabel('Email').fill(`assessment-${project}@example.invalid`)
  await login.getByLabel('Password', { exact: true }).fill('synthetic-browser-password')
  await login.getByRole('button', { name: 'Enter', exact: true }).click()
  const link = page.getByRole('link', { name: new RegExp(learner) }).first()
  await expect(link).toBeVisible()
  const home = (await link.getAttribute('href'))!
  await link.click()
  await expect(page).toHaveURL(/\/session\/[0-9a-f-]{36}$/)
  await page.getByRole('button', { name: 'Resume assessment', exact: true }).click()
  return { session: new URL(page.url()).pathname, home }
}

async function noFeedback(page: Page) {
  await expect(page.locator('.feedback-review, .verdict, .hint, form.talk, form[action$="/hint"]')).toHaveCount(0)
  await expect(page.getByText('A private teaching clue.', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Key or rubric:', { exact: false })).toHaveCount(0)
}

test('an assessment saves answers, restores written drafts and opens feedback only after the final answer', async ({ page }, info) => {
  const { session, home } = await openCheck(page, info.project.name, 'Synthetic assessment')
  await noFeedback(page)
  await page.getByLabel('Answer', { exact: true }).fill('5')
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click()
  await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible()
  await noFeedback(page)
  const steps = page.getByLabel('Your steps', { exact: true })
  await expect(steps).toHaveAttribute('rows', '4')
  const draftSaved = page.waitForResponse(response => response.url().endsWith('/draft') && response.status() === 200)
  await steps.fill('Find a common denominator. Then add the numerators.')
  await draftSaved
  await page.screenshot({ path: `evidence/screenshots/assessment-written-${info.project.name}.png`, fullPage: true })
  await page.reload()
  await expect(steps).toHaveValue('Find a common denominator. Then add the numerators.')
  // A failed send retains the written response; retrying saves it without a grading detour.
  await page.route('**/session/*/answer', route => route.abort('internetdisconnected'))
  const failed = page.waitForEvent('requestfailed', request => request.url().endsWith('/answer'))
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click()
  await failed
  await expect(async () => {
    await page.goto(session)
    await expect(steps).toHaveValue('Find a common denominator. Then add the numerators.')
  }).toPass({ timeout: 15000, intervals: [250, 500] })
  await page.unroute('**/session/*/answer')
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${session}\\?saved=answer$`))
  await noFeedback(page)
  await expect(page.getByRole('radio', { name: 'A', exact: true })).toBeVisible()
  // Leaving for a learning surface returns to the same unfinished assessment.
  await page.goto(`${home}/map`)
  await expect(page).toHaveURL(new RegExp(`${session}$`))
  await page.getByRole('radio', { name: 'A', exact: true }).check()
  await page.getByRole('button', { name: 'Save and finish assessment', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Assessment complete', exact: true })).toBeVisible()
  await expect(page.locator('.feedback-review article')).toHaveCount(3)
  await expect(page.locator('.is-pending')).toContainText('saved for a grown-up to check')
  await expect(page.locator('.is-miss')).toContainText('Needs another look')
  await expect(page.locator('form.answer')).toHaveCount(0)
  expect((await (await settledAudit(page)).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
})

test('pausing preserves the check and finishing early keeps unanswered work separate', async ({ page }, info) => {
  const { session } = await openCheck(page, info.project.name, 'Synthetic early finish')
  await page.getByLabel('Answer', { exact: true }).fill('5')
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click()
  await page.getByRole('button', { name: 'Pause assessment', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Assessment saved', exact: true })).toBeVisible()
  await noFeedback(page)
  await page.reload()
  await page.getByRole('button', { name: 'Resume assessment', exact: true }).click()
  await expect(page.getByLabel('Your steps', { exact: true })).toBeVisible()
  await noFeedback(page)
  expect((await (await settledAudit(page)).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
  await page.getByText('Finish assessment early', { exact: true }).click()
  await page.getByRole('button', { name: 'Finish assessment now', exact: true }).click()
  await expect(page.getByText('2 questions were left unanswered. These are not graded as incorrect.', { exact: true })).toBeVisible()
  await expect(page.locator('.feedback-review article')).toHaveCount(1)
  const csrf = await page.locator('#csrf-store').inputValue()
  await page.request.post(`${session}/resume`, { form: { csrf } })
  await page.reload()
  await expect(page.locator('form.answer')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Assessment complete', exact: true })).toBeVisible()
})
