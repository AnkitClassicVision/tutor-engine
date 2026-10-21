import test from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../src/db.ts'
import { registerUser } from '../src/auth.ts'
import { createStudent, startTutorSession, sessionItems, submitAnswer, loadAttempts, rewriteItem, reviewAnswer } from '../src/services.ts'
import { stampTask, readTask, replaceUnseenTask } from '../src/task-evidence.ts'
import { independent } from '../src/engine/mastery.ts'
import { independentConfidence } from '../src/engine/evidence.ts'
const now = new Date('2026-10-21T12:00:00Z')
async function fixture(mode: 'session' | 'assessment' = 'session') {
  const db = openDb(':memory:')
  const user = await registerUser(db, 'provenance@example.invalid', 'synthetic-password'); assert.ok(user.ok)
  const student = await createStudent(db, user.userId, { displayName: 'Synthetic learner', grade: 3, sessionCapMinutes: 10 }, now)
  const session = await startTutorSession(db, user.userId, student, now, { mode, focusConceptId: 'math.primary.2.add' })
  return { db, owner: user.userId, student, session }
}

test('final delivered metadata survives submit, reload and duplicate retry; confidence is revision-bound', async () => {
  const f = await fixture('assessment')
  try {
    let item = (await sessionItems(f.db, f.session))[0]
    await f.db.prepare("UPDATE session_items SET bloom_level = 1, answer = '4', format = 'text', choices_json = NULL WHERE id = ?").run(item.id)
    await stampTask(f.db, String(item.id), 'builtin')
    item = (await sessionItems(f.db, f.session))[0]
    const task = readTask(item.task_evidence)!
    assert.equal(task.conceptId, item.concept_id); assert.equal(task.demand, item.bloom_level)
    await submitAnswer(f.db, f.owner, f.session, { itemId: String(item.id), answer: String(item.answer), confidence: 'sure' }, now)
    const a = (await loadAttempts(f.db, f.student))[0]
    assert.equal(a.task?.revision, task.revision); assert.ok(independent(a)); assert.ok(independentConfidence(a))
    await submitAnswer(f.db, f.owner, f.session, { itemId: String(item.id), answer: 'stale retry', confidence: 'guess' }, now)
    const repeated = await loadAttempts(f.db, f.student)
    assert.equal(repeated.length, 1); assert.equal(repeated[0].confidence, 'sure')
  } finally { f.db.close() }
})

test('replacements retire their identity, clear discarded rubric/transfer fields and retain planned help', async () => {
  const f = await fixture()
  try {
    let item = (await sessionItems(f.db, f.session))[0]
    await f.db.prepare("UPDATE session_items SET rubric_json = ?, evidence_kind = 'transfer', hints_used = 1, hint_text = 'Earlier support', beat = 'guided' WHERE id = ?")
      .run('{"old":"discarded rubric"}', item.id)
    await stampTask(f.db, String(item.id), 'practice', 'old-source')
    item = (await sessionItems(f.db, f.session))[0]
    await rewriteItem(f.db, item, 1, now)
    const next = (await sessionItems(f.db, f.session))[0]
    assert.notEqual(next.id, item.id)
    assert.equal(next.rubric_json, null); assert.equal(next.evidence_kind, 'practice')
    assert.equal(next.hints_used, 1); assert.equal(next.interleaved, 0)
    assert.equal(f.db.prepare('SELECT skip_reason FROM session_items WHERE id = ?').get(item.id)!.skip_reason, 'replaced_before_display')
    assert.notEqual(readTask(next.task_evidence)!.revision, readTask(item.task_evidence)!.revision)
  } finally { f.db.close() }
})

test('a displayed question, saved draft or assessment cannot be rewritten', async () => {
  const f = await fixture()
  try {
    const item = (await sessionItems(f.db, f.session))[0]
    for (const column of ['shown_at', 'visible_at', 'draft_answer']) {
      await f.db.prepare(`UPDATE session_items SET ${column} = ? WHERE id = ?`).run('synthetic-existing', item.id)
      assert.equal(await replaceUnseenTask(f.db, item, { prompt: 'Changed' }, 'builtin'), null)
      await f.db.prepare(`UPDATE session_items SET ${column} = NULL WHERE id = ?`).run(item.id)
    }
    await f.db.prepare("UPDATE tutor_sessions SET mode = 'assessment' WHERE id = ?").run(f.session)
    assert.equal(await replaceUnseenTask(f.db, item, { prompt: 'Changed' }, 'builtin'), null)
  } finally { f.db.close() }
})

test('pending grading cannot score a changed rubric/revision and duplicate confirmed grading adds no attempt', async () => {
  const f = await fixture('assessment')
  try {
    let item = (await sessionItems(f.db, f.session))[0]
    await f.db.prepare("UPDATE session_items SET answer = 'Explain two reasons', format = 'text', bloom_level = 3 WHERE id = ?").run(item.id)
    await stampTask(f.db, String(item.id), 'designed')
    item = (await sessionItems(f.db, f.session))[0]
    await submitAnswer(f.db, f.owner, f.session, { itemId: String(item.id), answer: 'First reason and second reason.' }, now)
    assert.equal((await loadAttempts(f.db, f.student)).length, 0)
    await assert.rejects(reviewAnswer(f.db, f.owner, f.session, { itemId: String(item.id), revision: 'stale', correct: true }, now), /revision/)
    await f.db.prepare('UPDATE session_items SET rubric_json = ? WHERE id = ?').run('{"changed":true}', item.id)
    await assert.rejects(reviewAnswer(f.db, f.owner, f.session, { itemId: String(item.id), correct: true }, now), /changed after submission/)
    await f.db.prepare('UPDATE session_items SET rubric_json = NULL WHERE id = ?').run(item.id)
    await reviewAnswer(f.db, f.owner, f.session, { itemId: String(item.id), revision: String(item.revision_id), correct: true }, now)
    await reviewAnswer(f.db, f.owner, f.session, { itemId: String(item.id), revision: String(item.revision_id), correct: true }, now)
    assert.equal((await loadAttempts(f.db, f.student)).length, 1)
  } finally { f.db.close() }
})
