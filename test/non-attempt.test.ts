import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../src/db.ts'
import { registerUser } from '../src/auth.ts'
import { nonAttempt } from '../src/engine/score.ts'
import { createStudent, startTutorSession, sessionItems, submitAnswer, loadAttempts, useHint } from '../src/services.ts'
import { sessionPage } from '../src/view.ts'

const number = { answer: '56', format: 'text', choices: null }
const fraction = { answer: '3/4', format: 'text', choices: null }

test('only replies that are not a try are classed as non-attempts', () => {
  for (const raw of ['', '   ', '?', '??', '...', '!?', '-']) assert.equal(nonAttempt(number, raw), 'blank', raw)
  for (const raw of ['idk', 'IDK', "I don't know", 'i dont know', 'dunno', 'no idea', 'not sure', 'skip', 'I forgot.']) assert.equal(nonAttempt(number, raw), 'dont_know', raw)
  for (const raw of ['asdf', 'jjjj', 'qwerty', 'lol', '9999', 'a', 'x', '111', '999']) assert.equal(nonAttempt(number, raw), 'mash', raw)
  assert.equal(nonAttempt({ answer: '110', format: 'text', choices: null }, '111'), null, 'a near miss of repeated digits is a real try')
  // Real tries, right or wrong, are always scored.
  for (const raw of ['56', '54', '11', '99', '57', 'fifty six', 'fifty-six', '7 x 8', '5 6']) assert.equal(nonAttempt(number, raw), null, raw)
  for (const raw of ['three quarters', '6/8', '1/2', '0.75']) assert.equal(nonAttempt(fraction, raw), null, raw)
  assert.equal(nonAttempt({ answer: '1111', format: 'text', choices: null }, '1111'), null, 'a correct repeated-digit answer counts')
  assert.equal(nonAttempt({ answer: 'Rubric: names the denominator', format: 'text', choices: null }, 'the bottom number'), null, 'words on a written question are a try')
  assert.equal(nonAttempt({ answer: 'b', format: 'choice', choices: ['a', 'b'] }, 'a'), null)
  const written = { answer: 'Rubric: explains equal groups', format: 'text', choices: null }
  for (const raw of ['asdf', 'qwerty', 'fdsa', 'hjkl', 'xkcdq']) assert.equal(nonAttempt(written, raw), 'mash', raw)
  for (const raw of ['rows', 'groups of seven', 'try', 'rhythm', 'I add 7 eight times']) assert.equal(nonAttempt(written, raw), null, raw)
})

test('a non-attempt is asked again with no evidence, diagnosis or grading, and a second one points to the hint', async () => {
  const db = openDb(':memory:')
  try {
    const u = await registerUser(db, 'nonattempt@example.com', 'synthetic-password'); assert.ok(u.ok)
    const student = await createStudent(db, u.userId, { displayName: 'Synthetic learner', grade: 3, sessionCapMinutes: 25 })
    const now = new Date()
    const id = await startTutorSession(db, u.userId, student, now, { focusConceptId: 'math.primary.3.multiply' })
    let item = (await sessionItems(db, id))[0]
    const first = await submitAnswer(db, u.userId, id, { itemId: String(item.id), answer: 'idk' }, now)
    assert.deepEqual(first, { ended: false, reask: true, count: 1 })
    item = (await sessionItems(db, id))[0]
    assert.equal(item.answered, 0); assert.equal(item.error_type, null); assert.equal(item.correct, null)
    assert.equal((await loadAttempts(db, student)).length, 0)
    assert.equal((await db.prepare("SELECT count(*) AS n FROM jobs").get())!.n, 0)
    const decision = (await db.prepare("SELECT details FROM decision_records WHERE kind = 'non_attempt'").get())!
    assert.equal(JSON.parse(String(decision.details)).reason, 'dont_know')
    const session = (await db.prepare('SELECT pending_feedback FROM tutor_sessions WHERE id = ?').get(id))!
    const feedback = JSON.parse(String(session.pending_feedback))
    const page = (count: number, row = item) => sessionPage({ sessionId: id, continuity: '', item: row, position: 1, total: 6, feedback: { ...feedback, count }, onBreak: false, ended: false, capMinutes: 25 })
    assert.match(page(1), /Have a go\. A guess is fine/)
    for (const html of [page(1), page(2)]) assert.doesNotMatch(html, /\$\{|\} \?|\? '<p|: ""\}/, 'no template source leaks into the page')
    assert.doesNotMatch(page(1), /Possible|misconception|retrieval/i)
    const second = await submitAnswer(db, u.userId, id, { itemId: String(item.id), answer: 'asdf' }, now)
    assert.deepEqual(second, { ended: false, reask: true, count: 2 })
    const stuck = page(2)
    assert.match(stuck, /Stuck\? Tap Hint for a clue/)
    assert.match(stuck, /<button class="" type="submit">Hint<\/button>/, 'the hint becomes the main action')
    assert.ok(!stuck.includes(`>${String(item.answer)}<`), 'the answer is never shown')
    await useHint(db, u.userId, id, String(item.id))
    const hinted = (await sessionItems(db, id))[0]
    assert.doesNotMatch(page(2, hinted), /Stuck\?/, 'after a hint the prompt to use one goes away')
    // A real try is scored and counts as before.
    const real = await submitAnswer(db, u.userId, id, { itemId: String(item.id), answer: '11' }, now)
    assert.equal('reask' in real, false)
    // A locally keyed question records evidence now; a written one waits for its verdict as before.
    assert.equal((await loadAttempts(db, student)).length, 'pendingReview' in real && real.pendingReview ? 0 : 1)
    assert.equal((await sessionItems(db, id))[0].answered, 1)
  } finally { db.close() }
})
