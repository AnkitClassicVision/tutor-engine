import { retentionChecks } from "./evidence.ts"
// The evidence ladder: for each concept, how far the child's thinking has climbed and how much of it
// they own. Thinking bands follow the blueprint's pairs of Bloom levels; ownership separates practice,
// help, independence, memory after time and use in a new situation.

import { independent, freshEvidence } from "./mastery.ts"
import type { AttemptRecord, BloomLevel } from "./types.ts"
import { addDays } from "./dates.ts"

export type Band = "none" | "foundations" | "use" | "judge"
export const BAND_LABEL: Record<Band, string> = { none: "Not started", foundations: "Basics", use: "Using it", judge: "Judging and creating" }
export const bandOf = (level: number): Band => level >= 5 ? "judge" : level >= 3 ? "use" : level >= 1 ? "foundations" : "none"

export const OWNERSHIP = ["practiced", "assisted", "independent", "retained7", "retained28", "transferred"] as const
export type Ownership = (typeof OWNERSHIP)[number]
export const OWNERSHIP_LABEL: Record<Ownership, string> = {
  practiced: "Practised", assisted: "With help", independent: "On their own",
  retained7: "Comparable check after a week", retained28: "Comparable check after a month", transferred: "Used somewhere new",
}

export interface ConceptLadder {
  conceptId: string
  /** Highest Bloom band with an independent, fresh, confirmed success. */
  band: Band
  highestLevel: BloomLevel | 0
  /** Every ownership step reached, in order. Steps can be reached out of order (a transfer before a month passes). */
  reached: Ownership[]
  /** The first independent success; delayed comparisons have their own eligible baseline. */
  since: string | null
  /** Independent at Judge and produce, remembered after a month, and used somewhere new. */
  goalMet: boolean
  /** The next step worth aiming at. */
  next: string
  /** The highest level a later independent success reached, for each memory step; shown when below the topic's band. */
  memoryLevel: Partial<Record<"retained7" | "retained28", BloomLevel>>
}

const confirmed = (attempt: AttemptRecord) => attempt.evidenceCertainty !== "unresolved"

export function conceptLadder(conceptId: string, attempts: AttemptRecord[]): ConceptLadder {
  const rows = attempts.filter(a => a.conceptId === conceptId && confirmed(a)).sort((a, b) => (a.createdAt ?? a.day).localeCompare(b.createdAt ?? b.day))
  const own = freshEvidence(rows).filter(a => a.correct)
  const reached = new Set<Ownership>()
  if (rows.length) reached.add("practiced")
  if (rows.some(a => a.correct && (a.hintsUsed > 0 || a.supportUsed && a.supportUsed !== 'none'))) reached.add("assisted")
  const first = own[0]
  if (first) {
    reached.add("independent")
    if (retentionChecks(rows, 7).some(pair => pair.after.correct)) reached.add("retained7")
    if (retentionChecks(rows, 28).some(pair => pair.after.correct)) reached.add("retained28")
  }
  const memoryLevel: ConceptLadder["memoryLevel"] = {}
  for (const [step, days] of [["retained7", 7], ["retained28", 28]] as const) {
    const later = retentionChecks(rows, days).filter(pair => pair.after.correct).map(pair => pair.after)
    if (later.length) memoryLevel[step] = Math.max(...later.map(a => a.bloomLevel)) as BloomLevel
  }
  if (own.some(a => a.kind === "transfer")) reached.add("transferred")
  const highestLevel = (own.length ? Math.max(...own.map(a => a.bloomLevel)) : 0) as BloomLevel | 0
  const band = bandOf(highestLevel)
  const goalMet = band === "judge" && memoryLevel.retained28 === highestLevel && own.some(a => a.kind === 'transfer' && a.bloomLevel === highestLevel)
  const next = !rows.length ? "Start with a short check."
    : !reached.has("independent") ? "Get one right on their own, without a hint."
    : band !== "judge" ? `Try a ${band === "foundations" ? "use-it" : "judge-or-create"} challenge.`
    : !reached.has("transferred") ? "Use it in a new situation."
    : memoryLevel.retained28 !== highestLevel ? 'Plan a comparable check at this level after a month.'
    : "Goal reached. Keep it fresh with an occasional review."
  return { conceptId, band, highestLevel, reached: OWNERSHIP.filter(step => reached.has(step)), since: first?.day ?? null, goalMet, next, memoryLevel }
}

export function ladders(attempts: AttemptRecord[]): ConceptLadder[] {
  return [...new Set(attempts.map(a => a.conceptId))].map(id => conceptLadder(id, attempts))
}

/** How many concepts sit at each band and ownership step, for a one-line summary. */
export function ladderSummary(rows: ConceptLadder[]) {
  const bands = { none: 0, foundations: 0, use: 0, judge: 0 } as Record<Band, number>
  const steps = Object.fromEntries(OWNERSHIP.map(step => [step, 0])) as Record<Ownership, number>
  for (const row of rows) { bands[row.band]++; for (const step of row.reached) steps[step]++ }
  return { concepts: rows.length, bands, steps, goalMet: rows.filter(row => row.goalMet).length }
}
