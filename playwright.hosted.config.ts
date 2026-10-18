import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test/hosted', outputDir: './test-results/hosted', fullyParallel: false, workers: 1,
  globalTeardown: './test/hosted/cleanup.ts',
  timeout: 120000, expect: { timeout: 30000 },
  use: { baseURL: process.env.TUTOR_HOSTED_URL ?? 'https://kids-tutor-iota.vercel.app', trace: 'off' },
  reporter: [['list'], ['json', { outputFile: 'evidence/hosted-browser-results.json' }]],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
})
