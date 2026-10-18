import type { BloomLevel, QueueSlot } from "./types.ts"

export function mixCounts(itemCount: number): { frontier: number; review: number; stretch: number } {
  if (itemCount <= 0) return { frontier: 0, review: 0, stretch: 0 }
  const frontier = Math.round(itemCount * 0.6)
  let review = Math.round(itemCount * 0.25)
  let stretch = itemCount - frontier - review
  if (stretch < 0) {
    review += stretch
    stretch = 0
  }
  if (review < 0) return { frontier: itemCount, review: 0, stretch: 0 }
  return { frontier, review, stretch }
}

export function buildQueue(input: {
  frontierConceptId: string
  frontierBloom: BloomLevel
  review: Array<{ conceptId: string; bloom: BloomLevel }>
  stretchConceptId: string | null
  itemCount?: number
  counts?: { frontier: number; review: number; stretch: number }
}): QueueSlot[] {
  const counts = input.counts ?? mixCounts(input.itemCount ?? 12)
  const slots: QueueSlot[] = []
  const reviewPool = input.review.filter((row) => row.conceptId !== input.frontierConceptId)
  for (let index = 0; index < counts.review; index += 1) {
    const row = reviewPool[index % Math.max(reviewPool.length, 1)]
    if (!row) {
      slots.push(slot("warmup", input.frontierConceptId, input.frontierBloom, false, null))
    } else {
      slots.push(slot("warmup", row.conceptId, row.bloom, true, input.frontierConceptId))
    }
  }
  for (let index = 0; index < counts.frontier; index += 1) {
    slots.push(slot("frontier", input.frontierConceptId, input.frontierBloom, false, null))
  }
  const stretchId =
    input.stretchConceptId && input.stretchConceptId !== input.frontierConceptId
      ? input.stretchConceptId
      : reviewPool[0]?.conceptId ?? null
  for (let index = 0; index < counts.stretch; index += 1) {
    if (!stretchId) {
      slots.push(slot("frontier", input.frontierConceptId, input.frontierBloom, false, null))
    } else {
      slots.push(slot("stretch", input.frontierConceptId, Math.min(6, input.frontierBloom + 1) as BloomLevel, true, stretchId))
    }
  }
  return slots
}

function slot(
  beat: QueueSlot["beat"],
  conceptId: string,
  bloomLevel: BloomLevel,
  interleaved: boolean,
  partnerConceptId: string | null,
): QueueSlot {
  return { beat, conceptId, bloomLevel, interleaved, partnerConceptId, scored: bloomLevel <= 4 }
}
