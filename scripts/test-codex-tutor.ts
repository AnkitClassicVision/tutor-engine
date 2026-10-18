import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { gradeResponse } from '../src/grade-response.ts'
import { answerLesson, lessonFallback } from '../src/talk.ts'
import { planCurriculum } from '../src/plan-subject.ts'
import { mkdirSync as makeEvidenceDir } from 'node:fs'
makeEvidenceDir('evidence', { recursive: true })

if(process.env.TUTOR_CODEX_LOCAL!=='1'||process.env.TUTOR_PUBLIC==='1')throw new Error('Use the opt-in local Codex test environment.')
const ai={provider:'codex' as const,model:'',apiKey:''}
const cases: Array<{name: string; bloomLevel: 2 | 4; expected: boolean | null; response: string}> = [
 {name:'valid independent reasoning',bloomLevel:2,expected:true,response:'A common denominator is 6: 1/2 = 3/6 and 1/3 = 2/6, so the sum is 5/6. Both fractions are now measured in equal-sized sixths, so I combine the counts of pieces while keeping their size (the denominator) unchanged.'},
 {name:'incomplete explanation at Understand demand',bloomLevel:2,expected:false,response:'A common denominator is 6: 1/2 = 3/6 and 1/3 = 2/6, so the sum is 5/6.'},
 {name:'denominator misconception',bloomLevel:2,expected:false,response:'Add the top and bottom numbers separately: 1/2 + 1/3 = 2/5.'},
 {name:'unreadable text remains unresolved',bloomLevel:2,expected:null,response:'[The photograph cannot be read. No answer can be transcribed reliably.]'},
]
cases.push({name:'inflated Bloom label remains unresolved',bloomLevel:4,expected:null,response:cases[0].response})
const grades=[]
for(const c of cases){
 const verdict=await gradeResponse({concept:'Adding unlike-denominator fractions',bloomLevel:c.bloomLevel,prompt:'Explain how to add 1/2 and 1/3.',key:'Rubric: use equivalent fractions with denominator 6, combine 3/6 and 2/6, and justify why the denominator stays 6.',response:c.response},ai,60000)
 console.log(JSON.stringify({case:c.name,verdict}))
 assert.equal(verdict?.correct??null,c.expected,c.name)
 grades.push({case:c.name,bloomLevel:c.bloomLevel,expected:c.expected,verdict})
 console.log(JSON.stringify({case:c.name,passed:true}))
}
const teaching=await answerLesson({results:[{title:'Fractions',prompt:'Add 1/2 and 1/3.',answer:'5/6',correct:false}],transcript:[],question:'Why can’t I add the denominators? Can you give me one small step to try?'},ai,60000)
assert.ok(teaching.length>20)
assert.notEqual(teaching,lessonFallback([{title:'Fractions',prompt:'Add 1/2 and 1/3.',answer:'5/6',correct:false}]))
const plan=await planCurriculum({subject:'Math',about:'One small goal: add unlike-denominator fractions. A misconception adds denominators; keep equivalent fractions in review.',syllabus:'Equivalent fractions and fraction addition.',direction:'Start with a brief prerequisite probe, teach with a worked example, fade help, then a fresh unaided check. No forced creation task.',ageGrade:5,mathClass:'Grade-level math',existing:[]},ai,90000)
assert.ok(plan)
const report={testedAt:new Date().toISOString(),provider:'codex',auth:'installed CLI ChatGPT sign-in',model:'CLI default, no model override',realCalls:7,grades,teaching,plan,releaseGatePassed:false,limitations:['Synthetic smoke cases only; not the 100-reviewed-case quality gate.','No real learner data, image inference or live voice/camera.','Teaching and keys require broader human review; no measured learning gains.']}
await writeFile('evidence/codex-tutor-smoke.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({realCalls:7,gradingCasesPassed:5,teachingPresent:true,curriculumParsed:true,releaseGatePassed:false}))
