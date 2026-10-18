import { daysBetween } from "./dates.ts"
import { chronological, freshEvidence, independent, isStuckConcept, masteryMet } from "./mastery.ts"
import { rollingSuccess } from "./thermostat.ts"
import type { AttemptRecord, BloomLevel, LearnerConceptState } from "./types.ts"

export interface Scoreboard {
  assessmentEvidence?: import("../assessment-evidence.ts").AssessmentEvidence[]
  conceptsMasteredThisWeek: Array<{ conceptId: string; bloomLevel: BloomLevel }>
  frontier: Array<{ conceptId: string; bloomLevel: BloomLevel; status: string }>
  retention7: { checked: number; held: number }
  retention30: { checked: number; held: number }
  justRightRatio: number | null
  timeToMasteryDays: Array<{ conceptId: string; bloomLevel: BloomLevel; days: number }>
  errorTrend: Array<{ errorType: string; count: number }>
  stuck: Array<{ conceptId: string; errorType: string | null }>
}

export function weeklyScoreboard(input: {
  attempts: AttemptRecord[]
  states: LearnerConceptState[]
  weekStart: string
  today: string
}): Scoreboard {
  const evidence = freshEvidence(input.attempts)
  const byConcept = group(evidence)
  const masteredThisWeek: Scoreboard["conceptsMasteredThisWeek"] = []
  const timeToMasteryDays: Scoreboard["timeToMasteryDays"] = []
  const retention7 = { checked: 0, held: 0 }
  const retention30 = { checked: 0, held: 0 }
  const stuck: Scoreboard["stuck"] = []

  for (const [conceptId, attempts] of byConcept) {
    const ordered = [...attempts].sort(chronological)
    for (const level of [1, 2, 3, 4, 5, 6] as BloomLevel[]) {
      const hit = firstMasteryIndex(ordered, level)
      if (hit == null) continue
      const day = ordered[hit].day
      if (day >= input.weekStart && day <= input.today) {
        masteredThisWeek.push({ conceptId, bloomLevel: level })
      }
      timeToMasteryDays.push({
        conceptId,
        bloomLevel: level,
        days: Math.max(0, daysBetween(ordered[0].day, day)),
      })
      countRetention(ordered, hit, 7, retention7)
      countRetention(ordered, hit, 30, retention30)
    }
    if (isStuckConcept(ordered)) {
      const latestError = [...ordered].reverse().find((attempt) => attempt.errorType)?.errorType ?? null
      stuck.push({ conceptId, errorType: latestError })
    }
  }

  const timed = evidence
  let windows = 0
  let inBand = 0
  for (let index = 5; index < timed.length; index += 1) {
    windows += 1
    const window = timed.slice(index - 5, index + 1)
    if (!window.every(a => a.conceptId === timed[index].conceptId && a.bloomLevel === timed[index].bloomLevel)) { windows--; continue }
    const rate = rollingSuccess(window.map((attempt) => attempt.correct))
    if (rate != null && rate >= 0.7 && rate < 0.9) inBand += 1
  }

  const errorCounts = new Map<string, number>()
  for (const attempt of input.attempts) {
    if (!attempt.errorType) continue
    if (attempt.day < input.weekStart || attempt.day > input.today) continue
    errorCounts.set(attempt.errorType, (errorCounts.get(attempt.errorType) ?? 0) + 1)
  }

  const frontier = input.states
    .filter((state) => state.status === "frontier" || state.status === "stuck")
    .map((state) => ({
      conceptId: state.conceptId,
      bloomLevel: Math.min(6, state.bloomLevel + 1) as BloomLevel,
      status: state.status,
    }))

  return {
    conceptsMasteredThisWeek: masteredThisWeek,
    frontier,
    retention7,
    retention30,
    justRightRatio: windows ? inBand / windows : null,
    timeToMasteryDays,
    errorTrend: [...errorCounts.entries()].map(([errorType, count]) => ({ errorType, count })),
    stuck,
  }
}

function countRetention(
  ordered: AttemptRecord[],
  masteredAt: number,
  gap: number,
  bucket: { checked: number; held: number },
) {
  const start = ordered[masteredAt].day
  const level = ordered[masteredAt].bloomLevel
  const later = ordered.slice(masteredAt + 1).find((attempt) => attempt.bloomLevel === level && independent(attempt) && daysBetween(start, attempt.day) >= gap)
  if (!later) return
  bucket.checked += 1
  if (later.correct) bucket.held += 1
}

function firstMasteryIndex(ordered: AttemptRecord[], level: BloomLevel): number | null {
  for (let index = 0; index < ordered.length; index += 1) {
    if (masteryMet(ordered.slice(0, index + 1), level)) return index
  }
  return null
}

function group(attempts: AttemptRecord[]): Map<string, AttemptRecord[]> {
  const map = new Map<string, AttemptRecord[]>()
  for (const attempt of attempts) {
    const list = map.get(attempt.conceptId) ?? []
    list.push(attempt)
    map.set(attempt.conceptId, list)
  }
  return map
}
