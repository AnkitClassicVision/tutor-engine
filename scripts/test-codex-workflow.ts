import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { openDb } from '../src/db.ts'
import { deleteFamily } from '../src/accounts.ts'
import { mkdirSync as makeEvidenceDir } from 'node:fs'
makeEvidenceDir('evidence', { recursive: true })

const browser=await chromium.launch();const page=await browser.newPage();let owner:string|undefined
const db=openDb('data/codex-test.sqlite')
const email=`codex-workflow-${crypto.randomUUID()}@example.invalid`
try{
 await page.goto('http://127.0.0.1:8788/')
 await page.getByText('Create an account',{exact:true}).click()
 const register=page.locator('form[action="/register"]');await register.getByLabel('Email').fill(email);await register.getByLabel('Password',{exact:true}).fill('synthetic-local-password');await register.getByRole('button',{name:'Create account'}).click()
 await page.getByLabel('Name',{exact:true}).fill('Synthetic learner');await page.getByLabel('Birthday',{exact:true}).fill('2015-03-04');await page.getByRole('button',{name:'Add student',exact:true}).click();await page.waitForURL(/\/students\/[0-9a-f-]{36}$/i)
 owner=String((await db.prepare('SELECT id FROM users WHERE email = ?').get(email))!.id)
 const student=new URL(page.url()).pathname.split('/').at(-1)!
 await page.getByRole('link',{name:'Parent area',exact:true}).click();await page.getByRole('link',{name:'AI connection',exact:true}).click()
 await page.getByLabel('Which AI').selectOption('codex');await page.getByRole('button',{name:'Save AI',exact:true}).click();await page.getByText('Using this computer’s Codex ChatGPT sign-in',{exact:false}).waitFor()
 await page.getByRole('link',{name:'Back to parent area',exact:true}).click();await page.getByText('Plan a class',{exact:true}).click()
 await page.getByRole('navigation').filter({has:page.getByRole('link',{name:'New',exact:true})}).getByRole('link',{name:'New',exact:true}).click()
 await page.getByLabel('What do you want?',{exact:true}).fill('Plan one small Math class on equivalent fractions for Grade 5. I agree with this scope; make the proposal ready to build. Keep fraction addition as the next step, not forced creation.');await page.getByRole('button',{name:'Send',exact:true}).click()
 await page.getByRole('link',{name:'See your next step'}).waitFor({timeout:65000});await page.getByRole('link',{name:'See your next step'}).click()
 await page.getByRole('button',{name:'Build this',exact:true}).waitFor({timeout:10000});await page.getByRole('button',{name:'Build this',exact:true}).click()
 await page.getByRole('link',{name:'See your next step'}).waitFor({timeout:100000});await page.getByRole('link',{name:'See your next step'}).click()
 const custom=await db.prepare('SELECT count(*) n FROM custom_concepts WHERE student_id = ?').get(student)
 const practice=await db.prepare('SELECT count(*) n FROM practice_items WHERE student_id = ?').get(student)
 assert.ok(Number(practice!.n)>=2,'Real curriculum must persist usable practice items')
 await page.goto(`http://127.0.0.1:8788/students/${student}`)
 await page.getByRole('button',{name:'Let’s go',exact:false}).click();await page.getByLabel('Answer',{exact:true}).fill('Synthetic saved draft');await page.getByRole('button',{name:'Save & stop',exact:true}).click();await page.getByRole('button',{name:'Pick up where',exact:false}).click();assert.equal(await page.getByLabel('Answer',{exact:true}).inputValue(),'Synthetic saved draft')
 const report={testedAt:new Date().toISOString(),auth:'local Codex ChatGPT sign-in',realModelCalls:2,checks:['parent selects Codex without API key','real planning job returns to parent thread','agreed plan builds and persists fresh practice','student mission starts','draft survives save and resume'],customConcepts:Number(custom!.n),practiceItems:Number(practice!.n),releaseGatePassed:false}
 await writeFile('evidence/codex-workflow.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}finally{await browser.close();if(owner)await deleteFamily(db,owner,'data/codex-test-uploads');else{const row=await db.prepare('SELECT id FROM users WHERE email = ?').get(email);if(row)await deleteFamily(db,String(row.id),'data/codex-test-uploads')}db.close()}
