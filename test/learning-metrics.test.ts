import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../src/db.ts'
import { registerUser } from '../src/auth.ts'
import { createStudent, scoreboardFor } from '../src/services.ts'
import { learningMeasures } from '../src/learning-metrics.ts'
import { scoreboardPage } from '../src/view.ts'

async function learner() {
  const db = openDb(':memory:')
  const u = await registerUser(db, 'measures@example.com', 'synthetic-password'); if (!u.ok) throw new Error()
  const student = await createStudent(db, u.userId, { displayName: 'Synthetic learner', grade: 3, sessionCapMinutes: 25 })
  return { db, owner: u.userId, student }
}

type Row = { concept?: string; correct?: 0 | 1 | null; hints?: number; beat?: string; answered?: 0 | 1 }
/** One recorded mission: when it started, how long until the first question showed, and each question's outcome. */
async function mission(db: any, student: string, minutesAgo: number, waitSeconds: number, rows: Row[], end: string | null = 'recap', goal = 'practice') {
  const id = crypto.randomUUID(), started = new Date(Date.now() - minutesAgo * 60000)
  await db.prepare(`INSERT INTO tutor_sessions (id, student_id, started_at, modality, consecutive_step_downs, cap_minutes, continuity, mode, subject, goal, ended_at, end_reason)
    VALUES (?, ?, ?, 'screen', 0, 10, '', 'session', 'Math', ?, ?, ?)`).run(id, student, started.toISOString(), goal, end ? new Date(started.getTime() + 600000).toISOString() : null, end)
  for (const [i, row] of rows.entries()) {
    await db.prepare(`INSERT INTO session_items (id, session_id, position, beat, concept_id, bloom_level, prompt, answer, hints_json, surface, interleaved, hints_used, answered, correct, shown_at)
      VALUES (?, ?, ?, ?, ?, 2, ?, '1', '[]', 'screen', 0, ?, ?, ?, ?)`).run(crypto.randomUUID(), id, i + 1, row.beat ?? 'frontier', row.concept ?? 'math.primary.3.multiply', `Synthetic ${id} ${i}`,
      row.hints ?? 0, row.answered ?? 1, row.answered === 0 ? null : row.correct ?? 1, i === 0 ? new Date(started.getTime() + waitSeconds * 1000).toISOString() : null)
  }
  return id
}

test('with too little history every measure says so instead of showing a number', async () => {
  const f = await learner()
  try {
    const measures = await learningMeasures(f.db, f.student)
    assert.deepEqual(measures.map((m) => m.key), ['time_to_first', 'self_correction', 'hint_before_answer', 'completion', 'retention', 'calibration'])
    for (const m of measures) { assert.equal(m.enough, false); assert.match(m.value, /^Not enough yet: 0 of \d+/); assert.ok(m.definition.length > 20) }
  } finally { f.db.close() }
})

test('each measure follows its stated definition', async () => {
  const f = await learner()
  try {
    // Five finished missions: waits of 10, 20, 30, 40 and 300 seconds (middle value 30).
    // Misses followed by another try on the same topic: three corrected alone, one with a hint, one still wrong.
    await mission(f.db, f.student, 600, 10, [{ correct: 0 }, { correct: 1 }, { beat: 'guided', hints: 1, correct: 1 }])
    await mission(f.db, f.student, 500, 20, [{ correct: 0 }, { correct: 1 }, { correct: 1, hints: 1 }])
    await mission(f.db, f.student, 400, 30, [{ correct: 0 }, { correct: 1, hints: 1 }, { correct: 1 }])
    await mission(f.db, f.student, 300, 40, [{ correct: 0 }, { correct: 0, concept: 'math.primary.2.add' }, { correct: 0 }])
    await mission(f.db, f.student, 200, 300, [{ correct: 0 }, { correct: 1 }, { correct: 1 }, { correct: 1 }])
    // Two unfinished missions, one carried on later (counted once, where it finished), one waiting review (never counted).
    await mission(f.db, f.student, 150, 5, [{ correct: 1 }, { answered: 0 }], 'attention')
    await mission(f.db, f.student, 140, 5, [{ correct: 1 }, { answered: 0 }], 'continued')
    await mission(f.db, f.student, 130, 1, [{ correct: 1 }], 'waiting_review', 'waiting_review:job')
    const byKey = Object.fromEntries((await learningMeasures(f.db, f.student)).map((m) => [m.key, m]))
    assert.equal(byKey.time_to_first.value, '20 seconds', 'middle of 10, 20, 30, 40, 300 and two 5-second waits')
    assert.equal(byKey.self_correction.value, '60%'); assert.match(byKey.self_correction.detail, /3 of 5 misses/)
    // Own answers exclude the planned guided hint: 17 answered, 2 asked for a hint.
    assert.equal(byKey.hint_before_answer.value, '12%'); assert.match(byKey.hint_before_answer.detail, /2 of 17 answers/)
    assert.equal(byKey.completion.value, '83%'); assert.match(byKey.completion.detail, /5 of 6 missions/)
    assert.equal(byKey.retention.enough, false)
    const board = await scoreboardFor(f.db, f.owner, f.student)
    const page = scoreboardPage('Synthetic learner', f.student, board, {}, Object.values(byKey))
    assert.match(page, /How learning is going/); assert.match(page, /nothing is sent elsewhere/)
    assert.doesNotMatch(scoreboardPage('Synthetic learner', f.student, board, {}, []), /How learning is going/, 'not shown without the parent measures')
  } finally { f.db.close() }
})

test('remembered a week later compares the first unaided success with the next unaided try seven or more days on', async () => {
  const f = await learner()
  try {
    /** A real answered question and its attempt, on a given day, with or without a hint. */
    const answer = async (concept: string, daysAgo: number, correct: 0 | 1, hints = 0) => {
      const when = new Date(Date.now() - daysAgo * 86400000)
      const session = await mission(f.db, f.student, daysAgo * 1440, 5, [{ concept, correct, hints }])
      const item = (await f.db.prepare('SELECT id FROM session_items WHERE session_id = ?').get(session))!
      await f.db.prepare('UPDATE session_items SET submitted_at = ?, given_answer = ? WHERE id = ?').run(when.toISOString(), correct ? '1' : '9', item.id)
      await f.db.prepare(`INSERT INTO attempts (id, student_id, session_id, concept_id, bloom_level, day, correct, hints_used, interleaved, time_ms, error_type, modality, created_at)
        VALUES (?, ?, ?, ?, 2, ?, ?, ?, 0, 5000, NULL, 'screen', ?)`).run(item.id, f.student, session, concept, when.toISOString().slice(0, 10), correct, hints, when.toISOString())
    }
    const topics = ['math.primary.1.add', 'math.primary.1.subtract', 'math.primary.2.add', 'math.primary.2.subtract', 'math.primary.2.place', 'math.primary.3.divide']
    // Six topics first solved alone 20 days ago; four still right 10 days later, one wrong, one only checked with a hint.
    for (const topic of topics) await answer(topic, 20, 1)
    for (const topic of topics.slice(0, 4)) await answer(topic, 10, 1)
    await answer(topics[4], 10, 0)
    await answer(topics[5], 10, 1, 1)
    const retention = (await learningMeasures(f.db, f.student)).find((m) => m.key === 'retention')!
    assert.equal(retention.enough, true)
    assert.equal(retention.value, '80%'); assert.match(retention.detail, /4 of 5 topics/)
  } finally { f.db.close() }
})

test('a paused mission is not judged as unfinished, and the overview always has three plain lines', async () => {
  const f = await learner()
  try {
    for (let i = 0; i < 5; i++) {
      const id = await mission(f.db, f.student, 300 + i * 60, 5, [{ correct: 1 }, { answered: 0 }], null)
      await f.db.prepare('UPDATE tutor_sessions SET paused_at = ? WHERE id = ?').run(new Date(Date.now() - 200 * 60000).toISOString(), id)
    }
    const completion = (await learningMeasures(f.db, f.student)).find((m) => m.key === 'completion')!
    assert.equal(completion.enough, false); assert.match(completion.value, /Not enough yet: 0 of 5/)
    const { overviewLines } = await import('../src/journey-view.ts')
    assert.deepEqual(overviewLines(['Synthetic learner has not practised yet this week.'], { next: null, pending: 0 }, ''), ['Synthetic learner has not practised yet this week.', 'Next: add a class to choose the first topic.', 'Nothing needs you right now.'])
    assert.equal(overviewLines([], { next: { title: 'Equal groups' }, pending: 2 }, 'No AI is connected yet.').length, 3)
    assert.match(overviewLines(['a', 'b', 'Fractions is sticking: recent tries keep missing it.'], { next: { title: 'Equal groups' }, pending: 0 }, '')[2], /sticking/)
  } finally { f.db.close() }
})
