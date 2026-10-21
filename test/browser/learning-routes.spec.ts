import { test, expect, type Page } from '@playwright/test'
import { learningRouteFixture, FRACTION_TARGET, type LearningRoute } from '../fixtures/learning-routes.ts'
import { taskMatches, readTask } from '../../src/task-evidence.ts'
import { independent } from '../../src/engine/mastery.ts'
import { FRACTION_CHECKS } from '../../src/engine/fraction-cycle.ts'
import { settledAudit } from './settled-audit.ts'

test.setTimeout(120000)
test.use({ actionTimeout: 15000 })
async function enter(page: Page, f: LearningRoute) {
  await page.context().addCookies([{ name: 'tutor_session', value: f.auth.token, url: f.baseURL, httpOnly: true, sameSite: 'Lax' }])
  await page.goto(f.baseURL + '/students/' + f.student)
  await page.getByRole('button', { name: 'Start student mode', exact: true }).click()
}
const sessionId = (page: Page) => new URL(page.url()).pathname.split('/').at(-1)!
async function startFromHome(page: Page, label: string) {
  await Promise.all([
    page.waitForURL(url => /^\/session\/[0-9a-f-]{36}$/.test(url.pathname)),
    page.getByRole('button', { name: label, exact: true }).click(),
  ])
  return sessionId(page)
}
const responseFor = (row: Record<string, any>) => row.rubric_json ? JSON.parse(String(row.rubric_json)).examples.meets : String(row.answer)
async function current(page: Page, f: LearningRoute) {
  const id = await page.locator('form.answer input[name=itemId]').inputValue()
  const session = sessionId(page)
  await expect.poll(async () => (await f.items(session)).find(i => i.id === id)?.visible_at).toBeTruthy()
  return (await f.items(session)).find(i => i.id === id)!
}
async function answer(page: Page, f: LearningRoute, value?: string) {
  const row = await current(page, f), form = page.locator('form.answer')
  await form.locator('[name=answer]').fill(value ?? responseFor(row))
  f.advance(15000)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    form.getByRole('button', { name: /^(Check|Save and continue|Save and finish assessment)$/ }).click(),
  ])
  return row
}
async function sealed(page: Page) {
  await expect(page.locator('.feedback-review, .verdict, .hint, form.talk, form[action$="/hint"]')).toHaveCount(0)
  await expect(page.getByText('Key or rubric:', { exact: false })).toHaveCount(0)
}

test('a live fractions cycle measures a genuine seven-day pair, preserves support and reaches unfamiliar transfer', async ({ page }, info) => {
  const f = await learningRouteFixture()
  try {
    await enter(page, f)
    await expect(page.locator('[data-learning-day]')).toHaveAttribute('data-learning-day', '2026-10-05')
    await expect(page.locator('.mission-note')).toContainText('assessment on your own')
    const diagnostic = await startFromHome(page, 'Find my starting point'), diagnosticItems = await f.items(diagnostic)
    expect(diagnosticItems.map(i => i.concept_id)).toEqual(['math.4.nf.a.1', 'math.4.nf.a.1', 'math.4.nf.b.3', 'math.4.nf.b.3', FRACTION_TARGET, FRACTION_TARGET])
    const first = await current(page, f)
    const alternate = await f.request('/session/' + diagnostic + '/ask', { message: 'Give me a worked answer.' })
    expect(alternate.status).toBe(409)
    expect((await f.db.prepare('SELECT count(*) n FROM lesson_messages WHERE session_id = ?').get(diagnostic))?.n).toBe(0)
    await sealed(page)
    await answer(page, f)
    const duplicate = await f.request('/session/' + diagnostic + '/answer', { itemId: first.id, revision: first.revision_id, answer: responseFor(first), receipt: '1' })
    expect((await duplicate.json()).saved).toBe(true)
    expect((await f.attempts()).filter(a => a.attemptId === first.id)).toHaveLength(1)
    for (let i = 1; i < diagnosticItems.length; i++) {
      await sealed(page)
      await answer(page, f, diagnosticItems[i].concept_id === FRACTION_TARGET ? '0' : undefined)
    }
    await expect(page.getByRole('heading', { name: 'Assessment complete', exact: true })).toBeVisible()
    expect((await f.attempts()).filter(a => a.conceptId === FRACTION_TARGET && !a.correct)).toHaveLength(2)
    await page.goto(f.baseURL + '/students/' + f.student)
    const learning = await startFromHome(page, 'Let’s go')
    await expect(page.getByRole('heading', { name: 'A worked example', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Let’s try one together', exact: true }).click()
    const guided = await current(page, f)
    expect(guided.bloom_level).toBe(3); expect(guided.hints_used).toBe(1)
    await page.locator('form.answer [name=answer]').fill(responseFor(guided))
    await expect(page.locator('[data-draft-status]')).toHaveText('Draft saved.')
    await page.getByRole('button', { name: 'Save & stop', exact: true }).click()
    f.advance(120000)
    await page.getByRole('button', { name: /Pick up where/ }).click()
    await expect(page.locator('form.answer [name=answer]')).toHaveValue(responseFor(guided))
    expect((await current(page, f)).revision_id).toBe(guided.revision_id)
    await answer(page, f)
    const faded = await current(page, f)
    expect(faded.beat).toBe('faded'); expect(faded.hints_used).toBe(1)
    expect(JSON.parse(String(faded.scaffold_json)).task.prompt).not.toContain(' = ')
    await answer(page, f)
    for (let n = 0; n < 18; n++) {
      if (new URL(page.url()).pathname.startsWith('/jobs/')) { await f.drain(); await page.goto(f.baseURL + '/session/' + learning) }
      if (!(await f.items(learning)).some(i => i.answered === 0)) break
      if (await page.locator('form.answer').count()) await answer(page, f)
      // Feedback can return to the same URL; inspect the next document only after it loads.
      else await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.getByRole('button', { name: 'Ready for a fresh question', exact: true }).click(),
      ])
    }
    expect((await f.items(learning)).every(i => i.answered === 1)).toBe(true)
    await expect(page.locator('form.answer')).toHaveCount(0)
    const learningAttempts = (await f.attempts()).filter(a => a.sessionId === learning)
    expect(learningAttempts.filter(a => [guided.id, faded.id].includes(a.attemptId)).every(a => !independent(a))).toBe(true)
    await page.goto(f.baseURL + '/students/' + f.student)
    const immediate = await startFromHome(page, 'Check on my own'), immediateItems = await f.items(immediate)
    expect(immediateItems.map(i => i.bloom_level)).toEqual([3, 3, 4, 5, 6])
    expect(immediateItems.every(i => taskMatches(i) && readTask(i.task_evidence)?.parallelFormId)).toBe(true)
    const earlier = new Set((await f.items(learning)).map(i => i.prompt))
    expect(immediateItems.every(i => !earlier.has(i.prompt) && Number(i.hints_used) === 0)).toBe(true)
    for (let n = 0; n < immediateItems.length; n++) { await sealed(page); await answer(page, f) }
    await expect(page.getByRole('heading', { name: 'Assessment complete', exact: true })).toBeVisible()
    expect((await f.attempts()).filter(a => a.sessionId === immediate)).toHaveLength(2)
    await expect(page.locator('.is-pending')).toHaveCount(3)
    await f.drain(); await page.reload()
    await expect(page.locator('.is-pending')).toHaveCount(0)
    expect((await f.attempts()).filter(a => a.sessionId === immediate && a.correct)).toHaveLength(5)
    await expect.poll(async () => (await f.items(immediate)).filter(i => i.feedback_visible_at).length).toBe(5)
    expect(await f.source()).toContain('Synthetic school coverage')
    f.advance(7 * 86400000)
    await page.goto(f.baseURL + '/students/' + f.student)
    await expect(page.locator('[data-learning-day]')).toHaveAttribute('data-learning-day', '2026-10-12')
    expect(await f.source()).not.toContain('Synthetic school coverage')
    const delayed = await startFromHome(page, 'Check what stuck')
    expect(await f.items(delayed)).toHaveLength(2)
    expect((await f.items(delayed)).every(i => i.bloom_level === 3 && taskMatches(i))).toBe(true)
    for (let n = 0; n < 2; n++) { await sealed(page); await answer(page, f) }
    await expect(page.getByRole('heading', { name: 'Assessment complete', exact: true })).toBeVisible()
    const retained = (await f.retained()).filter(p => p.after.sessionId === delayed)
    const chain = (await f.attempts()).filter(a => a.conceptId === FRACTION_TARGET).map(a => ({
      session: a.sessionId === immediate ? 'immediate' : a.sessionId === delayed ? 'delayed' : 'earlier',
      day: a.day, demand: a.bloomLevel, correct: a.correct, fresh: a.fresh, support: a.supportUsed,
      certainty: a.evidenceCertainty, started: a.measurementStartedAt, lastExposure: a.lastExposureAt,
      outcome: a.task?.outcomeId, form: a.task?.parallelFormId,
    }))
    expect(retained.length, JSON.stringify(chain, null, 2)).toBeGreaterThan(0)
    expect(retained.every(p => p.comparison === 'validated' && p.unrefreshed && p.after.correct)).toBe(true)
    expect(retained.every(p => p.before.task?.parallelFormId === p.after.task?.parallelFormId)).toBe(true)
    await page.goto(f.baseURL + '/students/' + f.student)
    const transfer = await startFromHome(page, 'Try a new situation'), transferItem = await current(page, f)
    await sealed(page)
    expect(transferItem.evidence_kind).toBe('transfer')
    expect(transferItem.bloom_level).toBe(4)
    await expect(page.locator('.question-text')).toContainText('storage')
    await answer(page, f); await f.drain(); await page.reload()
    expect((await f.attempts()).find(a => a.sessionId === transfer)?.kind).toBe('transfer')
    expect((await f.retained()).every(p => p.after.sessionId !== transfer)).toBe(true)
    expect((await f.attempts()).every(a => a.task?.revision)).toBe(true)
    expect((await (await settledAudit(page)).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    await page.screenshot({ path: 'evidence/screenshots/learning-cycle-' + info.project.name + '.png', fullPage: true })
  } finally { await f.close() }
})

async function primeDelayed(f: LearningRoute) {
  const start = await f.request('/students/' + f.student + '/session', { mode: 'assessment', goal: 'independent_check', focusConceptId: FRACTION_TARGET })
  const path = start.headers.get('location')!, session = path.split('/').at(-1)!
  for (const row of (await f.items(session)).slice(0, 2)) {
    await f.request(path); await f.request(path + '/seen', { itemId: row.id, what: 'question' })
    f.advance(15000)
    await f.request(path + '/answer', { itemId: row.id, revision: row.revision_id, answer: responseFor(row), receipt: '1' })
  }
  await f.request(path + '/finish', {})
  f.advance(7 * 86400000)
}

for (const goal of FRACTION_CHECKS) test(goal + ' retains its seal through pause, timeout, skips and early submission', async ({ page }) => {
  const f = await learningRouteFixture()
  try {
    if (goal === 'delayed_check') await primeDelayed(f)
    await enter(page, f)
    const start = await f.request('/students/' + f.student + '/session', { mode: 'assessment', goal, focusConceptId: FRACTION_TARGET })
    expect(start.status).toBe(303)
    const path = start.headers.get('location')!, session = path.split('/').at(-1)!
    await page.goto(f.baseURL + path)
    const original = (await f.items(session)).map(i => [i.id, i.revision_id]), row = await current(page, f)
    await page.locator('form.answer [name=answer]').fill(responseFor(row))
    await expect(page.locator('[data-draft-status]')).toHaveText('Draft saved.')
    for (const suffix of ['hint', 'ask', 'lesson']) {
      const blocked = await f.request(path + '/' + suffix, { itemId: row.id, message: 'Explain the answer.', rung: 3 })
      expect(blocked.status).toBe(409)
      expect((await blocked.json()).location).toBe(path)
    }
    await page.goto(f.baseURL + '/students/' + f.student + '/map')
    await expect(page).toHaveURL(f.baseURL + path)
    await sealed(page)
    await page.getByRole('button', { name: 'Pause assessment', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Assessment saved', exact: true })).toBeVisible()
    f.advance(60000)
    await page.reload(); await sealed(page)
    await page.getByRole('button', { name: 'Resume assessment', exact: true }).click()
    await expect(page.locator('form.answer [name=answer]')).toHaveValue(responseFor(row))
    expect((await f.items(session)).map(i => [i.id, i.revision_id])).toEqual(original)
    f.advance(11 * 60000)
    await page.reload(); await sealed(page)
    await expect(page.getByRole('heading', { name: 'Assessment saved', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Resume assessment', exact: true }).click()
    await sealed(page)
    await page.getByRole('button', { name: 'Leave unanswered', exact: true }).click()
    if (original.length > 1) {
      await sealed(page)
      await page.getByText('Finish assessment early', { exact: true }).click()
      await page.getByRole('button', { name: 'Finish assessment now', exact: true }).click()
    }
    await expect(page.getByRole('heading', { name: 'Assessment complete', exact: true })).toBeVisible()
    expect((await f.attempts()).filter(a => a.sessionId === session)).toHaveLength(0)
    expect((await f.db.prepare('SELECT count(*) n FROM session_items WHERE session_id = ? AND correct IS NOT NULL').get(session))?.n).toBe(0)
    await f.request(path + '/resume', {}); await page.reload()
    await expect(page.locator('form.answer')).toHaveCount(0)
  } finally { await f.close() }
})

test('a missing prerequisite chooses its learning task; failed generation and checking preserve the current work', async ({ page }) => {
  const f = await learningRouteFixture()
  try {
    await enter(page, f)
    const diagnostic = await startFromHome(page, 'Find my starting point'), rows = await f.items(diagnostic)
    for (const row of rows) await answer(page, f, row.concept_id === 'math.4.nf.a.1' || row.concept_id === FRACTION_TARGET ? '0' : undefined)
    await page.goto(f.baseURL + '/students/' + f.student)
    await expect(page.locator('.today-mission h2')).toContainText('Explain equivalent fractions')
    const learning = await startFromHome(page, 'Let’s go')
    await page.getByRole('button', { name: 'Let’s try one together', exact: true }).click()
    const row = await current(page, f)
    await page.locator('form.answer [name=answer]').fill(responseFor(row))
    await expect(page.locator('[data-draft-status]')).toHaveText('Draft saved.')
    const failed = await f.failedGeneration()
    await page.goto(f.baseURL + '/jobs/' + failed)
    await expect(page.getByRole('button', { name: /Try again|Retry/ })).toBeVisible()
    expect((await f.db.prepare('SELECT status FROM jobs WHERE id = ?').get(failed))?.status).toBe('failed')
    await page.goto(f.baseURL + '/session/' + learning)
    await expect(page.locator('form.answer [name=answer]')).toHaveValue(responseFor(row))
    expect((await current(page, f)).revision_id).toBe(row.revision_id)
    await page.getByRole('button', { name: 'Save & stop', exact: true }).click()
    const start = await f.request('/students/' + f.student + '/session', { mode: 'assessment', goal: 'transfer_check', focusConceptId: FRACTION_TARGET })
    const path = start.headers.get('location')!, transfer = path.split('/').at(-1)!
    await page.goto(f.baseURL + path)
    const pending = await current(page, f)
    await answer(page, f)
    f.failChecker(true); await f.drain(); await page.reload()
    await expect(page.locator('.is-pending')).toContainText('Checking did not finish')
    expect((await f.attempts()).some(a => a.sessionId === transfer)).toBe(false)
    const job = await f.db.prepare("SELECT id FROM jobs WHERE kind = 'grade' AND status = 'failed' ORDER BY created_at DESC LIMIT 1").get()
    expect(job).toBeTruthy()
    const retry = await f.request('/jobs/' + job!.id + '/retry', {})
    expect([200, 202, 303]).toContain(retry.status)
    f.failChecker(false); await f.drain(); await page.reload()
    await expect(page.locator('.is-pending')).toHaveCount(0)
    expect((await f.attempts()).filter(a => a.attemptId === pending.id)).toHaveLength(1)
    expect((await f.items(learning)).find(i => i.id === row.id)?.draft_answer).toBe(responseFor(row))
  } finally { await f.close() }
})
