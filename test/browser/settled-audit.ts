import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

/** An accessibility audit of the page at rest, so a slow browser cannot catch a button or text mid-fade and report a
 * contrast failure that no one ever sees (seen in CI WebKit: a button sampled halfway through its colour transition). */
export async function settledAudit(page: Page) {
  // Finite animations and transitions jump to their end state; looping ones keep running and never change text colour.
  await page.evaluate(() => { for (const a of document.getAnimations()) if (a.effect?.getComputedTiming().endTime !== Infinity) { try { a.finish() } catch { /* already done */ } } })
  return new AxeBuilder({ page })
}
