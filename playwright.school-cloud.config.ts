import { defineConfig } from '@playwright/test'
import cloud from './playwright.cloud.config.ts'
export default defineConfig({
  ...cloud, grep: /sample-test photos/,
  reporter: [['list'], ['json', { outputFile: 'evidence/school-sources-cloud-browser-results.json' }]],
})
