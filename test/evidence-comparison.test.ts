import test from 'node:test'
import assert from 'node:assert/strict'
import { comparable, retentionPairs, independentConfidence, matchedSamples } from '../src/engine/evidence.ts'
import { gainOnFairChecks } from '../src/engine/gain.ts'
import type { AttemptRecord } from '../src/engine/types.ts'
import { taskEvidence } from '../src/task-evidence.ts'

function attempt(n: number, change: Partial<AttemptRecord> = {}): AttemptRecord {
  const task = taskEvidence({ concept_id: 'fraction', bloom_level: 2, prompt: `Question ${n}`, answer: '1', format: 'text' }, 'builtin')
  return { attemptId: `a${n}`, createdAt: `2026-10-${String(n).padStart(2, '0')}T12:00:00Z`, studentId: 's', sessionId: `session${n}`, conceptId: 'fraction', bloomLevel: 2,
    day: `2026-10-${String(n).padStart(2, '0')}`, correct: true, hintsUsed: 0, interleaved: false, timeMs: 10, errorType: null, modality: 'screen',
    fresh: true, evidenceCertainty: 'confirmed', kind: 'practice', task, ...change }
}

test('retention pairs to the latest eligible same-demand success and excludes incompatible demands, roles and formats', () => {
  const earlier = attempt(1, { bloomLevel: 1 }), second = attempt(2), latest = attempt(4), delayed = attempt(12)
  assert.equal(retentionPairs([earlier, second, latest, delayed])[0].before.attemptId, latest.attemptId)
  for (const patch of [{ bloomLevel: 6 as const }, { kind: 'transfer' as const }, { hintsUsed: 1 }, { fresh: false }, { evidenceCertainty: 'unresolved' as const }]) {
    assert.equal(retentionPairs([latest, { ...delayed, ...patch }]).length, 0)
  }
  assert.equal(comparable(latest, { ...delayed, task: { ...delayed.task!, responseForm: 'choice' } }), null)
  assert.equal(comparable({ ...latest, task: undefined }, delayed), 'historical-proxy')
  const authored = { ...latest, task: { ...latest.task!, outcomeId: 'magnitude', parallelFormId: 'magnitude-v1' } }
  assert.equal(comparable(authored, { ...delayed, task: { ...delayed.task!, outcomeId: 'magnitude', parallelFormId: 'magnitude-v1' } }), 'validated')
  assert.equal(comparable(authored, { ...delayed, task: { ...delayed.task!, outcomeId: 'addition', parallelFormId: 'addition-v1' } }), null)
})

test('unknown or recent exposure cannot certify an unrefreshed week', () => {
  const prior = attempt(4), later = attempt(12)
  assert.equal(retentionPairs([prior, later])[0].unrefreshed, false)
  assert.equal(retentionPairs([prior, { ...later, exposureComplete: true, lastExposureAt: '2026-10-04T12:00:00Z' }])[0].unrefreshed, true)
  assert.equal(retentionPairs([prior, { ...later, exposureComplete: true, lastExposureAt: '2026-10-11T12:00:00Z' }])[0].unrefreshed, false)
  assert.equal(retentionPairs([prior, { ...later, measurementStartedAt: '2026-10-05T12:00:00Z' }]).length, 0, 'an answer saved much later cannot lengthen a check that already began')
})

test('confidence keeps its captured value but requires captured order and independent answer conditions', () => {
  const row = attempt(12, { confidence: 'sure' })
  const captured = { ...row, confidenceEvidence: { at: row.createdAt!, revision: row.task!.revision, supportAtCapture: false } }
  assert.equal(independentConfidence(row), false)
  assert.equal(independentConfidence(captured), true)
  assert.equal(independentConfidence({ ...captured, hintsUsed: 1 }), false)
  assert.equal(independentConfidence({ ...captured, confidenceEvidence: { ...captured.confidenceEvidence, supportAtCapture: true } }), false)
  assert.equal(independentConfidence({ ...captured, confidenceEvidence: { ...captured.confidenceEvidence, revision: 'stale' } }), false)
  assert.equal(captured.confidence, 'sure')
})

test('unmatched before/after task mixtures withhold effect size and enough', () => {
  const before = Array.from({ length: 6 }, (_, n) => attempt(n + 1))
  const after = Array.from({ length: 6 }, (_, n) => attempt(n + 15, { bloomLevel: 6, correct: false }))
  const gain = gainOnFairChecks([...before, ...after])
  assert.equal(gain.enough, false); assert.equal(gain.effect, null); assert.equal(gain.size, null)
  assert.equal(matchedSamples(before, after).excludedAfter, 6)
  assert.equal(gainOnFairChecks([...before, ...after.map(a => ({ ...a, bloomLevel: 2 as const }))]).enough, true)
})
