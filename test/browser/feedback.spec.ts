import {test,expect} from '@playwright/test'
import { settledAudit } from './settled-audit.ts'

async function setup(page:any){
 await page.goto('/');await page.getByText('Create an account',{exact:true}).click();const form=page.locator('form[action="/register"]');await form.getByLabel('Email').fill(`feedback-${crypto.randomUUID()}@example.invalid`);await form.getByLabel('Password',{exact:true}).fill('synthetic-password');await form.getByRole('button',{name:'Create account'}).click();await page.getByLabel('Name',{exact:true}).fill('Synthetic learner');await page.getByLabel('Birthday',{exact:true}).fill('2018-03-04');await page.getByRole('button',{name:'Add student',exact:true}).click();await page.waitForURL(u => /^\/(students\/|welcome\/ai)/.test(u.pathname)); if (new URL(page.url()).pathname === '/welcome/ai') await page.getByRole('link', { name: 'Skip for now', exact: true }).click();await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}$/i);const home=page.url();await page.getByRole('link',{name:'Parent area',exact:true}).click();await page.getByRole('link',{name:'AI connection',exact:true}).click();await page.getByLabel('Which AI').selectOption('openai');await page.getByRole('textbox',{name:'API key',exact:true}).fill('synthetic-fixture');await page.getByRole('button',{name:'Save AI',exact:true}).click();await page.waitForURL(u => u.searchParams.has('notice'));return home
}

test('a lesson miss pauses for correction, survives reload and continues with a fresh question',async({page})=>{
 const home=await setup(page);await page.goto(home);await page.getByRole('button',{name:'Let’s go',exact:false}).click();const first=await page.locator('.question-text').innerText();await page.getByRole('textbox', { name: /^(Answer|Your steps)$/ }).fill('definitely wrong');await page.getByRole('button',{name:'Check',exact:true}).click();
 // The check may finish in place or through the job page, and WebKit can still be navigating when the click resolves.
 const nextStep=page.getByRole('link',{name:'See your next step',exact:false}),retry=page.getByRole('heading',{name:'Let’s try a different approach',exact:true})
 await expect(nextStep.or(retry)).toBeVisible({timeout:15_000});if(await nextStep.isVisible())await nextStep.click()
 await expect(retry).toBeVisible();await expect(page.locator('form.answer')).toHaveCount(0);for(const opener of await page.getByText('Show me how',{exact:true}).all())await opener.click();await expect(page.getByText('Example:',{exact:false}).first()).toBeVisible();await page.reload();await expect(page.getByRole('button',{name:'Ready for a fresh question'})).toBeVisible();await page.getByText('Talk through this step',{exact:true}).click();await expect(page.locator('form.talk [data-talk]')).toBeVisible();await page.locator('form.talk input[name=voice]').evaluate((e:any)=>e.value='1');await page.getByLabel('Ask about this step',{exact:true}).fill('Which part should I try first?');await page.getByRole('button',{name:'Ask the tutor',exact:true}).click();await page.getByRole('link',{name:'See your next step',exact:false}).waitFor();await page.getByRole('link',{name:'See your next step',exact:false}).click();await expect(page).toHaveURL(/voice=1/);await expect(page.locator('.thread .bubble').last()).toBeVisible();await expect(page.locator('.thread .bubble').last().locator('[data-hear]')).toBeVisible();await expect(page.locator('form.answer')).toHaveCount(0);await page.getByRole('button',{name:'Ready for a fresh question'}).click();await expect(page.locator('form.answer')).toBeVisible();expect(await page.locator('.question-text').innerText()).not.toBe(first);expect((await (await settledAudit(page)).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([])
})

test('thinking companion follows actual progress, stops at completion and respects reduced motion',async({page},info)=>{
 await setup(page);await page.getByRole('link',{name:'Back to parent area',exact:true}).click();await expect(page.locator('#planner-drawer')).toHaveCount(1);let finished=false
 await page.route('**/jobs/*/events',r=>r.abort());await page.route('**/jobs/*/status',r=>r.fulfill({json:{status:finished?'succeeded':'running',stage:finished?'Ready':'Preparing your class',error:null,createdAt:new Date().toISOString(),startedAt:new Date().toISOString(),result:finished?{subject:'Science'}:null}}))
 const student=new URL(page.url()).pathname.split('/')[2];const jobId=await page.evaluate(async(id:string)=>{const csrf=(document.querySelector('#csrf-store') as HTMLInputElement).value;const r=await fetch(`/students/${id}/planner/message`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({csrf,message:'Plan a small science class.'})});return (await r.json()).jobId},student);await page.goto(`/jobs/${jobId}`);await expect(page.locator('[data-job-stage]')).toHaveText('Preparing your class');await expect(page.locator('.thinking-world')).toBeVisible();await page.emulateMedia({reducedMotion:'reduce'});expect(await page.locator('.thinking-world .companion').evaluate(e=>getComputedStyle(e).animationName)).toBe('none');await page.emulateMedia({reducedMotion:'no-preference'});expect(await page.locator('.thinking-world .companion').evaluate(e=>getComputedStyle(e).animationName)).toBe('bubble-think');await expect(page.getByText('A tiny learning moment while we prepare')).toBeVisible();expect((await (await settledAudit(page)).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);await page.screenshot({path:`evidence/screenshots/thinking-${info.project.name}.png`,fullPage:true});finished=true;await expect(page.getByRole('link',{name:'See your next step',exact:false})).toBeVisible();expect(await page.locator('.thinking-world .companion').evaluate(e=>getComputedStyle(e).animationName)).toBe('none')
})

test('a question to the tutor survives a failed send, and a repeated send adds it once',async({page})=>{
 const home=await setup(page);await page.goto(home);await page.getByRole('button',{name:'Let’s go',exact:false}).click();await page.getByRole('textbox', { name: /^(Answer|Your steps)$/ }).fill('definitely wrong');await page.getByRole('button',{name:'Check',exact:true}).click()
 const nextStep=page.getByRole('link',{name:'See your next step',exact:false}),retry=page.getByRole('heading',{name:'Let’s try a different approach',exact:true})
 await expect(nextStep.or(retry)).toBeVisible({timeout:15_000});if(await nextStep.isVisible())await nextStep.click()
 await expect(retry).toBeVisible();const checkpoint=page.url();await page.waitForLoadState('load')
 const question=page.getByLabel('Ask about this step',{exact:true})
 // The send fails: the words stay on this page after a reload.
 await page.route('**/session/*/ask',route=>route.abort('internetdisconnected'))
 await page.getByText('Talk through this step',{exact:true}).click();await question.fill('Which part comes first?')
 const failed=page.waitForEvent('requestfailed',request=>request.url().endsWith('/ask'))
 await page.getByRole('button',{name:'Ask the tutor',exact:true}).click();await failed
 await expect(async()=>{await page.goto(checkpoint);await expect(question).toHaveValue('Which part comes first?')}).toPass({timeout:15000,intervals:[250,500]})
 await page.unroute('**/session/*/ask')
 // The same send arrives twice, as after a lost reply: the tutor gets the question once.
 const sendIds:string[]=[]
 await page.route('**/session/*/ask',async route=>{sendIds.push(new URLSearchParams(route.request().postData()??'').get('sendId')??'');if(sendIds.length===1){await route.fetch();await route.continue()}else await route.continue()})
 await page.getByText('Talk through this step',{exact:true}).click();await page.getByRole('button',{name:'Ask the tutor',exact:true}).click()
 await nextStep.waitFor();await nextStep.click();await expect(retry).toBeVisible()
 expect(sendIds[0]).toMatch(/^[0-9a-f-]{36}$/)
 await expect(page.locator('.thread li.mine',{hasText:'Which part comes first?'})).toHaveCount(1)
 // Once the page shows it as sent, the draft is cleared.
 await page.reload();await expect(question).toHaveValue('')
})

test('a child can say a check looks wrong, once, and the parent decides',async({page})=>{
 const home=await setup(page);const student=home.split('/').at(-1);await page.goto(home);await page.getByRole('button',{name:'Let’s go',exact:false}).click();await page.getByRole('textbox', { name: /^(Answer|Your steps)$/ }).fill('definitely wrong');await page.getByRole('button',{name:'Check',exact:true}).click()
 const nextStep=page.getByRole('link',{name:'See your next step',exact:false}),retry=page.getByRole('heading',{name:'Let’s try a different approach',exact:true})
 await expect(nextStep.or(retry)).toBeVisible({timeout:15_000});if(await nextStep.isVisible())await nextStep.click()
 await expect(retry).toBeVisible();const checkpoint=page.url()
 await page.getByRole('button',{name:/^I think there’s a mistake/}).click()
 await expect(page.locator('[data-concern="open"]')).toContainText('A grown-up will look at this one.')
 await expect(page.getByRole('button',{name:/^I think there’s a mistake/})).toHaveCount(0)
 expect((await (await settledAudit(page)).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([])
 // The parent sees the exact work and decides; a wrong grade then counts neither way.
 await page.goto(`/students/${student}/parent`);await expect(page.locator('[data-grading-unsure]')).toContainText('Synthetic learner thinks a grade is wrong.')
 await page.goto(`/students/${student}/grading`);const concern=page.locator('section.concerns')
 await expect(concern).toContainText('Synthetic learner answered: definitely wrong')
 await concern.getByRole('button',{name:'The grade is wrong',exact:true}).click()
 await expect(page.locator('section.concerns')).toHaveCount(0)
 await page.goto(checkpoint);await expect(page.locator('[data-concern="upheld"]')).toBeVisible()
})
