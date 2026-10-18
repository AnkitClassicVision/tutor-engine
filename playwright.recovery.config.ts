import { defineConfig } from '@playwright/test'
import local from './playwright.config.ts'
import cloud from './playwright.cloud.config.ts'

const liveCloud = process.env.TUTOR_TEST_CLOUD === '1'
export default defineConfig({
  ...(liveCloud ? cloud : local),
  testMatch: 'recovery.spec.ts',
  reporter: [['list'], ['json', { outputFile: `evidence/${liveCloud ? 'cloud-' : ''}browser-recovery-results.json` }]],
})
