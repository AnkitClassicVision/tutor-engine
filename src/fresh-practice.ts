import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {askModel,readModelJson,type AiConfig} from './ai.ts'
import {skillText} from './skill-text.ts'
import {promptIdentity} from './session-feedback.ts'
import type {ConceptNode,BloomLevel} from './engine/types.ts'

export class FreshPracticeRequired extends Error {
  conceptId:string
  subject:string
  constructor(conceptId:string,subject:string){super('This topic needs fresh practice. We will prepare different questions before continuing.');this.conceptId=conceptId;this.subject=subject}
}
const schema=JSON.stringify({type:'object',additionalProperties:false,required:['questions'],properties:{questions:{type:'array',minItems:4,maxItems:4,items:{type:'object',additionalProperties:false,required:['prompt','answer','bloomLevel'],properties:{prompt:{type:'string'},answer:{type:'string'},bloomLevel:{type:'integer',minimum:1,maximum:6}}}}}})
export type FreshContext={concept:ConceptNode;demand:BloomLevel;asked:string[];evidence:string}
export function parseFreshPractice(raw:string,input:FreshContext){
 const result=readModelJson(raw)
 if(Object.keys(result).length!==1||!Array.isArray(result.questions)||result.questions.length!==4)throw new Error('Fresh question generation did not match the contract.')
 const seen=new Set(input.asked.map(promptIdentity));let recall=0
 const questions=result.questions.map((q:any)=>{
  if(!q||Object.keys(q).sort().join(',')!=='answer,bloomLevel,prompt'||typeof q.prompt!=='string'||!q.prompt.trim()||typeof q.answer!=='string'||!q.answer.trim()||!Number.isInteger(q.bloomLevel)||q.bloomLevel<Math.max(1,input.demand-1)||q.bloomLevel>Math.min(6,input.demand+1))throw new Error('Fresh practice must keep the selected concept and appropriate demand.')
  const key=promptIdentity(q.prompt)
  if(seen.has(key)||q.bloomLevel===1&&++recall>1||q.bloomLevel>=4&&!q.answer.startsWith('Rubric:'))throw new Error('Fresh practice repeated a question or omitted its reasoning rubric.')
  seen.add(key);return{prompt:q.prompt.trim(),answer:q.answer.trim(),bloomLevel:q.bloomLevel as BloomLevel}
 });return questions
}
export async function freshPractice(input:FreshContext,ai:AiConfig){
 const dir=mkdtempSync(join(tmpdir(),'tutor-fresh-'));try{
  const path=join(dir,'prompt.txt');writeFileSync(path,JSON.stringify(input),{mode:0o600})
  const instructions=[skillText('design-questions'),skillText('assess-learning'),skillText('adapt-session'),'Fresh practice for one existing concept. Return four genuinely different unaided questions and their correct keys. Use the supplied concept only; vary the situation, representation and question move rather than repeating a failed question or changing its number label. Work at the supplied Bloom demand or one adjacent rung, with at most one recall question. Match the actual task: Bloom 2 explains an idea or distinguishes examples; Bloom 3 applies a procedure; finding and correcting a faulty step is Analyze (4), so omit that move if outside the allowed range. Put no worked steps or hints in these assessment prompts. The existing lesson handles teaching and support. Never reuse any supplied asked question. Uncertainty and misses are not diagnoses. Return exactly the questions array; no other fields or tools.'].join('\n\n')
  return parseFreshPractice(await askModel(path,schema,instructions,90000,ai),input)
 }finally{rmSync(dir,{recursive:true,force:true})}
}
