import base from './playwright.config.ts'
import { defineConfig } from '@playwright/test'
export default defineConfig({ ...base, testMatch: ['parent-access.spec.ts', 'journey.spec.ts'], outputDir:'./test-results/parent', reporter:[['list'],['json',{outputFile:'evidence/parent-browser-results.json'}]] })
