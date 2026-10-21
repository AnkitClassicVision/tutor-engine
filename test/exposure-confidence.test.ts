import test from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../src/db.ts'
import { registerUser } from '../src/auth.ts'
import { createStudent, loadAttempts, captureConfidence, submitAnswer, useHint } from '../src/services.ts'
import { recordExposure } from '../src/learning-exposure.ts'
import { independentConfidence, retentionPairs } from '../src/engine/evidence.ts'
import { evidenceAnswer, evidenceItem } from './fixtures/evidence-history.ts'
import { experimentReport, setExperiment, isoWeek } from '../src/experiments.ts'
const day = (n: number) => new Date(`2026-10-${String(n).padStart(2,'0')}T12:00:00Z`)
async function fixture() {
  const db = openDb(':memory:')
  const u = await registerUser(db, 'exposure@example.invalid', 'synthetic-password'); assert.ok(u.ok)
  const student = await createStudent(db, u.userId, { displayName: 'Synthetic learner', grade: 3, sessionCapMinutes: 25 }, day(1))
  return { db, owner: u.userId, student }
}
test('actual exposure gaps distinguish later review from unrefreshed checks, including related partners and unknown delivery', async () => {
  for (const kind of ['none', 'lesson', 'hint', 'failed', 'pending', 'partner', 'unknown', 'old-writer', 'replayed-feedback'] as const) {
    const f = await fixture()
    try {
      const first = await evidenceAnswer(f.db, f.owner, f.student, `first-${kind}`, day(4))
      if (kind === 'failed' || kind === 'pending' || kind === 'old-writer') await evidenceAnswer(f.db, f.owner, f.student, `middle-${kind}`, day(11), { correct: false, pending: kind === 'pending', legacy: kind === 'old-writer' })
      else if (kind === 'replayed-feedback') {
        await recordExposure(f.db, f.student, String(first.session_id), first, 'feedback', new Date(day(4).getTime()+3000), true)
        await recordExposure(f.db, f.student, String(first.session_id), first, 'feedback', day(11), true)
        assert.equal((await f.db.prepare("SELECT count(*) n FROM learning_exposures WHERE item_id=? AND kind='feedback'").get(first.id))!.n, 2, 'later redisplay must preserve both exposure events')
      }
      else if (kind !== 'none') {
        const item = await evidenceItem(f.db, f.student, `middle-${kind}`, day(11), { show: false, concept: kind === 'partner' ? 'math.primary.1.subtract' : undefined })
        await recordExposure(f.db, f.student, String(item.session_id), item, kind === 'lesson' || kind === 'hint' ? kind : 'question', day(11), kind !== 'unknown')
      }
      await evidenceAnswer(f.db, f.owner, f.student, `later-${kind}`, day(12))
      const pairs = retentionPairs(await loadAttempts(f.db, f.student))
      assert.equal(pairs.length, 1, kind); assert.equal(pairs[0].unrefreshed, kind === 'none', kind)
      assert.equal(pairs[0].before.day, '2026-10-04'); assert.equal(pairs[0].comparison, 'historical-proxy')
      if (kind === 'unknown') {
        await evidenceAnswer(f.db, f.owner, f.student, 'known-new-anchor', day(13))
        await evidenceAnswer(f.db, f.owner, f.student, 'later-known-gap', day(22))
        assert.equal(retentionPairs(await loadAttempts(f.db, f.student))[0].unrefreshed, true, 'an earlier unknown display cannot contaminate every later known interval')
      }
    } finally { f.db.close() }
  }
})

test('confidence retains its expressed value but excludes help at either capture or answer and fences stale revisions', async () => {
  for (const order of ['confidence-hint', 'hint-confidence', 'unaided'] as const) {
    const f = await fixture()
    try {
      const item = await evidenceItem(f.db, f.student, order, day(21), { mode: 'session' })
      await f.db.prepare('UPDATE session_items SET hints_json = ? WHERE id = ?').run(JSON.stringify(['A synthetic hint']), item.id)
      if (order === 'hint-confidence') await useHint(f.db, f.owner, String(item.session_id), String(item.id))
      await captureConfidence(f.db, f.owner, String(item.session_id), String(item.id), 'sure', String(item.revision_id), day(21))
      await assert.rejects(captureConfidence(f.db, f.owner, String(item.session_id), String(item.id), 'guess', 'old-revision', day(21)), /revision|current/)
      if (order === 'confidence-hint') await useHint(f.db, f.owner, String(item.session_id), String(item.id))
      await submitAnswer(f.db, f.owner, String(item.session_id), { itemId: String(item.id), answer: '4', confidence: 'sure' }, new Date(day(21).getTime() + 1000))
      const [attempt] = await loadAttempts(f.db, f.student)
      assert.equal(attempt.confidence, 'sure'); assert.equal(independentConfidence(attempt), order === 'unaided')
      assert.equal(attempt.confidenceEvidence?.supportAtCapture, order === 'hint-confidence')
    } finally { f.db.close() }
  }
})

test('experiment arms need matching task conditions and a frozen measurement policy', async () => {
  const f = await fixture()
  try {
    const start = new Date('2026-09-07T12:00:00Z'), end = new Date('2026-10-05T12:00:00Z')
    await setExperiment(f.db, f.student, 'confidence-check', true, start)
    for (let i = 0; i < 28; i++) {
      const at = new Date(start.getTime() + i * 86400000)
      await evidenceAnswer(f.db, f.owner, f.student, `arm-${i}`, at, { level: isoWeek(at) % 2 ? 1 : 2 })
    }
    const unmatched = await experimentReport(f.db, f.student, 'confidence-check', end)
    assert.equal(unmatched!.enough, false); assert.equal(unmatched!.on.fairChecks, 0); assert.equal(unmatched!.off.fairChecks, 0)
    assert.equal(unmatched!.on.excludedChecks, 14); assert.match(unmatched!.note, /matching task conditions/)
    await f.db.prepare("UPDATE students SET experiment_policy = 'comparison-old' WHERE id = ?").run(f.student)
    const changed = await experimentReport(f.db, f.student, 'confidence-check', end)
    assert.equal(changed!.enough, false); assert.equal(changed!.on.accuracy, null); assert.match(changed!.note, /policy changed/)
    await setExperiment(f.db, f.student, 'confidence-check', true, end)
    assert.match((await experimentReport(f.db, f.student, 'confidence-check', end))!.note, /policy changed/, 'enrolling again must not silently pool versions')
    await evidenceAnswer(f.db, f.owner, f.student, 'before-restart-today', new Date(end.getTime() - 3600000))
    await setExperiment(f.db, f.student, 'confidence-check', false, end)
    await setExperiment(f.db, f.student, 'confidence-check', true, end)
    const restarted = (await experimentReport(f.db, f.student, 'confidence-check', end))!
    assert.equal(restarted.on.missions + restarted.off.missions, 0, 'a restart must not include earlier checks from the same calendar day')
  } finally { f.db.close() }
})
