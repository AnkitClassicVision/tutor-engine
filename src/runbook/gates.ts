// Shared rules every runbook can use. They run in code after a model replies, so they hold the
// same way whichever model wrote the output. A blocking issue stops or prunes the output; the
// rest are warnings that are recorded and shown to reviewers.

import { safetyReply } from "../child-safety.ts"
import { promptIdentity } from "../session-feedback.ts"

export interface Issue { rule: string; message: string; block: boolean; item?: number }

export const issue = (rule: string, message: string, block = true, item?: number): Issue => ({ rule, message, block, ...(item === undefined ? {} : { item }) })

/** Any text a child could see must pass the same safety tripwires as chat. */
// Material written for a child never asks for personal details, whatever the model was told.
const PERSONAL = /\b(home address|your address|where (?:do )?you live|phone number|password|your (?:school's )?name and|last name|send (?:me )?(?:a )?(?:photo|picture|selfie)|meet (?:me|up))\b/i

export function childSafe(texts: Array<string | undefined | null>, item?: number): Issue[] {
  return texts.some(text => text && (safetyReply(text) || PERSONAL.test(text))) ? [issue("child_safety", "Contains wording that the child-safety check refuses.", true, item)] : []
}

/** A prompt must not hand over its own key. Short or numeric keys are skipped: "4" appears in many fair prompts. */
export function noLeak(prompt: string, answer: string, item?: number): Issue[] {
  const key = answer.replace(/^rubric:\s*/i, "").trim().toLowerCase()
  if (key.length < 6 || /^[-\d.,/\s%$]+$/.test(key)) return []
  return prompt.toLowerCase().includes(key) ? [issue("answer_leak", "The question contains its own answer.", true, item)] : []
}

/** A sentence the learner has already seen is used up. */
export function fresh(prompt: string, seen: Iterable<string>, item?: number): Issue[] {
  const used = new Set([...seen].map(promptIdentity))
  return used.has(promptIdentity(prompt)) ? [issue("not_fresh", "Repeats a question the learner has already seen.", true, item)] : []
}

/** Two items in one output may not be the same question. */
export function distinct(prompts: string[]): Issue[] {
  const seen = new Map<string, number>(), found: Issue[] = []
  prompts.forEach((prompt, index) => {
    const key = promptIdentity(prompt)
    if (seen.has(key)) found.push(issue("duplicate", "Two questions are the same.", true, index))
    else seen.set(key, index)
  })
  return found
}

const syllables = (word: string) => Math.max(1, (word.toLowerCase().replace(/[^a-z]/g, "").replace(/e$/, "").match(/[aeiouy]+/g) ?? []).length)

/** Flesch-Kincaid grade estimate. Rough on short text, so it only warns. */
export function readingGrade(text: string): number {
  const words = text.match(/[A-Za-z']+/g) ?? []
  if (words.length < 8) return 0
  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) ?? []).length)
  const total = words.reduce((sum, word) => sum + syllables(word), 0)
  return Math.round((0.39 * (words.length / sentences) + 11.8 * (total / words.length) - 15.59) * 10) / 10
}

export function readingFit(text: string, grade: number, item?: number): Issue[] {
  const level = readingGrade(text)
  return level > Math.max(3, grade + 3) ? [issue("reading_level", `Reads at about grade ${level}, well above grade ${grade}.`, false, item)] : []
}

// Cue words a task at each demand usually carries. A model can meet a level without them, so a
// missing cue is a warning for the reviewer, not a block.
const BLOOM_CUES: Record<number, RegExp> = {
  4: /\b(why|compare|contrast|differen|pattern|what went wrong|mistake|error|which (step|part)|relationship|cause|sort|classif|organi[sz]e|explain how)\b/i,
  5: /\b(better|best|worse|judge|decide|choose|would you|agree|disagree|convinc|defend|critique|evaluate|fair|strong|weak|recommend|rank|justify|which .* and why)\b/i,
  6: /\b(design|create|invent|make up|write (your own|a new|a)|plan|build|compose|propose|come up with|new (example|problem|rule|way))\b/i,
}

export function bloomCue(prompt: string, level: number, item?: number): Issue[] {
  const cue = BLOOM_CUES[level]
  return cue && !cue.test(prompt) ? [issue("bloom_cue", `Labelled Bloom ${level} but the wording does not ask for that kind of thinking.`, false, item)] : []
}

/** Factual material for a new subject must say where it came from. */
export function sourced(sources: Array<{ title?: string; url?: string }>, minimum = 1): Issue[] {
  const usable = sources.filter(source => source.title?.trim() && (!source.url || /^https:\/\/[^\s]+$/.test(source.url)))
  return usable.length < minimum ? [issue("sources", `Lists ${usable.length} usable source${usable.length === 1 ? "" : "s"}; at least ${minimum} required.`)] : []
}

export const blocking = (issues: Issue[]) => issues.filter(found => found.block)
