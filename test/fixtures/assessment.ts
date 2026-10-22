import type { Database } from '../../src/database.ts'
import { createStudent, startTutorSession, pauseSession } from '../../src/services.ts'

/** Known questions in an isolated browser database; never real learner work. */
export async function seedAssessment(db: Database, owner: string, name: string) {
  const student = await createStudent(db, owner, { displayName: name, grade: 5, sessionCapMinutes: 10 })
  const session = await startTutorSession(db, owner, student, new Date(), { mode: 'assessment' })
  await db.prepare('DELETE FROM session_items WHERE session_id = ?').run(session)
  const items = [
    { prompt: 'What is 2 + 2?', answer: '4', bloom: 3, format: 'number', choices: null },
    { prompt: 'Tell me, in order, the steps you would use to add two fractions. You do not need to work out the final answer.', answer: 'Rubric: describe a common denominator and combining the numerators.', bloom: 1, format: 'steps', choices: null },
    { prompt: 'Which shows two equal groups? A: two groups of three. B: a group of two and a group of four.', answer: 'A', bloom: 2, format: 'choice', choices: ['A', 'B'] },
  ]
  for (const [index, item] of items.entries()) await db.prepare(`INSERT INTO session_items
    (id, session_id, position, beat, concept_id, bloom_level, prompt, answer, hints_json, surface, interleaved, hints_used, answered, format, choices_json)
    VALUES (?, ?, ?, 'frontier', 'math.5.nf.a.1', ?, ?, ?, ?, 'screen', 0, 0, 0, ?, ?)`)
    .run(crypto.randomUUID(), session, index + 1, item.bloom, item.prompt, item.answer, JSON.stringify(['A private teaching clue.']), item.format, item.choices ? JSON.stringify(item.choices) : null)
  // The fixture waits without consuming its attention limit while earlier browser suites run.
  await pauseSession(db, owner, session)
}
