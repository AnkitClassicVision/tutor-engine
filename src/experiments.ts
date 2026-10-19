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
export function armFor(raw: unknown, key: ExperimentKey, date = new Date()): "on" | "off" {
  return enrolled(raw)[key] ? (isoWeek(date) % 2 === 1 ? "on" : "off") : "on"
}

export async function setExperiment(db: DatabaseSync, studentId: string, key: string, on: boolean, now = new Date()) {
  if (!(key in EXPERIMENTS)) throw new UserError("Unknown comparison.")
  const row = (await db.prepare("SELECT experiments FROM students WHERE id = ?").get(studentId)) as { experiments: string } | undefined
  const current = enrolled(row?.experiments)
  // Every comparison alternates on the same weeks, so two at once could not tell which feature made a difference.
  if (on && Object.keys(current).some(other => other !== key)) throw new UserError("Stop the other comparison first, so each result belongs to one feature.")
  if (on) current[key as ExperimentKey] = current[key as ExperimentKey] ?? now.toISOString().slice(0, 10)
  else delete current[key as ExperimentKey]
  await db.prepare("UPDATE students SET experiments = ? WHERE id = ?").run(JSON.stringify(current), studentId)
  await recordDecision(db, studentId, on ? "experiment_started" : "experiment_stopped", on ? "The parent started a week-on, week-off comparison of a feature." : "The parent stopped a feature comparison; the feature is simply on again.", { key }, now)
}

export interface ArmResult { weeks: number; missions: number; perWeek: number; hintRate: number | null; fairChecks: number; accuracy: number | null }
export interface ExperimentReport { key: ExperimentKey; since: string; on: ArmResult; off: ArmResult; enough: boolean; verdict: "keep" | "promising" | "redesign" | "not enough yet"; note: string }

export async function experimentReport(db: DatabaseSync, studentId: string, key: ExperimentKey, now = new Date()): Promise<ExperimentReport | null> {
  const row = (await db.prepare("SELECT experiments FROM students WHERE id = ?").get(studentId)) as { experiments: string } | undefined
  const since = enrolled(row?.experiments)[key]
  if (!since) return null
  const sessions = (await db.prepare("SELECT id, started_at FROM tutor_sessions WHERE student_id = ? AND started_at >= ? AND coalesce(goal, '') NOT LIKE 'waiting_review:%'").all(studentId, since)) as Array<{ id: string; started_at: string }>
  const items = (await db.prepare("SELECT i.hints_used, i.beat, i.answered, s.started_at FROM session_items i JOIN tutor_sessions s ON s.id = i.session_id WHERE s.student_id = ? AND s.started_at >= ?").all(studentId, since)) as Array<Record<string, any>>
  const attempts = (await loadAttempts(db, studentId)).filter(a => a.day >= since && fairCheck(a))
  const arm = (iso: string) => armFor(JSON.stringify({ [key]: since }), key, new Date(iso))
  // Rates use days in each arm, so a week that has only just started does not drag its arm down.
  const days = { on: 0, off: 0 }
  for (let day = new Date(`${since}T12:00:00Z`); day <= now; day = new Date(day.getTime() + 86400000)) days[arm(day.toISOString())]++
  const result = (side: "on" | "off"): ArmResult => {
    const own = items.filter(i => arm(String(i.started_at)) === side && i.answered === 1 && i.beat !== "guided" && i.beat !== "faded")
    const fair = attempts.filter(a => arm(a.createdAt ?? `${a.day}T12:00:00Z`) === side)
    const missions = sessions.filter(s => arm(s.started_at) === side).length
    return { weeks: Math.floor(days[side] / 7), missions, perWeek: days[side] ? (missions * 7) / days[side] : 0, hintRate: own.length ? own.filter(i => Number(i.hints_used) > 0).length / own.length : null, fairChecks: fair.length, accuracy: fair.length ? fair.filter(a => a.correct).length / fair.length : null }
  }
  const on = result("on"), off = result("off")
  const enough = on.weeks >= RULE.minWeeksPerArm && off.weeks >= RULE.minWeeksPerArm && on.fairChecks >= RULE.minFairChecksPerArm && off.fairChecks >= RULE.minFairChecksPerArm
  if (!enough) return { key, since, on, off, enough, verdict: "not enough yet", note: `Needs ${RULE.minWeeksPerArm} weeks and ${RULE.minFairChecksPerArm} fair checks with the feature on and off.` }
  const returnHolds = on.perWeek >= off.perWeek * (1 - RULE.returnDrop)
  const learningHolds = (on.accuracy ?? 0) >= (off.accuracy ?? 0) - RULE.accuracyDrop
  const verdict = !learningHolds || !returnHolds ? "redesign" : on.perWeek >= off.perWeek * (1 + RULE.returnDrop) ? "promising" : "keep"
  const note = verdict === "redesign" ? (learningHolds ? "Missions per week fell with the feature on." : "Accuracy on fair checks fell with the feature on.") : verdict === "promising" ? "More missions with the feature on, and learning held." : "Return and learning held with the feature on."
  return { key, since, on, off, enough, verdict, note }
}
