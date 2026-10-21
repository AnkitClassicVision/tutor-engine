import { retentionChecks } from "./evidence.ts"
import { createHash } from 'node:crypto'
import { daysBetween } from './dates.ts'
import { chronological, freshEvidence, masteryMet } from './mastery.ts'
import type { AttemptRecord, BloomLevel } from './types.ts'

export interface LearningMilestone {
  id: string
  conceptId: string
  kind: 'learning_step' | 'understanding' | 'application' | 'retention'
  day: string
  evidenceCount: number
}

/** Stable milestone IDs: replaying history or repeating answers cannot mint rewards. */
export function learningMilestones(attempts: AttemptRecord[]): LearningMilestone[] {
  const milestones: LearningMilestone[] = []
  const evidence = freshEvidence(attempts)
  for (const conceptId of new Set(attempts.map(a => a.conceptId))) {
    const step = [...attempts].sort(chronological).find(a => a.conceptId === conceptId && a.correct && a.evidenceCertainty === 'confirmed')
    if (step) milestones.push({ id: `${conceptId}:learning_step`, conceptId, kind: 'learning_step', day: step.day, evidenceCount: 1 })
    const rows = evidence.filter(a => a.conceptId === conceptId)
    for (const [level, kind] of [[2, 'understanding'], [3, 'application']] as const) {
      const hit = rows.findIndex((_, i) => masteryMet(rows.slice(0, i + 1), level as BloomLevel))
      if (hit < 0) continue
      const wins = rows.slice(0, hit + 1).filter(a => a.correct && a.bloomLevel === level)
      milestones.push({ id: `${conceptId}:${kind}`, conceptId, kind, day: rows[hit].day, evidenceCount: wins.length })
      const retained = retentionChecks(rows.slice(hit), 7).find(pair => pair.after.correct && pair.after.bloomLevel === level
        && (pair.after.evidencePolicy === undefined || pair.after.evidencePolicy === 1 && pair.unrefreshed))?.after
      if (retained && !milestones.some(m => m.id === `${conceptId}:retention`)) milestones.push({ id: `${conceptId}:retention`, conceptId, kind: 'retention', day: retained.day, evidenceCount: wins.length + 1 })
    }
  }
  const recorded = [...new Map(attempts.flatMap(a => a.historical?.milestones ?? []).map(m => [m.id, m])).values()]
  return [...recorded, ...milestones.filter(m => !recorded.some(old => old.id === m.id))]
}

const KEEPSAKES = [
  { symbol: '✦', name: 'Starlight compass', color: '#ffcf00' },
  { symbol: '❀', name: 'Meadow blossom', color: '#fde8e5' },
  { symbol: '☁', name: 'Cloud explorer', color: '#e4eefc' },
  { symbol: '◆', name: 'River pebble', color: '#e1f2e6' },
  { symbol: '☀', name: 'Morning sun', color: '#fff5c7' },
  { symbol: '✧', name: 'Moonlight spark', color: '#eef0f4' },
]
/** Cosmetic variation is attached to an earned milestone. No rerolls, rarity or chance payouts. */
export function milestoneKeepsake(milestone: LearningMilestone) {
  return KEEPSAKES[createHash('sha256').update(milestone.id).digest()[0] % KEEPSAKES.length]
}
