import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strengthGraph, strengthLayout } from '../src/engine/strengths.ts'
import type { AttemptRecord, ConceptNode } from '../src/engine/types.ts'
import { openDb } from '../src/db.ts'
import { registerUser } from '../src/auth.ts'
import { createStudent } from '../src/services.ts'
import { strengthsMap } from '../src/strengths-view.ts'
import { authorizeStudentPath } from '../src/journey-routes.ts'

const concepts: ConceptNode[] = [
  {conceptId:'foundation',title:'Equal parts',subject:'Math',grade:2,prereqs:[],recall:'',example:'',nonExample:''},
  {conceptId:'fractions',title:'Fraction addition',subject:'Math',grade:5,prereqs:['foundation'],recall:'',example:'',nonExample:''},
  {conceptId:'algebra',title:'Equations',subject:'Math',grade:8,prereqs:['fractions'],recall:'',example:'',nonExample:''},
  {conceptId:'reading',title:'Inference',subject:'Reading',grade:5,prereqs:[],recall:'',example:'',nonExample:''},
]
function attempt(n:number, changes:Partial<AttemptRecord>={}):AttemptRecord {
  return {attemptId:`a${n}`,studentId:'synthetic',conceptId:'algebra',sessionId:`s${n}`,bloomLevel:2,day:`2026-10-${String(1+n).padStart(2,'0')}`,correct:true,hintsUsed:0,interleaved:n===2,timeMs:1200,errorType:null,modality:'screen',fresh:true,promptKey:`fresh ${n}`,evidenceCertainty:'confirmed',supportUsed:'none',...changes}
}
const node=(g:ReturnType<typeof strengthGraph>,id:string)=>g.nodes.find(n=>n.conceptId===id)!
test('strengths keep mixed abilities and advanced evidence separate from grade and prerequisites',()=>{
 const rows=[attempt(1),attempt(2),attempt(3),attempt(4,{conceptId:'reading',correct:false})]
 const g=strengthGraph(concepts,rows,{},['fractions','reading'],'2026-10-05')
 assert.deepEqual(node(g,'algebra').demonstrated,[2]);assert.equal(node(g,'reading').independent,1)
 assert.equal(node(g,'fractions').status,'unseen');assert.equal(node(g,'foundation').status,'unseen')
 assert.equal(node(g,'algebra').levels[0].demonstrated,false)
 assert.deepEqual(g.edges,[{from:'foundation',to:'fractions'},{from:'fractions',to:'algebra'}])
 const layout=strengthLayout(g.nodes,g.edges)
 assert.ok(layout.positions.get('algebra')!.x>layout.positions.get('fractions')!.x)
 assert.equal(layout.positions.get('reading')!.x,24)
})
test('hints, homework, repeats, unresolved and legacy records never become map mastery',()=>{
 const rows=[attempt(1,{hintsUsed:1,supportUsed:'hint'}),attempt(2,{supportUsed:'homework'}),attempt(3,{evidenceCertainty:'legacy'}),attempt(4,{evidenceCertainty:'unresolved'}),attempt(5,{promptKey:'fresh 1'}),attempt(6,{fresh:false})]
 const n=node(strengthGraph(concepts,rows,{algebra:1},['algebra'],'2026-10-08'),'algebra')
 assert.equal(n.independent,0);assert.equal(n.supported,2);assert.equal(n.unresolved,2);assert.equal(n.legacy,1);assert.equal(n.repeated,1);assert.deepEqual(n.demonstrated,[])
 assert.equal(n.status,'supported')
})
test('delayed misses preserve achievements and seven-day retrieval is observed independently',()=>{
 const wins=[attempt(1),attempt(2),attempt(3)]
 const harder=attempt(4,{bloomLevel:5,correct:false})
 let n=node(strengthGraph(concepts,[...wins,harder],{},['algebra'],'2026-10-05'),'algebra')
 assert.equal(n.status,'demonstrated');assert.deepEqual(n.demonstrated,[2])
 const remembered=attempt(11,{day:'2026-10-11'})
 n=node(strengthGraph(concepts,[...wins,remembered,attempt(12,{correct:false})],{},['algebra'],'2026-10-13'),'algebra')
 assert.equal(n.status,'review');assert.deepEqual(n.demonstrated,[2]);assert.equal(n.retainedOn,'2026-10-11')
 assert.equal(n.latestMiss,true)
})
test('short sessions accumulate checks but same-day successes do not satisfy mastery',()=>{
 const sameDay=[1,2,3].map(n=>attempt(n,{day:'2026-10-02'}))
 assert.deepEqual(node(strengthGraph(concepts,sameDay,{},['algebra'],'2026-10-02'),'algebra').demonstrated,[])
 sameDay.push(attempt(4,{interleaved:true}))
 assert.deepEqual(node(strengthGraph(concepts,sameDay,{},['algebra'],'2026-10-05'),'algebra').demonstrated,[2])
})
test('freshness is deduplicated across concepts and unfinished grades are visible without a miss',()=>{
 const rows=[attempt(1,{conceptId:'fractions',supportUsed:'hint',hintsUsed:1}),attempt(2,{promptKey:'fresh 1'})]
 const g=strengthGraph(concepts,rows,{reading:2},['algebra'],'2026-10-05',true)
 assert.equal(node(g,'algebra').independent,0);assert.equal(node(g,'reading').status,'pending');assert.equal(node(g,'reading').latestMiss,false)
 assert.ok(g.nodes.some(n=>n.conceptId==='foundation'))
 assert.equal(strengthGraph(concepts,[],{},['algebra'],'2026-10-05').nodes.length,2)
})
test('map ownership and query handling preserve family and student isolation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'strengths-')),db=openDb(join(dir,'test.sqlite'))
 try{
  const owner=await registerUser(db,'strengths@example.invalid','test-only-password');assert.ok(owner.ok)
  const other=await registerUser(db,'other@example.invalid','test-only-password');assert.ok(other.ok)
  const student=await createStudent(db,owner.userId,{displayName:'Synthetic',grade:5,sessionCapMinutes:5})
  const sibling=await createStudent(db,owner.userId,{displayName:'Sibling',grade:3,sessionCapMinutes:5})
  await assert.rejects(()=>strengthsMap(db,other.userId,student))
  const auth = { id:'synthetic-session', userId:owner.userId, csrf:'synthetic', selectedStudent:sibling, parentUnlocked:false, studentOnly:true }
  assert.equal(await authorizeStudentPath(db,auth,`/students/${student}/map`,'GET'),false)
  assert.equal(await authorizeStudentPath(db,auth,`/students/${sibling}/map`,'GET'),true)
  const html=await strengthsMap(db,owner.userId,student,new URLSearchParams({concept:'<script>alert(1)</script>',subject:'<img src=x>'}))
  assert.ok(html.includes('Your topics'));assert.ok(html.includes('Not yet checked'));assert.ok(!html.includes('<script>alert'))
  assert.ok(html.includes('Try a harder one'));assert.ok(html.includes('2 sessions and 2 days'))
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})
