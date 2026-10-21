import test from 'node:test'
import assert from 'node:assert/strict'
import { loadBackbone } from '../src/engine/graph.ts'
import { checkedFractionExample, fractionScaffold, fractionCaseKeys, readScaffold } from '../src/engine/scaffolds.ts'
import { evaluate } from '../src/pack-qa.ts'
import { openDb } from '../src/db.ts'
import { registerUser } from '../src/auth.ts'
import { createStudent, createTarget, startTutorSession, sessionItems, acknowledgeFeedback, submitAnswer, reviewAnswer, loadAttempts, resumeSession } from '../src/services.ts'
import { evidenceAnswer } from './fixtures/evidence-history.ts'
import { lessonCard } from '../src/view.ts'
import { readTask, taskMatches, replaceUnseenTask } from '../src/task-evidence.ts'
import { recordExposure } from '../src/learning-exposure.ts'
import { freshEvidence } from '../src/engine/mastery.ts'
import type { BloomLevel } from '../src/engine/types.ts'

const graph = loadBackbone()
test('fraction worked examples contain correct intermediate values and reasons, and completion retains each thinking demand', () => {
  for (const id of ['math.5.nf.a.1', 'math.4.nf.b.3', 'math.4.nf.a.1', 'math.4.nf.a.2']) {
    const concept = graph.nodes.get(id)!
    for (let seed = 1; seed <= 80; seed++) {
      const worked = checkedFractionExample(concept, seed)!
      assert.ok(worked)
      const pairs = [...worked.problem.matchAll(/(\d+)\/(\d+)/g)].map(m => Number(m[1]) / Number(m[2]))
      const answer = evaluate(worked.answer)!
      const expected = id === 'math.4.nf.a.1' ? pairs[0] : id === 'math.4.nf.a.2' ? Math.max(...pairs) : pairs[0] + pairs[1]
      assert.ok(Math.abs(answer.n / answer.d - expected) < 1e-12)
      for (const step of worked.steps) {
        assert.ok(/\d/.test(step.work), 'a worked step must include actual values, not only a direction')
        assert.ok(step.reason.length > 25)
        for (const line of step.work.split('; ')) {
          if (!/^[\d\s/=+×÷.]+$/.test(line) || !line.includes('=')) continue
          const values = line.split('=').map(evaluate)
          assert.ok(values.every(Boolean))
          assert.ok(values.every(value => value!.n * values[0]!.d === values[0]!.n * value!.d), line)
        }
      }
    }
    for (let level = 1; level <= 6; level++) {
      const guided = fractionScaffold(concept, level as BloomLevel, 325, false)!
      const faded = fractionScaffold(concept, level as BloomLevel, 325, true)!
      assert.notEqual(guided.caseKeys[0], guided.caseKeys[1], 'the completed example and unfinished problem differ')
      assert.equal(guided.task.bloom, level)
      assert.ok(guided.task.prompt.length > faded.task.prompt.length, 'faded work supplies fewer completed steps')
      if (level === 1) { assert.equal(guided.task.format, 'steps'); assert.match(guided.task.answer, /no final calculation is required/i) }
      if (level === 2) { assert.equal(guided.task.format, 'choice'); assert.ok(guided.task.choices!.includes(guided.task.answer)) }
      if (level === 3) assert.ok(evaluate(guided.task.answer))
      if (level >= 4) { assert.match(guided.task.answer, /^Rubric:/); assert.equal(guided.task.format, 'text') }
      if (level === 6) assert.match(guided.task.answer, /create a new problem, not a copy/i)
    }
  }
  assert.equal(checkedFractionExample({ ...graph.nodes.get('math.5.nf.a.1')!, conceptId: 'custom.unchecked' }, 1), null)
  assert.deepEqual(fractionCaseKeys('Add 1/2 + 1/3.'), fractionCaseKeys('Find 2 / 6 + 2 / 4.'))
})

test('a delivered fractions mission separates worked, completion and fresh independent work across save/resume', async () => {
  const db = openDb(':memory:')
  try {
    const user = await registerUser(db, 'scaffolds@example.invalid', 'synthetic-password'); assert.ok(user.ok)
    const owner = user.userId, now = new Date(), conceptId = 'math.5.nf.a.1'
    const student = await createStudent(db, owner, { displayName: 'Synthetic learner', grade: 5, sessionCapMinutes: 10 })
    await createTarget(db, owner, student, { title: 'Synthetic fraction scope', conceptIds: [conceptId], deadline: new Date(now.getTime() + 86400000).toISOString().slice(0,10) })
    for (let index = 0; index < 3; index++) await evidenceAnswer(db, owner, student, `scaffold-prior-${index}`, new Date(now.getTime() - (3-index)*60000), { concept: conceptId, level: 3, correct: index !== 2 })
    const first = await startTutorSession(db, owner, student, now, { intent: 'practice', focusConceptId: conceptId, durationMinutes: 5 })
    const original = await sessionItems(db, first)
    assert.deepEqual(original.slice(0,2).map(i => i.beat), ['guided', 'faded'])
    assert.ok(original.every(i => Number(i.bloom_level) >= 3), 'support does not silently reduce a demonstrated application task to understanding')
    const scaffolds = original.slice(0,2).map(i => readScaffold(i.scaffold_json)!)
    assert.ok(scaffolds.every(Boolean))
    const cases = new Set(scaffolds.flatMap(s => s.caseKeys))
    assert.equal(cases.size, 4)
    for (const item of original.slice(2)) {
      assert.equal(item.hints_used, 0)
      assert.equal(item.scaffold_json, null)
      assert.ok(fractionCaseKeys(String(item.prompt)).every(key => !cases.has(key)), 'independent work must not copy a taught calculation')
    }
    const lesson = lessonCard(first, graph.nodes.get(conceptId)!, scaffolds[0])
    assert.ok(lesson.includes(scaffolds[0].worked.problem))
    assert.ok(!lesson.includes(scaffolds[0].task.prompt))
    assert.match(lesson, /A worked example/)
    assert.ok(taskMatches(original[0]))
    assert.equal(taskMatches({ ...original[0], scaffold_json: JSON.stringify({ ...scaffolds[0], worked: { ...scaffolds[0].worked, answer: 'wrong' } }) }), false)
    await recordExposure(db, student, first, original[0], 'lesson', now)
    assert.equal(await replaceUnseenTask(db, original[0], { prompt: 'Replacement after a displayed lesson' }, 'builtin'), null)
    // An interrupted lesson retains its exact worked content and completion task when carried forward.
    await db.prepare("UPDATE tutor_sessions SET ended_at=?, end_reason='attention' WHERE id=?").run(now.toISOString(), first)
    const resumed = await resumeSession(db, owner, first, 5)
    const carried = await sessionItems(db, resumed)
    assert.equal(carried[0].scaffold_json, original[0].scaffold_json)
    assert.equal(carried[0].revision_id, original[0].revision_id)
    assert.equal((await db.prepare('SELECT lesson_done FROM tutor_sessions WHERE id=?').get(resumed))!.lesson_done, 0)
    const ids = new Set<string>()
    for (const item of carried) {
      await acknowledgeFeedback(db, owner, resumed)
      const shown = new Date()
      await db.prepare('UPDATE session_items SET shown_at=?, visible_at=? WHERE id=?').run(shown.toISOString(), shown.toISOString(), item.id)
      await recordExposure(db, student, resumed, item, 'question', shown, true)
      const result = await submitAnswer(db, owner, resumed, { itemId: String(item.id), revision: String(item.revision_id), answer: String(item.answer) })
      if ('pendingReview' in result && result.pendingReview) await reviewAnswer(db, owner, resumed, { itemId: String(item.id), correct: true })
      ids.add(String(item.id))
    }
    const attempts = (await loadAttempts(db, student)).filter(a => ids.has(a.attemptId))
    assert.ok(attempts.slice(0,2).every(a => a.hintsUsed > 0))
    assert.equal(freshEvidence(attempts).length, carried.length - 2, 'ordinary prior instruction does not mark different unaided tasks as helped')
    assert.equal(readTask(carried[0].task_evidence)!.demand, Number(carried[0].bloom_level))
    const next = await startTutorSession(db, owner, student, new Date(), { intent: 'practice', focusConceptId: conceptId, durationMinutes: 5 })
    assert.ok(!(await sessionItems(db, next)).some(i => ['guided','faded'].includes(String(i.beat))), 'demonstrated independent success skips needless scaffolds')
  } finally { db.close() }
})
