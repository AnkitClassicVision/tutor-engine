import { freshEvidence, masteryMet, reduceState, mixedWin } from './mastery.ts'
import { learningMilestones } from './adventure.ts'
import type { AttemptRecord, BloomLevel, ConceptNode } from './types.ts'

export type StrengthStatus = 'demonstrated' | 'review' | 'growing' | 'supported' | 'pending' | 'unseen'
export const STRENGTH_LABEL: Record<StrengthStatus, string> = {
  demonstrated: 'Demonstrated', review: 'Ready for review', growing: 'Growing',
  supported: 'Learning with help', pending: 'Awaiting review', unseen: 'Not yet checked',
}
export const STRENGTH_SYMBOL: Record<StrengthStatus, string> = {
  demonstrated: '✦', review: '↻', growing: '◒', supported: '♡', pending: '…', unseen: '○',
}

/** One projection of existing records, with no writes or age-based ability assumptions. */
export function strengthGraph(concepts: ConceptNode[], attempts: AttemptRecord[], pending: Record<string, number>, roots: string[], today: string, allFoundations = false) {
  const known = new Map(concepts.map(c => [c.conceptId, c]))
  const rootIds = new Set([...roots, ...attempts.map(a => a.conceptId), ...Object.keys(pending)].filter(id => known.has(id)))
  const included = new Set(rootIds)
  const addParents = (id: string) => {
    for (const parent of known.get(id)?.prereqs ?? []) {
      if (!known.has(parent) || included.has(parent)) continue
      included.add(parent)
      if (allFoundations) addParents(parent)
    }
  }
  for (const id of rootIds) addParents(id)
  // Deduplicate across the learner's whole history before grouping by concept.
  const evidence = freshEvidence(attempts)
  const milestones = learningMilestones(attempts)
  const nodes = concepts.filter(c => included.has(c.conceptId)).map(concept => {
    const rows = attempts.filter(a => a.conceptId === concept.conceptId)
    const checks = evidence.filter(a => a.conceptId === concept.conceptId)
    const levels = ([1, 2, 3, 4, 5, 6] as BloomLevel[]).map(level => {
      const comparable = checks.filter(a => a.bloomLevel === level)
      const wins = comparable.filter(a => a.correct)
      return { level, checks: comparable.length, successes: wins.length, days: new Set(comparable.map(a => a.day)).size,
        successDays: new Set(wins.map(a => a.day)).size, successSessions: new Set(wins.map(a => a.sessionId)).size,
        mixedSuccess: wins.some(mixedWin), demonstrated: masteryMet(checks, level) }
    })
    const demonstrated = levels.filter(l => l.demonstrated).map(l => l.level)
    const state = reduceState(concept.conceptId, attempts, today, 'screen')
    const supported = rows.filter(a => a.evidenceCertainty === 'confirmed' && a.correct && (a.hintsUsed > 0 || a.supportUsed && a.supportUsed !== 'none')).length
    const unresolved = rows.filter(a => a.evidenceCertainty === 'unresolved').length + (pending[concept.conceptId] ?? 0)
    const due = checks.length > 0 && (state.nextDue <= today || state.status === 'review_due')
    const status: StrengthStatus = due ? 'review' : demonstrated.length ? 'demonstrated' : checks.length ? 'growing' : supported ? 'supported' : unresolved ? 'pending' : 'unseen'
    const latest = checks.at(-1)
    return { ...concept, status, levels, demonstrated, independent: checks.length, successes: checks.filter(a => a.correct).length,
      supported, unresolved, legacy: rows.filter(a => a.evidenceCertainty === 'legacy').length,
      repeated: rows.filter(a => a.fresh === false && a.evidenceCertainty !== 'legacy').length,
      lastCheck: latest?.day ?? null, nextDue: checks.length ? state.nextDue : null,
      latestMiss: latest?.correct === false, foundation: !rootIds.has(concept.conceptId),
      retainedOn: milestones.find(m => m.conceptId === concept.conceptId && m.kind === 'retention')?.day ?? null }
  })
  const edges = nodes.flatMap(node => node.prereqs.filter(id => included.has(id)).map(from => ({ from, to: node.conceptId })))
  return { nodes, edges, rootIds: [...rootIds] }
}
export type StrengthGraph = ReturnType<typeof strengthGraph>
export type StrengthNode = StrengthGraph['nodes'][number]

/** Stable prerequisite columns. Unknown or cyclic links never recurse indefinitely. */
export function strengthLayout(nodes: StrengthNode[], edges: StrengthGraph['edges']) {
  const depths = new Map<string, number>()
  const depth = (id: string, visiting = new Set<string>()): number => {
    if (depths.has(id)) return depths.get(id)!
    if (visiting.has(id)) return 0
    const parents = edges.filter(e => e.to === id)
    const next = new Set(visiting).add(id)
    const value = parents.length ? Math.max(...parents.map(e => depth(e.from, next))) + 1 : 0
    depths.set(id, value)
    return value
  }
  const columns = new Map<number, StrengthNode[]>()
  for (const node of nodes) {
    const d = depth(node.conceptId)
    columns.set(d, [...(columns.get(d) ?? []), node])
  }
  const positions = new Map<string, { x: number; y: number }>()
  for (const [column, members] of columns) members.sort((a, b) => a.grade - b.grade || a.title.localeCompare(b.title)).forEach((node, row) => positions.set(node.conceptId, { x: 24 + column * 264, y: 24 + row * 184 }))
  return { positions, width: Math.max(288, columns.size * 264 + 24), height: Math.max(216, ...[...columns.values()].map(m => m.length * 184 + 32)) }
}
