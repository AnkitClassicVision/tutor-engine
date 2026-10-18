import base from './playwright.hosted.config.ts'
import { defineConfig } from '@playwright/test'
export default defineConfig({ ...base, testMatch: 'adaptive.spec.ts', outputDir: './test-results/adaptive-hosted', reporter: [['list'], ['json', { outputFile: 'evidence/adaptive-hosted-results.json' }]] })
