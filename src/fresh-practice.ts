import {readModelJson,type AiConfig} from './ai.ts'
import {promptIdentity} from './session-feedback.ts'
import type {ConceptNode,BloomLevel} from './engine/types.ts'
import type {Contract} from './runbook/contract.ts'
import {questionCritic} from './runbook/critics.ts'
import {bloomCue,childSafe,distinct,fresh,issue,noLeak,readingFit,type Issue} from './runbook/gates.ts'
import {runContract,type Ask} from './runbook/run.ts'

export class FreshPracticeRequired extends Error {
  conceptId:string
  subject:string
  constructor(conceptId:string,subject:string){super('This topic needs fresh practice. We will prepare different questions before continuing.');this.conceptId=conceptId;this.subject=subject}
}
export type FreshContext={concept:ConceptNode;demand:BloomLevel;asked:string[];evidence:string}
type Question={prompt:string;answer:string;bloomLevel:BloomLevel;transfer?:boolean}

function parseQuestions(result:Record<string,unknown>,input:FreshContext):Question[]{
 if(Object.keys(result).length!==1||!Array.isArray(result.questions)||result.questions.length!==4)throw new Error('Fresh question generation did not match the contract.')
 const seen=new Set(input.asked.map(promptIdentity));let recall=0
 return result.questions.map((q:any)=>{
  if(!q||!['answer,bloomLevel,prompt','answer,bloomLevel,prompt,transfer'].includes(Object.keys(q).sort().join(','))||(q.transfer!==undefined&&typeof q.transfer!=='boolean')||typeof q.prompt!=='string'||!q.prompt.trim()||typeof q.answer!=='string'||!q.answer.trim()||!Number.isInteger(q.bloomLevel)||q.bloomLevel<Math.max(1,input.demand-1)||q.bloomLevel>Math.min(6,input.demand+1))throw new Error('Fresh practice must keep the selected concept and appropriate demand.')
  const key=promptIdentity(q.prompt)
  if(seen.has(key)||q.bloomLevel===1&&++recall>1||q.bloomLevel>=4&&!q.answer.startsWith('Rubric:'))throw new Error('Fresh practice repeated a question or omitted its reasoning rubric.')
  seen.add(key);return{prompt:q.prompt.trim(),answer:q.answer.trim(),bloomLevel:q.bloomLevel as BloomLevel,...(q.transfer===true?{transfer:true}:{})}
 })
}
export function parseFreshPractice(raw:string,input:FreshContext){return parseQuestions(readModelJson(raw),input)}

export const FRESH_PRACTICE:Contract<FreshContext,Question[]>={
 id:'fresh-practice',version:3,role:'verifier',
 skills:['design-questions','assess-learning','adapt-session'],
 brief:()=> 'Fresh practice for one existing concept. Return four genuinely different unaided questions and their correct keys. Use the supplied concept only; vary the situation, representation and question move rather than repeating a failed question or changing its number label. Work at the supplied Bloom demand or one adjacent rung, with at most one recall question. Match the actual task: Bloom 2 explains an idea or distinguishes examples; Bloom 3 applies a procedure; finding and correcting a faulty step is Analyze (4), so omit that move if outside the allowed range. Start the key of any Bloom 4-6 question with "Rubric:" and name what a good answer must contain. Mark transfer true on a question that uses the idea in a situation the child has not practised (a new context, representation or purpose) without needing anything they have not learned; at demand 3 or above include at least one. Put no worked steps or hints in these assessment prompts. The existing lesson handles teaching and support. Never reuse any supplied asked question. Uncertainty and misses are not diagnoses.',
 schema:{type:'object',additionalProperties:false,required:['questions'],properties:{questions:{type:'array',minItems:4,maxItems:4,items:{type:'object',additionalProperties:false,required:['prompt','answer','bloomLevel'],properties:{prompt:{type:'string',minLength:3,maxLength:1200},answer:{type:'string',minLength:1,maxLength:1200},bloomLevel:{type:'integer',minimum:1,maximum:6},transfer:{type:'boolean'}}}}}},
 selfCheck:[
  'Does every question practise only the supplied concept?',
  'Is every question new: no sentence from the asked list, and no two alike?',
  'Does each Bloom label match what the child must actually do?',
  'Is every key correct, and does every Bloom 4-6 key start with "Rubric:"?',
  'Is each question free of hints, worked steps and its own answer?',
  'At demand 3 or above, is at least one question marked transfer, set somewhere the child has not practised?',
 ],
 prompt:input=>input,
 parse:(reply,input)=>parseQuestions(reply,input),
 gate:(questions,input)=>{
  const found:Issue[]=[...distinct(questions.map(q=>q.prompt))]
  if(input.demand>=3&&!questions.some(q=>q.transfer))found.push(issue('no_transfer','No question uses the idea somewhere new.',false))
  questions.forEach((q,i)=>found.push(...fresh(q.prompt,input.asked,i),...noLeak(q.prompt,q.answer,i),...childSafe([q.prompt,q.answer],i),...readingFit(q.prompt,input.concept.grade,i),...bloomCue(q.prompt,q.bloomLevel,i)))
  return found
 },
 critic:questionCritic(questions=>questions,input=>({topic:input.concept.title,grade:input.concept.grade})),
}

export async function freshPractice(input:FreshContext,ai:AiConfig,options:{ask?:Ask;record?:(report:import('./runbook/contract.ts').RunReport)=>Promise<void>}={}){
 const {output,report}=await runContract(FRESH_PRACTICE,input,ai,{ask:options.ask})
 await options.record?.(report).catch(()=>{})
 if(!output)throw new Error('Fresh questions did not pass the quality checks. Retry for a different set.')
 return output
}
