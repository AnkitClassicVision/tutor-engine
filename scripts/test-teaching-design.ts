import {writeFileSync} from 'node:fs'
import {assertLocalCodex} from '../src/codex-local.ts'
import {answerLesson} from '../src/talk.ts'
import {freshPractice} from '../src/fresh-practice.ts'
import { mkdirSync as makeEvidenceDir } from 'node:fs'
makeEvidenceDir('evidence', { recursive: true })
assertLocalCodex()
const ai={provider:'codex' as const,model:process.env.TUTOR_CODEX_TEST_MODEL || '',apiKey:''}
const concept={conceptId:'math.5.nf.a.1',subject:'Math',grade:5,title:'Adding fractions',prereqs:[],recall:'Use equal-sized pieces before adding their counts.',example:'1/4 + 1/2 = 1/4 + 2/4 = 3/4.',nonExample:'Adding tops and bottoms separately does not combine equal-sized parts.'}
const reply=await answerLesson({results:[{title:concept.title,prompt:'Add 1/2 and 1/3.',answer:'5/6',correct:false,recall:concept.recall,example:concept.example}],transcript:[],question:'Please show me with simple words.',schoolLevel:'Grade 2'},ai,60000)
const questions=await freshPractice({concept,demand:3,asked:['Add 1/2 and 1/3.','Name the rule for fraction addition.'],evidence:'Synthetic learner-question signal: clarify why fractions need equal-sized pieces. This is a request, not a failed check. Stay on this concept and use fresh independent questions; preserve other strengths and due reviews in the standing program.'},ai)
writeFileSync('evidence/teaching-design-smoke.json',JSON.stringify({synthetic:true,provider:'codex',model:ai.model || 'installed CLI default',modelRequests:2,presentationGrade:2,contentGrade:5,reply,questions,substantiveReviewRequired:true,independentHumanReview:false,releaseGatePassed:false},null,2)+'\n')
console.log(JSON.stringify({presentationReplyPresent:!!reply,freshQuestions:questions.length,releaseGatePassed:false}))
