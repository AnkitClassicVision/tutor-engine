import { defineConfig } from '@playwright/test'
import cloud from './playwright.cloud.config.ts'
export default defineConfig({
  ...cloud, grep: /school-result photos/,
  reporter: [['list'], ['json', { outputFile: 'evidence/school-results-cloud-browser-results.json' }]],
})
