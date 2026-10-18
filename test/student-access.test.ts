import test from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../src/db.ts'
import { registerUser, readAuthSession, hashToken } from '../src/auth.ts'
import { createStudent, startTutorSession, sessionItems, submitAnswer, learningOverview } from '../src/services.ts'
import { configureStudentAccess, studentLogin } from '../src/student-access.ts'
import { authorizeStudentPath } from '../src/journey-routes.ts'
import { exportFamily } from '../src/accounts.ts'
import { learningMilestones, milestoneKeepsake } from '../src/engine/adventure.ts'

async function fixture() {
  const db = openDb(':memory:'); const user = await registerUser(db,'student-access@example.com','synthetic-password')
  assert.ok(user.ok)
  const student = await createStudent(db,user.userId,{displayName:'Synthetic learner',grade:3,sessionCapMinutes:10})
  const sibling = await createStudent(db,user.userId,{displayName:'Synthetic sibling',grade:5,sessionCapMinutes:10})
  return {db,owner:user.userId,student,sibling}
}

test('student link/PIN issues a permanently restricted session and rotation revokes it', async () => {
  const f=await fixture()
  try {
    const code=await configureStudentAccess(f.db,f.owner,f.student,'246810')
    assert.equal(code.length,32)
    const row=await f.db.prepare('SELECT access_pin_hash FROM students WHERE id = ?').get(f.student)
    assert.notEqual(row!.access_pin_hash,'246810')
    assert.equal(await studentLogin(f.db,code,'000000'),null)
    const login=await studentLogin(f.db,code,'246810'); assert.ok(login)
    const auth=await readAuthSession(f.db,login.token); assert.ok(auth)
    assert.equal(auth.studentOnly,true); assert.equal(auth.parentUnlocked,false)
    await f.db.prepare('UPDATE auth_sessions SET parent_unlocked_until = ? WHERE token_hash = ?').run('2099-01-01',hashToken(login.token))
    const restricted=(await readAuthSession(f.db,login.token))!
    assert.equal(restricted.parentUnlocked,false)
    for (const [path,method] of [[`/students/${f.sibling}`,'GET'],['/settings','GET'],['/family/export','GET'],['/family/progress','GET'],['/parent/unlock','POST'],[`/students/${f.student}/access`,'POST']]) assert.equal(await authorizeStudentPath(f.db,restricted,path,method),false,path)
    assert.equal(await authorizeStudentPath(f.db,restricted,`/students/${f.student}/insights`,'GET'),true)
    const exported=await exportFamily(f.db,f.owner,'/tmp/synthetic-student-access')
    assert.doesNotMatch(JSON.stringify(exported),new RegExp(code)); assert.doesNotMatch(JSON.stringify(exported),/access_pin_hash/)
    await configureStudentAccess(f.db,f.owner,f.student,'135790')
    assert.equal(await readAuthSession(f.db,login.token),null)
    assert.equal(await studentLogin(f.db,code,'246810'),null)
  } finally {f.db.close()}
})

test('PIN guesses are throttled and a disabled link never authenticates', async () => {
  const f=await fixture()
  try {
    const code=await configureStudentAccess(f.db,f.owner,f.student,'246810')
    for(let i=0;i<5;i++) assert.equal(await studentLogin(f.db,code,'000000'),null)
    assert.equal(await studentLogin(f.db,code,'246810'),null)
    const fresh=await configureStudentAccess(f.db,f.owner,f.student,'135790')
    assert.ok(await studentLogin(f.db,fresh,'135790'))
    await configureStudentAccess(f.db,f.owner,f.student,'',true)
    assert.equal(await studentLogin(f.db,fresh,'135790'),null)
    const other=await registerUser(f.db,'other-access@example.com','synthetic-password');assert.ok(other.ok)
    await assert.rejects(configureStudentAccess(f.db,other.userId,f.student,'123456'),/Student not found/)
  }finally{f.db.close()}
})

test('surprise keepsakes are cosmetic, stable and cannot be rerolled by repeated submissions', async () => {
  const f=await fixture()
  try{
    const session=await startTutorSession(f.db,f.owner,f.student,new Date(),{goal:'harder_probe',focusConceptId:'math.primary.3.multiply'})
    const item=(await sessionItems(f.db,session))[0]
    await submitAnswer(f.db,f.owner,session,{itemId:String(item.id),answer:String(item.answer)})
    await submitAnswer(f.db,f.owner,session,{itemId:String(item.id),answer:String(item.answer)})
    const overview=await learningOverview(f.db,f.owner,f.student)
    assert.equal(overview.independent,1);assert.equal(overview.successPercent,null)
    const milestone={id:'fractions:understanding',conceptId:'fractions',kind:'understanding' as const,day:'2026-10-12',evidenceCount:3}
    assert.deepEqual(milestoneKeepsake(milestone),milestoneKeepsake(milestone))
    assert.equal(learningMilestones([]).length,0)
  }finally{f.db.close()}
})
