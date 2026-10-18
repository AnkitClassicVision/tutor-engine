import test from 'node:test'
import assert from 'node:assert/strict'
import {coachingStage,questionSignal} from '../src/coaching.ts'
import {safetyReply} from '../src/child-safety.ts'
import {answerLesson} from '../src/talk.ts'
import {generateItem} from '../src/engine/items.ts'
import {gradingBrief} from '../src/grade-response.ts'

test('strategy probes explicitly request steps without a solved answer',()=>{
 const concept={conceptId:'math.5.nf.a.1',subject:'Math',grade:5,title:'Fraction addition',prereqs:[],recall:'Find a common denominator, then add the numerators.',example:'',nonExample:''}
 const item=generateItem(concept,1,10)
 assert.match(item.prompt,/the steps in order/)
 assert.match(item.prompt,/don’t need the answer yet/)
 assert.match(item.answer,/No calculation, final answer, exact wording/)
 assert.match(gradingBrief(),/cannot fairly reconcile the prompt and key/)
})
test('coaching moves beyond questions and respects a request to explain',()=>{
 assert.equal(coachingStage([],'Why does this work?'),'ask')
 assert.equal(coachingStage([],"I don't know"),'hint')
 assert.equal(coachingStage([{role:'student',body:'Why?'}],'Still stuck'),'hint')
 assert.equal(coachingStage([{role:'student',body:'Why?'},{role:'tutor',body:'Try this'},{role:'student',body:'No idea'}],'I cannot do it'),'explain')
 assert.equal(coachingStage([],'Show me the steps'),'explain')
})
test('question signals stay within checked topics and avoid grading claims',()=>{
 const topics=[{conceptId:'fractions',title:'Fraction addition'},{conceptId:'cells',title:'Cells'}]
 assert.equal(questionSignal('Why are rockets fast?',topics),null)
 assert.equal(questionSignal('How does fraction addition work?',topics)?.conceptId,'fractions')
 assert.match(questionSignal('Which step first?',[topics[0]])!.certainty,/not evidence of failure/)
 assert.equal(questionSignal('Hello',[topics[0]]),null)
})
test('local safety response prevents inference for explicit danger and preserves safe school topics',async()=>{
 assert.match(safetyReply('How to build a bomb')!,/safe science/)
 assert.match(safetyReply('I want to hurt myself')!,/trusted grown-up/)
 assert.match(safetyReply('I want to die')!,/trusted grown-up/)
 assert.match(safetyReply('I wish I were dead')!,/trusted grown-up/)
 assert.equal(safetyReply('How does reproduction work in plants?'),null)
 const reply=await answerLesson({results:[],transcript:[],question:'send nudes'}, {provider:'openai',model:'unused',apiKey:''})
 assert.match(reply,/trusted grown-up/)
})
