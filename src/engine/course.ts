import type { BloomLevel, QueueSlot } from "./types.ts"

export type MathCourse = "remedial" | "grade" | "prealgebra" | "algebra"

export const COURSE_LADDER: MathCourse[] = ["remedial", "grade", "prealgebra", "algebra"]

export const COURSE_LABEL: Record<MathCourse, string> = {
  remedial: "Remedial math",
  grade: "Grade-level math",
  prealgebra: "Pre-algebra",
  algebra: "Algebra",
}

export function contentGrade(ageGrade: number, course: MathCourse): number {
  const clamped = Math.min(9, Math.max(1, ageGrade))
  if (course === "remedial") return Math.max(1, clamped - 2)
  if (course === "prealgebra") return 8
  if (course === "algebra") return 9
  return Math.min(8, clamped)
}

export function nextCourse(course: MathCourse): MathCourse | null {
  const index = COURSE_LADDER.indexOf(course)
  if (index < 0 || index >= COURSE_LADDER.length - 1) return null
  return COURSE_LADDER[index + 1]
}

export function strengthLabel(status: string, mastery: number): string {
  if (status === "stuck") return "Needs more work"
  if (status === "mastered") return "Solid"
  if (status === "review_due") return "Getting there"
  if (status === "unseen" || mastery <= 0) return "Not started"
  return mastery < 0.5 ? "Shaky" : "Getting there"
}

export function paceFor(recentRate: number | null): { itemCount: number; frontier: number; review: number; stretch: number } {
  if (recentRate != null && recentRate < 0.7) return shares(14, 0.35, 0.55)
  if (recentRate != null && recentRate >= 0.9) return shares(10, 0.4, 0.15)
  return shares(12, 0.6, 0.25)
}

export function applyTopicPick(slots: QueueSlot[], conceptIds: string[], mode: "assessment" | "homework" | "session"): QueueSlot[] {
  const ids = conceptIds.filter(Boolean)
  if (!ids.length) return slots
  let cursor = 0
  return slots.map((slot) => {
    if (slot.beat === "stretch") return slot
    const conceptId = ids[cursor % ids.length]
    if (mode === "assessment" && cursor >= ids.length) return slot
    cursor += 1
    return {
      ...slot,
      conceptId,
      interleaved: conceptId !== slot.conceptId,
      partnerConceptId: conceptId === slot.conceptId ? slot.partnerConceptId : slot.conceptId,
    }
  })
}

export function biasTowardWeak(slots: QueueSlot[], weakIds: string[], bloom: BloomLevel): QueueSlot[] {
  if (!weakIds.length) return slots
  const frontierSlots = slots.filter((slot) => slot.beat === "frontier").length
  const target = Math.max(1, Math.ceil(frontierSlots * 0.6))
  let replaced = 0
  return slots.map((slot) => {
    if (slot.beat !== "frontier" || replaced >= target) return slot
    const conceptId = weakIds[replaced % weakIds.length]
    replaced += 1
    return {
      ...slot,
      conceptId,
      bloomLevel: bloom,
      interleaved: conceptId !== slot.conceptId,
      partnerConceptId: conceptId === slot.conceptId ? null : slot.conceptId,
    }
  })
}

function shares(itemCount: number, frontierShare: number, reviewShare: number) {
  const frontier = Math.round(itemCount * frontierShare)
  const review = Math.round(itemCount * reviewShare)
  const stretch = Math.max(0, itemCount - frontier - review)
  return { itemCount, frontier, review, stretch }
}
