import base from './playwright.config.ts'
import {defineConfig} from '@playwright/test'
export default defineConfig({...base,testMatch:['feedback.spec.ts','journey.spec.ts','parent-access.spec.ts'],outputDir:'./test-results/feedback',reporter:[['list'],['json',{outputFile:'evidence/feedback-final-browser-results.json'}]]})
