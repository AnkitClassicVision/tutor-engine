import {test,expect} from '@playwright/test'
import {randomBytes} from 'node:crypto'
import {withPostgres,closePostgres} from '../../src/postgres.ts'
import {registerUser} from '../../src/auth.ts'
import {deleteFamily} from '../../src/accounts.ts'
import {seedStrengths} from '../fixtures/strengths.ts'
import {trackFixture} from './cleanup.ts'
const owners:string[]=[]
test.afterEach(async()=>{for(const owner of owners)await withPostgres(db=>deleteFamily(db,owner,'/tmp/tutor-hosted-fixtures'),true);owners.length=0;await closePostgres()})
test('hosted strength graph uses linked evidence, changes subjects and rejects another family',async({page})=>{
 const email=`hosted-${crypto.randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url')
 const fixture=await withPostgres(async db=>{
  const owner=await registerUser(db,email,password);if(!owner.ok)throw Error('Synthetic registration failed');owners.push(owner.userId);trackFixture(owner.userId)
  await db.prepare("UPDATE users SET email_verified_at = ?, ai_provider = 'openai', ai_model = '', ai_key = '' WHERE id = ?").run(new Date().toISOString(),owner.userId)
  const learner=await seedStrengths(db,owner.userId)
  const other=await registerUser(db,`hosted-${crypto.randomUUID()}@example.invalid`,randomBytes(24).toString('base64url'));if(!other.ok)throw Error('Synthetic registration failed');owners.push(other.userId);trackFixture(other.userId)
  const foreign=await seedStrengths(db,other.userId)
  const count=await db.prepare('SELECT count(*) n FROM attempts WHERE student_id = ?').get(learner.student)
  return {...learner,foreign:foreign.student,count:Number(count?.n)}
 },true)
 await page.goto('/');const login=page.locator('form[action="/login"]');await login.getByLabel('Email').fill(email);await login.getByLabel('Password',{exact:true}).fill(password);await login.getByRole('button',{name:'Enter',exact:true}).click()
 await page.goto(`/students/${fixture.student}/parent`);await page.getByRole('link',{name:'Open strengths map'}).click()
 await expect(page.getByRole('heading',{name:'Your topics'})).toBeVisible()
 await page.locator('[data-strength-node="math.5.nf.a.1"]').click()
 for(const label of ['Fresh independent checks','Successes with help','Awaiting review'])await expect(page.locator('.strength-evidence div').filter({has:page.getByText(label,{exact:true})})).toContainText('1')
 await expect(page.locator('#strength-detail')).toContainText('1 repeated responses')
 await page.locator('[data-strength-node="math.8.ee.c.7"]').click();await expect(page.locator('#strength-detail')).toContainText('You’ve shown you can: use it.')
 await expect(page.locator('.strength-levels li').filter({has:page.getByText('Understand',{exact:true})})).toContainText('Not yet checked')
 await page.locator('[data-strength-node="math.5.nf.b.4"]').click();await expect(page.locator('#strength-detail')).toContainText('Your earlier achievement stays')
 await page.getByRole('navigation',{name:'Map subjects'}).getByRole('link',{name:'Reading',exact:true}).click();await expect(page.locator('#strength-detail-title')).toHaveText('Find a main idea')
 await page.reload();await expect(page.locator('.strength-evidence div').filter({has:page.getByText('Fresh independent checks',{exact:true})})).toContainText('0')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.goto(`/students/${fixture.foreign}/map?concept=${fixture.reading}`);await expect(page.locator('[data-strength-node]')).toHaveCount(0);await expect(page.getByRole('heading',{name:'Your topics'})).toHaveCount(0)
 const after=await withPostgres(db=>db.prepare('SELECT count(*) n FROM attempts WHERE student_id = ?').get(fixture.student),true);expect(Number(after?.n)).toBe(fixture.count)
})
