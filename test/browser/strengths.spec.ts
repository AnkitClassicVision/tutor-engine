import {test,expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {readFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

test('connected strengths show independent evidence, preserve milestones and navigate on small screens',async({page},info)=>{
 await page.goto('/');const login=page.locator('form[action="/login"]')
 await login.getByLabel('Email').fill('strengths-browser@example.invalid');await login.getByLabel('Password',{exact:true}).fill('synthetic-browser-password');await login.getByRole('button',{name:'Enter',exact:true}).click()
 // One fixture learner: landing may be the learner picker or the student home.
 if(!/\/students\/[0-9a-f-]{36}$/.test(page.url()))await page.getByRole('link',{name:/Synthetic explorer/}).first().click()
 const student=page.url().split('/').at(-1)!
 await page.goto(`/students/${student}/parent`);await page.getByRole('link',{name:'Open strengths map'}).click()
 await expect(page.getByRole('heading',{name:'Your topics'})).toBeVisible()
 const fraction=page.locator('[data-strength-node="math.5.nf.a.1"]')
 await fraction.click();await expect(page.locator('#strength-detail')).toContainText('1 repeated responses')
 await expect(page.locator('.strength-evidence div').filter({has:page.getByText('Fresh independent checks',{exact:true})})).toContainText('1')
 await expect(page.locator('.strength-evidence div').filter({has:page.getByText('Successes with help',{exact:true})})).toContainText('1')
 await expect(page.locator('.strength-evidence div').filter({has:page.getByText('Awaiting review',{exact:true})})).toContainText('1')
 await page.locator('[data-strength-node="math.8.ee.c.7"]').click()
 await expect(page.locator('#strength-detail')).toContainText('You’ve shown you can: use it.')
 await expect(page.locator('.strength-levels li').filter({has:page.getByText('Remember',{exact:true})})).toContainText('Not yet checked')
 await expect(page.locator('.strength-levels li').filter({has:page.getByText('Apply',{exact:true})})).toContainText('3 successful / 3 independent checks')
 await page.locator('[data-strength-node="math.5.nf.b.4"]').click()
 await expect(page.locator('#strength-detail')).toContainText('Your earlier achievement stays')
 await expect(page.getByRole('button',{name:'Revisit this idea'})).toBeVisible()
 await page.getByRole('link',{name:'Show all foundations',exact:true}).click();await expect(page.getByRole('link',{name:'Show nearby foundations'})).toBeVisible()
 await page.getByText('Explore the map as a list',{exact:true}).click();await expect(page.locator('.strength-list ul')).toBeVisible()
 const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([])
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 // Selected node stays keyboard reachable; page focus is not stolen by map centering.
 await page.locator('[data-strength-node="math.5.nf.a.1"]').focus();await page.keyboard.press('Enter');await expect(page.locator('#strength-detail-title')).toHaveText('Add and subtract fractions with unlike denominators')
 await page.getByRole('link',{name:'Show nearby foundations'}).click()
 await page.evaluate(()=>scrollTo(0,0));mkdirSync('evidence/screenshots',{recursive:true});await page.screenshot({path:`evidence/screenshots/${info.project.name}-strengths.png`,fullPage:true})
 await page.getByRole('navigation',{name:'Map subjects'}).getByRole('link',{name:'Reading',exact:true}).click()
 await expect(page.locator('#strength-detail')).toContainText('Success with help is a learning step')
 await expect(page.locator('[data-strength-node]')).toHaveCount(1)
 await page.reload();await expect(page.locator('#strength-detail-title')).toHaveText('Find a main idea')
 // Selection and mission target travel together without requiring JavaScript state.
 await expect(page.locator('.strength-actions input[name=subject]')).toHaveValue('Reading')
})

test('offline reviewer starts unapproved, exports a human decision and resets approval after edits',async({page},info)=>{
 await page.goto(pathToFileURL(resolve('eval/review-pack/review.html')).toString())
 await expect(page.locator('#counts')).toContainText('0 of 100 approved')
 await expect(page.getByRole('button',{name:'Approve this case',exact:true})).toBeDisabled()
 await page.getByLabel('I checked the source',{exact:false}).check();await page.getByLabel('Reviewer notes',{exact:true}).fill('Synthetic automation receipt to verify UI only; not a human signoff.')
 await page.getByRole('button',{name:'Approve this case',exact:true}).click();await expect(page.locator('#counts')).toContainText('1 of 100 approved')
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export review progress'}).click();const saved=await download;const file=await saved.path();const records=readFileSync(file!,'utf8').trim().split('\n').map(JSON.parse)
 expect(records.filter(c=>c.handChecked)).toHaveLength(1);expect(records[0].review.status).toBe('approved')
 await page.reload();await expect(page.locator('#counts')).toContainText('1 of 100 approved')
 await page.getByText('Correct this case before approving',{exact:true}).click()
 const originalEdit=await page.locator('#edit').inputValue(),bad=JSON.parse(originalEdit);bad.input.key=''
 await page.locator('#edit').fill(JSON.stringify(bad));await page.getByRole('button',{name:'Save corrected case'}).click();await expect(page.locator('#status')).toContainText('Provide a concept')
 await expect(page.locator('#counts')).toContainText('1 of 100 approved')
 await page.locator('#edit').fill(originalEdit);await page.getByRole('button',{name:'Save corrected case'}).click();await expect(page.locator('#counts')).toContainText('0 of 100 approved')
 await page.getByRole('button',{name:'Needs revision',exact:true}).click();await expect(page.locator('#counts')).toContainText('1 need revision')
 await page.locator('#import').setInputFiles({name:'saved.jsonl',mimeType:'application/x-ndjson',buffer:Buffer.from(records.map(c=>JSON.stringify(c)).join('\n'))});await expect(page.locator('#counts')).toContainText('1 of 100 approved')
 await page.locator('#kind').selectOption('extraction');await expect(page.locator('#case img')).toBeVisible();expect(await page.locator('#case img').evaluate((img:any)=>img.naturalWidth)).toBeGreaterThan(0)
 const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(result.violations.map(v=>v.id)).toEqual([])
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.screenshot({path:`evidence/screenshots/${info.project.name}-review-studio.png`,fullPage:true})
})
