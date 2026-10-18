import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { gradeResponse } from '../src/grade-response.ts'
import { askPhoto, readModelJson, askModel, type AiConfig } from '../src/ai.ts'
import { validateQuestions } from '../src/schoolwork.ts'
import { skillText } from '../src/skill-text.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// Requires a human-reviewed corpus. Results never contain source images, answers, or keys.
const file = process.argv[2]
if (!file) throw new Error('Pass a human-reviewed JSONL corpus. See docs/MODEL-EVALUATION.md.')
const cases = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line))
if (cases.length < 100 || cases.some(c => c.handChecked !== true)) throw new Error('The release gate requires at least 100 hand-checked cases per model preset.')
for (const kind of ['grading', 'extraction', 'explanation', 'higher_bloom', 'unreadable', 'answer_key']) if (!cases.some(c => c.kind === kind)) throw new Error(`Missing ${kind} cases.`)
const ai: AiConfig = { provider: process.env.TUTOR_EVAL_PROVIDER as AiConfig['provider'], model: process.env.TUTOR_EVAL_MODEL || '', apiKey: process.env.TUTOR_EVAL_KEY || '' }
if (!ai.model || !['openai', 'anthropic', 'xai', 'openrouter'].includes(ai.provider) || !ai.apiKey) throw new Error('Set TUTOR_EVAL_PROVIDER, TUTOR_EVAL_MODEL and TUTOR_EVAL_KEY.')
let agreements = 0, scored = 0, unreadableScores = 0
const records: any[] = [], dir = mkdtempSync(join(tmpdir(), 'tutor-eval-'))
try {
  for (const [i, c] of cases.entries()) {
    let agreement = false, modelVerdict: boolean | null = null
    if (['grading', 'higher_bloom', 'answer_key'].includes(c.kind)) {
      const verdict = await gradeResponse(c.input, ai)
      modelVerdict = verdict?.correct ?? null
      agreement = modelVerdict === c.expectedCorrect
      scored++; if (agreement) agreements++
    } else if (['extraction', 'unreadable'].includes(c.kind)) {
      const raw = await askPhoto(ai, skillText('read-school-material'), JSON.stringify({ concepts: c.concepts || [], instruction: 'Read the supplied page using the shared contract.' }), c.mime, readFileSync(resolve(dirname(resolve(file)), c.imagePath)).toString('base64'))
      const questions = validateQuestions(raw, new Set((c.concepts || []).map((t: any) => t.id)))
      if (c.kind === 'unreadable') { const auto = questions.some((q: any) => q.readable); unreadableScores += auto ? 1 : 0; agreement = !auto }
      else agreement = JSON.stringify(questions.map((q: any) => ({ number: q.number, prompt: q.prompt, visibleWork: q.visibleWork }))) === JSON.stringify(c.expectedQuestions)
    } else {
      const path = join(dir, 'prompt.txt'); writeFileSync(path, JSON.stringify(c.input))
      const reply = readModelJson(await askModel(path, '{}', [skillText('review-school-homework'), skillText('coach-through-question')].join('\n\n'), 120000, ai))
      // Human evaluator later checks explanation substance, not keyword overlap.
      agreement = false
      records.push({ caseIndex: i, kind: c.kind, reviewRequired: true, outputPresent: typeof reply.reply === 'string' || typeof reply.explanation === 'string' })
      continue
    }
    records.push({ caseIndex: i, kind: c.kind, agreement, modelVerdict })
  }
} finally { rmSync(dir, { recursive: true, force: true }) }
const report = { testedAt: new Date().toISOString(), provider: ai.provider, model: ai.model, cases: cases.length, scoredCases: scored, gradingAgreement: scored ? agreements / scored : null, unreadableScores, explanationHumanReviewPending: records.some(r => r.reviewRequired), gatePassed: false, records }
mkdirSync('evidence', { recursive: true }); writeFileSync('evidence/model-evaluation.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, records: undefined }, null, 2))
