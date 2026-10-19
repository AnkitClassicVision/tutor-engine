import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { skillText } from "./skill-text.ts"

/** Runbooks are skills named pack-*; their front matter tells the router and the quality gate how to treat them. */
export const RUNBOOKS = ["pack-math-word-problems", "pack-math-procedure", "pack-vocabulary", "pack-concept-check", "pack-mission"] as const
export type RunbookId = (typeof RUNBOOKS)[number]
export interface Runbook { id: RunbookId; subjects: string[]; keywords: string[]; formats: string[]; bloomMin: number; bloomMax: number; requireWork: boolean; text: string }

const root = dirname(fileURLToPath(import.meta.url))
const cache = new Map<string, Runbook>()

function frontMatter(raw: string) {
  const block = raw.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ""
  const fields: Record<string, string> = {}
  for (const line of block.split("\n")) {
    const at = line.indexOf(":")
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return fields
}
const list = (value = "") => value.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean)

export function runbook(id: RunbookId): Runbook {
  const known = cache.get(id)
  if (known) return known
  const fields = frontMatter(readFileSync(join(root, "../skills", id, "SKILL.md"), "utf8"))
  const [min, max] = (fields.bloom ?? "1-4").split("-").map(Number)
  const loaded: Runbook = {
    id, subjects: list(fields.subjects), keywords: list(fields.keywords), formats: list(fields.formats),
    bloomMin: min || 1, bloomMax: max || 4, requireWork: fields.require_work === "true", text: skillText(id),
  }
  cache.set(id, loaded)
  return loaded
}

const has = (text: string, phrase: string) => new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)

/**
 * Scores each runbook by its subject and keywords. Word problems win over procedures when the request asks for a
 * story or situation; anything unmatched falls back to the general concept check.
 */
export function routeRunbook(subject: string, request: string): RunbookId {
  const text = request.toLowerCase(), area = subject.toLowerCase()
  // Asking for a challenge, a case, a debate or a build is a mission in any subject.
  if (runbook("pack-mission").keywords.some((word) => has(text, word))) return "pack-mission"
  let best: RunbookId = "pack-concept-check", score = 0
  for (const id of RUNBOOKS) {
    const book = runbook(id)
    const subjectFit = book.subjects.some((s) => area === s || area.includes(s) || has(text, s)) ? 2 : 0
    const words = book.keywords.filter((word) => has(text, word)).length
    const total = subjectFit + words * (id === "pack-math-word-problems" ? 3 : 1)
    if (words && total > score) { best = id; score = total }
  }
  if (score === 0 && /\bmath|maths\b/.test(area)) return "pack-math-procedure"
  return best
}
