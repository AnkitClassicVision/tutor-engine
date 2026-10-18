import {test,expect} from '@playwright/test'
import {randomBytes} from 'node:crypto'
import {withPostgres,closePostgres} from '../../src/postgres.ts'
import {registerUser} from '../../src/auth.ts'
import {deleteFamily} from '../../src/accounts.ts'
import {createStudent,startTutorSession} from '../../src/services.ts'
import {trackFixture} from './cleanup.ts'
let owner:string|null=null

test.afterEach(async()=>{if(owner)await withPostgres(db=>deleteFamily(db,owner!,'/tmp/tutor-hosted-fixtures'),true);owner=null;await closePostgres()})

test('hosted correction, voice return, question provenance and safety preserve the learning pause',async({page})=>{
 const email=`hosted-${crypto.randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url')
 const fixture=await withPostgres(async db=>{
  const user=await registerUser(db,email,password);if(!user.ok)throw new Error('Synthetic registration failed')
  owner=user.userId;trackFixture(owner)
  // Missing model ensures clarification fallback uses no provider inference.
  await db.prepare("UPDATE users SET email_verified_at = ?, ai_provider = 'openai', ai_model = '', ai_key = '' WHERE id = ?").run(new Date().toISOString(),owner)
  const student=await createStudent(db,owner,{displayName:'Synthetic learner',grade:5,sessionCapMinutes:25})
  const session=await startTutorSession(db,owner,student,new Date(),{mode:'session'})
  await db.prepare('DELETE FROM session_items WHERE session_id = ?').run(session)
  for(let n=1;n<=3;n++)await db.prepare(`INSERT INTO session_items(id,session_id,position,beat,concept_id,bloom_level,prompt,answer,hints_json,surface,interleaved,hints_used,answered) VALUES(?, ?, ?, 'frontier', 'math.5.nf.a.1', 3, ?, '1', '[]', 'screen', 0, 0, 0)`).run(crypto.randomUUID(),session,n,`Synthetic context ${n}: add 1/2 and 1/2.`)
  return{student,session}
 },true)
 await page.goto('/');const login=page.locator('form[action="/login"]');await login.getByLabel('Email').fill(email);await login.getByLabel('Password',{exact:true}).fill(password);await login.getByRole('button',{name:'Enter',exact:true}).click()
 await page.goto(`/session/${fixture.session}`);await page.getByLabel('Answer',{exact:true}).fill('2');await page.getByRole('button',{name:'Check',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Let’s try a different approach',exact:true})).toBeVisible()
 await page.getByText('Talk through this step',{exact:true}).click();await expect(page.locator('form.talk [data-talk]')).toBeVisible();await page.locator('form.talk input[name=voice]').evaluate((e:any)=>e.value='1')
 await page.getByLabel('Ask about this step',{exact:true}).fill('Why does this step work?');await page.getByRole('button',{name:'Ask the tutor',exact:true}).click();await page.getByRole('link',{name:'See your next step',exact:false}).click()
 await expect(page).toHaveURL(/voice=1/);await expect(page.locator('.thread .bubble').last().locator('[data-hear]')).toBeVisible();await expect(page.locator('form.answer')).toHaveCount(0)
 const signals=await withPostgres(db=>db.prepare("SELECT count(*) n FROM decision_records WHERE student_id = ? AND kind = 'learner_question'").get(fixture.student),true);expect(Number(signals?.n)).toBe(1)
 await page.getByText('Talk through this step',{exact:true}).click();await page.getByLabel('Ask about this step',{exact:true}).fill('I want to die');await page.getByRole('button',{name:'Ask the tutor',exact:true}).click();await page.getByRole('link',{name:'See your next step',exact:false}).click();await expect(page.locator('.thread .bubble').last()).toContainText('trusted grown-up')
 await page.reload();await page.getByRole('button',{name:'Ready for a fresh question'}).click();await expect(page.locator('form.answer')).toBeVisible()
 const counts=await withPostgres(async db=>({attempts:await db.prepare('SELECT count(*) n FROM attempts WHERE student_id = ?').get(fixture.student),signals:await db.prepare("SELECT count(*) n FROM decision_records WHERE student_id = ? AND kind = 'learner_question'").get(fixture.student)}),true)
 expect(Number(counts.attempts?.n)).toBe(1);expect(Number(counts.signals?.n)).toBe(1)
})
