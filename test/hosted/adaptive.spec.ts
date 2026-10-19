import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { withPostgres, closePostgres } from '../../src/postgres.ts'
import { registerUser } from '../../src/auth.ts'
import { deleteFamily } from '../../src/accounts.ts'
import { trackFixture } from './cleanup.ts'
import { requiresJudgment } from '../../src/engine/score.ts'

let owner: string | null = null

test.afterEach(async () => {
  if (owner) await withPostgres(db => deleteFamily(db, owner!, '/tmp/tutor-hosted-fixtures'), true)
  owner = null
  await closePostgres()
})

test('a harder probe is answered from its local key, saved and resumed on the actual origin, with one attempt recorded', async ({ page }) => {
  const email = `hosted-${crypto.randomUUID()}@example.invalid`, password = randomBytes(24).toString('base64url')
  owner = await withPostgres(async db => {
    const user = await registerUser(db, email, password)
    if (!user.ok) throw new Error('Synthetic registration failed')
    trackFixture(user.userId)
    await db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?').run(new Date().toISOString(), user.userId)
    return user.userId
  }, true)
  await page.goto('/')
  const login = page.locator('form[action="/login"]')
  await expect(login.locator('[name="csrf"]')).not.toHaveValue('')
  await login.getByLabel('Email').fill(email)
  await login.getByLabel('Password', { exact: true }).fill(password)
  await login.getByRole('button', { name: 'Enter', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill('Synthetic learner')
  await page.getByLabel('Birthday', { exact: true }).fill('2018-03-04')
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  await page.waitForURL(u => /^\/(students\/|welcome\/ai)/.test(u.pathname)); if (new URL(page.url()).pathname === '/welcome/ai') await page.getByRole('link', { name: 'Skip for now', exact: true }).click()
  // Current child home (2026-10-19): a greeting, then the topics map offers a harder probe.
  await expect(page.getByRole('heading', { name: /Hey, Synthetic learner/ })).toBeVisible()
  const home = page.url(), student = new URL(home).pathname.split('/').at(-1)!
  await page.goto(`${home}/map`)
  await page.getByRole('button', { name: 'Try a harder one', exact: true }).first().click()
  await expect(page.locator('form.answer')).toBeVisible()
  const session = new URL(page.url()).pathname.split('/').at(-1)!
  const item = await withPostgres(db => db.prepare(`SELECT i.id, i.answer, i.bloom_level FROM session_items i JOIN tutor_sessions s ON s.id = i.session_id JOIN students t ON t.id = s.student_id WHERE s.id = ? AND t.id = ? AND t.owner_user_id = ? ORDER BY i.position LIMIT 1`).get(session, student, owner!), true)
  if (!item || requiresJudgment(String(item.answer), Number(item.bloom_level))) throw new Error('Hosted verification requires an objective local key; no model calls are permitted.')
  await page.getByLabel('Answer', { exact: true }).fill(String(item.answer))
  const submitted = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/answer'))
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  const response = await submitted
  await page.waitForURL(new URL(response.headers().location, home).href)
  await expect(page.locator('form.answer')).toBeVisible()
  await page.getByRole('button', { name: 'Save & stop', exact: true }).click()
  // The saved mission waits on the home page, across a reload.
  await expect(page.getByText('Your unfinished mission is waiting.', { exact: false })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Your unfinished mission is waiting.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Pick up where I left off', exact: false }).click()
  await expect(page.locator('form.answer')).toBeVisible()
  const evidence = await withPostgres(db => db.prepare('SELECT count(*) n FROM attempts WHERE student_id = ? AND session_id = ?').get(student, session), true)
  expect(Number(evidence?.n)).toBe(1)
})
