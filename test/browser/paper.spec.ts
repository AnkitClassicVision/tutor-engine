import { test, expect } from '@playwright/test'
import { learningRouteFixture } from '../fixtures/learning-routes.ts'
import { createSheet, getSheet } from '../../src/services.ts'
import { readPaperWork } from '../../src/paper-work.ts'
import { settledAudit } from './settled-audit.ts'
import { recordAudit } from '../../src/grading-audit.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')
test.setTimeout(90000)

test('paper photos and entries recover from lost replies, retain the printed work and lead to a fresh independent check', async ({ page }, info) => {
  const f = await learningRouteFixture()
  try {
    const sheet = await f.within(() => createSheet(f.db, f.owner, f.student)), path = '/sheet/' + sheet
    const payload = JSON.parse(String((await getSheet(f.db, f.owner, sheet)).spec_json))
    await page.context().addCookies([{ name: 'tutor_session', value: f.auth.token, url: f.baseURL, httpOnly: true, sameSite: 'Lax' }])
    await page.goto(f.baseURL + path)
    await expect(page.getByRole('heading', { name: 'Paper practice', exact: true })).toBeVisible()
    await expect(page.getByText(payload.items[3].rubric.examples.meets, { exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true)
    let losePhotoReply = true
    await page.route('**' + path + '/upload', async route => {
      if (losePhotoReply) { losePhotoReply = false; const saved = await route.fetch(); expect(saved.status()).toBe(201); await route.abort('failed') }
      else await route.continue()
    })
    await page.getByLabel('Choose a paper photo').setInputFiles({ name: 'synthetic-paper.png', mimeType: 'image/png', buffer: PNG })
    await expect(page.locator('[data-paper-photo-status]')).toContainText('in this page only')
    await page.getByRole('button', { name: 'Save photo', exact: true }).click()
    await expect(page.locator('[data-paper-photo-status]')).toContainText('not confirmed')
    await expect(page.getByAltText('Selected paper photo, not saved yet')).toBeVisible()
    await page.getByRole('button', { name: 'Save photo', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Saved paper photos', exact: true })).toBeVisible()
    expect((await f.db.prepare('SELECT count(*) n FROM uploads').get())?.n).toBe(1)
    const work = readPaperWork(JSON.parse(String((await getSheet(f.db, f.owner, sheet)).spec_json)).work)!
    expect(work.photos).toHaveLength(1); expect((await f.attempts()).length).toBe(0)
    for (const [index, item] of payload.items.entries()) await page.getByLabel('Box ' + (index + 1), { exact: true }).fill(item.rubric?.examples.meets ?? item.answer)
    await page.getByLabel('Help while doing this paper').selectOption('none')
    await expect(page.locator('[data-paper-draft-status]')).toContainText('Kept in this tab')
    await page.reload()
    await expect(page.getByLabel('Box 4', { exact: true })).toHaveValue(payload.items[3].rubric.examples.meets)
    await page.getByLabel('I have finished this paper check', { exact: false }).check()
    await page.getByLabel('These entries match what I wrote.', { exact: true }).check()
    await page.getByLabel('Box 3', { exact: true }).fill('?')
    await page.getByRole('button', { name: 'Submit paper check', exact: true }).click()
    await expect(page.locator('[data-paper-submit-status]')).toContainText('not readable')
    expect((await f.attempts()).length).toBe(0)
    await page.getByLabel('Box 3', { exact: true }).fill(payload.items[2].answer)
    let loseSubmissionReply = true
    await page.route('**' + path + '/score', async route => {
      if (loseSubmissionReply) { loseSubmissionReply = false; const saved = await route.fetch(); expect(saved.status()).toBe(200); await route.abort('failed') }
      else await route.continue()
    })
    await page.getByRole('button', { name: 'Submit paper check', exact: true }).click()
    await expect(page.locator('[data-paper-submit-status]')).toContainText('still here')
    const beforeRetry = (await f.attempts()).length
    await page.getByRole('button', { name: 'Submit paper check', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Paper submitted', exact: true })).toBeVisible()
    expect((await f.attempts()).length).toBe(beforeRetry)
    await expect(page.getByText('answer saved, awaiting a check', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('Paper conditions are self-reported.', { exact: false })).toBeVisible()
    await f.drain(); await page.reload()
    await expect(page.getByText('answer saved, awaiting a check', { exact: false })).toHaveCount(0)
    expect((await f.attempts()).every(a => a.task?.revision === payload.tasks[a.attemptId].revision && a.paperConditions?.basis === 'self-reported')).toBe(true)
    expect((await (await settledAudit(page)).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    await page.screenshot({ path: 'evidence/screenshots/paper-cycle-' + info.project.name + '.png', fullPage: true })
    await f.within(() => recordAudit(f.db, f.student, payload.items[3].itemId, false, f.clock()))
    await page.reload()
    await expect(page.getByText('Box 4: grade questioned; not counted toward progress', { exact: true })).toBeVisible()
    expect((await f.attempts()).find(a => a.attemptId === payload.items[3].itemId)?.evidenceCertainty).toBe('unresolved')
    await page.getByRole('link', { name: 'Continue with fresh practice', exact: true }).click()
    const start = await f.request('/students/' + f.student + '/session', { mode: 'assessment', goal: 'independent_check', focusConceptId: payload.items[0].conceptId })
    expect(start.status).toBe(303)
    const session = start.headers.get('location')!.split('/').at(-1)!, followup = await f.items(session)
    expect(followup).toHaveLength(5)
    expect(followup.every(item => !payload.items.some((prior: any) => prior.prompt === item.prompt))).toBe(true)
    await page.goto(f.baseURL + start.headers.get('location'))
    await expect(page.locator('.hint, .feedback-review, .verdict')).toHaveCount(0)
  } finally { await f.close() }
})

test('paper previews clear on leaving the page and sign-out removes tab entries and private access', async ({ page }) => {
  const f = await learningRouteFixture({ ai: false })
  try {
    const sheet = await f.within(() => createSheet(f.db, f.owner, f.student)), path = '/sheet/' + sheet
    await page.context().addCookies([{ name: 'tutor_session', value: f.auth.token, url: f.baseURL, httpOnly: true, sameSite: 'Lax' }])
    await page.goto(f.baseURL + path)
    await page.getByLabel('Choose a paper photo').setInputFiles({ name: 'synthetic-paper.png', mimeType: 'image/png', buffer: PNG })
    await expect(page.getByAltText('Selected paper photo, not saved yet')).toBeVisible()
    await page.getByLabel('Box 1', { exact: true }).fill('Synthetic paper draft')
    await page.goto(f.baseURL + '/students')
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page).toHaveURL(f.baseURL + '/')
    await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), 'draft:paper:' + sheet)).toBeNull()
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('draft:paper:')))).toEqual([])
    await page.goto(f.baseURL + path)
    await expect(page.locator('[data-paper-score], [data-paper-photo-preview], img[src^="/uploads/"]')).toHaveCount(0)
    expect((await f.db.prepare('SELECT count(*) n FROM uploads').get())?.n).toBe(0)
  } finally { await f.close() }
})
