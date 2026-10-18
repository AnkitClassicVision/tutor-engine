import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ConceptNode, LearnerConceptState } from "./types.ts"

export interface ConceptGraph {
  nodes: Map<string, ConceptNode>
  dependents: Map<string, string[]>
}

export function buildGraph(concepts: ConceptNode[]): ConceptGraph {
  const nodes = new Map<string, ConceptNode>()
  for (const concept of concepts) {
    if (nodes.has(concept.conceptId)) {
      throw new Error(`duplicate concept: ${concept.conceptId}`)
    }
    nodes.set(concept.conceptId, concept)
  }
  for (const concept of concepts) {
    for (const prereq of concept.prereqs) {
      if (!nodes.has(prereq)) {
        throw new Error(`${concept.conceptId} lists missing prereq ${prereq}`)
      }
    }
  }
  const dependents = new Map<string, string[]>()
  for (const concept of concepts) dependents.set(concept.conceptId, [])
  for (const concept of concepts) {
    for (const prereq of concept.prereqs) dependents.get(prereq)!.push(concept.conceptId)
  }
  assertAcyclic(nodes)
  return { nodes, dependents }
}

export function loadBackbone(): ConceptGraph {
  const here = dirname(fileURLToPath(import.meta.url))
  const raw = JSON.parse(readFileSync(join(here, "../data/math-backbone.json"), "utf8")) as {
    concepts: ConceptNode[]
  }
  return buildGraph(raw.concepts)
}

export function feeds(graph: ConceptGraph, conceptId: string): string[] {
  return [...(graph.dependents.get(conceptId) ?? [])]
}

export function prerequisiteClosure(graph: ConceptGraph, roots: string[]): string[] {
  const needed = new Set<string>()
  const visit = (id: string) => {
    if (needed.has(id)) return
    const node = graph.nodes.get(id)
    if (!node) throw new Error(`unknown concept: ${id}`)
    needed.add(id)
    for (const prereq of node.prereqs) visit(prereq)
  }
  for (const root of roots) visit(root)
  return topo(graph, needed)
}

export function probeFailures(
  graph: ConceptGraph,
  roots: string[],
  states: Record<string, Pick<LearnerConceptState, "mastery" | "status"> | undefined>,
  limit = 3,
): string[] {
  const ordered = prerequisiteClosure(graph, roots)
  const failing = ordered.filter((id) => {
    const state = states[id]
    if (!state) return true
    if (state.status === "stuck" || state.status === "unseen" || state.status === "frontier") return true
    return state.mastery < 0.7
  })
  return failing.slice(0, limit)
}

function assertAcyclic(nodes: Map<string, ConceptNode>) {
  const color = new Map<string, 0 | 1 | 2>()
  const visit = (id: string) => {
    const mark = color.get(id) ?? 0
    if (mark === 1) throw new Error(`cycle at ${id}`)
    if (mark === 2) return
    color.set(id, 1)
    for (const prereq of nodes.get(id)!.prereqs) visit(prereq)
    color.set(id, 2)
  }
  for (const id of nodes.keys()) visit(id)
}

function topo(graph: ConceptGraph, needed: Set<string>): string[] {
  const indegree = new Map<string, number>()
  for (const id of needed) indegree.set(id, 0)
  for (const id of needed) {
    for (const prereq of graph.nodes.get(id)!.prereqs) {
      if (needed.has(prereq)) indegree.set(id, (indegree.get(id) ?? 0) + 1)
    }
  }
  const ready = [...needed].filter((id) => indegree.get(id) === 0).sort()
  const ordered: string[] = []
  while (ready.length) {
    const id = ready.shift()!
    ordered.push(id)
    for (const child of graph.dependents.get(id) ?? []) {
      if (!needed.has(child)) continue
      indegree.set(child, (indegree.get(child) ?? 0) - 1)
      if (indegree.get(child) === 0) {
        ready.push(child)
        ready.sort()
      }
    }
  }
  if (ordered.length !== needed.size) throw new Error("cycle in closure")
  return ordered
}
