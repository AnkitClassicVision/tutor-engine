import test from 'node:test'
import assert from 'node:assert/strict'
import {openDb} from '../src/db.ts'
import {registerUser} from '../src/auth.ts'
import {createStudent,startTutorSession,sessionItems,submitAnswer,acknowledgeFeedback,getOwnedSession,reviewAnswer,avoidRepeatedQuestions,applyCurriculum} from '../src/services.ts'
import {feedbackState,promptIdentity} from '../src/session-feedback.ts'

async function fixture(mode='session') {
 const db=openDb(':memory:');const user=await registerUser(db,'feedback@example.invalid','synthetic-password');assert.ok(user.ok)
 const student=await createStudent(db,user.userId,{displayName:'Synthetic learner',grade:5,sessionCapMinutes:25})
 const session=await startTutorSession(db,user.userId,student,new Date(),{mode:mode as any})
 await db.prepare('DELETE FROM session_items WHERE session_id = ?').run(session)
 for(let i=1;i<=6;i++)await db.prepare(`INSERT INTO session_items(id,session_id,position,beat,concept_id,bloom_level,prompt,answer,hints_json,surface,interleaved,hints_used,answered) VALUES(?, ?, ?, 'frontier', 'math.5.nf.a.1', 3, ?, '4', '[]', 'screen', 0, 0, 0)`).run(crypto.randomUUID(),session,i,`Fresh context ${i}: two groups of two.`)
 return{db,owner:user.userId,student,session}
}

test('lesson feedback varies between immediate and a durable three-question batch pause',async()=>{
 const f=await fixture();try{
  for(let i=0;i<5;i++){
   const item=(await sessionItems(f.db,f.session)).find(i=>i.answered===0)!
   await submitAnswer(f.db,f.owner,f.session,{itemId:String(item.id),answer:'4'})
   const session=await getOwnedSession(f.db,f.owner,f.session),state=feedbackState('session',await sessionItems(f.db,f.session),Number(session.feedback_cursor))
   assert.equal(state.timing,i<2?'immediate':i<4?'waiting':'batch');assert.equal(state.checkpoint,i===4)
  }
  const next=(await sessionItems(f.db,f.session)).find(i=>i.answered===0)!
  await assert.rejects(submitAnswer(f.db,f.owner,f.session,{itemId:String(next.id),answer:'4'}),/Review your feedback/)
  await acknowledgeFeedback(f.db,f.owner,f.session)
  assert.equal((await getOwnedSession(f.db,f.owner,f.session)).feedback_cursor,5)
  await submitAnswer(f.db,f.owner,f.session,{itemId:String(next.id),answer:'4'})
 }finally{f.db.close()}
})

test('two homework misses stop drilling, show correction and retain the original queue and evidence',async()=>{
 const f=await fixture('homework');try{
  for(let i=0;i<2;i++){const item=(await sessionItems(f.db,f.session)).find(i=>i.answered===0)!;await submitAnswer(f.db,f.owner,f.session,{itemId:String(item.id),answer:'5'})}
  const session=await getOwnedSession(f.db,f.owner,f.session),feedback=JSON.parse(String(session.pending_feedback))
  assert.match(feedback.corrective.move,/Worked example/);assert.equal(feedback.action,'teach')
  assert.equal((await sessionItems(f.db,f.session)).length,2)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM session_items WHERE session_id = ?').get(f.session))!.n,6)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM attempts WHERE session_id = ?').get(f.session))!.n,2)
  assert.equal(feedbackState('homework',await sessionItems(f.db,f.session),0).timing,'immediate')
 }finally{f.db.close()}
})

test('model/parent misses with an uncertain error cause still receive a specific correction',async()=>{
 const f=await fixture('homework');try{
  const item=(await sessionItems(f.db,f.session))[0];await f.db.prepare("UPDATE session_items SET answer = 'Rubric: Explain the equal groups.', bloom_level = 4 WHERE id = ?").run(item.id)
  await submitAnswer(f.db,f.owner,f.session,{itemId:String(item.id),answer:'There are some apples in it.'})
  await reviewAnswer(f.db,f.owner,f.session,{itemId:String(item.id),correct:false,errorType:null,reason:'The response does not explain the groups.'})
  const feedback=JSON.parse(String((await getOwnedSession(f.db,f.owner,f.session)).pending_feedback))
  assert.equal(feedback.errorType,null);assert.match(feedback.corrective.move,/does not explain/);assert.match(feedback.corrective.move,/A good answer says: Explain the equal groups/);assert.ok(feedback.corrective.ask)
  assert.equal((await f.db.prepare('SELECT count(*) n FROM attempts WHERE session_id = ?').get(f.session))!.n,1)
 }finally{f.db.close()}
})

test('dynamic classes use fresh prompts, cap repeated recall tasks and archive duplicates on resume',async()=>{
 const f=await fixture();try{
  await applyCurriculum(f.db,f.owner,f.student,'Science',[{title:'Synthetic cell functions',recall:'Cells have parts with different jobs.',example:'A membrane separates the cell from its surroundings.',nonExample:'All parts have the same job.',questions:[{prompt:'Explain why a cell needs a boundary.',answer:'Rubric: distinguish inside and outside.',bloomLevel:2},{prompt:'Describe a cell boundary in a new setting.',answer:'Rubric: apply inside/outside separation.',bloomLevel:3}]}])
  const first=await startTutorSession(f.db,f.owner,f.student,new Date(),{subject:'Science'})
  const items=await sessionItems(f.db,first);assert.ok(items.length)
  assert.equal(new Set(items.map(i=>promptIdentity(String(i.prompt)))).size,items.length);assert.ok(items.filter(i=>i.bloom_level===1).length<=1)
  await assert.rejects(startTutorSession(f.db,f.owner,f.student,new Date(),{subject:'Science'}),/fresh practice/)
  await f.db.prepare('UPDATE session_items SET prompt = ? WHERE id = ?').run(items[0].prompt,items[1].id)
  await f.db.prepare('UPDATE session_items SET answered = 1 WHERE id = ?').run(items[0].id)
  await avoidRepeatedQuestions(f.db,f.owner,first)
  assert.equal((await f.db.prepare('SELECT skipped FROM session_items WHERE id = ?').get(items[1].id))!.skipped,1)
 }finally{f.db.close()}
})

test('fresh practice contract rejects past wording, duplicate items and unsupported demand',async()=>{
 const {parseFreshPractice}=await import('../src/fresh-practice.ts')
 const context={concept:{conceptId:'synthetic',subject:'Science',grade:5,title:'Cell boundaries',prereqs:[],recall:'Separate inside from outside.',example:'Membrane',nonExample:'No boundary'},demand:1 as const,asked:['Already seen question.'],evidence:''}
 const valid={questions:[1,2,3,4].map(n=>({prompt:`Different case ${n}: explain the boundary.`,answer:'A boundary separates inside and outside.',bloomLevel:2}))}
 assert.equal(parseFreshPractice(JSON.stringify(valid),context).length,4)
 for(const invalid of [{questions:[{...valid.questions[0],prompt:'Already seen question.'},...valid.questions.slice(1)]},{questions:Array(4).fill(valid.questions[0])},{questions:[{...valid.questions[0],bloomLevel:6},...valid.questions.slice(1)]}])assert.throws(()=>parseFreshPractice(JSON.stringify(invalid),context))
})

test('lesson feedback teaches the idea rather than calling a numeric key the idea to remember',async()=>{
 const {lessonOpening,lessonFallback}=await import('../src/talk.ts')
 const results=[{title:'Fraction addition',prompt:'Add 1/2 and 1/2.',answer:'1',correct:false,recall:'Use equal-sized parts before adding their counts.',example:'1/2 + 1/3 = 3/6 + 2/6 = 5/6.'}]
 for(const reply of [lessonOpening(results),lessonFallback(results)]){assert.match(reply,/equal-sized parts/);assert.match(reply,/Worked example/);assert.doesNotMatch(reply,/idea to keep is "1/)}
})
