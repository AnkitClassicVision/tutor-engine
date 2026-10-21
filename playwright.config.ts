import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './test/browser', outputDir: './test-results/local', fullyParallel: false, workers: 1, timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:8799', trace: 'retain-on-failure' },
  reporter: [['list'], ['json', { outputFile: 'evidence/browser-results.json' }]],
  webServer: { command: 'node --experimental-strip-types scripts/browser-server.ts', url: 'http://127.0.0.1:8799/health', reuseExistingServer: false },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'firefox', use: { ...devices['Desktop Firefox'] } }, { name: 'webkit', use: { ...devices['Desktop Safari'] } }, { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    // Tablet (WF-02-A): the child journeys on an iPad-sized touch screen.
    { name: 'tablet', use: { ...devices['iPad (gen 7)'] }, testMatch: ['journey.spec.ts', 'age-bands.spec.ts', 'homework-confirm.spec.ts', 'ai-welcome.spec.ts', 'feedback.spec.ts', 'shared-device.spec.ts', 'teaching.spec.ts', 'turn-saving.spec.ts', 'learning-routes.spec.ts', 'paper.spec.ts'] }],
})
