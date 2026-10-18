import base from './playwright.config.ts'
import { defineConfig } from '@playwright/test'
export default defineConfig({ ...base, testMatch: ['adaptive.spec.ts', 'journey.spec.ts', 'recovery.spec.ts'], outputDir: './test-results/adaptive', reporter: [['list'], ['json', { outputFile: process.env.TUTOR_BROWSER_REPORT || 'evidence/adaptive-browser-results.json' }]] })
