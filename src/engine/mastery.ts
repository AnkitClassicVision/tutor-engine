import { addDays } from "./dates.ts"
import type { AttemptRecord, BloomLevel, ConceptNode, LearnerConceptState, Mode } from "./types.ts"

const LADDER = [1, 3, 7, 16, 35]

/** Planning estimate only: stability is the modeled interval to 90% recall. */
export function estimatedRetention(stabilityDays: number, elapsedDays: number): number {
  if (elapsedDays <= 0) return 1
  if (stabilityDays <= 0) return 0
  return Math.pow(0.9, elapsedDays / stabilityDays)
}

export function chronological(a: AttemptRecord, b: AttemptRecord): number {
  return (a.createdAt ?? a.day).localeCompare(b.createdAt ?? b.day) || a.attemptId.localeCompare(b.attemptId)
}

export function emptyState(conceptId: string, today: string): LearnerConceptState {
  return {
    conceptId,
    bloomLevel: 0,
    mastery: 0,
    stabilityDays: 0,
    nextDue: today,
    errorSignatures: [],
    hintsLast10: 0,
    masteredIn: null,
    status: "unseen",
  }
}

export function initialState(concept: ConceptNode, studentGrade: number, today: string): LearnerConceptState {
  return { ...emptyState(concept.conceptId, today), placement: "provisional" }
}

/** A prompt counts once, even if retried in another mission. */
export function freshEvidence(attempts: AttemptRecord[]): AttemptRecord[] {
  const seen = new Set<string>()
  return [...attempts].sort(chronological).filter(attempt => {
    const key = attempt.promptKey ?? attempt.attemptId
    const repeated = seen.has(key)
    seen.add(key)
    return !repeated && independent(attempt)
  })
}

export function independent(attempt: AttemptRecord): boolean {
  return attempt.fresh !== false && attempt.hintsUsed === 0 && (!attempt.supportUsed || attempt.supportUsed === "none")
    && attempt.evidenceCertainty !== "unresolved" && attempt.evidenceCertainty !== "legacy"
}

export function qualifying(attempt: AttemptRecord, level: BloomLevel): boolean {
  return attempt.correct && attempt.bloomLevel === level && independent(attempt)
}

export function masteryMet(attempts: AttemptRecord[], level: BloomLevel): boolean {
  const wins = freshEvidence(attempts).filter((attempt) => qualifying(attempt, level))
  return [...new Set(wins.map(a => a.conceptId))].some(conceptId => {
    const rows = wins.filter(a => a.conceptId === conceptId)
    return rows.length >= 3 && new Set(rows.map(a => a.sessionId)).size >= 2
      && new Set(rows.map(a => a.day)).size >= 2 && rows.some(a => a.interleaved)
  })
}

export function scheduleAfter(stabilityDays: number, correct: boolean, today: string) {
  if (!correct) {
    const next = Math.max(1, Math.floor(stabilityDays / 2))
    return { stabilityDays: next, nextDue: addDays(today, 1) }
  }
  const next = LADDER.find((step) => step > stabilityDays) ?? 35
  return { stabilityDays: next, nextDue: addDays(today, next) }
}

export function reduceState(
  conceptId: string,
  attempts: AttemptRecord[],
  today: string,
  modality: Mode,
): LearnerConceptState {
  const ordered = freshEvidence(attempts).filter(attempt => attempt.conceptId === conceptId)
  let state = emptyState(conceptId, today)
  let highestMastered: BloomLevel = 0
  const cumulative = new Map<BloomLevel, { wins: number; sessions: Set<string>; days: Set<string>; mixed: boolean }>()
  for (let index = 0; index < ordered.length; index += 1) {
    const attempt = ordered[index]
    const level = attempt.bloomLevel
    const window = ordered.slice(Math.max(0, index - 9), index + 1)
    state.hintsLast10 = window.reduce((sum, item) => sum + item.hintsUsed, 0)
    if (attempt.errorType) {
      state.errorSignatures = [...state.errorSignatures, attempt.errorType].slice(-10)
    }
    let promoted = false
    if (qualifying(attempt, level)) {
      const tally = cumulative.get(level) ?? { wins: 0, sessions: new Set<string>(), days: new Set<string>(), mixed: false }
      tally.wins++; tally.sessions.add(attempt.sessionId); tally.days.add(attempt.day); tally.mixed ||= attempt.interleaved
      cumulative.set(level, tally)
      if (tally.wins >= 3 && tally.sessions.size >= 2 && tally.days.size >= 2 && tally.mixed && level > highestMastered) { highestMastered = level; promoted = true }
    }
    if (promoted) {
      state.stabilityDays = 7
      state.nextDue = addDays(attempt.day, 7)
      state.masteredIn = attempt.modality
    } else if (highestMastered === 0) {
      state.stabilityDays = 1
      state.nextDue = addDays(attempt.day, 1)
    } else if (level === highestMastered && (!attempt.correct || attempt.day >= state.nextDue)) {
      const schedule = scheduleAfter(state.stabilityDays, attempt.correct, attempt.day)
      state.stabilityDays = schedule.stabilityDays
      state.nextDue = schedule.nextDue
      state.masteredIn = attempt.correct ? attempt.modality : state.masteredIn
    }
  }
  state.bloomLevel = highestMastered
  state.placementBloom = Math.max(1, ...ordered.filter(a => a.correct).map(a => a.bloomLevel)) as BloomLevel
  while (state.placementBloom > 1) {
    const comparable = ordered.filter(a => a.bloomLevel === state.placementBloom).slice(-6)
    if (comparable.length < 6 || comparable.filter(a => a.correct).length / comparable.length >= 0.7) break
    state.placementBloom = (state.placementBloom - 1) as BloomLevel
  }
  const working = workingBloom(state)
  const winsAtWorking = ordered.filter((attempt) => qualifying(attempt, working)).length
  const holdsMastery = highestMastered > 0 && masteryMet(ordered, highestMastered)
  state.mastery = holdsMastery ? 1 : Math.min(0.99, winsAtWorking / 3)
  state.status = holdsMastery ? "mastered" : "frontier"
  const last = [...ordered].reverse().find(a => a.bloomLevel === highestMastered) ?? ordered.at(-1)
  if (holdsMastery && last && last.bloomLevel === highestMastered && !last.correct) {
    state.mastery = Math.max(0.4, 1 - 0.25)
    state.status = "review_due"
  } else if (holdsMastery && state.nextDue <= today) {
    state.status = "review_due"
  }
  if (!holdsMastery && ordered.length) state.nextDue = addDays(ordered.at(-1)!.day, 1)
  if (isStuckConcept(ordered)) state.status = "stuck"
  state.hintsLast10 = attempts.filter(a => a.conceptId === conceptId).sort(chronological).slice(-10).reduce((n, a) => n + a.hintsUsed, 0)
  if (!ordered.length) return { ...emptyState(conceptId, today), hintsLast10: state.hintsLast10, placement: "provisional", independentChecks: 0 }
  state.placement = holdsMastery ? "evidence" : "provisional"
  state.independentChecks = ordered.length
  state.conceptId = conceptId
  return state
}

export function isStuckConcept(attempts: AttemptRecord[]): boolean {
  const groups = new Map<string, AttemptRecord[]>()
  for (const attempt of freshEvidence(attempts)) {
    const key = `${attempt.conceptId}:${attempt.bloomLevel}`
    groups.set(key, [...(groups.get(key) ?? []), attempt])
  }
  return [...groups.values()].some(rows => {
    const sessions = [...new Set(rows.map(a => a.sessionId))].slice(-3)
    return sessions.length === 3 && sessions.every(id => {
      const comparable = rows.filter(a => a.sessionId === id)
      return comparable.filter(a => a.correct).length / comparable.length < 0.7
    })
  })
}

export function workingBloom(state: LearnerConceptState | undefined): BloomLevel {
  const mastered = state?.bloomLevel ?? 0
  if (state?.status === "review_due" && mastered > 0) return mastered
  return Math.min(6, Math.max(1, mastered + 1, state?.placementBloom ?? 1)) as BloomLevel
}

export function projectState(
  base: LearnerConceptState,
  attempts: AttemptRecord[],
  today: string,
): LearnerConceptState {
  // Saved states include historical age estimates. Derive current claims from original evidence.
  return reduceState(base.conceptId, attempts, today, attempts.at(-1)?.modality ?? "screen")
}
