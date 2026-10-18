import { defineConfig } from '@playwright/test'
import base from './playwright.config.ts'

export default defineConfig(base, {
  grep: /menus lead|class planning returns|both age presentations|school-result photos keep/,
  reporter: [['list'], ['json', { outputFile: 'evidence/class-shortcuts-browser-results.json' }]],
})
