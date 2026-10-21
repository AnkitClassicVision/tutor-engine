import test from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../src/db.ts'
import { registerUser } from '../src/auth.ts'
import { createStudent, createTarget, startTutorSession, sessionItems, submitAnswer, loadAttempts, acknowledgeFeedback, reviewAnswer, practiceRefreshContext, applyCurriculum } from '../src/services.ts'
import { FreshPracticeRequired, parseFreshPractice } from '../src/fresh-practice.ts'
import { evidenceAnswer } from './fixtures/evidence-history.ts'
import { comparable, retentionPairs } from '../src/engine/evidence.ts'
import { readTask } from '../src/task-evidence.ts'

test('automatic due work survives practice substitution with the prior concept, demand, role and response form', async () => {
  for (const minutes of [3,5,10]) {
    const db = openDb(':memory:')
    try {
      const user = await registerUser(db, 'due@example.invalid', 'synthetic-password'); assert.ok(user.ok)
      const owner = user.userId, now = new Date('2026-10-20T12:00:00Z'), earlier = new Date('2026-10-04T12:00:00Z')
      const student = await createStudent(db, owner, { displayName: 'Synthetic learner', grade: 3, sessionCapMinutes: 10 }, earlier)
      const concept = 'math.primary.1.add'
      await createTarget(db, owner, student, { title: 'Bounded synthetic scope', conceptIds: [concept, 'math.primary.1.subtract'], deadline: '2026-12-01' }, earlier)
      await evidenceAnswer(db, owner, student, 'prior-due', earlier)
      for (const [id, level, kind, format] of [['harder',6,'practice','text'], ['transfer',2,'transfer','text'], ['different-form',2,'practice','choice'], ['matching',2,'practice','text']] as const) {
        await db.prepare(`INSERT INTO practice_items (id,student_id,concept_id,prompt,answer,bloom_level,created_at,evidence_kind,format) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(id, student, concept, `There are four synthetic counters in the ${id} group. How many counters?`, '4', level, earlier.toISOString(), kind, format)
      }
      const session = await startTutorSession(db, owner, student, now, { intent: 'practice', durationMinutes: minutes })
      const [item] = await sessionItems(db, session)
      assert.equal(item.beat, 'review'); assert.equal(item.concept_id, concept); assert.equal(item.bloom_level, 2)
      assert.equal(item.evidence_kind, 'practice'); assert.equal(item.hints_used, 0); assert.equal(item.evidence_purpose, 'delayed-check')
      assert.equal(readTask(item.task_evidence)!.sourceId, 'matching'); assert.equal(readTask(item.task_evidence)!.responseForm, 'number')
      await db.prepare('UPDATE session_items SET shown_at=?,visible_at=? WHERE id=?').run(now.toISOString(), now.toISOString(), item.id)
      await submitAnswer(db, owner, session, { itemId: String(item.id), answer: '4' }, new Date(now.getTime()+1000))
      const attempts = await loadAttempts(db, student)
      const due = attempts.find(a => a.attemptId === item.id)!
      assert.equal(comparable(attempts[0], due), 'historical-proxy')
      assert.equal(retentionPairs(attempts)[0].after.attemptId, item.id)
    } finally { db.close() }
  }
})

test('an incompatible fallback leaves the due check pending and a constrained refresh makes matching work reachable', async () => {
  const db = openDb(':memory:')
  try {
    const user = await registerUser(db, 'due-refresh@example.invalid', 'synthetic-password'); assert.ok(user.ok)
    const owner = user.userId, earlier = new Date('2026-10-04T12:00:00Z'), now = new Date('2026-10-20T12:00:00Z')
    const student = await createStudent(db, owner, { displayName: 'Synthetic learner', grade: 3, sessionCapMinutes: 10 }, earlier)
    await createTarget(db, owner, student, { title: 'Synthetic bounded scope', conceptIds: ['math.primary.1.add'], deadline: '2026-12-01' }, earlier)
    await evidenceAnswer(db, owner, student, 'numeric-understanding-baseline', earlier)
    const before = (await db.prepare('SELECT count(*) n FROM tutor_sessions WHERE student_id=?').get(student))!.n
    let required: FreshPracticeRequired | undefined
    await assert.rejects(startTutorSession(db, owner, student, now, { intent:'practice',durationMinutes:5 }), error => {
      assert.ok(error instanceof FreshPracticeRequired); required = error; return true
    })
    assert.deepEqual(required!.comparison, { demand:2,responseForm:'number' })
    assert.equal((await db.prepare('SELECT count(*) n FROM tutor_sessions WHERE student_id=?').get(student))!.n, before, 'failed generation must not create an empty mission')
    const context = await practiceRefreshContext(db, owner, student, required!.conceptId, required!.comparison)
    const raw = { questions: [4,5,6,7].map(n => ({ prompt:`Which number shows the total in a group of ${n-2} and a group of two?`,answer:String(n),bloomLevel:2,format:'text' })) }
    for (const patch of [{bloomLevel:3},{transfer:true},{format:'steps'}]) assert.throws(()=>parseFreshPractice(JSON.stringify({questions:raw.questions.map(q=>({...q,...patch}))}),context), /comparable/)
    const questions = parseFreshPractice(JSON.stringify(raw),context)
    await applyCurriculum(db,owner,student,context.concept.subject,[{...context.concept,conceptId:context.concept.conceptId,questions}],now)
    const session = await startTutorSession(db,owner,student,now,{intent:'practice',durationMinutes:5})
    const [item] = await sessionItems(db,session)
    assert.equal(item.beat,'review'); assert.equal(readTask(item.task_evidence)!.responseForm,'number'); assert.equal(item.bloom_level,2)
    assert.equal(item.concept_id,context.concept.conceptId); assert.equal(item.evidence_kind,'practice')
  } finally { db.close() }
})

test('a due opening also supplies a real mixed component without increasing a five-minute budget', async () => {
  const db = openDb(':memory:')
  try {
    const user = await registerUser(db, 'due-pair@example.invalid', 'synthetic-password'); assert.ok(user.ok)
    const owner = user.userId, now = new Date('2026-10-20T12:00:00Z')
    const student = await createStudent(db, owner, { displayName: 'Synthetic learner', grade: 3, sessionCapMinutes: 10 }, now)
    const roots = ['math.primary.1.add','math.primary.1.subtract']
    await createTarget(db, owner, student, { title: 'Synthetic inverse pair', conceptIds: roots, deadline: '2026-12-01' }, now)
    for (const concept of roots) for (const n of [1,2]) await evidenceAnswer(db, owner, student, `${concept}-ready-${n}`, new Date(`2026-10-0${n}T12:00:00Z`), { concept, legacy: true })
    const session = await startTutorSession(db, owner, student, now, { intent: 'practice', durationMinutes: 5 })
    const items = await sessionItems(db, session)
    assert.equal(items[0].beat, 'review'); assert.equal(items.length, 2)
    assert.notEqual(items[0].concept_id, items[1].concept_id)
    for (let i = 0; i < items.length; i++) {
      const at = new Date(now.getTime() + i * 5000)
      await db.prepare('UPDATE session_items SET shown_at=?,visible_at=? WHERE id=?').run(at.toISOString(), at.toISOString(), items[i].id)
      const result = await submitAnswer(db, owner, session, { itemId: String(items[i].id), answer: String(items[i].answer) }, new Date(at.getTime()+1000))
      if ('pendingReview' in result && result.pendingReview) await reviewAnswer(db, owner, session, { itemId: String(items[i].id), correct: true }, new Date(at.getTime()+2000))
      await acknowledgeFeedback(db, owner, session)
    }
    assert.ok((await loadAttempts(db, student)).find(a => a.attemptId === items[1].id)?.mixed)
  } finally { db.close() }
})
