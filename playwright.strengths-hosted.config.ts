import base from './playwright.hosted.config.ts'
import {defineConfig} from '@playwright/test'
export default defineConfig({...base,testMatch:'strengths.spec.ts',outputDir:'./test-results/strengths-hosted',reporter:[['list'],['json',{outputFile:'evidence/strengths-hosted-results.json'}]]})
