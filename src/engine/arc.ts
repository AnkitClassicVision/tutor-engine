import type { QueueSlot } from "./types.ts"

// A practice mission as a complete arc (panel round 2, item 3): a short lesson card,
// one guided item, one faded item, independent items, one spaced review, then the close.
// Guided and faded items start with a hint showing, so they count as supported work,
// never as independent evidence. The chosen minutes set how many independent items run;
// a shorter mission loses independent items before it loses the review or the close.
export const ARC_INDEPENDENT: Record<number, number> = { 3: 1, 5: 2, 10: 4, 15: 6, 20: 8, 25: 10 }

export function missionArc(queue: QueueSlot[], minutes: number, scaffold = true): QueueSlot[] {
  const work = queue.filter((slot) => slot.beat === "frontier" || slot.beat === "stretch")
  const main = queue.find((slot) => slot.beat === "frontier") ?? work[0] ?? queue[0]
  if (!main) return queue
  const review = queue.find((slot) => slot.beat === "warmup" && slot.conceptId !== main.conceptId)
  const plain = { ...main, interleaved: false, partnerConceptId: null }
  const pool = work.length ? work : [main]
  const count = ARC_INDEPENDENT[minutes] ?? 4
  const independent = Array.from({ length: count }, (_, i) => pool[i % pool.length])
  return [
    ...(scaffold ? [{ ...plain, beat: "guided" as const }, { ...plain, beat: "faded" as const }] : []),
    ...independent,
    ...(review ? [{ ...review, beat: "review" as const, interleaved: false, partnerConceptId: null }] : []),
  ]
}
