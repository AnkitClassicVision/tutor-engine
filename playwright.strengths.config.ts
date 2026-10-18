import base from './playwright.config.ts'
import {defineConfig} from '@playwright/test'
export default defineConfig({...base,testMatch:'strengths.spec.ts',outputDir:'./test-results/strengths',reporter:[['list'],['json',{outputFile:'evidence/strengths-browser-results.json'}]]})
