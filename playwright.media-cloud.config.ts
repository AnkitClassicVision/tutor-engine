import { defineConfig } from '@playwright/test'
import cloud from './playwright.cloud.config.ts'
export default defineConfig({
  ...cloud, outputDir: './test-results/media-cloud', grep: /simulated camera captures and retakes/,
  use: { ...cloud.use, baseURL: 'http://127.0.0.1:8802' },
  webServer: { ...cloud.webServer as any,
    command: 'TUTOR_TEST_CLOUD=1 TUTOR_TEST_CLOUD_PORT=8802 node --env-file=.env.vercel-production.local --experimental-strip-types scripts/cloud-browser-server.ts',
    url: 'http://127.0.0.1:8802/health',
  },
  reporter: [['list'], ['json', { outputFile: 'evidence/camera-device-cloud-results.json' }]],
})
