// Subject maps: a researched, parent-approved plan of any subject, built before it is taught.
// The research step writes a draft; code and an independent reviewer check it; the parent approves,
// asks for changes or sets it aside. An approved map becomes the topics, their order and the
// misconceptions every later runbook teaches from.

import type { AiConfig } from "./ai.ts"
import type { Database as DatabaseSync } from "./database.ts"
import { UserError } from "./errors.ts"
import { recordDecision } from "./decisions.ts"
import { createJob, type JobContext } from "./jobs.ts"
import { addLearning, aiConfigFor, assertStudent, latestDirection, listSubjectPlans, markPlanBuild, uploadedSourceText } from "./services.ts"
import { recordRun } from "./runbook/record.ts"
import { sealForStudent } from "./family-crypto.ts"
import { canSearch, askResearch } from "./research-web.ts"
import type { Contract, RunReport } from "./runbook/contract.ts"
import { bloomCue, childSafe, issue, readingFit, type Issue } from "./runbook/gates.ts"
import { defaultAsk, runContract, type Ask } from "./runbook/run.ts"
import type { Schema } from "./runbook/schema.ts"

export type Dimension = "factual" | "conceptual" | "procedural" | "metacognitive"
export interface Misconception { belief: string; probe: string; fix: string }
export interface MapConcept {
  key: string; title: string; idea: string; dimension: Dimension; prereqs: string[]; crossLinks: string[]
  success: { foundations: string; use: string; judge: string }
  misconceptions: Misconception[]; contrast: { example: string; nonExample: string }
  mission: string; transfer: string; sources: number[]
}
export interface MapSource { title: string; publisher: string; url: string }
export interface SubjectMap { subject: string; purpose: string; scope: string; groups: Array<{ title: string; concepts: MapConcept[] }>; sources: MapSource[]; cautions: string }

export interface ResearchInput {
  subject: string; about: string; why: string; grade: number; uploads: string; existing: string[]
  change?: string; previous?: SubjectMap | null
  /** Whether the family's AI connection offers web search. */
  searchable: boolean
  /** Filled by the research call: whether the web was searched and which URLs it returned. */
  found: { web: boolean; urls: string[] }
}

const text = (max = 600): Schema => ({ type: "string", minLength: 1, maxLength: max })
const CONCEPT: Schema = {
  type: "object", additionalProperties: false,
  required: ["key", "title", "idea", "dimension", "prereqs", "crossLinks", "success", "misconceptions", "contrast", "mission", "transfer", "sources"],
  properties: {
    key: { type: "string", minLength: 2, maxLength: 60 }, title: text(120), idea: text(300),
    dimension: { enum: ["factual", "conceptual", "procedural", "metacognitive"] },
    prereqs: { type: "array", maxItems: 6, items: { type: "string" } },
    crossLinks: { type: "array", maxItems: 4, items: text(120) },
    success: { type: "object", additionalProperties: false, required: ["foundations", "use", "judge"], properties: { foundations: text(), use: text(), judge: text() } },
    misconceptions: { type: "array", minItems: 1, maxItems: 3, items: { type: "object", additionalProperties: false, required: ["belief", "probe", "fix"], properties: { belief: text(300), probe: text(300), fix: text(400) } } },
    contrast: { type: "object", additionalProperties: false, required: ["example", "nonExample"], properties: { example: text(300), nonExample: text(300) } },
    mission: text(500), transfer: text(400),
    sources: { type: "array", maxItems: 6, items: { type: "integer", minimum: 0, maximum: 29 } },
  },
}
export const MAP_SCHEMA: Schema = {
  type: "object", additionalProperties: false, required: ["subject", "purpose", "scope", "groups", "sources", "cautions"],
  properties: {
    subject: text(80), purpose: text(400), scope: text(400), cautions: { type: "string", maxLength: 1200 },
    groups: { type: "array", minItems: 2, maxItems: 6, items: { type: "object", additionalProperties: false, required: ["title", "concepts"], properties: { title: text(120), concepts: { type: "array", minItems: 2, maxItems: 3, items: CONCEPT } } } },
    sources: { type: "array", maxItems: 30, items: { type: "object", additionalProperties: false, required: ["title", "publisher", "url"], properties: { title: text(300), publisher: { type: "string", maxLength: 200 }, url: { type: "string", maxLength: 600 } } } },
  },
}

export const concepts = (map: SubjectMap) => map.groups.flatMap(group => group.concepts)
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const normalUrl = (value: string) => { try { const url = new URL(value); url.hash = ""; return url.toString() } catch { return "" } }

/** Keys are unique, prerequisites point to earlier concepts that exist, and nothing depends on itself. */
function structure(map: SubjectMap): Issue[] {
  const found: Issue[] = []
  const list = concepts(map), seen = new Set<string>()
  list.forEach((concept, index) => {
    if (!KEY.test(concept.key)) found.push(issue("map_key", `Concept key "${concept.key.slice(0, 40)}" is not lowercase words joined by hyphens.`, true, index))
    if (seen.has(concept.key)) found.push(issue("map_key", "Two concepts share a key.", true, index))
    for (const prereq of concept.prereqs) if (!seen.has(prereq)) found.push(issue("map_order", `Prerequisite "${prereq.slice(0, 40)}" is not an earlier concept.`, true, index))
    seen.add(concept.key)
    for (const source of concept.sources) if (source >= map.sources.length) found.push(issue("map_source_ref", "Cites a source number that is not listed.", true, index))
  })
  return found
}

export const RESEARCH_SUBJECT: Contract<ResearchInput, SubjectMap> = {
  id: "research-subject", version: 5, role: "planner",
  skills: ["research-subject"],
  brief: input => [
    input.searchable ? "Web search is available. Use it, and cite only pages it returned." : "Web search is not available. Work from your own knowledge and the uploads; give reference works by title only, never a link.",
    input.change ? "This is a revision. Keep what the parent did not ask to change." : "",
  ].filter(Boolean).join("\n"),
  schema: MAP_SCHEMA,
  selfCheck: [
    "Does every group have two or three concepts, ordered so each concept's prerequisites come earlier?",
    "Does every concept's judge-level success ask the child to judge with reasons or to make something new and defend it?",
    "Is every misconception one children really hold, with a probe question that would reveal it?",
    "Does every concept cite at least one source you listed, and is every listed source real, with no invented links (no link at all when you could not search)?",
    "Is everything safe and suitable for a child of this grade?",
  ],
  prompt: input => ({
    subject: input.subject, parentDescription: input.about, whyThisChildIsLearningIt: input.why, schoolGrade: input.grade,
    topicsAlreadyOnThePlan: input.existing, uploadedMaterial: input.uploads.slice(0, 20000) || "None.",
    ...(input.change ? { parentChangeRequest: input.change, previousMap: input.previous } : {}),
  }),
  parse: reply => {
    const map = reply as unknown as SubjectMap
    // A map that numbered its sources from 1 (none cites 0, one cites one past the end) is shifted to count from 0.
    const cited = map.groups.flatMap(group => group.concepts.flatMap(concept => concept.sources))
    const fromOne = cited.length > 0 && !cited.includes(0) && Math.max(...cited) === map.sources.length
    return { ...map, groups: map.groups.map(group => ({ ...group, concepts: group.concepts.map(concept => ({ ...concept, key: concept.key.trim().toLowerCase(), sources: fromOne ? concept.sources.map(n => n - 1) : concept.sources })) })) }
  },
  gate: (map, input) => {
    const found = structure(map)
    const list = concepts(map)
    if (list.length < 4) found.push(issue("map_size", "A map needs at least four concepts."))
    found.push(...childSafe([map.purpose, map.scope]))
    list.forEach((concept, index) => {
      found.push(...childSafe([concept.title, concept.idea, concept.contrast.example, concept.contrast.nonExample, concept.mission, concept.transfer, ...concept.misconceptions.map(m => m.probe)], index))
      found.push(...readingFit(concept.idea, input.grade, index))
      if (bloomCue(concept.success.judge, 5).length && bloomCue(concept.success.judge, 6).length) found.push(issue("judge_level", "The top-level success does not ask the child to judge or create.", true, index))
      for (const m of concept.misconceptions) if (!m.probe.trim().endsWith("?")) found.push(issue("probe", "A misconception probe is not a question.", false, index))
      if (!concept.sources.length) found.push(issue("uncited", "The concept cites no source.", input.found.web, index))
    })
    if (input.found.web) {
      // Only links the search itself returned may be cited; anything else may be invented.
      const returned = new Set(input.found.urls.map(normalUrl))
      map.sources.forEach((source, number) => {
        if (source.url && !returned.has(normalUrl(source.url))) list.forEach((concept, index) => { if (concept.sources.includes(number)) found.push(issue("unverified_source", "Cites a link the web search did not return.", true, index)) })
      })
      if (map.sources.filter(source => returned.has(normalUrl(source.url))).length < 2) found.push(issue("sources", "Fewer than two sources came from the web search."))
    } else if (map.sources.some(source => source.url)) {
      // Without search there is nothing to check a link against, so links are not kept.
      found.push(issue("unchecked_links", "Links were listed without a web search; they are removed and the parent is told.", false))
    }
    return found
  },
  prune: (map, bad) => {
    const keep = concepts(map).filter((_, index) => !bad.has(index))
    if (keep.length < 4) return null
    const keys = new Set(keep.map(concept => concept.key))
    const groups = map.groups
      .map(group => ({ ...group, concepts: group.concepts.filter(concept => keys.has(concept.key)).map(concept => ({ ...concept, prereqs: concept.prereqs.filter(key => keys.has(key)) })) }))
      .filter(group => group.concepts.length)
    return { ...map, groups }
  },
  critic: {
    brief: [
      "You are an independent subject expert and children's educator reviewing a subject map written for one child. You did not write it.",
      "For each concept, by its index: say whether the idea and examples are factually accurate; rate ageFit 1-5 for the stated grade; say whether the listed misconceptions are ones children really hold; and in issue name any real problem (factual error, contested claim stated as fact, unsafe or unsuitable content, judge-level success that is really recall) or leave it empty.",
      "Return {\"concepts\": [{\"index\", \"accurate\", \"ageFit\", \"realMisconceptions\", \"issue\"}]}.",
    ].join("\n"),
    schema: { type: "object", additionalProperties: false, required: ["concepts"], properties: { concepts: { type: "array", maxItems: 18, items: { type: "object", additionalProperties: false, required: ["index", "accurate", "ageFit", "realMisconceptions", "issue"], properties: { index: { type: "integer", minimum: 0 }, accurate: { type: "boolean" }, ageFit: { type: "integer", minimum: 1, maximum: 5 }, realMisconceptions: { type: "boolean" }, issue: { type: "string", maxLength: 600 } } } } } },
    view: (map, input) => ({ subject: map.subject, grade: input.grade, purpose: map.purpose, concepts: concepts(map).map((concept, index) => ({ index, title: concept.title, idea: concept.idea, success: concept.success, misconceptions: concept.misconceptions, contrast: concept.contrast, mission: concept.mission })) }),
    judge: (verdict, map) => {
      const found: Issue[] = []
      const rows = (verdict.concepts as Array<Record<string, any>>) ?? []
      concepts(map).forEach((_, index) => {
        const row = rows.find(item => item.index === index)
        if (!row) { found.push(issue("review_missing", "The reviewer skipped this concept.", false, index)); return }
        if (row.accurate === false) found.push(issue("inaccurate", "The reviewer found a factual problem.", true, index))
        if (Number(row.ageFit) < 3) found.push(issue("age_fit", "The reviewer found this concept a poor fit for the grade.", true, index))
        if (row.realMisconceptions === false) found.push(issue("misconceptions", "The reviewer doubts children hold these misconceptions.", false, index))
        if (String(row.issue ?? "").trim()) found.push(issue("review_problem", "The reviewer named a problem with this concept.", true, index))
      })
      return found
    },
  },
  repairs: 1,
  timeoutMs: 150000,
  maxTokens: 12000,
}

/** The research call searches the web when the family's AI can, and records which links came back. */
export function researchAsk(input: ResearchInput, fallback: Ask = defaultAsk): Ask {
  return async request => {
    if (request.purpose === "critic" || !canSearch(request.ai)) {
      if (request.purpose !== "critic") input.found.web = false
      return fallback(request)
    }
    try {
      const reply = await askResearch(request.ai, request.system, request.prompt, request.timeoutMs, request.maxTokens)
      input.found.web = true
      input.found.urls = [...new Set([...input.found.urls, ...reply.citations.map(citation => citation.url)])]
      return reply.text
    } catch {
      // Search unavailable for this key or model: research from knowledge and say so.
      input.found.web = false
      return fallback(request)
    }
  }
}

/** Links that no search returned are dropped from a map researched without the web. */
function settle(map: SubjectMap, web: boolean): SubjectMap {
  return web ? map : { ...map, sources: map.sources.map(source => ({ ...source, url: "" })) }
}

export async function researchSubject(input: Omit<ResearchInput, "found" | "searchable">, ai: AiConfig, options: { ask?: Ask; record?: (report: RunReport) => Promise<void> } = {}) {
  const full: ResearchInput = { ...input, searchable: canSearch(ai), found: { web: false, urls: [] } }
  // Research, review and any repair share one budget that fits a 300-second host function.
  const { output, report } = await runContract(RESEARCH_SUBJECT, full, ai, { ask: researchAsk(full, options.ask), budgetMs: 260000 })
  await options.record?.(report).catch(() => {})
  return { map: output ? settle(output, full.found.web) : null, web: full.found.web, report }
}

// ---- Storage ---------------------------------------------------------------------------------

export type MapStatus = "researching" | "draft" | "approved" | "rejected" | "superseded" | "failed"
export interface MapRow { id: string; student_id: string; subject: string; version: number; status: MapStatus; research: "web" | "knowledge" | ""; map_json: string; note: string; created_at: string; decided_at: string | null; job_id: string | null }

export async function mapRow(db: DatabaseSync, studentId: string, mapId: string): Promise<MapRow | null> {
  return (await db.prepare("SELECT * FROM subject_maps WHERE id = ? AND student_id = ?").get(mapId, studentId)) as MapRow | null ?? null
}
export async function latestMap(db: DatabaseSync, studentId: string, subject: string): Promise<MapRow | null> {
  return (await db.prepare("SELECT * FROM subject_maps WHERE student_id = ? AND lower(subject) = lower(?) AND status != 'superseded' ORDER BY version DESC LIMIT 1").get(studentId, subject)) as MapRow | null ?? null
}
export async function approvedMap(db: DatabaseSync, studentId: string, subject: string): Promise<SubjectMap | null> {
  const row = (await db.prepare("SELECT map_json FROM subject_maps WHERE student_id = ? AND lower(subject) = lower(?) AND status = 'approved' ORDER BY version DESC LIMIT 1").get(studentId, subject)) as { map_json: string } | undefined
  if (!row?.map_json) return null
  try { const map = JSON.parse(row.map_json) as SubjectMap; return Array.isArray(map?.groups) && Array.isArray(map?.sources) ? map : null } catch { return null }
}

/** The newest map per subject, for the classes page. */
export async function subjectMaps(db: DatabaseSync, studentId: string): Promise<MapRow[]> {
  const rows = (await db.prepare("SELECT * FROM subject_maps WHERE student_id = ? AND status != 'superseded' ORDER BY version DESC").all(studentId)) as MapRow[]
  const newest = new Map<string, MapRow>()
  for (const row of rows) if (!newest.has(row.subject.toLowerCase())) newest.set(row.subject.toLowerCase(), row)
  return [...newest.values()]
}

export async function startMapRow(db: DatabaseSync, studentId: string, subject: string, now = new Date()) {
  const previous = (await db.prepare("SELECT max(version) AS v FROM subject_maps WHERE student_id = ? AND lower(subject) = lower(?)").get(studentId, subject)) as { v: number | null }
  const id = crypto.randomUUID()
  await db.prepare("INSERT INTO subject_maps (id, student_id, subject, version, status, research, map_json, note, created_at) VALUES (?, ?, ?, ?, 'researching', '', '', '', ?)")
    .run(id, studentId, subject.trim().slice(0, 80), Number(previous?.v ?? 0) + 1, now.toISOString())
  return id
}

export async function saveResearch(db: DatabaseSync, studentId: string, mapId: string, result: { map: SubjectMap | null; web: boolean }) {
  const subject = ((await db.prepare("SELECT subject FROM subject_maps WHERE id = ?").get(mapId)) as { subject: string } | undefined)?.subject ?? ""
  if (!result.map) {
    await db.prepare("UPDATE subject_maps SET status = 'failed', note = ? WHERE id = ? AND student_id = ?").run("The research did not pass its checks. Try again, or add a syllabus or notes to research from.", mapId, studentId)
    await markPlanBuild(db, studentId, subject, "failed", "The research did not pass its checks. Open Subject maps to try again.")
    return
  }
  await markPlanBuild(db, studentId, subject, "building", "The subject map is ready. Approve it under Subject maps to start teaching.")
  await db.prepare("UPDATE subject_maps SET status = 'draft', research = ?, map_json = ?, note = '' WHERE id = ? AND student_id = ?")
    .run(result.web ? "web" : "knowledge", await sealForStudent(db, studentId, JSON.stringify(result.map)), mapId, studentId)
}

export async function decideMap(db: DatabaseSync, studentId: string, mapId: string, decision: "approved" | "rejected", now = new Date()) {
  const row = await mapRow(db, studentId, mapId)
  if (!row) throw new UserError("That subject map was not found.")
  if (row.status !== "draft") throw new UserError("Only a draft map can be approved or set aside.")
  if (decision === "approved") await db.prepare("UPDATE subject_maps SET status = 'superseded' WHERE student_id = ? AND lower(subject) = lower(?) AND status = 'approved'").run(studentId, row.subject)
  await db.prepare("UPDATE subject_maps SET status = ?, decided_at = ? WHERE id = ?").run(decision, now.toISOString(), mapId)
  if (decision === "rejected") await markPlanBuild(db, studentId, row.subject, "failed", "The subject map was set aside. Research it again under Subject maps when you are ready.")
  return row
}

// ---- Research jobs and approval ---------------------------------------------------------------

export const isBuiltIn = (subject: string) => /^maths?$/i.test(subject.trim())

/** Starts (or returns) the research job for a subject. A draft already waiting for the parent is reused. */
export async function startResearchJob(db: DatabaseSync, ownerId: string, studentId: string, subject: string, change = "", now = new Date()): Promise<string> {
  const latest = await latestMap(db, studentId, subject)
  if (!change && latest?.job_id && (latest.status === "draft" || latest.status === "researching")) {
    // A draft waits for the parent; research still running is reused. A cancelled or failed job starts afresh.
    const job = (await db.prepare("SELECT status FROM jobs WHERE id = ?").get(latest.job_id)) as { status: string } | undefined
    if (latest.status === "draft" || ["queued", "running"].includes(String(job?.status))) return latest.job_id
    await db.prepare("UPDATE subject_maps SET status = 'superseded' WHERE id = ?").run(latest.id)
  }
  if (change && latest?.status === "draft") await db.prepare("UPDATE subject_maps SET status = 'superseded' WHERE id = ?").run(latest.id)
  const mapId = await startMapRow(db, studentId, subject, now)
  const jobId = await createJob(db, ownerId, studentId, "research_subject", { mapId, subject, change: change.slice(0, 2000), previous: change && latest ? latest.id : null }, `research:${studentId}:${mapId}`)
  await db.prepare("UPDATE subject_maps SET job_id = ? WHERE id = ?").run(jobId, mapId)
  return jobId
}

export async function runResearchJob(db: DatabaseSync, ctx: JobContext, payload: { mapId: string; subject: string; change?: string; previous?: string | null }, ask?: Ask) {
  const ownerId = ctx.job.owner_user_id, studentId = ctx.job.student_id!
  const location = `/students/${studentId}/maps/${payload.mapId}`
  const row = await mapRow(db, studentId, payload.mapId)
  if (!row || row.status !== "researching") return { location }
  const student = await assertStudent(db, ownerId, studentId)
  const ai = await aiConfigFor(db, ownerId)
  await ctx.stage(canSearch(ai) ? "Searching for good sources" : "Researching the subject")
  const plan = (await listSubjectPlans(db, ownerId, studentId)).find(p => p.subject.toLowerCase() === payload.subject.toLowerCase())
  const previous = payload.previous ? await mapRow(db, studentId, payload.previous) : null
  const existing = ((await db.prepare("SELECT title FROM custom_concepts WHERE student_id = ? AND lower(subject) = lower(?)").all(studentId, payload.subject)) as Array<{ title: string }>).map(r => r.title)
  const why = (await latestDirection(db, studentId, payload.subject))?.body ?? ""
  const uploads = [plan?.syllabus_text ?? "", await uploadedSourceText(db, studentId, payload.subject)].filter(Boolean).join("\n\n")
  const result = await researchSubject({
    subject: payload.subject, about: plan?.about ?? "", why: String(why).slice(0, 2000), grade: Number(student.grade), uploads, existing,
    change: payload.change || undefined, previous: previous?.map_json ? JSON.parse(previous.map_json) as SubjectMap : null,
  }, ai, { ask, record: report => recordRun(db, ownerId, studentId, report) })
  await ctx.stage("Checking the map")
  await ctx.commit(async () => { await saveResearch(db, studentId, payload.mapId, result) })
  return { location }
}

/** Approving a map makes its concepts the child's topics for that subject, with their prerequisites, then writes the first questions. */
export async function approveMap(db: DatabaseSync, ownerId: string, studentId: string, mapId: string, now = new Date()) {
  await assertStudent(db, ownerId, studentId, now)
  const row = await decideMap(db, studentId, mapId, "approved", now)
  const map = JSON.parse(row.map_json) as SubjectMap
  const ids = new Map<string, string>()
  for (const concept of concepts(map)) {
    const existing = (await db.prepare("SELECT concept_id FROM custom_concepts WHERE student_id = ? AND lower(subject) = lower(?) AND lower(title) = lower(?)").get(studentId, row.subject, concept.title)) as { concept_id: string } | undefined
    const id = existing?.concept_id ?? await addLearning(db, ownerId, studentId, { purpose: "year", subject: row.subject, title: concept.title, recall: concept.idea, example: concept.contrast.example, nonExample: concept.contrast.nonExample }, now)
    ids.set(concept.key, id)
  }
  for (const concept of concepts(map)) {
    await db.prepare("UPDATE custom_concepts SET map_key = ?, prereqs = ?, recall = ?, example = ?, non_example = ? WHERE concept_id = ? AND student_id = ?")
      .run(concept.key, JSON.stringify(concept.prereqs.map(key => ids.get(key)).filter(Boolean)), concept.idea, concept.contrast.example, concept.contrast.nonExample, ids.get(concept.key)!, studentId)
  }
  await recordDecision(db, studentId, "subject_map_approved", "The parent approved a researched subject map; its concepts, order and misconceptions now guide teaching.", { mapId, subject: row.subject, version: row.version, concepts: concepts(map).length, research: row.research }, now)
  return { subject: row.subject, conceptIds: [...ids.values()] }
}

/** The approved map, condensed for the runbooks that write questions and lessons. */
export function mapBrief(map: SubjectMap): string {
  const lines = concepts(map).map(concept => `- ${concept.title}: ${concept.idea} | success: basics "${concept.success.foundations}", using it "${concept.success.use}", judging and creating "${concept.success.judge}" | misconceptions: ${concept.misconceptions.map(m => `"${m.belief}" (probe: ${m.probe})`).join("; ")} | transfer: ${concept.transfer}`)
  return [`Approved subject map for ${map.subject}. Purpose: ${map.purpose} Scope: ${map.scope}`, "Use these exact topic titles in this order. Aim questions at the success descriptions and at the listed misconceptions; mark a question transfer when it uses the idea somewhere new.", ...lines].join("\n")
}
