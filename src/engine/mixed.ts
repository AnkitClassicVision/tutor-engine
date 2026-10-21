import { createHash } from 'node:crypto'
import type { ConceptGraph } from './graph.ts'
import type { AttemptRecord, BloomLevel, ConceptNode, QueueSlot } from './types.ts'
import { freshEvidence } from './mastery.ts'
import { dayStamp } from './dates.ts'

export const MIXED_POLICY = 'mixed-context-v1'
export interface MixedEvidence {
  rule: typeof MIXED_POLICY
  kind: 'sequence'
  relationId: string
  mapVersion: string
  targetRevision: string
  partnerItemId: string
  partnerRevision: string
  partnerConceptId: string
  partnerDemand: number
  targetDemand: number
  partnerPosition: number
  targetPosition: number
  partnerAnsweredAt: string
  targetShownAt: string
  day: string
}

/** Authored inverse-operation comparisons, with no expansion of the learner's approved scope. */
const BUILTIN_PAIRS = [
  ['math.primary.1.add', 'math.primary.1.subtract'], ['math.primary.2.add', 'math.primary.2.subtract'],
  ['math.primary.3.multiply', 'math.primary.3.divide'],
]
export function mixedRelation(graph: ConceptGraph, leftId: string, rightId: string): { relationId: string; mapVersion: string } | null {
  const left = graph.nodes.get(leftId), right = graph.nodes.get(rightId)
  if (!left || !right || leftId === rightId || left.subject.toLowerCase() !== right.subject.toLowerCase()) return null
  const pair = [leftId, rightId].sort()
  let relationId: string | null = null
  if (left.prereqs.includes(rightId) || right.prereqs.includes(leftId)) relationId = `prerequisite:${pair.join(':')}`
  else {
    const shared = left.prereqs.filter(id => right.prereqs.includes(id)).sort()[0]
    if (shared) relationId = `shared-prerequisite:${shared}:${pair.join(':')}`
    else if (left.crossLinks?.includes(rightId) || right.crossLinks?.includes(leftId)) relationId = `approved-cross-link:${pair.join(':')}`
    else if (BUILTIN_PAIRS.some(ids => ids.includes(leftId) && ids.includes(rightId))) relationId = `authored-pair:${pair.join(':')}`
  }
  if (!relationId) return null
  const mapVersion = createHash('sha256').update(JSON.stringify(pair.map(id => {
    const node = graph.nodes.get(id)!
    return [id, node.subject, [...node.prereqs].sort(), [...(node.crossLinks ?? [])].sort(), node.mapVersion ?? 'backbone-v1']
  }))).digest('hex')
  return { relationId, mapVersion }
}

export function componentReady(attempts: AttemptRecord[], conceptId: string, demand: number): boolean {
  return freshEvidence(attempts).filter(a => a.conceptId === conceptId && a.bloomLevel === demand && a.correct && a.evidenceCertainty === 'confirmed').length >= 2
}
export function componentDemand(attempts: AttemptRecord[], node: ConceptNode): BloomLevel | null {
  for (const demand of [2, 1, 3, 4, 5, 6] as BloomLevel[]) if (componentReady(attempts, node.conceptId, demand)) return demand
  return null
}
export function eligiblePartner(graph: ConceptGraph, scope: Set<string>, attempts: AttemptRecord[], target: string, demand: number): { conceptId: string; bloom: BloomLevel; relationId: string; mapVersion: string } | null {
  if (!componentReady(attempts, target, demand)) return null
  for (const id of [...scope].sort()) {
    const node = graph.nodes.get(id), relation = mixedRelation(graph, target, id)
    const bloom = node ? componentDemand(attempts, node) : null
    if (relation && bloom) return { conceptId: id, bloom, ...relation }
  }
  return null
}

/** Replace redundant supports with a real pair; keep work and independent-work budgets unchanged. */
export function mixedArc(queue: QueueSlot[], target: QueueSlot, partner: { conceptId: string; bloom: BloomLevel } | null, minutes: number): QueueSlot[] {
  if (!partner) return queue
  const independent = queue.filter(slot => ['frontier', 'stretch', 'warmup', 'review'].includes(slot.beat))
  const due = queue.filter(slot => slot.beat === 'review')
  const opening = due.find(slot => slot.conceptId === partner.conceptId && slot.bloomLevel === partner.bloom)
  // A three-minute mission allows one independent target plus its existing due opening, if it qualifies.
  if (minutes === 3) {
    if (!opening) return queue
    const supported = queue.filter(slot => slot.beat === 'guided' || slot.beat === 'faded')
    return [opening, ...supported, { ...target, beat: 'frontier', interleaved: false, partnerConceptId: partner.conceptId }]
  }
  const capacity = independent.length - due.length
  if (opening && capacity >= 1) return [...due, { ...target, beat: 'frontier', interleaved: false, partnerConceptId: partner.conceptId },
    ...Array.from({ length: capacity - 1 }, () => ({ ...target, interleaved: false, partnerConceptId: null }))]
  if (capacity < 2) return queue
  const pair: QueueSlot[] = [
    { ...target, conceptId: partner.conceptId, bloomLevel: partner.bloom, beat: 'frontier', interleaved: false, partnerConceptId: null },
    { ...target, beat: 'frontier', interleaved: false, partnerConceptId: partner.conceptId },
  ]
  // Readiness demonstrates the components, so support beats can be omitted without adding independent work.
  return [...due, ...pair, ...Array.from({ length: capacity - 2 }, () => ({ ...target, interleaved: false, partnerConceptId: null }))]
}
export function readMixed(raw: unknown): MixedEvidence | undefined {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!value || value.rule !== MIXED_POLICY || value.kind !== 'sequence'
      || !['relationId','mapVersion','targetRevision','partnerItemId','partnerRevision','partnerConceptId','partnerAnsweredAt','targetShownAt','day'].every(key => typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= 600)
      || !['partnerDemand','targetDemand','partnerPosition','targetPosition'].every(key => Number.isInteger(value[key]) && value[key] > 0)
      || value.partnerDemand > 6 || value.targetDemand > 6 || value.partnerPosition >= value.targetPosition) return undefined
    const partnerAt = Date.parse(value.partnerAnsweredAt), shownAt = Date.parse(value.targetShownAt)
    if (!Number.isFinite(partnerAt) || !Number.isFinite(shownAt) || shownAt < partnerAt || shownAt - partnerAt > 30 * 60000
      || dayStamp(new Date(partnerAt)) !== value.day || dayStamp(new Date(shownAt)) !== value.day) return undefined
    return value as MixedEvidence
  } catch { return undefined }
}
