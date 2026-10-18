import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface TopicCandidate {
  id: string
  title: string
  strength: string
  misses: number
  errors: string[]
}

export interface PickPacket {
  useCase: "assessment" | "homework"
  subject: string
  ageGrade: number
  mathClass: string
  topics: TopicCandidate[]
  plan?: { about: string; syllabusExcerpt: string }
}

export interface TopicPick {
  conceptIds: string[]
  reason: string
}

const SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    conceptIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
    reason: { type: "string" },
  },
  required: ["conceptIds", "reason"],
  additionalProperties: false,
})

export function keepKnownIds(packet: PickPacket, conceptIds: string[]): string[] {
  const allowed = new Set(packet.topics.map((topic) => topic.id))
  const kept: string[] = []
  for (const id of conceptIds) {
    if (!allowed.has(id) || kept.includes(id)) continue
    kept.push(id)
    if (kept.length === 5) break
  }
  return kept
}

export async function chooseTopics(packet: PickPacket, timeoutMs = 40000): Promise<TopicPick | null> {
  if (!packet.topics.length) return null
  const dir = mkdtempSync(join(tmpdir(), "tutor-pick-"))
  const promptPath = join(dir, "prompt.txt")
  writeFileSync(promptPath, promptFor(packet))
  try {
    const stdout = await askGrok(promptPath, SCHEMA, "Choose topic ids from the list and return only the JSON object. Do not use tools.", timeoutMs)
    const parsed = JSON.parse(stdout) as { structuredOutput?: { conceptIds?: string[]; reason?: string } }
    const ids = keepKnownIds(packet, parsed.structuredOutput?.conceptIds ?? [])
    const reason = (parsed.structuredOutput?.reason ?? "").trim()
    if (!ids.length || !reason) return null
    return { conceptIds: ids, reason }
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function promptFor(packet: PickPacket) {
  const lines = packet.topics.map(
    (topic) =>
      `- ${topic.id} | ${topic.title} | ${topic.strength} | misses ${topic.misses} | errors ${topic.errors.join(", ") || "none"}`,
  )
  const job =
    packet.useCase === "homework"
      ? "Homework: spend more of the set on shaky topics and recent misses. A faster student can include one harder topic from the same class."
      : "Assessment: sample the class. Cover not-started and shaky topics. Do not spend the whole check on one miss."
  return [
    "Pick 2 to 4 topic ids from the list. Use only those ids.",
    `Use case: ${packet.useCase}. Subject: ${packet.subject}. Age grade: ${packet.ageGrade}. Math class: ${packet.mathClass}.`,
    job,
    "Topics:",
    ...lines,
    "Reason in one sentence. Do not include a student name or an answer.",
    packet.plan
      ? `Subject plan: ${packet.plan.about}. Syllabus notes: ${packet.plan.syllabusExcerpt}`
      : "",
  ]
    .filter(Boolean)
    .join("\n")
}

export function askGrok(promptPath: string, schema: string, systemPrompt: string, timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      "grok",
      [
        "--cwd",
        "/tmp",
        "--prompt-file",
        promptPath,
        "--verbatim",
        "--system-prompt-override",
        systemPrompt,
        "--json-schema",
        schema,
        "--max-turns",
        "1",
        "--no-subagents",
        "--disable-web-search",
        "--output-format",
        "json",
        "--always-approve",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    )
    child.stdin.end()
    let out = ""
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error("picker timed out"))
    }, timeoutMs)
    child.stdout.on("data", (chunk) => {
      out += chunk.toString()
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`picker exited ${code}`))
      else resolve(out)
    })
  })
}
