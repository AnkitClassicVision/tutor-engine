import assert from 'node:assert/strict'
import { stampTask } from '../src/task-evidence.ts'
import test from 'node:test'
import { openDb } from '../src/db.ts'
import { registerUser } from '../src/auth.ts'
import { gradePendingResponses } from '../src/server.ts'
import { initialState, emptyState, reduceState, masteryMet, freshEvidence, workingBloom } from '../src/engine/mastery.ts'
import { learningMilestones } from '../src/engine/adventure.ts'
import { inferError } from '../src/engine/diagnose.ts'
import { loadBackbone } from '../src/engine/graph.ts'
import { createStudent, startTutorSession, sessionItems, submitAnswer, reviewAnswer, useHint, loadAttempts, listStates, rollingSix, adventureFor, missionSummary, pauseSession, resumeSession, createSheet, scoreSheet } from '../src/services.ts'
import type { AttemptRecord } from '../src/engine/types.ts'

const base: AttemptRecord = { attemptId: '1', studentId: 's', sessionId: 'a', conceptId: 'fractions', bloomLevel: 3, day: '2026-10-01', correct: true, hintsUsed: 0, interleaved: false, timeMs: 1000, errorType: null, modality: 'screen', evidenceCertainty: 'confirmed', supportUsed: 'none' }
const wins: AttemptRecord[] = [base, { ...base, attemptId: '2' }, { ...base, attemptId: '3', sessionId: 'b', day: '2026-10-02', interleaved: true }]
async function fixture() {
  const db = openDb(':memory:')
  const u = await registerUser(db, 'adaptive@example.com', 'synthetic-password')
  assert.ok(u.ok)
  const student = await createStudent(db, u.userId, { displayName: 'Synthetic learner', grade: 8, sessionCapMinutes: 25 })
  return { db, owner: u.userId, student }
}
const now = new Date()

test('placement is provisional even for older learners; advanced content and topic ability remain separate', () => {
  const graph = loadBackbone()
  const node = graph.nodes.get('math.4.nf.a.1')!
  assert.deepEqual(initialState(node, 9, '2026-10-01'), { ...emptyState(node.conceptId, '2026-10-01'), placement: 'provisional' })
  assert.equal(reduceState('fractions', wins, '2026-10-02', 'screen').bloomLevel, 3)
  assert.equal(reduceState('algebra', wins, '2026-10-02', 'screen').bloomLevel, 0)
})

test('support, uncertain verdicts and repeated prompts cannot establish mastery or delayed retention', () => {
  assert.equal(masteryMet(wins, 3), true)
  for (const field of [{ hintsUsed: 1 }, { supportUsed: 'homework' as const }, { evidenceCertainty: 'unresolved' as const }, { promptKey: 'same prompt' }]) assert.equal(masteryMet(wins.map(w => ({ ...w, ...field })), 3), false)
  assert.equal(freshEvidence([{ ...base, hintsUsed: 1, promptKey: 'same' }, { ...base, attemptId: '2', promptKey: 'same' }]).length, 0)
  const delayedMiss = { ...base, attemptId: '4', day: '2026-10-10', correct: false }
  assert.equal(reduceState('fractions', [...wins, delayedMiss], '2026-10-10', 'screen').status, 'review_due')
})

test('milestones have stable unique IDs, preserve supported steps and distinguish understanding, application and retention', () => {
  const understanding = wins.map(a => ({ ...a, attemptId: `u${a.attemptId}`, bloomLevel: 2 as const }))
  const delayed = { ...base, attemptId: '4', day: '2026-10-10', sessionId: 'c' }
  const attempts = [...wins, ...understanding, delayed]
  const milestones = learningMilestones(attempts)
  assert.deepEqual(new Set(milestones.map(m => m.kind)), new Set(['learning_step', 'understanding', 'application', 'retention']))
  assert.deepEqual(learningMilestones([...attempts, { ...delayed, attemptId: '5', day: '2026-10-11' }]).map(m => m.id), milestones.map(m => m.id))
  assert.deepEqual(learningMilestones([{ ...base, hintsUsed: 3 }]).map(m => m.kind), ['learning_step'])
})

test('long and slow errors remain uncertain rather than decoding or attention diagnoses', () => {
  assert.equal(inferError({ raw: 'A lengthy attempt with more than twelve words that still might contain thoughtful work and reasoning', correct: false, timeMs: 100000, medianTimeMs: 1000, sameWrongAnswerSeen: false, lateInSession: true }), null)
})

test('early difficulty teaches and probes one prerequisite, preserves history, then returns to the selected topic', async () => {
  const f = await fixture()
  try {
    const concept = 'math.5.nf.a.1'
    const id = await startTutorSession(f.db, f.owner, f.student, now, { focusConceptId: concept })
    const original = await sessionItems(f.db, id)
    await f.db.prepare("UPDATE session_items SET prompt = 'Fresh addition check', answer = '4' WHERE id = ?").run(original[0].id)
    await stampTask(f.db, String(original[0].id), 'builtin')
    await submitAnswer(f.db, f.owner, id, { itemId: String(original[0].id), answer: '5' }, now)
    const items = await sessionItems(f.db, id)
    assert.equal(items[0].given_answer, '5')
    assert.notEqual(items[1].concept_id, concept)
    assert.equal(items[2].concept_id, concept)
    const feedback = JSON.parse(String((await f.db.prepare('SELECT pending_feedback FROM tutor_sessions WHERE id = ?').get(id))!.pending_feedback))
    assert.match(feedback.corrective.move, /Example:/)
    assert.equal(feedback.errorType, null)
    await pauseSession(f.db, f.owner, id)
    assert.equal(await resumeSession(f.db, f.owner, id), id)
    assert.deepEqual((await sessionItems(f.db, id)).map(i => i.id), items.map(i => i.id))
  } finally { f.db.close() }
})

test('supported success, duplicate submissions and repeated wording do not inflate independent progress', async () => {
  const f = await fixture()
  try {
    const id = await startTutorSession(f.db, f.owner, f.student, now, { goal: 'harder_probe', focusConceptId: 'math.primary.3.multiply' })
    const items = await sessionItems(f.db, id)
    await f.db.prepare("UPDATE session_items SET prompt = 'Unique synthetic question', answer = '4', bloom_level = 3 WHERE id = ?").run(items[0].id)
    await stampTask(f.db, String(items[0].id), 'builtin')
    await useHint(f.db, f.owner, id, String(items[0].id))
    await submitAnswer(f.db, f.owner, id, { itemId: String(items[0].id), answer: '4' }, now)
    await submitAnswer(f.db, f.owner, id, { itemId: String(items[0].id), answer: '4' }, now)
    await f.db.prepare("UPDATE session_items SET prompt = 'Unique synthetic question', answer = '4', bloom_level = 3 WHERE id = ?").run(items[1].id)
    await stampTask(f.db, String(items[1].id), 'builtin')
    await submitAnswer(f.db, f.owner, id, { itemId: String(items[1].id), answer: '4' }, new Date(now.getTime() + 1000))
    assert.equal((await loadAttempts(f.db, f.student)).length, 2)
    assert.equal((await missionSummary(f.db, f.owner, id)).independent, 0)
    assert.equal((await adventureFor(f.db, f.owner, f.student)).length, 1)
    assert.equal((await listStates(f.db, f.student)).find(s => s.conceptId === items[0].concept_id)!.bloomLevel, 0)
    assert.deepEqual(await rollingSix(f.db, f.student, String(items[0].concept_id), 3), [])
    const other = await registerUser(f.db, 'other-adaptive@example.com', 'synthetic-password')
    assert.ok(other.ok)
    await assert.rejects(adventureFor(f.db, other.userId, f.student), /Student not found/)
  } finally { f.db.close() }
})

test('pending grading remains unresolved; reviewed provenance is explicit and does not mutate old submissions', async () => {
  const f = await fixture()
  try {
    const id = await startTutorSession(f.db, f.owner, f.student, now)
    const item = (await sessionItems(f.db, id))[0]
    await f.db.prepare("UPDATE session_items SET answer = 'Rubric: explain the method', bloom_level = 2 WHERE id = ?").run(item.id)
    await stampTask(f.db, String(item.id), 'designed')
    await submitAnswer(f.db, f.owner, id, { itemId: String(item.id), answer: 'I explained it' }, now)
    assert.equal((await missionSummary(f.db, f.owner, id)).unresolved, 1)
    assert.equal((await loadAttempts(f.db, f.student)).length, 0)
    await reviewAnswer(f.db, f.owner, id, { itemId: String(item.id), correct: true }, new Date(now.getTime() + 1000))
    const evidence = (await loadAttempts(f.db, f.student))[0]
    assert.equal(evidence.attemptId, String(item.id))
    assert.equal(evidence.evidenceCertainty, 'confirmed')
    assert.equal((await sessionItems(f.db, id))[0].given_answer, 'I explained it')
  } finally { f.db.close() }
})

test('paper scoring retains prompt provenance and is idempotent', async () => {
  const f = await fixture()
  try {
    const sheet = await createSheet(f.db, f.owner, f.student, now)
    const payload = JSON.parse(String((await f.db.prepare('SELECT spec_json FROM sheets WHERE id = ?').get(sheet))!.spec_json))
    const apply = payload.items.find((i: any) => i.bloomLevel === 3)
    const box = payload.spec.boxes.find((b: any) => b.itemId === apply.itemId)
    await scoreSheet(f.db, f.owner, sheet, [{ boxIndex: box.boxIndex, answer: apply.answer }], now, { version: 1, basis: 'self-reported', help: 'none', confirmed: true })
    const before = await loadAttempts(f.db, f.student)
    await scoreSheet(f.db, f.owner, sheet, [{ boxIndex: 0, answer: 'different' }], now)
    assert.deepEqual(await loadAttempts(f.db, f.student), before)
    assert.ok(before.length)
    assert.ok(before.every(a => a.promptKey && a.evidenceCertainty === 'confirmed'))
  } finally { f.db.close() }
})

test('early practice cannot postpone a seven-day retention check; a delayed miss needs review', () => {
  const state = reduceState('fractions', wins, '2026-10-02', 'screen')
  assert.equal(state.nextDue, '2026-10-09')
  const early = { ...base, attemptId: 'early', sessionId: 'c', day: '2026-10-03' }
  assert.equal(reduceState('fractions', [...wins, early], '2026-10-03', 'screen').nextDue, '2026-10-09')
  const miss = { ...base, attemptId: 'miss', sessionId: 'd', day: '2026-10-09', correct: false }
  const easier = { ...base, attemptId: 'easy', sessionId: 'd', day: '2026-10-09', createdAt: '2026-10-09T15:00:00Z', bloomLevel: 2 as const }
  assert.equal(reduceState('fractions', [...wins, early, miss, easier], '2026-10-09', 'screen').status, 'review_due')
})

test('current projections preserve earlier placement records and ambiguous historical attempts', async () => {
  const f = await fixture()
  try {
    const concept = 'math.primary.3.multiply'
    await f.db.prepare("UPDATE learner_states SET bloom_level = 2, mastery = 1, status = 'mastered' WHERE student_id = ? AND concept_id = ?").run(f.student, concept)
    const historical = await f.db.prepare('SELECT * FROM learner_states WHERE student_id = ? AND concept_id = ?').get(f.student, concept)
    const id = await startTutorSession(f.db, f.owner, f.student, now, { focusConceptId: concept, goal: 'harder_probe' })
    const item = (await sessionItems(f.db, id))[0]
    await submitAnswer(f.db, f.owner, id, { itemId: String(item.id), answer: String(item.answer) }, now)
    assert.deepEqual(await f.db.prepare('SELECT * FROM learner_states WHERE student_id = ? AND concept_id = ?').get(f.student, concept), historical)
    assert.equal((await listStates(f.db, f.student)).find(s => s.conceptId === concept)!.bloomLevel, 0)
    assert.equal((await loadAttempts(f.db, f.student)).length, 1)
  } finally { f.db.close() }
})

test('a harder success raises provisional working demand without awarding multi-day mastery', async () => {
  const state = reduceState('fractions', [base], '2026-10-01', 'screen')
  assert.equal(state.bloomLevel, 0)
  assert.equal(state.placement, 'provisional')
  assert.equal(workingBloom(state), 3)
  const misses = Array.from({ length: 6 }, (_, i) => ({ ...base, attemptId: `miss-${i}`, createdAt: `2026-10-02T12:00:0${i}Z`, correct: false, day: '2026-10-02' }))
  assert.equal(workingBloom(reduceState('fractions', [base, ...misses], '2026-10-02', 'screen')), 2)
  const f = await fixture()
  try {
    const focus = 'math.primary.3.multiply'
    const id = await startTutorSession(f.db, f.owner, f.student, now, { focusConceptId: focus, goal: 'harder_probe' })
    const item = (await sessionItems(f.db, id))[0]
    await submitAnswer(f.db, f.owner, id, { itemId: String(item.id), answer: String(item.answer) }, now)
    const next = await startTutorSession(f.db, f.owner, f.student, now, { focusConceptId: focus })
    assert.equal((await sessionItems(f.db, next))[0].bloom_level, 3)
    assert.equal((await listStates(f.db, f.student)).find(s => s.conceptId === focus)!.bloomLevel, 0)
  } finally { f.db.close() }
})

test('unanswered paper is not graded and an empty typed reply is asked again, without affecting placement', async () => {
  const f = await fixture()
  try {
    const sheet = await createSheet(f.db, f.owner, f.student, now)
    const results = await scoreSheet(f.db, f.owner, sheet, [], now)
    assert.ok(results.every(r => r.unanswered && !r.pendingReview))
    assert.equal((await loadAttempts(f.db, f.student)).length, 0)
    const id = await startTutorSession(f.db, f.owner, f.student, now, { goal: 'harder_probe', focusConceptId: 'math.primary.3.multiply' })
    const item = (await sessionItems(f.db, id))[0]
    await submitAnswer(f.db, f.owner, id, { itemId: String(item.id), answer: '?' }, now)
    let calls = 0
    await gradePendingResponses(f.db, f.owner, id, async () => { calls++; throw new Error('Unreadable work must not reach the grader') })
    assert.equal(calls, 0)
    assert.equal((await missionSummary(f.db, f.owner, id)).unresolved, 0, 'a typed "?" is not a try, so nothing waits for a verdict')
    assert.equal((await sessionItems(f.db, id))[0].answered, 0, 'the same question is asked again')
    assert.equal((await loadAttempts(f.db, f.student)).length, 0)
  } finally { f.db.close() }
})
