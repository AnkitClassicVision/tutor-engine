import { learningNow } from './learning-clock.ts'
// On/off comparisons for the features meant to make learning fun. A parent can opt a child in; the
// feature is then on in odd ISO weeks and off in even ones, so the same child is compared with
// themselves. A feature earns its place only if return holds or rises and learning on fair checks
// holds. The thresholds below are fixed in advance, before anyone looks at results. One feature is compared
// at a time. The result is exploratory: order, school, topic and time of year also change week to week.

import type { Database as DatabaseSync } from "./database.ts"
import { UserError } from "./errors.ts"
import { recordDecision } from "./decisions.ts"
import { fairCheck } from "./engine/gain.ts"
import { loadAttempts } from "./services.ts"
import { COMPARISON_POLICY, matchedSamples } from './engine/evidence.ts'
import { freshEvidence } from './engine/mastery.ts'

export const EXPERIMENTS = {
  "confidence-check": { label: "Ask how sure before checking", detail: "The Sure / I think so / Guessing choice under each question the child answers alone." },
  "challenge-missions": { label: "Offer challenge missions", detail: "The Challenge mission tile on the child's home once a topic is solved alone at the using-it level." },
} as const
export type ExperimentKey = keyof typeof EXPERIMENTS

/** Decision rule, fixed before results: keep when return is no more than 10% lower and fair-check accuracy no more than 5 points lower. */
export const RULE = { returnDrop: 0.10, accuracyDrop: 0.05, minWeeksPerArm: 2, minFairChecksPerArm: 10 }

export function isoWeek(date: Date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const weekday = day.getUTCDay() || 7
  day.setUTCDate(day.getUTCDate() + 4 - weekday)
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1))
  return Math.ceil(((day.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

export function enrolled(raw: unknown): Partial<Record<ExperimentKey, string>> {
  try { const value = JSON.parse(String(raw ?? "{}")); return value && typeof value === "object" ? value : {} } catch { return {} }
}

/** Without enrolment a feature is simply on. Enrolled, it alternates by week. */
export function armFor(raw: unknown, key: ExperimentKey, date = learningNow()): "on" | "off" {
  return enrolled(raw)[key] ? (isoWeek(date) % 2 === 1 ? "on" : "off") : "on"
}

export async function setExperiment(db: DatabaseSync, studentId: string, key: string, on: boolean, now = learningNow()) {
  if (!(key in EXPERIMENTS)) throw new UserError("Unknown comparison.")
  const row = (await db.prepare("SELECT experiments, experiment_policy FROM students WHERE id = ?").get(studentId)) as { experiments: string; experiment_policy: string | null } | undefined
  const current = enrolled(row?.experiments)
  // Every comparison alternates on the same weeks, so two at once could not tell which feature made a difference.
  if (on && Object.keys(current).some(other => other !== key)) throw new UserError("Stop the other comparison first, so each result belongs to one feature.")
  const starting = on && !current[key as ExperimentKey]
  if (on) current[key as ExperimentKey] = current[key as ExperimentKey] ?? now.toISOString().slice(0, 10)
  else delete current[key as ExperimentKey]
  await db.prepare("UPDATE students SET experiments = ? WHERE id = ?").run(JSON.stringify(current), studentId)
  if (starting) await db.prepare('UPDATE students SET experiment_policy = ? WHERE id = ?')
    .run(JSON.stringify({ comparison: COMPARISON_POLICY, rules: RULE, key, startedAt: now.toISOString() }), studentId)
  await recordDecision(db, studentId, on ? "experiment_started" : "experiment_stopped", on ? "The parent started a week-on, week-off comparison of a feature." : "The parent stopped a feature comparison; the feature is simply on again.", { key }, now)
}

export interface ArmResult { weeks: number; missions: number; perWeek: number; hintRate: number | null; fairChecks: number; excludedChecks: number; accuracy: number | null }
export interface ExperimentReport { key: ExperimentKey; since: string; on: ArmResult; off: ArmResult; enough: boolean; verdict: "keep" | "promising" | "redesign" | "not enough yet"; note: string }

export async function experimentReport(db: DatabaseSync, studentId: string, key: ExperimentKey, now = learningNow()): Promise<ExperimentReport | null> {
  const row = (await db.prepare("SELECT experiments, experiment_policy FROM students WHERE id = ?").get(studentId)) as { experiments: string; experiment_policy: string | null } | undefined
  const since = enrolled(row?.experiments)[key]
  if (!since) return null
  let policy: any = null
  try { policy = JSON.parse(row?.experiment_policy ?? 'null') } catch { /* unknown policy withholds a verdict */ }
  const validPolicy = policy?.comparison === COMPARISON_POLICY && policy.key === key && JSON.stringify(policy.rules) === JSON.stringify(RULE)
    && typeof policy.startedAt === 'string' && Number.isFinite(Date.parse(policy.startedAt)) && policy.startedAt.slice(0,10) === since
  const start = validPolicy ? String(policy.startedAt) : since
  const sessions = (await db.prepare("SELECT id, started_at FROM tutor_sessions WHERE student_id = ? AND started_at >= ? AND coalesce(goal, '') NOT LIKE 'waiting_review:%'").all(studentId, start)) as Array<{ id: string; started_at: string }>
  const items = (await db.prepare("SELECT i.hints_used, i.beat, i.answered, s.started_at FROM session_items i JOIN tutor_sessions s ON s.id = i.session_id WHERE s.student_id = ? AND s.started_at >= ?").all(studentId, start)) as Array<Record<string, any>>
  const attempts = freshEvidence(await loadAttempts(db, studentId)).filter(a => (a.createdAt ?? a.day) >= start && fairCheck(a))
  const arm = (iso: string) => armFor(JSON.stringify({ [key]: since }), key, new Date(iso))
  const matched = matchedSamples(attempts.filter(a => arm(a.createdAt ?? `${a.day}T12:00:00Z`) === 'on'), attempts.filter(a => arm(a.createdAt ?? `${a.day}T12:00:00Z`) === 'off'))
  // Rates use days in each arm, so a week that has only just started does not drag its arm down.
  const days = { on: 0, off: 0 }
  for (let day = new Date(`${since}T12:00:00Z`); day <= now; day = new Date(day.getTime() + 86400000)) days[arm(day.toISOString())]++
  const result = (side: "on" | "off"): ArmResult => {
    const own = items.filter(i => arm(String(i.started_at)) === side && i.answered === 1 && i.beat !== "guided" && i.beat !== "faded")
    const fair = side === 'on' ? matched.before : matched.after
    const missions = sessions.filter(s => arm(s.started_at) === side).length
    return { weeks: Math.floor(days[side] / 7), missions, perWeek: days[side] ? (missions * 7) / days[side] : 0, hintRate: own.length ? own.filter(i => Number(i.hints_used) > 0).length / own.length : null, fairChecks: fair.length, excludedChecks: side === 'on' ? matched.excludedBefore : matched.excludedAfter, accuracy: fair.length ? fair.filter(a => a.correct).length / fair.length : null }
  }
  const on = result("on"), off = result("off")
  if (!validPolicy) return { key, since, on: { ...on, accuracy: null }, off: { ...off, accuracy: null }, enough: false, verdict: 'not enough yet', note: 'The measurement policy changed or was not recorded. This comparison cannot produce a verdict. Stop and start a new comparison to use the current policy.' }
  const enough = on.weeks >= RULE.minWeeksPerArm && off.weeks >= RULE.minWeeksPerArm && on.fairChecks >= RULE.minFairChecksPerArm && off.fairChecks >= RULE.minFairChecksPerArm
  if (!enough) return { key, since, on, off, enough, verdict: "not enough yet", note: `Needs ${RULE.minWeeksPerArm} weeks and ${RULE.minFairChecksPerArm} comparable fair checks with the feature on and off. ${on.excludedChecks} on / ${off.excludedChecks} off checks have no matching task conditions.` }
  const returnHolds = on.perWeek >= off.perWeek * (1 - RULE.returnDrop)
  const learningHolds = (on.accuracy ?? 0) >= (off.accuracy ?? 0) - RULE.accuracyDrop
  const verdict = !learningHolds || !returnHolds ? "redesign" : on.perWeek >= off.perWeek * (1 + RULE.returnDrop) ? "promising" : "keep"
  const note = verdict === "redesign" ? (learningHolds ? "Missions per week fell with the feature on." : "Accuracy on fair checks fell with the feature on.") : verdict === "promising" ? "More missions with the feature on, and learning held." : "Return and learning held with the feature on."
  return { key, since, on, off, enough, verdict, note }
}
