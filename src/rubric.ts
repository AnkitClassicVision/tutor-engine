// Rubrics for open-response questions, written together with the question. Flexible enough to accept
// the different ways a child might say a right idea; scoped enough to name what does not count.
// Every grader — first, second and grounding — marks against the stored rubric.

import { childSafe, issue, type Issue } from "./runbook/gates.ts"
import type { Schema } from "./runbook/schema.ts"

export interface RubricPointSpec { point: string; acceptable: string[] }
export interface Rubric {
  /** What the answer must show. Each point lists several acceptable ways a child might say it. */
  mustShow: RubricPointSpec[]
  /** Answers that sound close but do not meet it: misconceptions, a right answer with a wrong reason. */
  doesNotMeet: string[]
  /** What a grader must not mark down: spelling, units not asked for, extra steps, length. */
  notRequired: string[]
  examples: { meets: string; almost: string; notYet: string }
}

const short = (max: number): Schema => ({ type: "string", minLength: 1, maxLength: max })
export const RUBRIC_SCHEMA: Schema = {
  type: "object", additionalProperties: false, required: ["mustShow", "doesNotMeet", "notRequired", "examples"],
  properties: {
    mustShow: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["point", "acceptable"], properties: { point: short(200), acceptable: { type: "array", minItems: 1, maxItems: 6, items: short(160) } } } },
    doesNotMeet: { type: "array", minItems: 1, maxItems: 5, items: short(200) },
    notRequired: { type: "array", maxItems: 5, items: short(160) },
    examples: { type: "object", additionalProperties: false, required: ["meets", "almost", "notYet"], properties: { meets: short(400), almost: short(400), notYet: short(400) } },
  },
}

export const RUBRIC_BRIEF = [
  "Every open-response question (any answer that begins with \"Rubric:\", and every written answer) also gets a rubric object, written for this exact question:",
  "- mustShow: one to four points the answer must show. For each, list two to five acceptable ways a child might say it, in their own words, including everyday wording and common misspellings of key words. A different correct method or wording also counts.",
  "- doesNotMeet: one to five answers that sound close but do not meet it, such as a common misconception, a right answer with a wrong reason, or repeating the question.",
  "- notRequired: things a grader must not mark down, such as spelling, full sentences, units the question did not ask for, extra steps, or length.",
  "- examples: meets (a short answer a child could give that meets every point), almost (one that misses one point), notYet (one that shows the misconception).",
  "Keep it scoped to what the question asks; never require anything the question did not ask for.",
].join("\n")

/** Shape checks that keep a rubric usable: flexible (more than one way to say each point) and scoped (what does not count). */
export function rubricIssues(rubric: Rubric | undefined, item?: number): Issue[] {
  if (!rubric) return [issue("rubric_missing", "An open-response question has no rubric.", true, item)]
  const found: Issue[] = []
  for (const point of rubric.mustShow) if (point.acceptable.length < 2) found.push(issue("rubric_narrow", "A rubric point accepts only one way of saying it.", false, item))
  const { meets, almost, notYet } = rubric.examples
  if (new Set([meets, almost, notYet].map(text => text.trim().toLowerCase())).size < 3) found.push(issue("rubric_examples", "The rubric's example answers are not distinct.", true, item))
  found.push(...childSafe([meets, almost, notYet, ...rubric.mustShow.flatMap(point => point.acceptable)], item))
  return found
}

export function parseRubric(value: unknown): Rubric | undefined {
  if (!value || typeof value !== "object") return undefined
  const r = value as Rubric
  return Array.isArray(r.mustShow) && Array.isArray(r.doesNotMeet) && r.examples ? r : undefined
}

export const readRubric = (json: unknown): Rubric | undefined => { try { return json ? parseRubric(JSON.parse(String(json))) : undefined } catch { return undefined } }

/** True when the answer is open (a reasoning key or a written answer) and needs a rubric to be graded well. */
export const isOpen = (answer: string, format = "text") => /^rubric:/i.test(answer.trim()) || format === "written"
