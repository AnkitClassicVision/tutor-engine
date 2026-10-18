import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { withPostgres, closePostgres } from '../../src/postgres.ts'
import { registerUser } from '../../src/auth.ts'
import { deleteFamily } from '../../src/accounts.ts'
import { trackFixture } from './cleanup.ts'
import AxeBuilder from '@axe-core/playwright'

let owner: string | null = null

test.afterEach(async () => {
  if (owner) await withPostgres(db => deleteFamily(db, owner!, '/tmp/tutor-hosted-fixtures'), true)
  owner = null
  await closePostgres()
})

async function setup(page: any) {
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
  await login.getByLabel('Password', {exact:true}).fill(password)
  await login.getByRole('button',{name:'Enter',exact:true}).click()
  await page.getByLabel('Name',{exact:true}).fill('Synthetic learner')
  await page.getByLabel('Birthday',{exact:true}).fill('2018-03-04')
  await page.getByRole('button',{name:'Add student',exact:true}).click()
  await page.waitForURL(u => /^\/(students\/|welcome\/ai)/.test(u.pathname)); if (new URL(page.url()).pathname === '/welcome/ai') await page.getByRole('link', { name: 'Skip for now', exact: true }).click()
  await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}$/i)
  const id=page.url().split('/').at(-1)
  await page.goto(`/students/${id}/parent`)
  return id
}

test('parent overview, student PIN access and family isolation', async ({ page, browser, baseURL }) => {
  const id=await setup(page)
  await expect(page.getByRole('heading',{name:'This week'})).toBeVisible()
  await expect(page.getByRole('heading',{name:'Keep these strengths growing'})).toBeVisible()
  await expect(page.getByRole('navigation',{name:'Parent actions'})).toBeVisible()
  const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()
  expect(audit.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))).toEqual([])
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('navigation',{name:'Parent actions'}).getByRole('link',{name:'Controls',exact:true}).click()
  await page.getByLabel('New student PIN',{exact:true}).fill('246810')
  await page.getByRole('button',{name:'Create student sign-in',exact:true}).click()
  const link=await page.getByRole('link',{name:'Open student sign-in',exact:true}).getAttribute('href')
  expect(link).toMatch(/^\/learn\//)
  await page.getByRole('link',{name:'overview',exact:false}).click()
  await page.getByRole('link',{name:'All children’s progress',exact:false}).click()
  await expect(page.getByRole('heading',{name:'Family progress',exact:true})).toBeVisible()
  await page.getByRole('link',{name:'Manage Synthetic learner',exact:true}).click()
  const context=await browser.newContext({baseURL})
  try {
    const student=await context.newPage()
    await student.goto(link!)
    await expect(student.locator('[name="csrf"]')).not.toHaveValue('')
    await student.getByLabel('Student PIN',{exact:true}).fill('246810')
    await student.getByRole('button',{name:'Enter my learning space'}).click()
    await expect(student).toHaveURL(new RegExp(`/students/${id}$`))
    await expect(student.getByRole('link', {name:'Parent area', exact:true})).toHaveCount(0)
    await expect(student.getByRole('button', {name:'Sign out / parent sign-in', exact:true})).toBeVisible()
    await student.goto('/family/progress')
    await expect(student.getByRole('heading',{name:'This is your student space'})).toBeVisible()
    await student.goto('/settings')
    await expect(student.getByRole('textbox',{name:'API key',exact:true})).toHaveCount(0)
    await student.goto(`/students/${id}`)
    await student.getByRole('button',{name:'Let’s go',exact:false}).click()
    await expect(student.locator('form.answer')).toBeVisible()
    await student.getByLabel('Answer',{exact:true}).fill('Saved synthetic thinking')
    await student.getByRole('button',{name:'Save & stop',exact:true}).click()
    await student.getByRole('button',{name:'Pick up where',exact:false}).click()
    await expect(student.getByLabel('Answer',{exact:true})).toHaveValue('Saved synthetic thinking')
    await page.goto(`/students/${id}/controls`)
    await page.getByRole('button',{name:'Turn off student access',exact:true}).click()
    await student.reload()
    await expect(student.getByRole('heading',{name:'Small missions, built one step at a time.',exact:true})).toBeVisible()
  }finally{await context.close()}
})
