import { test, expect, type Page } from '@playwright/test'
import { settledAudit } from './settled-audit.ts'

const birthday = (years: number) => new Date(Date.now() - years * 365.25 * 86400000).toISOString().slice(0, 10)
const audit = async (page: Page) => expect((await (await settledAudit(page)).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(v => v.id)).toEqual([])

async function family(page: Page, years: number) {
  await page.goto('/')
  await page.getByText('Create an account', { exact: true }).click()
  const form = page.locator('form[action="/register"]')
  await expect(form.locator('[name="csrf"]')).not.toHaveValue('')
  await form.getByLabel('Email').fill(`wf05-${crypto.randomUUID()}@example.invalid`)
  await form.getByLabel('Password', { exact: true }).fill('long-wf05-fixture-password')
  await form.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Synthetic reader')
  await page.getByLabel('Birthday', { exact: true }).fill(birthday(years))
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  await page.waitForURL(u => /^\/(students\/|welcome\/ai)/.test(u.pathname)); if (new URL(page.url()).pathname === '/welcome/ai') await page.getByRole('link', { name: 'Skip for now', exact: true }).click()
  const student = page.url().split('/').at(-1)!
  await page.goto('/settings')
  await page.getByLabel('Which AI').selectOption('openai')
  await page.getByRole('textbox', { name: 'API key', exact: true }).fill('fixture-key')
  await page.getByRole('button', { name: 'Save AI' }).click()
  await page.waitForURL(u => u.searchParams.has('notice'))
  // A smudged page: one clear question, one uncertain reading, one that could not be read.
  await page.goto(`/students/${student}/materials/new`)
  const name = page.getByLabel('Give it a name')
  if (!(await name.isVisible())) await page.getByText(/About this page/).click()
  await name.fill('Smudged homework')
  await page.getByLabel('Type the page', { exact: true }).fill('smudged page: 12b What is 2 + 2? 3 Sam ate 1/? of a pizza 5 ???')
  await page.getByRole('button', { name: 'Save my pages' }).click()
  await page.getByRole('button', { name: 'Read my pages', exact: true }).click()
  await page.getByRole('link', { name: 'See your next step' }).click({ timeout: 15000 })
  await expect(page.getByRole('heading', { name: /What is 2 \+ 2\?/ })).toBeVisible()
  return { student, material: page.url() }
}

test('WF-05: the child checks, fixes or types each homework question before help, in student mode', async ({ page }) => {
  const { material } = await family(page, 9)
  // Hand the device to the child.
  await page.getByRole('link', { name: 'Parent area', exact: true }).first().click()
  await page.getByRole('button', { name: 'Lock and return to student mode' }).click()
  await page.waitForURL(u => !u.pathname.endsWith('/parent'))
  await page.goto(material)
  // Case 2: the uncertain reading is offered, pre-filled, with a warning; the child's fix is used.
  await page.getByRole('link', { name: /Check this question/ }).click()
  await expect(page.getByRole('heading', { name: 'Is this the question?' })).toBeVisible()
  await expect(page.getByRole('note')).toContainText('I might have read this wrong')
  const box = page.getByLabel('The question', { exact: true })
  await expect(box).toHaveValue('Sam ate 1/2 of a pizza. How much is left?')
  await audit(page)
  await box.fill('Sam ate 1/3 of a pizza. How much is left?')
  await page.getByRole('button', { name: 'Use this question', exact: true }).click()
  await expect(page.locator('.prompt')).toContainText('Sam ate 1/3 of a pizza')
  // Case 4: an unreadable question is typed by the child; nothing is marked wrong.
  await page.goto(material)
  await page.getByRole('link', { name: /I couldn’t read this one/ }).click()
  await expect(page.getByRole('heading', { name: 'I couldn’t read this one' })).toBeVisible()
  await page.getByLabel('Type the question here', { exact: true }).fill('What is 7 x 8?')
  await page.getByRole('button', { name: 'Use this question', exact: true }).click()
  await expect(page.locator('.prompt')).toContainText('What is 7 x 8?')
  // Case 1: a clear question still asks once before help.
  await page.goto(material)
  await page.getByRole('link', { name: 'Let’s think it through' }).first().click()
  await expect(page.getByRole('heading', { name: 'Is this the question?' })).toBeVisible()
  await page.getByRole('button', { name: 'Yes, help me', exact: true }).click()
  await expect(page.getByText('One thinking step at a time.')).toBeVisible()
  // The material page credits the child.
  await page.goto(material)
  await expect(page.locator('[data-confirm="fixed"]').first()).toContainText('Fixed by Synthetic reader')
  await expect(page.locator('[data-confirm="yes"]')).toContainText('Checked by Synthetic reader')
})

test('WF-05: ages 5–7 get one decision with Hear this and 64 px targets', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__spoken = []
    Object.defineProperty(window, 'speechSynthesis', { value: { speak: (u: any) => (window as any).__spoken.push(u.text), cancel: () => {} }, configurable: true })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class { text: string; constructor(text: string) { this.text = text } }, configurable: true })
  })
  const { material } = await family(page, 6.5)
  // On the uncertain reading, Hear this reads the words in the box, including the child's edits.
  await page.goto(material)
  await page.getByRole('link', { name: /Check this question/ }).click()
  await page.waitForLoadState('load')
  await page.getByLabel('Fix the words', { exact: true }).fill('Sam ate 1/3 of a pizza.')
  await page.evaluate(() => { (window as any).__spoken.length = 0 })
  await page.getByRole('button', { name: 'Hear this', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__spoken[0])).toContain('Sam ate 1/3 of a pizza')
  // On an unreadable question the box starts empty, so Hear this reads what to do.
  await page.goto(material)
  await page.getByRole('link', { name: /I couldn’t read this one/ }).click()
  await page.waitForLoadState('load')
  await page.evaluate(() => { (window as any).__spoken.length = 0 })
  await page.getByRole('button', { name: 'Hear this', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__spoken[0])).toContain('Type the question')
  await page.goto(material)
  await page.getByRole('link', { name: 'Let’s think it through' }).first().click()
  await expect(page.getByRole('heading', { name: 'Is this it?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hear this', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Take another photo' })).toHaveCount(0)
  for (const target of [page.getByRole('button', { name: 'Yes, help me', exact: true }), page.getByRole('link', { name: 'No, fix it', exact: true })])
    expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(64)
  await audit(page)
})
