import { devices } from '../device-fixture.ts'
import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { withPostgres, closePostgres } from '../../src/postgres.ts'
import { registerUser } from '../../src/auth.ts'
import { deleteFamily } from '../../src/accounts.ts'
import { trackFixture } from './cleanup.ts'
const HOSTED = process.env.TUTOR_HOSTED_URL ?? 'https://kids-tutor-iota.vercel.app'

// Fixtures use their own verified synthetic accounts. Public email verification
// was tested separately; these tests send no mail and do not mock model calls.
type Family = { owner: string; email: string; password: string }
let families: Family[] = []
async function family(): Promise<Family> {
  const email = `hosted-${crypto.randomUUID()}@example.invalid`, password = randomBytes(24).toString('base64url')
  return withPostgres(async db => {
    const registered = await registerUser(db,email,password)
    if (!registered.ok) throw new Error('Synthetic account creation failed.')
    const fixture = { owner: registered.userId, email, password }
    families.push(fixture)
    trackFixture(fixture.owner)
    await db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?').run(new Date().toISOString(),fixture.owner)
    return fixture
  },true)
}
async function login(page: Page, fixture: Family) {
  await page.goto('/')
  const form = page.locator('form[action="/login"]')
  await expect(form.locator('[name="csrf"]')).not.toHaveValue('')
  await form.getByLabel('Email').fill(fixture.email)
  await form.getByLabel('Password', { exact: true }).fill(fixture.password)
  await form.getByRole('button', { name: 'Enter', exact: true }).click()
  await expect(page).toHaveURL(/\/students$/)
}
async function learner(page: Page, birthday = '2018-03-04') {
  const fixture = await family(); await login(page,fixture)
  await page.getByLabel('Name', { exact: true }).fill('Synthetic learner')
  await page.getByLabel('Birthday', { exact: true }).fill(birthday)
  await page.getByRole('button', { name: 'Add student', exact: true }).click()
  await page.waitForURL(u => /^\/(students\/|welcome\/ai)/.test(u.pathname)); if (new URL(page.url()).pathname === '/welcome/ai') await page.getByRole('link', { name: 'Skip for now', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Hey, Synthetic learner/ })).toBeVisible()
  return { fixture, student: page.url().split('/').at(-1)! }
}
test.afterEach(async () => {
  for (const fixture of families) await withPostgres(db => deleteFamily(db,fixture.owner,'/tmp/tutor-hosted-fixtures'),true)
  families = []; await closePostgres()
})

test('live profiles, draft recovery, fresh sign-in, progress and parent lock', async ({ page, browser }) => {
  const { fixture, student } = await learner(page)
  const navigation = page.getByRole('navigation', { name: 'Learning', exact: true })
  for (const label of ['Topics', 'Schoolwork', 'Progress', 'Practice', 'Parent area']) {
    await navigation.getByRole('link', { name: label, exact: true }).click()
    await expect(navigation.locator('[aria-current="page"]')).toHaveText(label)
    await expect(page.locator('main h1')).toHaveCount(1)
  }
  await page.getByRole('link', { name: 'AI connection', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'AI connection', exact: true })).toBeVisible()
  const csrf = await page.locator('#csrf-store').inputValue()
  const authStart = await page.request.post('/connections/openrouter', { form: { csrf }, maxRedirects: 0 })
  expect(authStart.status()).toBe(303)
  const provider = new URL(authStart.headers().location), callback = new URL(provider.searchParams.get('callback_url')!)
  expect(provider.origin).toBe('https://openrouter.ai')
  expect(provider.pathname).toBe('/auth')
  expect(provider.searchParams.get('code_challenge_method')).toBe('S256')
  expect(callback.origin).toBe(HOSTED)
  expect(callback.pathname).toBe('/connections/openrouter/callback')
  expect(callback.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  // No provider login, token exchange or model call: only the real hosted redirect.
  await page.getByRole('link', { name: 'Back to parent area', exact: true }).click()
  await page.getByRole('link', { name: 'Family / switch student', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Family', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Synthetic learner', exact: true }).click()
  await expect(page.locator('[data-presentation="junior"]')).toBeVisible()
  await page.getByRole('button', { name: 'Let’s go' }).click()
  const answer = page.getByRole('textbox', { name: /^(Answer|Your steps)$/ })
  await expect(answer).toBeVisible()
  await page.waitForLoadState('load')
  const mission = page.url()
  await page.route('**/session/*/draft', route => route.abort('internetdisconnected'))
  await page.route('**/session/*/answer', route => route.abort('internetdisconnected'))
  await answer.fill('Synthetic draft survives a connection failure')
  const failed = page.waitForEvent('requestfailed', request => request.url().endsWith('/answer'))
  await page.getByRole('button', { name: 'Check', exact: true }).click(); await failed
  // The browser's error-page navigation may finish after requestfailed. Reopen
  // once that navigation settles, still requiring the preserved draft itself.
  await expect(async () => {
    await page.goto(mission)
    await expect(answer).toHaveValue('Synthetic draft survives a connection failure')
  }).toPass({ timeout: 15000, intervals: [250,500] })
  await page.unroute('**/session/*/draft'); await page.unroute('**/session/*/answer')
  await page.getByRole('button', { name: 'Save & stop' }).click()
  const context = await browser.newContext({ baseURL: HOSTED })
  try {
    const fresh = await context.newPage(); await login(fresh,fixture)
    await fresh.goto(`/students/${student}`)
    await fresh.getByRole('button', { name: /Pick up where/ }).click()
    await expect(fresh.getByRole('textbox', { name: /^(Answer|Your steps)$/ })).toHaveValue('Synthetic draft survives a connection failure')
    await fresh.getByRole('button', { name: 'Save & stop' }).click()
    await fresh.getByRole('link', { name: 'Topics', exact: true }).click()
    await expect(fresh.getByRole('heading', { name: 'Your topics' })).toBeVisible()
    await fresh.getByRole('link', { name: 'Progress', exact: true }).click()
    await expect(fresh.getByText('Still learning about this', { exact: true })).toHaveCount(6)
    await fresh.goto(`/students/${student}/controls`)
    await fresh.getByRole('combobox', { name: 'Presentation', exact: true }).selectOption('11-14')
    const preferences = fresh.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/presentation'))
    await fresh.getByRole('button', { name: 'Save preferences' }).click()
    expect((await preferences).status()).toBe(303)
    await fresh.goto(`/students/${student}`)
    await expect(fresh.locator('[data-presentation="explorer"]')).toBeVisible()
    await fresh.goto(`/students/${student}/parent`)
    await fresh.getByRole('button', { name: 'Lock and return to student mode' }).click()
    await expect(fresh).toHaveURL(new RegExp(`/students/${student}$`))
    await fresh.goto('/settings')
    await expect(fresh.getByRole('heading', { name: 'Unlock the parent area' })).toBeVisible()
    await fresh.getByLabel('Parent password', { exact: true }).fill(fixture.password)
    await fresh.getByLabel('Parent password', { exact: true }).press('Enter')
    await expect(fresh.getByRole('heading', { name: 'AI connection', exact: true })).toBeVisible()
  } finally { await context.close() }
})

test('live class homework and score shortcuts retain subject and parent unlock destination', async ({ page }) => {
  const { fixture, student } = await learner(page)
  await page.getByRole('link', { name: 'Parent area', exact: true }).click()
  await page.getByRole('button', { name: 'Lock and return to student mode' }).click()
  await page.getByRole('link', { name: 'School score', exact: false }).click()
  await expect(page.getByRole('heading', { name: 'Unlock the parent area', exact: true })).toBeVisible()
  await page.getByLabel('Parent password', { exact: true }).fill(fixture.password)
  await page.getByRole('button', { name: 'Unlock for 15 minutes', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/students/${student}/school#school-results$`))
  await expect(page.getByRole('heading', { name: 'Record a school result', exact: true })).toBeInViewport()
  await page.goto(`/students/${student}/classes#learning-plan`)
  const actions = page.locator('.class-card').filter({ has: page.getByRole('heading', { name: 'Math', exact: true }) })
  await actions.getByRole('link', { name: 'Add homework', exact: true }).click()
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Math')
  await expect(page.getByRole('radio', { name: 'I’m getting started' })).toBeChecked()
  await page.getByLabel('Give it a name').fill('Synthetic class homework')
  await page.getByLabel('Type the page', { exact: true }).fill('Add three and two.')
  await page.getByRole('button', { name: 'Save my pages' }).click()
  await expect(page.getByRole('heading', { name: 'Synthetic class homework', exact: true })).toBeVisible()
  await page.goto(`/students/${student}/classes#learning-plan`)
  await actions.getByRole('link', { name: 'Record school score', exact: true }).click()
  await expect(page).toHaveURL(/\/school\?subject=Math#school-results$/)
  const result = page.locator('form[data-school-result]')
  await expect(result.getByLabel('Subject', { exact: true })).toHaveValue('Math')
  await result.getByLabel('Test title').fill('Synthetic class result')
  await result.getByLabel('Test date').fill(new Date().toISOString().slice(0, 10))
  await result.getByLabel('Points earned').fill('20')
  await result.getByLabel('Points possible').fill('25')
  await result.getByRole('button', { name: 'Save teacher result', exact: true }).click()
  await expect(page.locator('.school-score').filter({ hasText: 'Synthetic class result' })).toContainText('20 / 25')
})

test('live private photo upload retries without duplicates and rejects another family', async ({ page, browser }) => {
  const { student } = await learner(page,'2013-03-04')
  await page.goto(`/students/${student}/materials/new`)
  await page.getByLabel('Give it a name').fill('Synthetic recovered homework')
  await page.locator('[data-pages]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nO3NQQkAAAgEsOtvODPYxBQ+hMH+S02fikAgEAgEAoFAIPgSLOeI7HlLIQSFAAAAAElFTkSuQmCC','base64') })
  await expect(page.getByRole('img', { name: 'Preview of page 1' })).toBeVisible()
  const requests: any[] = []
  await page.route(`**/students/${student}/materials`, async route => {
    requests.push(route.request().postDataJSON())
    if (requests.length === 1) { const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('internetdisconnected') }
    else await route.continue()
  })
  await page.getByRole('button', { name: 'Save my pages' }).click()
  await expect(page.locator('[data-upload-status]')).toContainText('Connection paused')
  await page.getByRole('button', { name: 'Save my pages' }).click()
  await expect(page.getByRole('heading', { name: 'Synthetic recovered homework', exact: true })).toBeVisible()
  expect(requests).toHaveLength(2)
  expect(requests[1].requestId).toBe(requests[0].requestId)
  expect(requests[1].pages).toEqual(requests[0].pages)
  const materialPath = new URL(page.url()).pathname
  await page.reload()
  const photo = page.locator('img[src^="/uploads/"]')
  await expect(photo).toHaveCount(1)
  const photoPath = await photo.getAttribute('src')
  const image = await page.request.get(photoPath!)
  expect(image.status()).toBe(200); expect(image.headers()['content-type']).toContain('image/jpeg')
  expect((await image.body()).subarray(0,2).equals(Buffer.from([0xff,0xd8]))).toBe(true)
  const other = await family(), context = await browser.newContext({ baseURL: HOSTED })
  try {
    const foreign = await context.newPage(); await login(foreign,other)
    for (const path of [photoPath!,materialPath,`/students/${student}`]) {
      const response = await context.request.get(path,{ maxRedirects: 0 })
      expect([403,404]).toContain(response.status())
    }
  } finally { await context.close() }
  await page.goto(`/students/${student}/materials`)
  await expect(page.getByRole('heading', { name: 'Synthetic recovered homework', exact: true })).toHaveCount(1)
})

test('live PDF job completes and its private download survives a fresh request', async ({ page }) => {
  const { student } = await learner(page)
  const csrf = await page.locator('#csrf-store').inputValue()
  const created = await page.request.post(`/students/${student}/sheet`,{ form: { csrf }, maxRedirects: 0 })
  expect(created.status()).toBe(303)
  await page.goto(created.headers().location)
  await page.getByRole('button', { name: 'Download a PDF', exact: true }).click()
  await expect(page).toHaveURL(/\/jobs\//)
  const jobPath = new URL(page.url()).pathname
  await expect.poll(async () => {
    const response = await page.request.get(`${jobPath}/status`)
    expect(response.status()).toBe(200)
    return (await response.json()).status
  },{ timeout: 60000 }).toBe('succeeded')
  await page.reload()
  const response = await page.request.get(`${jobPath}/file`)
  expect(response.status()).toBe(200); expect(response.headers()['content-type']).toContain('application/pdf')
  expect((await response.body()).subarray(0,5).toString()).toBe('%PDF-')
})


test('live test pages retain date and private photo when AI is unavailable, with parent-only plan changes', async ({ page }) => {
  const { fixture, student } = await learner(page)
  await page.getByRole('link', { name: 'A test coming up?' }).click()
  await page.getByRole('link', { name: 'Add test pages' }).click()
  await expect(page.getByLabel('What is it?')).toHaveValue('practice_exam')
  await page.waitForLoadState('load')
  await page.getByLabel('Give it a name').fill('Synthetic saved sample test')
  await page.locator('[data-pages]').setInputFiles({ name: 'synthetic-test.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nO3NQQkAAAgEsOtvODPYxBQ+hMH+S02fikAgEAgEAoFAIPgSLOeI7HlLIQSFAAAAAElFTkSuQmCC', 'base64') })
  await expect(page.getByRole('img', { name: 'Preview of page 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Save my pages' }).click()
  await expect(page.getByRole('heading', { name: 'Synthetic saved sample test', exact: true })).toBeVisible()
  const materialPath = new URL(page.url()).pathname, material = materialPath.split('/').at(-1)!
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  await expect(page.getByLabel('How should we use these pages?')).toHaveValue('test')
  await page.getByLabel('Test name', { exact: true }).fill('Synthetic upcoming test')
  await page.getByLabel('Test date', { exact: true }).fill(date)
  await page.getByRole('button', { name: 'Use these pages', exact: true }).click()
  await expect(page).toHaveURL(/\/jobs\//)
  const jobPath = new URL(page.url()).pathname
  await expect.poll(async () => (await (await page.request.get(`${jobPath}/status`)).json()).status, { timeout: 60000 }).toBe('failed')
  await page.goto(materialPath)
  await expect(page.getByText('Your choice is saved. Page reading and practice planning still need to finish.', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Test date', { exact: true })).toHaveValue(date)
  const photo = page.getByRole('img', { name: 'Original school page 1' })
  await expect(photo).toBeVisible()
  expect((await page.request.get((await photo.getAttribute('src'))!)).status()).toBe(200)
  await withPostgres(async db => {
    const row = await db.prepare('SELECT m.* FROM materials m JOIN students s ON s.id = m.student_id WHERE m.id = ? AND s.owner_user_id = ?').get(material, fixture.owner)
    expect(row?.learning_purpose).toBe('test'); expect(row?.test_date).toBe(date)
    expect(row?.learning_applied_revision).toBe(0)
    expect((await db.prepare('SELECT count(*) n FROM attempts WHERE student_id = ?').get(student))?.n).toBe(0)
  }, true)
  await page.goto(`/students/${student}/parent`)
  await page.getByRole('button', { name: 'Lock and return to student mode' }).click()
  await page.goto(materialPath)
  await expect(page.locator('[data-learning-source]')).toHaveCount(0)
  await expect(photo).toBeVisible()
  const csrf = await page.locator('#csrf-store').inputValue()
  expect((await page.request.post(`${materialPath}/learning`, { form: { csrf, purpose: 'learning' }, maxRedirects: 0 })).status()).toBe(403)
  await page.goto(`/students/${student}/test`)
  await expect(page.getByRole('link', { name: 'Synthetic upcoming test', exact: true })).toBeVisible()
  await expect(page.getByText('Saved; practice planning is pending', { exact: true })).toBeVisible()
})

test('live school-result photos preserve score, retry, private reads and parent lock', async ({ page, browser }) => {
  const { fixture, student } = await learner(page)
  await page.goto(`/students/${student}/school`)
  const form = page.locator('[data-school-result]')
  await form.getByLabel('Test title', { exact: true }).fill('Synthetic marked quiz')
  await form.getByLabel('Test date', { exact: true }).fill('2026-10-02')
  await form.getByLabel('Points earned').fill('8')
  await form.getByLabel('Points possible').fill('10')
  await expect(form.getByLabel('Use phone camera', { exact: true })).toHaveAttribute('capture', 'environment')
  await form.getByLabel('Use phone camera', { exact: true }).setInputFiles({ name: 'synthetic-marked-quiz.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nO3NQQkAAAgEsOtvODPYxBQ+hMH+S02fikAgEAgEAoFAIPgSLOeI7HlLIQSFAAAAAElFTkSuQmCC', 'base64') })
  await expect(form.getByRole('img', { name: 'Preview of page 1' })).toBeVisible()
  let lost = false
  await page.route(`**/students/${student}/school-results`, async route => {
    if (!lost) { lost = true; const saved = await route.fetch(); expect(saved.status()).toBe(201); await route.abort('failed') }
    else await route.continue()
  })
  await form.getByRole('button', { name: 'Save teacher result' }).click()
  await expect(form.locator('[data-upload-status]')).toContainText('Try saving again')
  await form.getByRole('button', { name: 'Save teacher result' }).click()
  await expect(page).toHaveURL(new RegExp(`/students/${student}/insights#school-results$`))
  await expect(page.getByText('8 / 10', { exact: true })).toHaveCount(1)
  await page.getByRole('link', { name: 'View marked pages' }).click()
  await expect(page.getByText('Synthetic marked quiz: 8 / 10', { exact: true })).toBeVisible()
  const materialPath = new URL(page.url()).pathname
  const photo = page.locator('img[src^="/uploads/"]').first()
  await expect(photo).toBeVisible()
  const uploadPath = (await photo.getAttribute('src'))!
  const read = await page.request.get(uploadPath)
  expect(read.status()).toBe(200); expect(read.headers()['content-type']).toBe('image/jpeg')
  await page.reload(); await expect(photo).toBeVisible()
  const otherContext = await browser.newContext({ baseURL: HOSTED })
  try {
    const other = await family(); await login(await otherContext.newPage(), other)
    expect((await otherContext.request.get(uploadPath)).status()).not.toBe(200)
    expect((await otherContext.request.get(materialPath)).status()).not.toBe(200)
  } finally { await otherContext.close() }
  await page.goto(`/students/${student}/parent`)
  const csrf = await page.locator('#csrf-store').inputValue()
  await page.getByRole('button', { name: 'Lock and return to student mode' }).click()
  const denied = await page.request.post(`/students/${student}/school-results`, { data: { csrf, title: 'Forged result', date: '2026-10-02', earned: 10, possible: 10, pages: [] } })
  expect(denied.status()).toBe(403)
  await withPostgres(async db => {
    const scores = await db.prepare('SELECT * FROM school_results WHERE student_id = ?').all(student)
    expect(scores.length).toBe(1); expect(scores[0].earned).toBe(8); expect(scores[0].possible).toBe(10)
    expect(scores[0].provenance).toBe('parent-entered teacher result')
    expect((await db.prepare('SELECT count(*) n FROM attempts WHERE student_id = ?').get(student))?.n).toBe(0)
    expect((await db.prepare('SELECT count(*) n FROM jobs WHERE owner_user_id = ?').get(fixture.owner))?.n).toBe(0)
  }, true)
})


test('live onboard camera saves a private teacher-result photo and live tutor activation remains gated', async ({ page, browserName }) => {
  await devices(page, browserName === 'webkit')
  const { student } = await learner(page)
  await page.goto(`/students/${student}/parent`)
  const result = page.locator('[data-school-result]')
  await result.getByLabel('Test title', { exact: true }).fill('Synthetic onboard camera score')
  await result.getByLabel('Test date', { exact: true }).fill('2026-10-02')
  await result.getByLabel('Points earned').fill('8'); await result.getByLabel('Points possible').fill('10')
  await result.getByRole('button', { name: 'Take a picture', exact: true }).click()
  await expect(result.getByRole('button', { name: 'Capture photo' })).toBeEnabled()
  await result.getByRole('button', { name: 'Capture photo' }).click()
  await expect(result.locator('.page-preview')).toHaveCount(1)
  expect(await page.evaluate(() => (window as any).__camera.stops)).toBe(1)
  await result.getByRole('button', { name: 'Save teacher result' }).click()
  await expect(page.getByText('8 / 10', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'View marked pages' }).click()
  const photo = page.getByRole('img', { name: 'Original school page 1' })
  await expect(photo).toBeVisible()
  const response = await page.request.get((await photo.getAttribute('src'))!)
  expect(response.status()).toBe(200); expect(response.headers()['content-type']).toContain('image/jpeg')
  await page.goto(`/students/${student}/live`)
  await expect(page.getByRole('button', { name: 'Start live tutor' })).toBeDisabled()
  const csrf = await page.locator('#csrf-store').inputValue()
  const blocked = await page.request.post(`/students/${student}/live`, { data: { csrf, sdp: 'v=0\r\nsynthetic-offer' } })
  expect(blocked.status()).toBe(400); expect((await blocked.json()).error).toContain('waiting for')
  await page.goto(`/students/${student}/parent`)
  await page.getByRole('button', { name: 'Lock and return to student mode' }).click()
  const forbidden = await page.request.post(`/students/${student}/live`, { data: { csrf, sdp: 'v=0' } })
  expect(forbidden.status()).toBe(403)
})
