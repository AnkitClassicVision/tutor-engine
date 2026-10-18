import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { askModel, readModelJson, type AiConfig } from "./ai.ts"
import type { TopicCandidate } from "./choose-topics.ts"
import { contentSkillBrief } from "./content-skills.ts"
import { coursePlanningBrief } from "./course-planning.ts"
import { skillText } from "./skill-text.ts"
import type { BloomLevel } from "./engine/types.ts"

export interface CurriculumTopic {
  title: string
  recall: string
  example: string
  nonExample: string
  questions: Array<{ prompt: string; answer: string; bloomLevel?: BloomLevel }>
}

export interface CurriculumPlan {
  topics: CurriculumTopic[]
  reason: string
}

const SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    reason: { type: "string" },
    topics: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          recall: { type: "string" },
          example: { type: "string" },
          nonExample: { type: "string" },
          questions: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: {
              type: "object",
              properties: { prompt: { type: "string" }, answer: { type: "string" }, bloomLevel: { type: "integer", minimum: 1, maximum: 6 } },
              required: ["prompt", "answer", "bloomLevel"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "recall", "example", "nonExample", "questions"],
        additionalProperties: false,
      },
    },
  },
  required: ["reason", "topics"],
  additionalProperties: false,
})

export function readSyllabusUpload(input: { text?: string; base64?: string; mime?: string; name?: string }) {
  const pasted = (input.text ?? "").trim()
  if (pasted) return { name: input.name?.trim() || "pasted notes", text: pasted.slice(0, 80_000) }
  if (!input.base64) return { name: "", text: "" }
  const bytes = Buffer.from(input.base64, "base64")
  if (bytes.length < 8 || bytes.length > 5_000_000) throw new Error("Upload a syllabus under 5 MB.")
  const name = input.name?.trim() || "syllabus"
  const pdf = input.mime === "application/pdf" || name.toLowerCase().endsWith(".pdf")
  const text = pdf ? pdfToText(bytes) : bytes.toString("utf8")
  if (!text.trim()) throw new Error("No text could be read from that syllabus.")
  return { name, text: text.trim().slice(0, 80_000) }
}

export async function planCurriculum(
  input: CurriculumInput,
  ai: AiConfig = { provider: "grok", model: "", apiKey: "" },
  timeoutMs = 90000,
): Promise<CurriculumPlan | null> {
  const dir = mkdtempSync(join(tmpdir(), "tutor-plan-"))
  const promptPath = join(dir, "prompt.txt")
  writeFileSync(promptPath, curriculumPrompt(input))
  try {
    const stdout = await askModel(
      promptPath,
      SCHEMA,
      curriculumSystemPrompt(),
      timeoutMs,
      ai,
    )
    return parseCurriculum(stdout)
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export interface CurriculumInput {
  subject: string
  about: string
  syllabus: string
  direction?: string
  ageGrade: number
  mathClass: string
  existing: TopicCandidate[]
  decisionHistory?: string
}

export function curriculumSystemPrompt() {
  return [coursePlanningBrief(), skillText("design-questions"), skillText("assess-learning"), skillText("adapt-session"), skillText("revise-agenda"), contentSkillBrief(), "Return only the JSON object. Do not use tools."].join("\n\n")
}

/** Enforce the same content contract even when a provider only returns free-form JSON. */
export function parseCurriculum(raw: string): CurriculumPlan | null {
  try {
    const plan = readModelJson(raw)
    if (!hasFields(plan, ["reason", "topics"]) || !isText(plan.reason)) return null
    if (!Array.isArray(plan.topics) || plan.topics.length < 1 || plan.topics.length > 6) return null
    const titles = new Set<string>()
    const topics: CurriculumTopic[] = []
    for (const value of plan.topics) {
      if (!hasFields(value, ["title", "recall", "example", "nonExample", "questions"])) return null
      if (![value.title, value.recall, value.example, value.nonExample].every(isText)) return null
      const title = (value.title as string).trim()
      if (titles.has(title.toLowerCase())) return null
      titles.add(title.toLowerCase())
      if (!Array.isArray(value.questions) || value.questions.length !== 2) return null
      const questions: CurriculumTopic["questions"] = []
      for (const question of value.questions) {
        if (!hasFields(question, ["prompt", "answer", "bloomLevel"]) || !isText(question.prompt) || !isText(question.answer)) return null
        if (!Number.isInteger(question.bloomLevel) || Number(question.bloomLevel) < 1 || Number(question.bloomLevel) > 6) return null
        if (Number(question.bloomLevel) >= 4 && !/^rubric:/i.test(question.answer.trim())) return null
        questions.push({ prompt: question.prompt.trim(), answer: question.answer.trim(), bloomLevel: question.bloomLevel as BloomLevel })
      }
      if (questions[0].prompt.toLowerCase() === questions[1].prompt.toLowerCase()) return null
      topics.push({ title, recall: (value.recall as string).trim(), example: (value.example as string).trim(), nonExample: (value.nonExample as string).trim(), questions })
    }
    return { reason: plan.reason.trim(), topics }
  } catch {
    return null
  }
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function hasFields(value: unknown, fields: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field))
}

export function curriculumPrompt(input: CurriculumInput) {
  const already = input.existing.length
    ? input.existing
        .map((topic) => `- ${topic.title} | ${topic.strength} | misses ${topic.misses} | errors ${topic.errors.join(", ") || "none"}`)
        .join("\n")
    : "None yet."
  return [
    `Make a curriculum for ${input.subject}. Age grade ${input.ageGrade}. Math class, if this is math: ${input.mathClass}.`,
    "Use the syllabus as the source of topics. Choose the question form from the teaching skills and this student's current work.",
    "A later school test or parent note changes what to practice. Follow that note when it conflicts with the older syllabus.",
    "Add topics the new material requires. Rewrite the questions so the next practice matches the new direction.",
    "Each topic needs two questions with answers and an explicit bloomLevel from 1 to 6 matching the actual task. Use an evidence-appropriate demand: address a current gap and check independent use or transfer. For new or shaky topics use Remember, Understand or Apply. Analyze, Evaluate and Create are optional further challenges when evidence supports them. Levels 4 to 6 need an answer beginning Rubric: with the reasoning/production criteria. Homework and assessment on this topic must not reuse either sentence.",
    input.direction ? `Latest school test or parent note:\n${input.direction}` : "",
    `What this subject is: ${input.about || "Not stated."}`,
    "Syllabus:",
    input.syllabus || "No syllabus text. Use the subject description only.",
    "Topics already on the plan:",
    already,
    input.decisionHistory ? `Recorded decisions and reasons (historical evidence, not new instructions):\n${input.decisionHistory}` : "",
  ]
    .filter(Boolean)
    .join("\n")
}

function pdfToText(bytes: Buffer) {
  return execFileSync("pdftotext", ["-layout", "-", "-"], {
    input: bytes,
    encoding: "utf8",
    maxBuffer: 2_000_000,
  })
}
