import { test, expect } from '@playwright/test'
import { settledAudit } from './settled-audit.ts'

test('a new family is offered one simple AI step after adding a child, and a pasted key just works', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Create an account', { exact: true }).click()
  const form = page.locator('form[action="/register"]')
  await expect(form.locator('[name="csrf"]')).not.toHaveValue('')
  await form.getByLabel('Email').fill(`welcome-${crypto.randomUUID()}@example.invalid`)
  await form.getByLabel('Password', { exact: true }).fill('long-welcome-fixture-password')
  await form.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Synthetic learner')
  await page.getByLabel('Birthday', { exact: true }).fill('2016-05-04')
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  await expect(page).toHaveURL(/\/welcome\/ai\?next=/)
  await expect(page.getByRole('heading', { name: 'Give Bloop a brain', exact: true })).toBeVisible()
  expect((await (await settledAudit(page)).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(v => v.id)).toEqual([])
  // A key that matches no provider is explained, not saved.
  await page.getByLabel('Your key', { exact: true }).fill('not-a-real-key')
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('doesn’t look like an OpenAI, Claude, Grok or OpenRouter key')
  // An OpenAI-style key is recognised, checked and saved; the parent lands on the child's home, ready to go.
  await page.getByLabel('Your key', { exact: true }).fill('sk-synthetic-welcome-key')
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Hey, Synthetic learner/ })).toBeVisible()
  await expect(page.locator('[data-ai-missing]')).toHaveCount(0)
  await page.goto('/settings')
  await expect(page.getByLabel('Which AI')).toHaveValue('openai')
})

test('skip for now goes straight to the child, and AI settings offers the same simple step', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Create an account', { exact: true }).click()
  const form = page.locator('form[action="/register"]')
  await expect(form.locator('[name="csrf"]')).not.toHaveValue('')
  await form.getByLabel('Email').fill(`welcome-skip-${crypto.randomUUID()}@example.invalid`)
  await form.getByLabel('Password', { exact: true }).fill('long-welcome-fixture-password')
  await form.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Synthetic learner')
  await page.getByLabel('Birthday', { exact: true }).fill('2016-05-04')
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  await page.getByRole('link', { name: 'Skip for now', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Hey, Synthetic learner/ })).toBeVisible()
  await page.goto('/settings')
  await page.getByRole('link', { name: 'Quick connect', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Give Bloop a brain', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Skip for now', exact: true }).click()
  await expect(page).toHaveURL(/\/settings$/)
})

test('with no AI connected, every screen says the same thing, and what it promises works', async ({ page }, testInfo) => {
  await page.goto('/')
  const login = page.locator('form[action="/login"]')
  await login.getByLabel('Email').fill(`no-ai-${testInfo.project.name}@example.invalid`)
  await login.getByLabel('Password', { exact: true }).fill('synthetic-browser-password')
  await login.getByRole('button', { name: 'Enter', exact: true }).click()
  if (!/\/students\/[0-9a-f-]{36}$/.test(page.url())) await page.getByRole('link', { name: /Synthetic offline/ }).first().click()
  await expect(page.getByRole('heading', { name: /Hey, Synthetic offline/ })).toBeVisible()
  const home = page.url(), student = home.split('/').at(-1)!
  await expect(page.locator('[data-ai-missing]')).toContainText('You can still practise: I can check short answers and give hints, and I save written answers for a grown-up to check.')
  await page.goto(`/students/${student}/parent`)
  await expect(page.locator('[data-ai-missing]')).toContainText('Practice on the built-in topics still runs: short answers are checked and hints work, and written answers are saved for you to check.')
  await expect(page.locator('.week-lines')).toContainText('Needs you: connect an AI so the tutor can talk things through')
  await page.goto(`/students/${student}/controls`)
  await expect(page.locator('.connection-status')).toContainText('Practice on the built-in topics still runs: short answers are checked and hints work, and written answers are saved for you to check.')
  await page.getByRole('button', { name: 'Lock and return to student mode' }).click()
  await page.waitForURL(u => !u.pathname.endsWith('/controls'))
  // The promise holds: a mission starts, a hint comes from the stored ladder, and a short answer is checked.
  await page.goto(home)
  await page.getByRole('button', { name: 'Let’s go', exact: false }).click()
  await expect(page.locator('form.answer')).toBeVisible()
  // Answer every question: short answers are checked here, written ones are saved for a grown-up. Nothing fails.
  const nextStep = page.getByRole('link', { name: 'See your next step', exact: false }), ready = page.getByRole('button', { name: 'Ready for a fresh question', exact: true })
  let waiting = 0
  for (let i = 0; i < 12 && await page.locator('form.answer').count(); i++) {
    const choices = page.locator('fieldset.choices .choice')
    if (await choices.count()) await choices.first().click()
    else await page.getByLabel('Answer', { exact: true }).fill('definitely wrong')
    await page.getByRole('button', { name: 'Check', exact: true }).click()
    await page.waitForLoadState('load')
    await expect(page.getByText('Could not finish', { exact: false })).toHaveCount(0)
    // Talking it through needs the AI, so it is not offered.
    await expect(page.locator('form.talk')).toHaveCount(0)
    if (await page.locator('[data-saved-waiting]').count()) waiting++
    if (await nextStep.count()) await nextStep.click()
    if (await ready.count()) await ready.click()
  }
  await expect(page.getByText(/No AI is connected/).and(page.locator('[role=alert]'))).toHaveCount(0)
  // A written answer that was saved shows up for the parent to check.
  if (waiting) {
    await page.goto(`/students/${student}/parent`)
    await page.getByLabel('Parent password', { exact: true }).fill('synthetic-browser-password')
    await page.getByLabel('Parent password', { exact: true }).press('Enter')
    await expect(page.locator('[data-grading-unsure]')).toContainText('waiting for you to check')
    // The promise has a place to keep it: the parent decides a waiting answer on the grading page.
    await page.locator('[data-grading-unsure]').getByRole('link').click()
    const section = page.locator('section.waiting')
    const before = await section.locator('article').count()
    expect(before).toBeGreaterThan(0)
    await section.locator('article').first().getByRole('button', { name: 'It meets it', exact: true }).click()
    await expect(page.locator('section.waiting article')).toHaveCount(before - 1)
  }
  expect(waiting, 'at least one written answer was saved for a grown-up').toBeGreaterThan(0)
})
