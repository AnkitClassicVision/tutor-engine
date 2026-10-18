import { test, expect, type Page } from '@playwright/test'
import { settledAudit } from './settled-audit.ts'

async function onboard(page: Page) {
  await page.goto('/')
  await page.getByText('Create an account', { exact: true }).click()
  const form = page.locator('form[action="/register"]')
  await expect(form.locator('[name="csrf"]')).not.toHaveValue('')
  await form.getByLabel('Email').fill(`overview-${crypto.randomUUID()}@example.invalid`)
  await form.getByLabel('Password', { exact: true }).fill('long-overview-fixture-password')
  await form.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Synthetic learner')
  await page.getByLabel('Birthday', { exact: true }).fill('2018-03-04')
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  await page.waitForURL(u => /^\/(students\/|welcome\/ai)/.test(u.pathname)); if (new URL(page.url()).pathname === '/welcome/ai') await page.getByRole('link', { name: 'Skip for now', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Hey, Synthetic learner/ })).toBeVisible()
  const student = page.url().split('/').at(-1)!
  await page.goto('/settings')
  await page.getByLabel('Which AI').selectOption('openai')
  await page.getByRole('textbox', { name: 'API key', exact: true }).fill('fixture-key')
  await page.getByRole('button', { name: 'Save AI', exact: true }).click()
  await page.waitForURL(u => u.searchParams.has('notice'))
  await expect(page).toHaveURL(/settings\?notice=/)
  return student
}

test('the parent overview fits one phone screen and every section has its own page', async ({ page }, info) => {
  await page.setViewportSize({ width: 412, height: 915 })
  const student = await onboard(page)
  await page.goto(`/students/${student}/parent`)
  // Name, the week's lines and the one primary action are visible without scrolling.
  await expect(page.getByText('Parent mode · Synthetic learner', { exact: true })).toBeInViewport({ ratio: 1 })
  await expect(page.locator('.week-lines')).toBeInViewport({ ratio: 1 })
  await expect(page.locator('.week-action .button')).toBeInViewport({ ratio: 1 })
  expect(await page.locator('.week-action .button').count()).toBe(1)
  const action = (await page.locator('.week-action .button').boundingBox())!, fab = (await page.locator('.planner-fab').boundingBox())!
  expect(action.y + action.height <= fab.y || fab.y + fab.height <= action.y || action.x + action.width <= fab.x || fab.x + fab.width <= action.x, 'the Planner button does not cover the primary action').toBe(true)
  expect(await page.locator('main form:not(.lock-form)').count()).toBe(0)
  const audit = await (await settledAudit(page)).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(audit.violations.map(v => v.id)).toEqual([])
  await page.screenshot({ path: `evidence/screenshots/parent-overview-${info.project.name}.png` })
  const actions = page.getByRole('navigation', { name: 'Parent actions' })
  for (const [name, heading] of [['Classes and practice', 'Classes and practice'], ['Record school score', 'School results'], ['Leave a note', 'A note for Synthetic learner'], ['Controls', 'Controls']]) {
    await actions.getByRole('link', { name, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible()
    expect((await (await settledAudit(page)).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(v => v.id)).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('link', { name: /overview/ }).click()
  }
  // Old links from emails, bookmarks and job results still land on the right page.
  for (const [old, now] of [['#learning-plan', /\/classes#learning-plan$/], ['#controls', /\/controls#controls$/], ['#student-access', /\/controls#student-access$/], ['#school-results', /\/school#school-results$/], ['#note', /\/note#note$/], ['?section=child-requests', /\/controls#child-requests$/], ['?section=note', /\/note#note$/]] as const) {
    await page.goto(`/students/${student}/parent${old}`)
    await expect(page).toHaveURL(now)
  }
  await page.goto(`/students/${student}/parent?planner=open#planner`)
  await expect(page.locator('#planner-drawer')).toBeVisible()
  // How learning is going: parents see each measure with its definition; a child at the device does not.
  await expect(page.locator(`a[href="/students/${student}/scoreboard"]`)).toHaveCount(1)
  await page.goto(`/students/${student}/scoreboard`)
  await expect(page.getByRole('heading', { name: 'How learning is going', exact: true })).toBeVisible()
  await expect(page.getByText('Not enough yet', { exact: false }).first()).toBeVisible()
  expect((await (await settledAudit(page)).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(v => v.id)).toEqual([])
  await page.goto(`/students/${student}/parent`)
  // The planner drawer remembers it was open on this tab; close it before using the page.
  if (await page.locator('#planner-drawer').isVisible()) await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Lock and return to student mode' }).click()
  await page.goto(`/students/${student}/scoreboard`)
  await expect(page.getByRole('heading', { name: 'How learning is going', exact: true })).toHaveCount(0)
})
