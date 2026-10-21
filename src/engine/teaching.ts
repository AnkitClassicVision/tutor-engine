import type { Schema } from '../runbook/schema.ts'
import { schemaErrors } from '../runbook/schema.ts'
import type { ConceptNode } from './types.ts'

export type KnowledgeDimension = 'factual' | 'conceptual' | 'procedural' | 'metacognitive'
export interface ApprovedTeaching {
  key: string
  title: string
  idea: string
  dimension: KnowledgeDimension
  success: { foundations: string; use: string; judge: string }
  contrast: { example: string; nonExample: string }
  misconceptions: Array<{ belief: string; probe: string; fix: string }>
  mission: string
  transfer: string
}

const text = (maxLength: number): Schema => ({ type: 'string', minLength: 1, maxLength })
const object = (properties: Record<string, Schema>): Schema => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const schema = object({
  key: text(60), title: text(120), idea: text(300),
  dimension: { enum: ['factual', 'conceptual', 'procedural', 'metacognitive'] },
  success: object({ foundations: text(600), use: text(600), judge: text(600) }),
  contrast: object({ example: text(300), nonExample: text(300) }),
  misconceptions: { type: 'array', minItems: 1, maxItems: 3, items: object({ belief: text(300), probe: text(300), fix: text(400) }) },
  mission: text(500), transfer: text(400),
})

/** Only bounded approved teaching fields reach a question writer or lesson. No title-word matching. */
export function approvedTeaching(value: unknown): ApprovedTeaching | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const picked = Object.fromEntries(Object.keys(schema.properties!).map(key => [key, row[key]]))
  if (schemaErrors(picked, schema).length || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(picked.key))) return null
  return structuredClone(picked) as unknown as ApprovedTeaching
}

export function selectTeaching(entries: unknown[], topic: string, key?: string): ApprovedTeaching | null {
  const list = entries.map(approvedTeaching).filter((entry): entry is ApprovedTeaching => Boolean(entry))
  const matches = key !== undefined ? list.filter(entry => entry.key === key)
    : list.filter(entry => entry.title.trim().toLowerCase() === topic.trim().toLowerCase())
  return matches.length === 1 ? matches[0] : null
}

export const TEACHING_ROUTE: Record<KnowledgeDimension, { label: string; cue: string }> = {
  factual: { label: 'Notice and remember', cue: 'Notice the key fact. Cover it, recall it, then check.' },
  conceptual: { label: 'Compare the ideas', cue: 'Compare what fits with what does not. Explain the difference.' },
  procedural: { label: 'Follow the reasons', cue: 'Follow each step and its reason. Then finish a new example.' },
  metacognitive: { label: 'Choose and check a plan', cue: 'Choose a strategy, say when it fits, and decide how to check it.' },
}

export interface LessonContext {
  version: 1
  conceptId: string
  title: string
  recall: string
  example: string
  nonExample: string
  teaching?: ApprovedTeaching
  mapVersion?: string
}
export function lessonContext(concept: ConceptNode): LessonContext {
  return { version: 1, conceptId: concept.conceptId, title: concept.title, recall: concept.recall, example: concept.example, nonExample: concept.nonExample,
    ...(concept.teaching ? { teaching: structuredClone(concept.teaching), mapVersion: concept.mapVersion } : {}) }
}
export function readLessonContext(raw: unknown): LessonContext | null {
  if (typeof raw !== 'string' || raw.length > 16000) return null
  try {
    const value = JSON.parse(raw)
    if (value.version !== 1 || !['conceptId','title','recall','example','nonExample'].every(key => typeof value[key] === 'string' && value[key].length <= 1500)) return null
    const teaching = value.teaching ? approvedTeaching(value.teaching) : undefined
    if (value.teaching && !teaching) return null
    return { version: 1, conceptId: value.conceptId, title: value.title, recall: value.recall, example: value.example, nonExample: value.nonExample,
      ...(teaching ? { teaching, mapVersion: typeof value.mapVersion === 'string' ? value.mapVersion.slice(0,100) : undefined } : {}) }
  } catch { return null }
}
