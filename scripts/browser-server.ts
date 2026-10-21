import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.ts'
import { judgeAnswer } from '../src/grade-response.ts'
import { startServer } from '../src/server.ts'
import { registerUser } from '../src/auth.ts'
import { createStudent } from '../src/services.ts'
import { encryptSecret } from '../src/secrets.ts'
import { seedStrengths } from '../test/fixtures/strengths.ts'
import { seedAssessment } from '../test/fixtures/assessment.ts'
import { seedTeachingRoute } from '../test/fixtures/teaching-route.ts'
const dir = mkdtempSync(join(tmpdir(), 'tutor-browser-'))
const db = openDb(join(dir, 'browser.sqlite'))
// The full browser suite and focused strengths suite share this isolated family.
const strengthsUser = await registerUser(db, 'strengths-browser@example.invalid', 'synthetic-browser-password')
if (!strengthsUser.ok) throw new Error('Synthetic strengths registration failed')
await db.prepare("UPDATE users SET email_verified_at = ?, ai_provider = 'openai', ai_model = '', ai_key = '' WHERE id = ?").run(new Date().toISOString(), strengthsUser.userId)
await seedStrengths(db, strengthsUser.userId)
// A family with no AI connected, to check that what the screens promise without one really works.
// One per browser project, so parallel browsers never share a mission.
for (const project of ['chromium', 'firefox', 'webkit', 'mobile-chromium', 'tablet']) {
  const teachingUser = await registerUser(db, `teaching-${project}@example.invalid`, 'synthetic-browser-password')
  if (!teachingUser.ok) throw new Error('Synthetic teaching registration failed')
  await db.prepare("UPDATE users SET email_verified_at = ?, ai_provider = 'openai', ai_model = '', ai_key = '' WHERE id = ?").run(new Date().toISOString(), teachingUser.userId)
  await seedTeachingRoute(db, teachingUser.userId)
  const assessmentUser = await registerUser(db, `assessment-${project}@example.invalid`, 'synthetic-browser-password')
  if (!assessmentUser.ok) throw new Error('Synthetic assessment registration failed')
  await db.prepare("UPDATE users SET email_verified_at = ?, ai_provider = 'openai', ai_model = '', ai_key = '' WHERE id = ?").run(new Date().toISOString(), assessmentUser.userId)
  await seedAssessment(db, assessmentUser.userId, 'Synthetic assessment')
  await seedAssessment(db, assessmentUser.userId, 'Synthetic early finish')
  const noAiUser = await registerUser(db, `no-ai-${project}@example.invalid`, 'synthetic-browser-password')
  if (!noAiUser.ok) throw new Error('Synthetic no-AI registration failed')
  await db.prepare("UPDATE users SET email_verified_at = ?, ai_provider = 'openai', ai_model = '', ai_key = '' WHERE id = ?").run(new Date().toISOString(), noAiUser.userId)
  await createStudent(db, noAiUser.userId, { displayName: 'Synthetic offline', birthDate: '2016-05-04', sessionCapMinutes: 10 })
  for (const age of [6, 9, 12]) await createStudent(db, noAiUser.userId, { displayName: `Synthetic capability ${age}`, birthDate: new Date(Date.now() - age * 365.25 * 86400000).toISOString().slice(0, 10), sessionCapMinutes: 10 })
  // WF-01: a family whose AI key stopped being accepted.
  const revoked = await registerUser(db, `revoked-${project}@example.invalid`, 'synthetic-browser-password')
  if (!revoked.ok) throw new Error('Synthetic revoked registration failed')
  await db.prepare("UPDATE users SET email_verified_at = ?, ai_provider = 'openai', ai_model = 'gpt-synthetic', ai_key = ?, ai_health = 'revoked', ai_health_at = ? WHERE id = ?").run(new Date().toISOString(), encryptSecret('sk-synthetic-revoked'), new Date().toISOString(), revoked.userId)
  await createStudent(db, revoked.userId, { displayName: 'Synthetic revoked', birthDate: '2016-05-04', sessionCapMinutes: 10 })
}
// A researched subject map for any new class, from the research golden case.
const researchMap = JSON.parse(readFileSync(new URL('../eval/golden/research-subject.json', import.meta.url), 'utf8'))[0].replies.write
// Open questions carry the rubric written with them.
const fixtureRubric = { mustShow: [{ point: 'Gives the idea with a reason', acceptable: ['says the idea and why', 'explains it in their own words'] }], doesNotMeet: ['repeats the question'], notRequired: ['spelling'], examples: { meets: 'It keeps the inside separate because the boundary controls what passes.', almost: 'It is a boundary.', notYet: 'Because it is.' } }
// Graders show their working: one point, met with the learner's own words unless the answer says "definitely wrong".
const graded = (content: any) => {
  let response = ''
  try { response = String(JSON.parse(String(content).split('\n\nReply with one JSON')[0]).response ?? '') } catch { response = '' }
  const correct = !response.includes('definitely wrong')
  return { rubricPoints: [{ point: 'Does what the question asks', met: correct, quote: correct ? response.slice(0, 30) : '' }], reasoningSound: correct, doubts: [], correct }
}
// Deterministic, isolated model fixture exercises the actual worker and routing contracts.
globalThis.fetch = async (_input: any, init: any) => {
  const body = JSON.parse(init.body), content = body.messages.at(-1).content
  const system = body.messages[0]?.content ?? body.system ?? ''
  let result: any
  if (system.includes('You write a learning pack')) {
    // A times-tables pack whose keys are right, so the code gate and the keyless check both pass it.
    const facts = [2, 3, 4, 6, 8, 9]
    const items = facts.map((n, i) => i === 1
      ? { prompt: `Which is the same as 7 × ${n}?`, answer: String(7 * n), format: 'choice', choices: [String(7 * n), String(7 * n + 7), String(7 * n - 1)], work: null, hints: ['Count up in sevens.', `Think of ${n} groups of seven.`, 'Check by adding seven again.'], explanation: `${n} groups of 7 make ${7 * n}.`, bloom: 2 }
      : { prompt: `What is 7 × ${n}?`, answer: String(7 * n), format: 'number', choices: null, work: `7*${n}`, hints: ['Count up in sevens.', `Think of ${n} groups of seven.`, 'Use a fact you know and add or take away a seven.'], explanation: `${n} groups of 7 make ${7 * n}.`, bloom: i < 2 ? 1 : 3 })
    result = { interpretation: 'The seven times table, with a one-minute lesson first.', lesson: { hook: 'Sevens show up in every week.', steps: ['Count in sevens: 7, 14, 21.', 'Use a fact you know, then add one more seven.'], workedExample: '7 × 5 is 35, so 7 × 6 is 35 + 7 = 42.', quickCheck: { question: 'What is 7 × 2?', answer: '14' } }, skills: [{ title: 'Seven times table', recall: 'Multiplying by 7 adds a group of seven each time.', example: '7 × 3 = 21', nonExample: '7 × 3 = 10', items }] }
  }
  else if (system.includes('independent reviewer of children')) {
    const items = JSON.parse(String(content).split('\n\nReply with one JSON')[0]).items as Array<{ id: string; prompt: string }>
    result = { items: items.map(item => ({ id: item.id, answer: String(7 * Number(item.prompt.match(/7 × (\d+)/)?.[1] ?? 0)), onTopic: 5, ageFit: 5, issue: '' })) }
  }
  else if (system.includes('You independently review questions')) result = { items: Array.from({ length: 40 }, (_, id) => ({ id, answer: '', bloom: 6, onTopic: 5, ageFit: 5, issue: '' })) }
  else if (system.includes('independent subject expert')) result = { concepts: Array.from({ length: 18 }, (_, index) => ({ index, accurate: true, ageFit: 5, realMisconceptions: true, issue: '' })) }
  else if (system.includes('# Research a subject')) result = researchMap
  else if (system.includes('# Verify a judgment')) { const { doubts: _d, ...g } = graded(content); result = { ...g, confidence: .95, reason: 'The response meets the stored rubric.' } }
  else if (system.includes('# Ground a judgment')) { const g = graded(content); result = { ...g, groundedOn: ['own working'], doubtAbout: 'none', reason: 'Checked against the topic.', confidence: .95, errorType: g.correct ? null : 'misconception' } }
  else if (system.includes('Instructions for planning a class.')) result = { reply: 'Here is your science class plan.', subject: 'Science', about: 'A small science class', mathCourse: '', ready: true, topics: [{ title: 'Cells', recall: 'Name parts of a cell.' }] }
  else if (system.includes('Fresh practice for one existing concept')) result = {questions:[1,2,3,4].map(n=>({prompt:`Fresh situation ${n}: explain why a cell needs a boundary.`,answer:'Rubric: distinguish the inside from the surroundings.',bloomLevel:2,rubric:fixtureRubric}))}
  else if (typeof content === 'string' && content.startsWith('Make a curriculum for')) result = { reason: 'Use the parent-selected sample test to practise addition.', topics: [{ title: 'Add and subtract multi-digit numbers', recall: 'Add with regrouping.', example: '12 plus 8 is 20.', nonExample: 'Ignoring place value.', questions: [{ prompt: 'What is 13 + 8?', answer: '21', bloomLevel: 3 }, { prompt: 'Create an addition question with a sum of 30 and solve it.', answer: 'Rubric: Give an addition problem whose terms add to 30 and show its solution.', bloomLevel: 6, rubric: fixtureRubric }] }] }
  else if (system.includes('# Read school material')) result = { questions: [{ number: '12b', prompt: 'What is 2 + 2?', figure: '', visibleWork: '5', answerKey: '4', teacherMark: '', conceptId: 'math.4.nbt.b.4', readable: true, confidence: .98 },
    // A smudged page also has an uncertain reading and one that could not be read (WF-05).
    ...(JSON.stringify(content).includes('smudged') ? [{ number: '3', prompt: 'Sam ate 1/2 of a pizza. How much is left?', figure: '', visibleWork: '', answerKey: '', teacherMark: '', conceptId: 'math.4.nbt.b.4', readable: true, confidence: .6 }, { number: '5', prompt: '', figure: '', visibleWork: '', answerKey: '', teacherMark: '', conceptId: null, readable: false, confidence: .1 }] : [])] }
  else if (system.includes('# Review school homework')) result = system.includes('For guidance') && typeof content === 'string' && content.includes('transcript') ? { reply: 'You counted one extra. What happens if you group two and two?' } : { verdict: 'needs_work', explanation: 'Two and two make four. Check the extra count.', confidence: .99 }
  else { const g = graded(content); result = { ...g, reason: g.correct ? 'You did what the question asked.' : 'Look again at what the question asks.', confidence: .99, errorType: g.correct ? null : 'misconception' } }
  // Runbook writers answer their self-check; the fixture always reports its checks as done.
  if (system.includes('Self-check. Before replying') && result && !result.selfCheck) result = { ...result, selfCheck: Array.from({ length: 12 }, (_, i) => ({ question: `Check ${i + 1}`, answer: 'Yes, checked.', ok: true })) }
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }), { status: 200 })
}
await startServer({ db, judgeResponse: async (input, ai, options) => ['grok', 'claude'].includes(ai.provider) ? { kind: 'failed' as const } : judgeAnswer(input, ai, options), uploadsDir: join(dir, 'uploads'), host: '127.0.0.1', port: 8799 })
