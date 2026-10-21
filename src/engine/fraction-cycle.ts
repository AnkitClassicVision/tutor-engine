import { FRACTION_OUTCOMES, FRACTION_OPERATION } from './fraction-forms.ts'
import type { AttemptRecord, BloomLevel, QueueSlot } from './types.ts'
import type { ConceptGraph } from './graph.ts'
import { prerequisiteClosure } from './graph.ts'
import { freshEvidence } from './mastery.ts'
import { componentDemand } from './mixed.ts'
import { daysBetween } from './dates.ts'

export const FRACTION_CHECKS = ['diagnostic_check', 'independent_check', 'delayed_check', 'transfer_check'] as const
export type FractionCheck = typeof FRACTION_CHECKS[number]
export const fractionCheck = (goal: unknown): FractionCheck | null => FRACTION_CHECKS.includes(goal as FractionCheck) ? goal as FractionCheck : null
export const fractionOutcome = (id: string) => FRACTION_OUTCOMES[id as keyof typeof FRACTION_OUTCOMES]
export const checkLabel = (goal: FractionCheck) => ({
  diagnostic_check: 'Find my starting point', independent_check: 'Check on my own',
  delayed_check: 'Check what stuck', transfer_check: 'Try a new situation',
})[goal]

/** Existing independent success can establish a component; unknown prerequisites are not silently marked complete. */
export function fractionGap(graph: ConceptGraph, attempts: AttemptRecord[], focus: string): string | null {
  if (!fractionOutcome(focus)) return null
  const evidence = freshEvidence(attempts)
  const tested = evidence.filter(a => a.conceptId === focus)
  // Established target success need not be retested just because older prerequisite records are absent.
  if (tested.filter(a => a.correct).length >= 2) return null
  return prerequisiteClosure(graph, [focus]).find(id => id !== focus && !componentDemand(attempts, graph.nodes.get(id)!)) ?? null
}

/** The diagnostic found an application gap after the foundations were demonstrated. Teach at that demand. */
export function fractionPracticeDemand(graph: ConceptGraph, attempts: AttemptRecord[], focus: string): BloomLevel | null {
  if (!fractionOutcome(focus) || fractionGap(graph, attempts, focus)) return null
  const last = freshEvidence(attempts).filter(a => a.conceptId === focus).slice(-2)
  return last.length === 2 && last.every(a => a.bloomLevel === 3 && a.task?.outcomeId === fractionOutcome(focus)?.id) ? 3 : null
}

/** Select a delayed calculation with actual authored success at the same outcome, form and demand. */
export function dueFraction(attempts: AttemptRecord[], focus: string, today: string): AttemptRecord | null {
  const rows = freshEvidence(attempts).filter(a => a.conceptId === focus && a.bloomLevel === 3 && a.kind !== 'transfer'
    && a.task?.outcomeId === fractionOutcome(focus)?.id && a.task?.parallelFormId)
  const latest = rows.at(-1)
  return latest?.correct && daysBetween(latest.day, today) >= 7 ? latest : null
}

export function fractionCheckQueue(graph: ConceptGraph, attempts: AttemptRecord[], focus: string, goal: FractionCheck, today: string): QueueSlot[] {
  if (!fractionOutcome(focus)) return []
  const slot = (conceptId: string, level: BloomLevel, beat: QueueSlot['beat'] = 'frontier'): QueueSlot =>
    ({ conceptId, bloomLevel: level, beat, interleaved: false, partnerConceptId: null, scored: level <= 4 })
  if (goal === 'diagnostic_check') {
    const prerequisites = prerequisiteClosure(graph, [focus]).filter(id => id !== focus && fractionOutcome(id)
      && !componentDemand(attempts, graph.nodes.get(id)!)).slice(0, 2)
    return [...prerequisites.flatMap(id => [slot(id, 3), slot(id, 3)]), slot(focus, 3), slot(focus, 3)]
  }
  if (goal === 'delayed_check') return dueFraction(attempts, focus, today) ? [slot(focus, 3, 'review'), slot(focus, 3, 'review')] : []
  if (goal === 'transfer_check') return [FRACTION_OPERATION, 'math.5.nf.a.1'].includes(focus) ? [slot(focus, 4)] : []
  return [3, 3, 4, 5, 6].map(level => slot(focus, level as BloomLevel))
}
