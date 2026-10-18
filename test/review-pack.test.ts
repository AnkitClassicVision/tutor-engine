import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const root=resolve('eval/review-pack'),source=readFileSync(`${root}/cases.jsonl`,'utf8')
const cases=source.trim().split('\n').map(line=>JSON.parse(line))
test('review pack has 100 unique unapproved cases with all six release-gate kinds',()=>{
 assert.equal(cases.length,100);assert.equal(new Set(cases.map(c=>c.id)).size,100)
 assert.ok(cases.every(c=>c.handChecked===false&&c.rationale&&c.reviewChecks.length>=2))
 assert.deepEqual(Object.fromEntries(['grading','higher_bloom','answer_key','explanation','extraction','unreadable'].map(kind=>[kind,cases.filter(c=>c.kind===kind).length])),{grading:64,higher_bloom:12,answer_key:8,explanation:8,extraction:4,unreadable:4})
 for(const c of cases){
  if(['grading','higher_bloom','answer_key'].includes(c.kind)){
   assert.ok(c.input.concept&&c.input.prompt&&c.input.key&&c.input.response)
   assert.ok(Number.isInteger(c.input.bloomLevel)&&c.input.bloomLevel>=1&&c.input.bloomLevel<=6)
   assert.ok([true,false,null].includes(c.expectedCorrect))
  }
  if(c.imagePath){assert.ok(existsSync(resolve(root,c.imagePath)));assert.equal(c.mime,'image/png');assert.ok(c.concepts.length>0);assert.equal(readFileSync(resolve(root,c.imagePath)).subarray(1,4).toString(),'PNG')}
 }
 const verdicts=cases.filter(c=>'expectedCorrect'in c).map(c=>c.expectedCorrect)
 for(const expected of [true,false,null])assert.ok(verdicts.includes(expected))
 assert.equal(new Set(cases.map(c=>c.subject)).size,3)
})
test('offline reviewer embeds the current corpus and starts with no human signoffs',()=>{
 const html=readFileSync(`${root}/review.html`,'utf8')
 const embedded=JSON.parse(html.match(/<script type="application\/json" id="cases">(.*?)<\/script>/s)![1])
 assert.deepEqual(embedded,cases)
 assert.ok(html.includes(createHash('sha256').update(source).digest('hex').slice(0,16)))
 assert.ok(!html.includes('__CASE_DATA__'));assert.ok(!html.includes('__PACK_VERSION__'))
})
