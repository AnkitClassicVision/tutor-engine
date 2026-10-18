import base from './playwright.hosted.config.ts'
import {defineConfig} from '@playwright/test'
export default defineConfig({...base,testMatch:'coaching.spec.ts',outputDir:'./test-results/coaching-hosted',reporter:[['list'],['json',{outputFile:'evidence/coaching-hosted-results.json'}]]})
