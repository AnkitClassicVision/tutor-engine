import test from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../src/db.ts'
import { registerUser } from '../src/auth.ts'
import { createStudent, createTarget, startTutorSession, sessionItems, submitAnswer, reviewAnswer, acknowledgeFeedback, loadAttempts, listStates, missionSummary } from '../src/services.ts'
import { evidenceAnswer, evidenceItem } from './fixtures/evidence-history.ts'
import { componentReady, mixedRelation, mixedArc } from '../src/engine/mixed.ts'
import { loadBackbone } from '../src/engine/graph.ts'
import { missionArc } from '../src/engine/arc.ts'
import type { QueueSlot } from '../src/engine/types.ts'

const roots = ['math.primary.1.add', 'math.primary.1.subtract']
const start = new Date('2026-10-01T12:00:00Z')
async function fixture(ids = roots) {
  const db = openDb(':memory:')
  const user = await registerUser(db, 'mixed@example.invalid', 'synthetic-password'); assert.ok(user.ok)
  const student = await createStudent(db, user.userId, { displayName: 'Synthetic learner', grade: 3, sessionCapMinutes: 10 }, start)
  await createTarget(db, user.userId, student, { title: 'Synthetic bounded scope', deadline: '2026-12-01', conceptIds: ids }, start)
  return { db, student, owner: user.userId }
}
async function finish(f: Awaited<ReturnType<typeof fixture>>, now: Date, show = true) {
  const id = await startTutorSession(f.db, f.owner, f.student, now, { intent: 'practice', durationMinutes: 5 })
  const opening = await sessionItems(f.db, id)
  assert.ok(opening.length <= 6, 'bounded five-minute arc or first-check queue')
  for (let n = 0; n < 12; n++) {
    await acknowledgeFeedback(f.db, f.owner, id)
    const item = (await sessionItems(f.db, id)).find(i => !i.answered)
    if (!item) return id
    const at = new Date(now.getTime() + n * 3000)
    if (show) await f.db.prepare('UPDATE session_items SET visible_at = ? WHERE id = ?').run(at.toISOString(), item.id)
    const result = await submitAnswer(f.db, f.owner, id, { itemId: String(item.id), answer: String(item.answer) }, new Date(at.getTime() + 1000))
    if ('pendingReview' in result && result.pendingReview) await reviewAnswer(f.db, f.owner, id, { itemId: String(item.id), correct: true }, new Date(at.getTime() + 1500))
  }
  throw new Error('Mission failed to finish within its bounded queue')
}

test('cold start rotates two approved related roots and earns Bloom-2 mixed mastery within twelve bounded sessions', async () => {
  const f = await fixture()
  try {
    const selected = new Set<string>()
    for (let n = 0; n < 12; n++) {
      const now = new Date(start.getTime() + n * 86400000)
      const id = await finish(f, now)
      for (const item of await sessionItems(f.db, id)) selected.add(String(item.concept_id))
      const states = await listStates(f.db, f.student, now)
      if (n >= 4 && roots.every(root => (states.find(s => s.conceptId === root)?.bloomLevel ?? 0) >= 2)) break
    }
    assert.ok(roots.every(id => selected.has(id)), 'selection must rotate without seeded history')
    const attempts = await loadAttempts(f.db, f.student)
    for (const id of roots) {
      assert.ok(componentReady(attempts, id, 2), id)
      assert.ok(attempts.some(a => a.conceptId === id && a.bloomLevel === 2 && a.mixed), `missing validated mixed win: ${id}`)
      assert.ok((await listStates(f.db, f.student, new Date('2026-10-06T18:00:00Z'))).find(s => s.conceptId === id)!.bloomLevel >= 2, id)
    }
  } finally { f.db.close() }
})

test('unshown work and a structurally single-concept scope cannot manufacture mixed credit', async () => {
  for (const [ids, show] of [[roots, false], [[roots[0]], true]] as const) {
    const f = await fixture([...ids])
    try {
      let last = ''
      for (let n = 0; n < 6; n++) last = await finish(f, new Date(start.getTime() + n * 86400000), show)
      assert.ok((await loadAttempts(f.db, f.student)).every(a => !a.mixed))
      if (ids.length === 1) {
        assert.ok((await loadAttempts(f.db, f.student)).every(a => a.conceptId === roots[0]))
        assert.match((await missionSummary(f.db, f.owner, last, new Date('2026-10-06T12:00:00Z'))).mixedStatus?.message ?? '', /mixed check not available in this scope/)
      }
    } finally { f.db.close() }
  }
})

test('persisted mixed evidence requires an earlier fresh, visible, approved and timely partner at ready component demands', async () => {
  for (const scenario of ['valid', 'short-pause', 'unshown', 'skipped', 'repeated', 'later-only', 'other-session', 'unrelated', 'wrong-demand', 'long-pause', 'next-day'] as const) {
    const f = await fixture()
    try {
      for (let n = 0; n < 2; n++) for (const concept of [...roots, 'math.primary.2.place'])
        await evidenceAnswer(f.db, f.owner, f.student, `${scenario}-ready-${concept}-${n}`, new Date(start.getTime() + n * 86400000), { concept, legacy: true })
      const at = new Date('2026-10-04T12:00:00Z')
      const delay = scenario === 'short-pause' ? 10 * 60000 : scenario === 'long-pause' ? 31 * 60000 : scenario === 'next-day' ? 86400000 : 5000
      const partner = await evidenceItem(f.db, f.student, `${scenario}-partner`, at, {
        concept: scenario === 'unrelated' ? 'math.primary.2.place' : roots[1], mode: 'session', show: scenario !== 'unshown',
        prompt: scenario === 'repeated' ? `Synthetic fresh question ${scenario}-ready-${roots[1]}-0` : undefined,
        position: scenario === 'later-only' ? 2 : 1,
      })
      const target = await evidenceItem(f.db, f.student, `${scenario}-target`, new Date(at.getTime() + delay), {
        concept: roots[0], level: scenario === 'wrong-demand' ? 3 : 2, mode: 'session',
        session: scenario === 'other-session' ? undefined : String(partner.session_id), position: scenario === 'later-only' || scenario === 'other-session' ? 1 : 2,
      })
      if (scenario === 'skipped') await f.db.prepare("UPDATE session_items SET skipped = 1, skip_reason = 'learner_skip' WHERE id = ?").run(partner.id)
      if (scenario !== 'skipped' && scenario !== 'later-only') await submitAnswer(f.db, f.owner, String(partner.session_id), { itemId: String(partner.id), answer: '4' }, new Date(at.getTime() + 1000))
      // A resumed mission's active timer can move forward; mixed context still expires on wall-clock time.
      await f.db.prepare('UPDATE tutor_sessions SET started_at = ?, ended_at = NULL WHERE id = ?').run(new Date(at.getTime() + delay).toISOString(), target.session_id)
      await acknowledgeFeedback(f.db, f.owner, String(target.session_id))
      await submitAnswer(f.db, f.owner, String(target.session_id), { itemId: String(target.id), answer: '4' }, new Date(at.getTime() + delay + 1000))
      const attempt = (await loadAttempts(f.db, f.student)).find(a => a.attemptId === target.id)
      assert.ok(attempt, `${scenario} must reach scoring`)
      assert.equal(Boolean(attempt.mixed), scenario === 'valid' || scenario === 'short-pause', scenario)
      if (scenario === 'valid') {
        assert.equal(attempt.mixed!.partnerItemId, partner.id); assert.equal(attempt.mixed!.partnerRevision, partner.revision_id)
        await f.db.prepare('UPDATE session_items SET disputed = 1 WHERE id = ?').run(partner.id)
        assert.equal((await loadAttempts(f.db, f.student)).find(a => a.attemptId === target.id)!.mixed, undefined, 'a disputed partner withdraws dependent credit')
      }
    } finally { f.db.close() }
  }
})

test('positive relations and three/five/ten minute budgets never invent a pair or drop due review', () => {
  const graph = loadBackbone()
  assert.ok(mixedRelation(graph, roots[0], roots[1]))
  assert.equal(mixedRelation(graph, roots[0], roots[0]), null)
  assert.equal(mixedRelation(graph, roots[0], 'unknown'), null)
  const target: QueueSlot = { conceptId: roots[0], bloomLevel: 2, beat: 'frontier', interleaved: false, partnerConceptId: null, scored: true }
  const review: QueueSlot = { ...target, conceptId: roots[1], beat: 'warmup' }
  for (const minutes of [3,5,10]) {
    const arc = missionArc([review, ...Array.from({ length: 8 }, () => target)], minutes)
    const actual = mixedArc(arc, target, { conceptId: roots[1], bloom: 2 }, minutes)
    assert.ok(actual.length <= arc.length)
    assert.ok(actual.some(s => s.beat === 'review' && s.conceptId === roots[1]))
    assert.ok(actual.filter(s => !['guided','faded'].includes(s.beat)).length <= arc.filter(s => !['guided','faded'].includes(s.beat)).length)
  }
})
