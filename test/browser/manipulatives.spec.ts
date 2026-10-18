import { test, expect } from '@playwright/test'
import { settledAudit } from './settled-audit.ts'
import { manipulative } from '../../src/manipulatives.ts'

test('the hands-on models work by touch, mouse and keyboard and always state their value', async ({ page }) => {
  await page.goto('/')
  await page.setContent(`<!doctype html><html lang="en"><head><title>Models</title></head><body><main><h1>Models</h1>
    ${manipulative('math.4.nf.a.1', 'Is 3/8 equal to 6/16?')}
    ${manipulative('math.primary.3.multiply', '6 baskets hold 7 apples each.')}
    ${manipulative('math.primary.2.add', 'What is 38 + 15?')}</main></body></html>`)
  // The app's real stylesheet and script, loaded the way pages load them (the security policy allows no inline code).
  await page.addStyleTag({ url: '/app.css' })
  await page.addScriptTag({ url: '/manipulatives.js' })
  const fraction = page.locator('[data-manip="fraction"]')
  await expect(fraction.locator('[data-value]')).toHaveText('3 of 8 equal parts shaded: 3/8')
  await fraction.getByRole('button', { name: 'Part 4 of 8' }).click()
  await expect(fraction.locator('[data-value]')).toHaveText('4 of 8 equal parts shaded: 4/8')
  await fraction.getByRole('button', { name: 'Part 1 of 8' }).focus()
  await page.keyboard.press('Space')
  await expect(fraction.getByRole('button', { name: 'Part 1 of 8' })).toHaveAttribute('aria-pressed', 'false')
  await expect(fraction.locator('[data-value]')).toHaveText('3 of 8 equal parts shaded: 3/8')
  await fraction.getByRole('button', { name: 'More parts' }).click()
  await expect(fraction.locator('[data-value]')).toHaveText('0 of 9 equal parts shaded: 0/9')
  await expect(fraction.getByRole('button', { name: /^Part \d+ of 9$/ })).toHaveCount(9)
  const groups = page.locator('[data-manip="groups"]')
  await groups.getByRole('button', { name: 'More groups' }).click()
  await groups.getByRole('button', { name: 'Fewer in each' }).focus()
  await page.keyboard.press('Enter')
  await expect(groups.locator('[data-value]')).toHaveText('7 groups of 6 make 42')
  await expect(groups.locator('.manip-dot')).toHaveCount(42)
  const line = page.locator('[data-manip="line"]')
  await line.getByRole('button', { name: 'Forward 10' }).click()
  for (let i = 0; i < 5; i++) await line.getByRole('button', { name: 'Forward 1', exact: true }).click()
  await expect(line.locator('[data-value]')).toHaveText('At 53')
  for (let i = 0; i < 3; i++) await line.getByRole('button', { name: 'Forward 10' }).click()
  await expect(line.locator('[data-value]')).toHaveText('At 60', { timeout: 2000 })
  for (const box of await page.locator('.manip-part, .manip-controls button').all()) expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  const audit = await (await settledAudit(page)).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(audit.violations.map((v) => v.id)).toEqual([])
})
