import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.ts'
import { gradeResponse } from '../src/grade-response.ts'
import { startServer } from '../src/server.ts'
import { registerUser } from '../src/auth.ts'
import { seedStrengths } from '../test/fixtures/strengths.ts'
const dir = mkdtempSync(join(tmpdir(), 'tutor-browser-'))
const db = openDb(join(dir, 'browser.sqlite'))
// The full browser suite and focused strengths suite share this isolated family.
const strengthsUser = await registerUser(db, 'strengths-browser@example.invalid', 'synthetic-browser-password')
if (!strengthsUser.ok) throw new Error('Synthetic strengths registration failed')
await db.prepare("UPDATE users SET email_verified_at = ?, ai_provider = 'openai', ai_model = '', ai_key = '' WHERE id = ?").run(new Date().toISOString(), strengthsUser.userId)
await seedStrengths(db, strengthsUser.userId)
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
  else if (system.includes('Instructions for planning a class.')) result = { reply: 'Here is your science class plan.', subject: 'Science', about: 'A small science class', mathCourse: '', ready: true, topics: [{ title: 'Cells', recall: 'Name parts of a cell.' }] }
  else if (system.includes('Fresh practice for one existing concept')) result = {questions:[1,2,3,4].map(n=>({prompt:`Fresh situation ${n}: explain why a cell needs a boundary.`,answer:'Rubric: distinguish the inside from the surroundings.',bloomLevel:2}))}
  else if (typeof content === 'string' && content.startsWith('Make a curriculum for')) result = { reason: 'Use the parent-selected sample test to practise addition.', topics: [{ title: 'Add and subtract multi-digit numbers', recall: 'Add with regrouping.', example: '12 plus 8 is 20.', nonExample: 'Ignoring place value.', questions: [{ prompt: 'What is 13 + 8?', answer: '21', bloomLevel: 3 }, { prompt: 'Create an addition question with a sum of 30 and solve it.', answer: 'Rubric: Give an addition problem whose terms add to 30 and show its solution.', bloomLevel: 6 }] }] }
  else if (system.includes('# Read school material')) result = { questions: [{ number: '12b', prompt: 'What is 2 + 2?', figure: '', visibleWork: '5', answerKey: '4', teacherMark: '', conceptId: 'math.4.nbt.b.4', readable: true, confidence: .98 }] }
  else if (system.includes('# Review school homework')) result = system.includes('For guidance') && typeof content === 'string' && content.includes('transcript') ? { reply: 'You counted one extra. What happens if you group two and two?' } : { verdict: 'needs_work', explanation: 'Two and two make four. Check the extra count.', confidence: .99 }
  else result = { correct: !(typeof content === 'string' && content.includes('definitely wrong')), reason: 'The response meets the stored rubric.', confidence: .99, errorType: null }
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }), { status: 200 })
}
await startServer({ db, judgeResponse: async (input, ai) => ['grok', 'claude'].includes(ai.provider) ? null : gradeResponse(input, ai), uploadsDir: join(dir, 'uploads'), host: '127.0.0.1', port: 8799 })
