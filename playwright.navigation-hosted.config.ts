import { defineConfig } from '@playwright/test'
import base from './playwright.hosted.config.ts'

export default defineConfig(base, {
  grep: /live class homework and score shortcuts|live profiles, draft recovery/,
  reporter: [['list'], ['json', { outputFile: 'evidence/class-shortcuts-hosted-results.json' }]],
})
