import base from './playwright.hosted.config.ts'
import { defineConfig } from '@playwright/test'
export default defineConfig({ ...base, testMatch: ['parent-access.spec.ts','adaptive.spec.ts'], outputDir:'./test-results/parent-hosted', reporter:[['list'],['json',{outputFile:'evidence/parent-hosted-results.json'}]] })
