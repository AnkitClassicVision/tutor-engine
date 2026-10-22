import type { AttemptRecord } from './types.ts'
import { chronological, freshEvidence, independent } from './mastery.ts'
import { daysBetween, dayStamp } from './dates.ts'

/** Frozen before examining outcomes. Never pool an experiment across policy versions. */
export const COMPARISON_POLICY = 'comparison-v1'
export type ResponseForm = 'number' | 'choice' | 'steps' | 'text' | 'unknown'
export interface TaskEvidence {
  version: 1
  revision: string
  origin: 'builtin' | 'practice' | 'designed' | 'paper'
  sourceId: string | null
  conceptId: string
  demand: number
  role: 'practice' | 'transfer'
  responseForm: ResponseForm
  promptHash: string
  rubricHash: string
  supportHash?: string
  /** Only application-approved authored forms may set these, never a model boolean. */
  outcomeId: string | null
  parallelFormId: string | null
}
export interface ConfidenceEvidence {
  at: string
  revision: string
  supportAtCapture: boolean
}
export type Comparison = 'validated' | 'historical-proxy'

export function comparable(a: AttemptRecord, b: AttemptRecord): Comparison | null {
  if (!independent(a) || !independent(b) || a.conceptId !== b.conceptId || a.bloomLevel !== b.bloomLevel
    || (a.kind ?? 'practice') !== (b.kind ?? 'practice')) return null
  const left = a.task, right = b.task
  if (left?.responseForm && right?.responseForm && left.responseForm !== 'unknown' && right.responseForm !== 'unknown'
    && left.responseForm !== right.responseForm) return null
  if (left?.outcomeId && right?.outcomeId && left.outcomeId !== right.outcomeId) return null
  if (left?.parallelFormId && right?.parallelFormId && left.parallelFormId !== right.parallelFormId) return null
  return left?.outcomeId && left.parallelFormId && left.outcomeId === right?.outcomeId && left.parallelFormId === right.parallelFormId
    ? 'validated' : 'historical-proxy'
}

export interface RetentionPair {
  before: AttemptRecord
  after: AttemptRecord
  comparison: Comparison
  /** Unknown or intervening exposure cannot establish an unrefreshed interval. */
  unrefreshed: boolean
}
/** Each measurement is paired to the most recent eligible comparable success. */
export function retentionChecks(attempts: AttemptRecord[], delayDays = 7): RetentionPair[] {
  const rows = freshEvidence(attempts).sort(chronological)
  const pairs: RetentionPair[] = []
  for (let index = 0; index < rows.length; index++) {
    const after = rows[index]
    if (after.kind === 'transfer') continue
    const measuredDay = after.measurementStartedAt ? dayStamp(new Date(after.measurementStartedAt)) : after.day
    const before = rows.slice(0, index).reverse().find(a => a.correct && comparable(a, after) && daysBetween(a.day, measuredDay) >= delayDays)
    if (!before) continue
    const comparison = comparable(before, after)!
    const gap = after.lastExposureAt ? daysBetween(dayStamp(new Date(after.lastExposureAt)), measuredDay) : null
    const unrefreshed = after.exposureComplete === true && gap !== null && gap >= delayDays
    pairs.push({ before, after, comparison, unrefreshed })
  }
  return pairs
}

/** Reports count one latest measurement per concept, not several items from one sealed check. */
export function retentionPairs(attempts: AttemptRecord[], delayDays = 7): RetentionPair[] {
  return [...new Map(retentionChecks(attempts, delayDays).map(pair => [pair.after.conceptId, pair])).values()]
}

/** Pair conditions rather than comparing uncontrolled task mixtures. Missing matches stay visible. */
export function matchedSamples(before: AttemptRecord[], after: AttemptRecord[]) {
  const remaining = [...before], pairs: Array<[AttemptRecord, AttemptRecord]> = []
  for (const current of after) {
    const index = remaining.findIndex(prior => comparable(prior, current))
    if (index >= 0) pairs.push([remaining.splice(index, 1)[0], current])
  }
  return { before: pairs.map(p => p[0]), after: pairs.map(p => p[1]), excludedBefore: before.length - pairs.length, excludedAfter: after.length - pairs.length }
}

export function independentConfidence(attempt: AttemptRecord): boolean {
  if (!attempt.confidence || !independent(attempt)) return false
  const capture = attempt.confidenceEvidence
  // Historical capture order is unknown; keep the expressed value, withhold an unaided prediction claim.
  return Boolean(capture && !capture.supportAtCapture && capture.revision === attempt.task?.revision
    && attempt.createdAt && capture.at <= attempt.createdAt)
}
