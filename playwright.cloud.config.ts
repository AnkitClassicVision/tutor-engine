import { defineConfig } from '@playwright/test'
import local from './playwright.config.ts'
export default defineConfig({
  ...local,
  timeout: 90000,
  expect: { timeout: 20000 },
  reporter: [['list'], ['json', { outputFile: 'evidence/cloud-browser-results.json' }]],
  webServer: {
    command: 'TUTOR_TEST_CLOUD=1 node --env-file=.env.vercel-production.local --experimental-strip-types scripts/cloud-browser-server.ts',
    url: 'http://127.0.0.1:8799/health', reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 30000 },
  },
})
