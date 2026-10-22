// Before and after on fair checks: fresh questions the child had not seen, answered without help and
// graded with confidence. This describes the child against their own start; it does not show cause. Cohen's h
// is a scale for a change between two proportions. Bloom's 2-sigma compares tutored and classroom students on
// standardized scores, so the two numbers are not comparable; the parent view says so.

import { matchedSamples } from "./evidence.ts"
import { independent, freshEvidence } from "./mastery.ts"
import type { AttemptRecord } from "./types.ts"
import { addDays } from "./dates.ts"

export interface Window { checks: number; correct: number; accuracy: number; low: number; high: number; demand: number; from: string; to: string }
export interface Gain {
  enough: boolean
  checks: number
  before: Window | null
  after: Window | null
  /** Cohen's h on accuracy: the standard effect size for a change between two proportions. */
  effect: number | null
  size: "too small to call" | "small" | "medium" | "large" | null
  /** Change in average Bloom level between the windows: the kind of thinking asked for, which is not the same as difficulty. */
  demandChange: number | null
  note: string
}

export const WINDOW = 6
const MIN_DAYS_APART = 7

/** Wilson interval at about 80% confidence: honest about how little a handful of checks can show. */
function wilson(correct: number, n: number, z = 1.2816) {
  if (!n) return { low: 0, high: 0 }
  const p = correct / n, denominator = 1 + z * z / n
  const centre = (p + z * z / (2 * n)) / denominator
  const spread = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denominator
  return { low: Math.max(0, centre - spread), high: Math.min(1, centre + spread) }
}

function window(rows: AttemptRecord[]): Window {
  const correct = rows.filter(a => a.correct).length
  return { checks: rows.length, correct, accuracy: correct / rows.length, ...wilson(correct, rows.length), demand: rows.reduce((sum, a) => sum + a.bloomLevel, 0) / rows.length, from: rows[0].day, to: rows.at(-1)!.day }
}

export const fairCheck = (attempt: AttemptRecord) => attempt.evidenceCertainty !== "unresolved" && independent(attempt)

export function gainOnFairChecks(attempts: AttemptRecord[]): Gain {
  const rows = freshEvidence(attempts).filter(fairCheck).sort((a, b) => (a.createdAt ?? a.day).localeCompare(b.createdAt ?? b.day))
  const empty: Gain = { enough: false, checks: rows.length, before: null, after: null, effect: null, size: null, demandChange: null, note: "" }
  if (rows.length < WINDOW * 2) return { ...empty, note: `Needs ${WINDOW * 2} fair checks; ${rows.length} so far.` }
  const matched = matchedSamples(rows.slice(0, WINDOW), rows.slice(-WINDOW))
  if (matched.before.length < WINDOW) return { ...empty, note: `Not enough comparable checks: ${matched.before.length} of ${WINDOW} matched by topic, demand, task role and response form. Unmatched task mixtures cannot establish a change.` }
  const before = window(matched.before), after = window(matched.after)
  if (after.from < addDays(before.from, MIN_DAYS_APART)) return { ...empty, before, after, note: "Needs fair checks at least a week apart." }
  const effect = 2 * Math.asin(Math.sqrt(after.accuracy)) - 2 * Math.asin(Math.sqrt(before.accuracy))
  const magnitude = Math.abs(effect)
  const size = magnitude < 0.2 ? "too small to call" : magnitude < 0.5 ? "small" : magnitude < 0.8 ? "medium" : "large"
  const demandChange = after.demand - before.demand
  const overlap = after.low <= before.high && before.low <= after.high
  const note = overlap ? "The two ranges overlap, so more checks are needed before calling a change." : effect > 0 ? "Accuracy on fair checks has risen beyond the uncertainty of a few checks." : "Accuracy on fair checks has fallen; look at what changed."
  return { enough: true, checks: rows.length, before, after, effect: Math.round(effect * 100) / 100, size, demandChange: Math.round(demandChange * 10) / 10, note }
}
