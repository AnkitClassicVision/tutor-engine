import { sealForStudent } from "./family-crypto.ts"
import { UserError } from "./errors.ts"
import type { Database as DatabaseSync } from "./database.ts"
import { withWrite, lockFamily } from "./transaction.ts"
import { createJob, type JobContext } from "./jobs.ts"
import { recordDecision } from "./decisions.ts"
import { askText, draftFromWords, type TalkTurn } from "./talk.ts"
import { readModelJson, type AiConfig } from "./ai.ts"
import { skillText } from "./skill-text.ts"
import { coursePlanningBrief } from "./course-planning.ts"
import type { Contract, RunReport } from "./runbook/contract.ts"
import { childSafe } from "./runbook/gates.ts"
import { runContract, type Ask } from "./runbook/run.ts"
import { recordRun } from "./runbook/record.ts"
import { planClassTurn, commitClassTurn, startCurriculumJob } from "./class-planning.ts"
import {
  acceptPlan, addDirection, addTalk, aiConfigFor, aiConnectionProblem, aiSettings, assertStudent, createTarget, listSubjectPlans, listTalk,
  nextLearningAction, PRESENTATIONS, scoreboardFor, setPresentation, studentConcepts, titleMap, topicMenu, updateStudentProfile, validBirthday, boundedGrade,
} from "./services.ts"
import { leaveNote } from "./notes.ts"
import { createMaterial, configureMaterialLearning } from "./schoolwork.ts"
import { dayStamp } from "./engine/dates.ts"
import { gradeLabel } from "./engine/grade.ts"
import { findDate } from "./find-date.ts"
import { requestPack, PackLimit, PackNeedsAi, PackScope } from "./pack.ts"

export const INTENTS = ["add_class", "change_class", "make_pack", "set_test", "add_homework", "set_minutes_presentation", "set_grade_birthday", "parent_note", "ai_setup_help", "question"] as const
export type Intent = (typeof INTENTS)[number]
/** Proposals the server creates itself (never chosen by the model). */
export const INTERNAL_INTENTS = ["use_pages"] as const
export type ApplyIntent = Intent | (typeof INTERNAL_INTENTS)[number]
export interface PlannerTurn { reply: string; intent: Intent | "unknown"; params: Record<string, unknown>; needsClarification: boolean }
export interface Proposal { intent: ApplyIntent; params: Record<string, unknown>; summary: string; applyLabel: string; undoable: boolean }
export interface PlannerRow {
  id: string; student_id: string; role: string; body: string; intent: string; params: string; status: string
  job_id: string | null; decision_id: string | null; source: string; created_at: string
}
export class PlannerConflict extends UserError {}

export const PLANNER_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    reply: { type: "string" },
    intent: { type: "string", enum: [...INTENTS, "unknown"] },
    needsClarification: { type: "boolean" },
    params: { type: "object" },
  },
  required: ["reply", "intent", "needsClarification", "params"],
})

// ---- Storage -----------------------------------------------------------------

export async function addPlannerMessage(
  db: DatabaseSync, studentId: string,
  input: { role: "parent" | "tutor"; body: string; intent?: string; params?: Record<string, unknown>; status?: string; source?: string; jobId?: string },
) {
  const id = crypto.randomUUID()
  await db.prepare("INSERT INTO planner_messages (id, student_id, role, body, intent, params, status, job_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, studentId, input.role, await sealForStudent(db, studentId, input.body.slice(0, 8000)), input.intent ?? "", input.params ? JSON.stringify(input.params) : "", input.status ?? "", input.jobId ?? null, input.source ?? "", new Date().toISOString())
  return id
}

export async function listPlanner(db: DatabaseSync, ownerUserId: string, studentId: string, limit = 30): Promise<PlannerRow[]> {
  await assertStudent(db, ownerUserId, studentId)
  const rows = (await db.prepare("SELECT * FROM planner_messages WHERE student_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(studentId, limit)) as unknown as PlannerRow[]
  return rows.reverse()
}

export async function plannerRow(db: DatabaseSync, studentId: string, id: string) {
  return (await db.prepare("SELECT * FROM planner_messages WHERE id = ? AND student_id = ?").get(id, studentId)) as unknown as PlannerRow | undefined
}

export async function pendingPlanner(db: DatabaseSync, studentId: string) {
  return (await db.prepare("SELECT * FROM planner_messages WHERE student_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").get(studentId)) as unknown as PlannerRow | undefined
}

export async function finishPlannerMessage(
  db: DatabaseSync, studentId: string, id: string,
  input: { body: string; intent: string; params: object; status: "" | "proposed" | "declined" },
) {
  if (input.status === "proposed") await db.prepare("UPDATE planner_messages SET status = 'superseded' WHERE student_id = ? AND status = 'proposed' AND id != ?").run(studentId, id)
  await db.prepare("UPDATE planner_messages SET body = ?, intent = ?, params = ?, status = ? WHERE id = ? AND student_id = ?")
    .run(await sealForStudent(db, studentId, input.body.slice(0, 8000)), input.intent, JSON.stringify(input.params), input.status, id, studentId)
}

export async function setPlannerStatus(db: DatabaseSync, studentId: string, id: string, status: string, extra: { decisionId?: string; jobId?: string } = {}) {
  await db.prepare("UPDATE planner_messages SET status = ?, decision_id = coalesce(?, decision_id), job_id = coalesce(?, job_id) WHERE id = ? AND student_id = ?")
    .run(status, extra.decisionId ?? null, extra.jobId ?? null, id, studentId)
}

export function rowProposal(row: PlannerRow): Proposal | null {
  if (!["proposed", "applied", "superseded", "declined", "undone"].includes(row.status) || !row.params) return null
  try {
    const parsed = JSON.parse(row.params) as Proposal
    return parsed && typeof parsed.summary === "string" && ([...INTENTS, ...INTERNAL_INTENTS] as readonly string[]).includes(parsed.intent) ? parsed : null
  } catch { return null }
}

// ---- Context ---------------------------------------------------------------------

export interface PlannerContext {
  studentId: string; name: string; grade: number; gradeLabel: string; birthDate: string | null; gradeHold: boolean
  presentation: string; cap: number; today: string
  classes: string[]; topics: Array<{ conceptId: string; title: string; subject: string }>
  next: { title: string; subject: string; reason: string } | null
  week: { mastered: string[]; frontier: string[]; stuck: string[]; held: number; checked: number }
  tests: Array<{ title: string; deadline: string }>
}

export async function plannerContext(db: DatabaseSync, ownerUserId: string, studentId: string, now = new Date()): Promise<PlannerContext> {
  const student: any = await assertStudent(db, ownerUserId, studentId)
  const menu = await topicMenu(db, ownerUserId, studentId)
  const plans = await listSubjectPlans(db, ownerUserId, studentId)
  const concepts = await studentConcepts(db, ownerUserId, studentId)
  const titles = await titleMap(db, studentId)
  const next = await nextLearningAction(db, ownerUserId, studentId, now)
  const board = await scoreboardFor(db, ownerUserId, studentId, now)
  const tests = (await db.prepare("SELECT title, deadline FROM targets WHERE student_id = ? AND kind = 'target' AND deadline >= ? ORDER BY deadline LIMIT 5").all(studentId, dayStamp(now))) as Array<{ title: string; deadline: string }>
  const classes = [...new Set([...menu.subjects, ...plans.map((plan) => plan.subject)].map((s) => s.trim()).filter(Boolean))]
  const name = (state: { conceptId: string }) => titles[state.conceptId] ?? state.conceptId
  return {
    studentId, name: String(student.display_name), grade: Number(student.grade), gradeLabel: gradeLabel(Number(student.grade)),
    birthDate: student.birth_date ? String(student.birth_date) : null, gradeHold: Boolean(student.grade_hold),
    presentation: String(student.presentation ?? "auto"), cap: Number(student.session_cap_minutes), today: dayStamp(now),
    classes, topics: concepts.map((c) => ({ conceptId: c.conceptId, title: c.title, subject: c.subject })),
    next: next ? { title: next.title, subject: next.subject, reason: next.reason } : null,
    week: {
      mastered: (board.conceptsMasteredThisWeek ?? []).map(name), frontier: (board.frontier ?? []).map(name), stuck: (board.stuck ?? []).map(name),
      held: Number(board.retention7?.held ?? 0), checked: Number(board.retention7?.checked ?? 0),
    },
    tests: tests.map((t) => ({ title: String(t.title), deadline: String(t.deadline) })),
  }
}

export function contextLines(context: PlannerContext) {
  const bySubject = new Map<string, string[]>()
  for (const topic of context.topics) bySubject.set(topic.subject, [...(bySubject.get(topic.subject) ?? []), topic.title])
  return [
    `Today: ${context.today}. Grade: ${context.gradeLabel}${context.gradeHold ? " (held by the parent)" : ""}. Birthday on file: ${context.birthDate ? "yes" : "no"}.`,
    `Practice settings: presentation ${context.presentation}, up to ${context.cap} minutes.`,
    `Classes: ${context.classes.length ? context.classes.join(", ") : "none yet"}.`,
    ...[...bySubject.entries()].map(([subject, titles]) => `Topics in ${subject}: ${titles.slice(0, 40).join("; ")}.`),
    context.next ? `Next recommended mission: ${context.next.title} (${context.next.subject}). ${context.next.reason}` : "No next mission yet.",
    `This week: new ${context.week.mastered.join(", ") || "none"}; working on ${context.week.frontier.join(", ") || "nothing yet"}; sticking ${context.week.stuck.join(", ") || "none"}; ${context.week.held} of ${context.week.checked} earlier topics held when rechecked.`,
    context.tests.length ? `Tests coming up: ${context.tests.map((t) => `${t.title} on ${t.deadline}`).join("; ")}.` : "No test dates saved.",
  ]
}

// ---- Model turn and fallback ---------------------------------------------------------

export function plannerBrief() {
  return `${coursePlanningBrief()}\n\n${skillText("parent-planner")}`
}

export function parsePlannerTurn(raw: string): PlannerTurn | null {
  let outer: Record<string, unknown>
  try { outer = readModelJson(raw) } catch { return null }
  const intent = String(outer.intent ?? "unknown")
  const params = outer.params && typeof outer.params === "object" && !Array.isArray(outer.params) ? { ...(outer.params as Record<string, unknown>) } : {}
  for (const key of Object.keys(params)) {
    const value = params[key]
    if (typeof value === "string") params[key] = value.trim().slice(0, 600)
    else if (Array.isArray(value)) params[key] = value.slice(0, 12).map((v) => (typeof v === "string" ? v.trim().slice(0, 120) : v))
  }
  const reply = String(outer.reply ?? "").trim().slice(0, 2000)
  if (!reply) return null
  return { reply, intent: (INTENTS as readonly string[]).includes(intent) ? (intent as Intent) : "unknown", params, needsClarification: Boolean(outer.needsClarification) }
}

function matchClass(text: string, classes: string[]) {
  const lower = text.toLowerCase()
  return classes.find((c) => lower.includes(c.toLowerCase())) ?? null
}

function matchTopics(text: string, topics: PlannerContext["topics"], subject: string | null) {
  const lower = text.toLowerCase()
  return topics.filter((t) => (!subject || t.subject.toLowerCase() === subject.toLowerCase()) && t.title.length > 3 && lower.includes(t.title.toLowerCase())).map((t) => t.title)
}

export function draftPlannerTurn(message: string, context: PlannerContext): PlannerTurn {
  const text = message.trim(), lower = text.toLowerCase()
  const subject = matchClass(text, context.classes)
  const date = findDate(text, context.today)
  if (/\b(questions?|problems?|practi[cs]e|worksheet|drills?|flash ?cards?|quiz (?:me|him|her|them)|exercises?)\b/.test(lower) && !/^(how|what|why|is|are|does|did)\b/.test(lower)) {
    return { reply: "I will write that practice now, with a short lesson first, and check every answer.", intent: "make_pack", params: { request: text }, needsClarification: false }
  }
  if (/\b(test|quiz|exam)\b/.test(lower) && (date || /\b(on|by|this|next)\b/.test(lower))) {
    const topics = matchTopics(text, context.topics, subject)
    const title = text.match(/\b(?:test|quiz|exam)\b(?:\s+(?:on|about|in|for))?\s+([A-Za-z][A-Za-z ]{2,40}?)(?=\s+(?:on|by|this|next|tomorrow|\d)|[.,!]|$)/i)?.[1]?.trim()
    return { reply: date ? "I can point the next missions at this test. Check the date and the topics, then press Apply." : "Which day is the test? Give me a date and I will line the next missions up to it.", intent: "set_test", params: { title: title ? `${title} test` : subject ? `${subject} test` : "Test", ...(date ? { date } : {}), topics }, needsClarification: !date }
  }
  const minutes = text.match(/\b(\d{1,2})\s*(?:min|minute)/i)
  const presentation = PRESENTATIONS.find((p) => lower.includes(p)) ?? (/\b(younger|little|simple)\b/.test(lower) ? "junior" : /\bolder\b/.test(lower) ? "explorer" : undefined)
  if (minutes || (presentation && /\b(presentation|look|mode|screen|switch|use)\b/.test(lower))) {
    return { reply: "Here is the practice setting change. Press Apply to use it from the next mission.", intent: "set_minutes_presentation", params: { ...(minutes ? { minutes: Number(minutes[1]) } : {}), ...(presentation ? { presentation } : {}) }, needsClarification: false }
  }
  if (/\b(birthday|born|grade)\b/.test(lower) && !/\b(how|what)\b.*\bgrade\b/.test(lower)) {
    const grade = text.match(/\bgrade\s*(\d{1,2})\b/i) ?? text.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+grade\b/i)
    return { reply: "I can update that. Check the details, then press Apply.", intent: "set_grade_birthday", params: { ...(date && /\b(birthday|born)\b/.test(lower) ? { birthDate: date } : {}), ...(grade ? { grade: Number(grade[1]), gradeHold: true } : {}) }, needsClarification: !date && !grade }
  }
  const note = text.match(/^(?:tell|note|message|say to)\s+(?:(?:him|her|them|my (?:son|daughter|kid|child))\s*[:,]?\s*)?(.+)$/i)
  if (note) return { reply: "Here is the note as your child will see it on the home screen. Press Apply to leave it.", intent: "parent_note", params: { text: note[1].trim().replace(/^["'“]|["'”]$/g, "") }, needsClarification: false }
  if (/\bhomework\b|\bworksheet\b|\bmarked\b/.test(lower)) return { reply: "Homework pages work best from the Schoolwork page, where you can photograph them. Open it from the Add schoolwork button.", intent: "add_homework", params: { ...(subject ? { subject } : {}) }, needsClarification: false }
  if (/\b(ai|openai|openrouter|api key|connect(?:ion)?|chatgpt)\b/.test(lower)) return { reply: "The AI connection lives in AI settings: connect OpenRouter with the browser sign-in, or paste an API key, then choose a text model. Checks and hints need it.", intent: "ai_setup_help", params: {}, needsClarification: false }
  if (/^(how|what|why|when|is|are|does|did|which|should)\b/.test(lower) || lower.endsWith("?")) {
    const parts = [
      context.next ? `The next recommended mission is ${context.next.title} in ${context.next.subject}: ${context.next.reason}` : "There is no recommended mission yet; add a class to start.",
      context.week.mastered.length ? `New this week: ${context.week.mastered.join(", ")}.` : "",
      context.week.stuck.length ? `Sticking: ${context.week.stuck.join(", ")}.` : "",
      context.week.checked ? `${context.week.held} of ${context.week.checked} earlier topics held when checked again.` : "",
    ].filter(Boolean)
    return { reply: parts.join(" "), intent: "question", params: {}, needsClarification: false }
  }
  if (subject && /\b(easier|harder|add|drop|remove|focus|skip|more|less|change|instead|stop)\b/.test(lower)) {
    return { reply: `Here is the change for ${subject}. Press Apply and the next questions will be written around it.`, intent: "change_class", params: { subject, focus: text }, needsClarification: false }
  }
  if (/^(add|start|plan|make|set up|create)\b/.test(lower)) {
    const draft = draftFromWords(text, "new")
    const called = text.match(/\bcalled\s+([A-Za-z][A-Za-z ]{1,40}?)(?:[.:,;!]|$)/i)?.[1]?.trim()
    return { reply: draft.reply, intent: "add_class", params: { subject: called ? called.charAt(0).toUpperCase() + called.slice(1) : draft.proposal?.subject ?? "", about: text }, needsClarification: false }
  }
  return { reply: "I can add or change a class, set a test date, change practice minutes or presentation, update the grade or birthday, leave a note for your child, or answer a question about progress. Which would you like?", intent: "unknown", params: {}, needsClarification: true }
}

// ---- Validation --------------------------------------------------------------------

export type Validation = { proposal: Proposal } | { clarify: string } | { none: true }

export function validateProposal(turn: PlannerTurn, context: PlannerContext, classTurn?: { subject: string; turn: TalkTurn }): Validation {
  const p = turn.params
  const str = (key: string) => (typeof p[key] === "string" ? (p[key] as string).trim() : "")
  switch (turn.intent) {
    case "add_class":
    case "change_class": {
      if (!classTurn?.turn.proposal?.ready || !classTurn.turn.proposal.topics.length) return { none: true }
      const subject = classTurn.subject
      const topics = classTurn.turn.proposal.topics.map((t) => t.title)
      return { proposal: { intent: turn.intent, params: { thread: subject, focus: str("focus") }, summary: `${turn.intent === "add_class" ? "Add" : "Rebuild"} ${subject}: ${topics.join(" · ")}`, applyLabel: turn.intent === "add_class" ? `Build ${subject}` : `Rebuild ${subject}`, undoable: true } }
    }
    case "set_test": {
      const date = str("date"), title = str("title") || "Test"
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { clarify: "Which day is the test? Give me a date." }
      if (date < context.today) return { clarify: "That date has already passed. Which upcoming day is the test?" }
      const wanted = Array.isArray(p.topics) ? (p.topics as unknown[]).map(String) : []
      const subject = str("subject") || matchClass(title, context.classes)
      const pool = context.topics.filter((t) => !subject || t.subject.toLowerCase() === subject.toLowerCase())
      const ids = wanted.map((w) => pool.find((t) => t.title.toLowerCase() === w.toLowerCase()) ?? context.topics.find((t) => t.title.toLowerCase() === w.toLowerCase())).filter((t): t is PlannerContext["topics"][number] => Boolean(t))
      if (!ids.length) {
        const sample = pool.slice(0, 6).map((t) => t.title).join(", ")
        return { clarify: sample ? `Which topics does it cover? For example: ${sample}.` : "Add a class with topics first, then I can point missions at the test." }
      }
      return { proposal: { intent: "set_test", params: { title, date, conceptIds: ids.map((t) => t.conceptId), topics: ids.map((t) => t.title) }, summary: `${title} on ${date}, covering ${ids.map((t) => t.title).join(", ")}. Missions lead to it until then.`, applyLabel: "Focus on this test", undoable: true } }
    }
    case "set_minutes_presentation": {
      const minutes = p.minutes === undefined ? undefined : Number(p.minutes)
      const presentation = str("presentation")
      if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 3 || minutes > 25)) return { clarify: "Practice can run from 3 to 25 minutes. How many minutes?" }
      if (presentation && !(PRESENTATIONS as readonly string[]).includes(presentation)) return { clarify: "The presentation can follow age, or be ages 5–7, 8–10 or 11–14. Which one?" }
      if (minutes === undefined && !presentation) return { clarify: "Do you want to change the minutes, the presentation, or both?" }
      const parts = [minutes !== undefined ? `up to ${minutes} minutes a mission` : "", presentation ? `${presentation} presentation` : ""].filter(Boolean)
      return { proposal: { intent: "set_minutes_presentation", params: { ...(minutes !== undefined ? { minutes } : {}), ...(presentation ? { presentation } : {}) }, summary: `Practice ${parts.join(", ")}.`, applyLabel: "Use these settings", undoable: true } }
    }
    case "set_grade_birthday": {
      const birthDate = str("birthDate"), grade = p.grade === undefined ? undefined : Number(p.grade)
      if (birthDate && !validBirthday(birthDate)) return { clarify: "I need the birthday as a real date, like 2017-05-14." }
      if (grade !== undefined && (!Number.isInteger(grade) || grade < 0 || grade > 12)) return { clarify: "Which grade, from kindergarten (0) to 12?" }
      if (!birthDate && grade === undefined) return { clarify: "Tell me the birthday, the grade to hold, or both." }
      const hold = grade !== undefined ? (p.gradeHold === undefined ? true : Boolean(p.gradeHold)) : false
      const parts = [birthDate ? `birthday ${birthDate}` : "", grade !== undefined ? `${gradeLabel(boundedGrade(grade))}${hold ? " held" : ""}` : ""].filter(Boolean)
      return { proposal: { intent: "set_grade_birthday", params: { ...(birthDate ? { birthDate } : {}), ...(grade !== undefined ? { grade: boundedGrade(grade), gradeHold: hold } : {}) }, summary: `Set ${parts.join(" and ")}.`, applyLabel: "Update", undoable: true } }
    }
    case "parent_note": {
      const text = str("text").replace(/\s+/g, " ")
      if (!text) return { clarify: "What should the note say?" }
      if (text.length > 200) return { clarify: "Keep the note under 200 characters so it fits on the home screen." }
      return { proposal: { intent: "parent_note", params: { text }, summary: `“${text}”`, applyLabel: "Leave this note", undoable: true } }
    }
    default:
      return { none: true }
  }
}

// ---- Apply -------------------------------------------------------------------------

export async function applyProposal(db: DatabaseSync, ownerUserId: string, studentId: string, proposalId: string, now = new Date()) {
  return withWrite(db, async () => {
    await lockFamily(db, ownerUserId)
    await assertStudent(db, ownerUserId, studentId)
    const row = await plannerRow(db, studentId, proposalId)
    if (!row) throw new PlannerConflict("That suggestion is no longer here.")
    if (row.status === "applied") return { applied: true, decisionId: row.decision_id, jobId: row.job_id, location: `/students/${studentId}/parent`, message: "Already applied." }
    if (row.status !== "proposed") throw new PlannerConflict("That suggestion was replaced. Ask again.")
    // WF-07: a suggestion made before another change was applied or undone was based on a plan that no longer exists.
    const since = (await db.prepare("SELECT count(*) AS n FROM decision_records WHERE student_id = ? AND kind IN ('planner_change_applied', 'change_undone') AND created_at > ?").get(studentId, String(row.created_at))) as { n: number } | undefined
    if (Number(since?.n ?? 0) > 0) {
      throw new PlannerConflict("The plan changed after this suggestion was made, so it was not applied. Ask again for an up-to-date suggestion.")
    }
    const proposal = rowProposal(row)
    if (!proposal) throw new PlannerConflict("That suggestion cannot be applied.")
    const p = proposal.params
    let jobId: string | undefined, location = `/students/${studentId}/parent`, message = "Applied.", details: Record<string, unknown> = {}
    switch (proposal.intent) {
      case "add_class":
      case "change_class": {
        const thread = String(p.thread ?? "")
        const focus = String(p.focus ?? "").trim()
        const student: any = await assertStudent(db, ownerUserId, studentId)
        const conceptsBefore = ((await db.prepare("SELECT concept_id FROM custom_concepts WHERE student_id = ?").all(studentId)) as Array<{ concept_id: string }>).map((r) => r.concept_id)
        const planBefore = (await db.prepare("SELECT subject, about, syllabus_name, agenda, build_status FROM subject_plans WHERE student_id = ? AND lower(subject) = lower(?)").get(studentId, thread)) as Record<string, string> | undefined
        const sourceId = focus && proposal.intent === "change_class" ? await addDirection(db, ownerUserId, studentId, { subject: thread, kind: "parent_note", name: "Planner", body: focus }) : undefined
        const accepted = await acceptPlan(db, ownerUserId, studentId, thread)
        jobId = await startCurriculumJob(db, ownerUserId, studentId, accepted.subject, focus)
        location = `/students/${studentId}/classes#learning-plan`
        const researching = (await db.prepare("SELECT kind FROM jobs WHERE id = ?").get(jobId)) as { kind: string } | undefined
        message = researching?.kind === "research_subject"
          ? `${accepted.subject} is new, so it is being researched first. You will see its subject map to approve before anything is taught.`
          : `${accepted.subject} is being built. Lessons and questions are written in the background.`
        details = {
          subject: accepted.subject, jobId, sourceId, conceptsBefore,
          before: { planExisted: Boolean(planBefore), about: planBefore?.about ?? "", syllabusName: planBefore?.syllabus_name ?? "", agenda: planBefore?.agenda ?? "", subjects: JSON.parse(String(student.subjects || "[]")), mathCourse: String(student.math_course || "grade") },
        }
        break
      }
      case "set_test": {
        const targetId = await createTarget(db, ownerUserId, studentId, { title: String(p.title), deadline: String(p.date), conceptIds: (p.conceptIds as string[]) ?? [], notBefore: dayStamp(now) }, now)
        message = `${String(p.title)} is saved for ${String(p.date)}. Missions lead to it until then.`
        // A test also gets fresh, checked practice on its topics. The date already lives on the target, so the request leaves it out.
        let packId: string | null = null
        const topics = Array.isArray(p.topics) ? (p.topics as string[]) : []
        if (topics.length && p.makePractice !== false) {
          const subject = (await studentConcepts(db, ownerUserId, studentId)).find((c) => c.conceptId === (p.conceptIds as string[])?.[0])?.subject
          try {
            const made = await requestPack(db, ownerUserId, studentId, { text: `Practice ${topics.join(", ")}`, by: "parent", mode: "now", requestId: `test-${proposalId}`, subject }, now)
            if (made.kind === "pack") { packId = made.pack.id; message += ` Practice for it is being written now.` }
          } catch (error) { if (!(error instanceof PackLimit || error instanceof PackNeedsAi || error instanceof PackScope)) throw error }
        }
        details = { targetId, title: p.title, deadline: p.date, conceptIds: p.conceptIds, packId }
        break
      }
      case "set_minutes_presentation": {
        const change = await setPresentation(db, ownerUserId, studentId, { ...(p.minutes !== undefined ? { cap: Number(p.minutes) } : {}), ...(p.presentation ? { presentation: String(p.presentation) } : {}) })
        message = "Practice settings updated for the next mission."
        details = change
        break
      }
      case "set_grade_birthday": {
        const change = await updateStudentProfile(db, ownerUserId, studentId, { ...(p.birthDate ? { birthDate: String(p.birthDate) } : {}), ...(p.grade !== undefined ? { grade: Number(p.grade), gradeHold: Boolean(p.gradeHold) } : {}) }, now)
        message = "Grade and birthday updated."
        details = change
        break
      }
      case "use_pages": {
        const materialId = String(p.materialId ?? "")
        const source = await configureMaterialLearning(db, ownerUserId, materialId, { purpose: p.purpose, testTitle: p.testTitle, testDate: p.testDate }, now)
        jobId = await createJob(db, ownerUserId, studentId, "school_path", source, `school-path:${source.materialId}:${source.revision}:${source.learningVersion}`)
        location = `/materials/${materialId}`
        message = p.purpose === "test" ? `These pages now lead practice until ${String(p.testDate)}. I am reading them now.` : "I am reading the pages now and will write practice from them."
        details = { materialId, purpose: p.purpose, testDate: p.testDate ?? null, jobId }
        break
      }
      case "parent_note": {
        const noteId = await leaveNote(db, ownerUserId, studentId, String(p.text))
        message = "The note is waiting on your child's home screen."
        details = { noteId }
        break
      }
      default:
        throw new PlannerConflict("That suggestion cannot be applied.")
    }
    const decisionId = await recordDecision(db, studentId, "planner_change_applied", "The parent applied a change from the planner conversation.", { intent: proposal.intent, proposalId, summary: proposal.summary, ...details }, now)
    await setPlannerStatus(db, studentId, proposalId, "applied", { decisionId, jobId })
    return { applied: true, decisionId, jobId, location, message, undoable: proposal.undoable }
  })
}

// ---- Message intake and the job ------------------------------------------------------------

export async function acceptPlannerMessage(
  db: DatabaseSync, ownerUserId: string, studentId: string, message: string, source = "", packMode: "now" | "review" = "now",
): Promise<{ messageId: string; jobId?: string; reply?: string; proposal?: Proposal | null; aiConnected: boolean; aiProblem: string }> {
  const text = message.replace(/\r/g, "").trim()
  if (!text) throw new UserError("Say what you want to change or know.")
  if (text.length > 4000) throw new UserError("Keep the message under 4000 characters.")
  const settings = await aiSettings(db, ownerUserId)
  const aiProblem = aiConnectionProblem(settings)
  return withWrite(db, async () => {
    await lockFamily(db, ownerUserId)
    await assertStudent(db, ownerUserId, studentId)
    const existing = await pendingPlanner(db, studentId)
    if (existing) throw new PlannerConflict("Still thinking about the last message.")
    await addPlannerMessage(db, studentId, { role: "parent", body: text, source })
    const messageId = await addPlannerMessage(db, studentId, { role: "tutor", body: "Thinking about it.", status: "pending" })
    if (aiProblem) {
      const context = await plannerContext(db, ownerUserId, studentId)
      const turn = draftPlannerTurn(text, context)
      if (turn.intent === "make_pack") turn.reply = `Practice packs need the AI connection. ${aiProblem}`
      const outcome = settle(turn, context)
      await finishPlannerMessage(db, studentId, messageId, { body: outcome.reply, intent: turn.intent, params: outcome.proposal ?? {}, status: outcome.proposal ? "proposed" : "" })
      return { messageId, reply: outcome.reply, proposal: outcome.proposal, aiConnected: false, aiProblem }
    }
    const jobId = await createJob(db, ownerUserId, studentId, "planner", { messageId, message: text, packMode }, `planner:${messageId}`)
    await db.prepare("UPDATE planner_messages SET job_id = ? WHERE id = ?").run(jobId, messageId)
    return { messageId, jobId, aiConnected: true, aiProblem: "" }
  })
}

function settle(turn: PlannerTurn, context: PlannerContext, classTurn?: { subject: string; turn: TalkTurn }) {
  const result = validateProposal(turn, context, classTurn)
  if ("proposal" in result) return { reply: turn.reply, proposal: result.proposal }
  if ("clarify" in result) return { reply: turn.needsClarification ? turn.reply : `${turn.reply} ${result.clarify}`.trim(), proposal: null }
  return { reply: turn.reply, proposal: null }
}

export async function classifyIntent(context: PlannerContext, message: string, prior: Array<{ role: string; body: string }>, ai: AiConfig, timeoutMs = 40000, options: { ask?: Ask; record?: (report: RunReport) => Promise<void> } = {}) {
  const prompt = [
    "Context for this family:",
    ...contextLines(context),
    "Recent planner conversation:",
    ...prior.map((line) => `${line.role === "parent" ? "Parent" : "Planner"}: ${line.body}`),
    `Parent: ${message}`,
  ].join("\n")
  const { output, report } = await runContract({ ...PARENT_PLANNER, timeoutMs }, prompt, ai, { ask: options.ask })
  await options.record?.(report).catch(() => {})
  return output
}

export const PARENT_PLANNER: Contract<string, PlannerTurn> = {
  id: "parent-planner", version: 2, role: "planner",
  skills: ["parent-planner"],
  brief: () => coursePlanningBrief(),
  schema: JSON.parse(PLANNER_SCHEMA), selfCheck: [], repairs: 0,
  prompt: text => text,
  parse: reply => { const turn = parsePlannerTurn(JSON.stringify(reply)); if (!turn) throw new Error("The planner reply broke its contract."); return turn },
  gate: turn => childSafe([turn.reply]),
}

export async function processPlanner(options: { db: DatabaseSync }, ctx: JobContext, payload: { messageId: string; message: string; packMode?: "now" | "review" }, ask: typeof classifyIntent = classifyIntent) {
  const db = options.db, ownerUserId = ctx.job.owner_user_id, studentId = ctx.job.student_id!
  const row = await plannerRow(db, studentId, payload.messageId)
  if (!row || row.status !== "pending") return { studentId, messageId: payload.messageId, location: `/students/${studentId}/parent?planner=open#planner` }
  await ctx.stage("Reading your message")
  try {
    const context = await plannerContext(db, ownerUserId, studentId)
    const prior = (await listPlanner(db, ownerUserId, studentId, 12)).filter((m) => m.id !== payload.messageId && m.status !== "pending").slice(-8).map((m) => ({ role: m.role, body: m.body }))
    let turn: PlannerTurn
    try { turn = (await ask(context, payload.message, prior, await aiConfigFor(db, ownerUserId), 40000, { record: report => recordRun(db, ownerUserId, studentId, report) })) ?? draftPlannerTurn(payload.message, context) } catch { turn = draftPlannerTurn(payload.message, context) }
    if (turn.intent === "make_pack" && !turn.needsClarification) {
      const made = await makePackFromPlanner(db, ownerUserId, studentId, String(turn.params.request || payload.message), payload.messageId, payload.packMode ?? "now", context.name)
      await ctx.commit(async () => { await finishPlannerMessage(db, studentId, payload.messageId, { body: made.reply, intent: "make_pack", params: made.packId ? { packId: made.packId } : {}, status: "" }) })
      return { studentId, messageId: payload.messageId, packId: made.packId, location: `/students/${studentId}/parent?planner=open#planner` }
    }
    let classTurn: { subject: string; turn: TalkTurn } | undefined
    if ((turn.intent === "add_class" || turn.intent === "change_class") && !turn.needsClarification) {
      const requested = String(turn.params.subject ?? "").trim()
      const existing = context.classes.find((c) => c.toLowerCase() === requested.toLowerCase())
      const thread = turn.intent === "change_class" ? existing ?? requested : existing ?? "new"
      if (turn.intent === "change_class" && !existing) { turn = { ...turn, intent: "add_class" } }
      await ctx.stage("Planning the class")
      const classPrior = (await listTalk(db, ownerUserId, studentId, thread)).slice(-8).map((m) => ({ role: m.role, body: m.body }))
      const planned = await planClassTurn(db, ownerUserId, studentId, thread, payload.message, classPrior)
      let next = thread
      await ctx.commit(async () => {
        await addTalk(db, ownerUserId, studentId, { subject: thread, role: "parent", body: payload.message })
        await addTalk(db, ownerUserId, studentId, { subject: thread, role: "tutor", body: "Thinking about this class.", pending: true })
        next = await commitClassTurn(db, studentId, thread, planned)
      })
      classTurn = { subject: next, turn: planned }
      turn = { ...turn, reply: planned.reply }
    }
    const outcome = settle(turn, context, classTurn)
    await ctx.commit(async () => { await finishPlannerMessage(db, studentId, payload.messageId, { body: outcome.reply, intent: turn.intent, params: outcome.proposal ?? {}, status: outcome.proposal ? "proposed" : "" }) })
    return { studentId, messageId: payload.messageId, proposalId: outcome.proposal ? payload.messageId : undefined, location: `/students/${studentId}/parent?planner=open#planner` }
  } catch (error) {
    await ctx.commit(async () => { await finishPlannerMessage(db, studentId, payload.messageId, { body: "I could not finish that. Your message is saved; try again in a moment.", intent: "unknown", params: {}, status: "" }) })
    throw error
  }
}

/** A practice request from the planner becomes a learning pack at once; "show me first" holds it for the parent's check. */
export async function makePackFromPlanner(db: DatabaseSync, ownerUserId: string, studentId: string, request: string, messageId: string, mode: "now" | "review", name: string) {
  try {
    const result = await requestPack(db, ownerUserId, studentId, { text: request.slice(0, 600), by: "parent", mode, requestId: `planner-${messageId}` })
    if (result.kind === "pack") {
      const pack = result.pack
      const reply = result.existing && pack.request_id !== `planner-${messageId}`
        ? `I am still making “${pack.title}”. Ask again once it is ready.`
        : mode === "review" ? `Writing “${pack.title}” now with a short lesson, and checking every answer. You will look it over before ${name} sees it.` : `Making “${pack.title}” now: a short lesson, then checked questions. It will be on ${name}'s home screen in about a minute.`
      return { packId: pack.id, reply }
    }
    return { packId: null, reply: result.reply }
  } catch (error) {
    if (error instanceof PackLimit || error instanceof PackNeedsAi || error instanceof PackScope) return { packId: null, reply: error.message }
    throw error
  }
}

// ---- Photos sent from the planner ------------------------------------------------------------

export interface PhotoPlan { kind: "homework" | "practice_exam" | "returned_test"; workState: "blank" | "partial" | "completed"; subject: string; title: string; purpose: "" | "learning" | "test"; testTitle?: string; testDate?: string; needsDate: boolean }

/** Decides what a batch of photos is from the parent's words. No model call; the parent confirms with Apply. */
export function photoPlan(text: string, context: PlannerContext): PhotoPlan {
  const lower = text.toLowerCase()
  const subject = matchClass(text, context.classes) ?? context.next?.subject ?? context.classes[0] ?? "Math"
  const date = findDate(text, context.today)
  const label = (kind: string) => `${subject} ${kind} · ${context.today}`
  if (/\b(marked|graded|returned|score|scored|got back|teacher marked)\b/.test(lower)) {
    return { kind: "returned_test", workState: "completed", subject, title: label("marked work"), purpose: "", needsDate: false }
  }
  if (/\b(test|quiz|exam|practice test|study guide)\b/.test(lower)) {
    const testTitle = `${subject} test`
    return date && date >= context.today
      ? { kind: "practice_exam", workState: "blank", subject, title: label("practice test"), purpose: "test", testTitle, testDate: date, needsDate: false }
      : { kind: "practice_exam", workState: "blank", subject, title: label("practice test"), purpose: "learning", needsDate: true }
  }
  const workState = /\b(done|finished|completed|did it)\b/.test(lower) ? "completed" : /\b(blank|new|not started|to do)\b/.test(lower) ? "blank" : "partial"
  return { kind: "homework", workState, subject, title: label("homework"), purpose: "learning", needsDate: false }
}

export async function acceptPlannerPhotos(
  db: DatabaseSync, ownerUserId: string, studentId: string,
  input: { message?: string; pages: Array<{ uploadId?: string; base64?: string; mime?: string }>; requestId?: string }, uploadsDir: string,
) {
  const text = String(input.message ?? "").replace(/\r/g, "").trim().slice(0, 2000)
  const pages = Array.isArray(input.pages) ? input.pages.slice(0, 13) : []
  if (!pages.length) throw new UserError("Add at least one photo.")
  if (pages.length > 12) throw new UserError("Send up to twelve pages at a time.")
  for (const page of pages) if (!page || (!page.uploadId && !(page.base64 && ["image/jpeg", "image/png"].includes(String(page.mime))))) throw new UserError("Each page must be a JPEG or PNG photo.")
  const context = await plannerContext(db, ownerUserId, studentId)
  const plan = photoPlan(text, context)
  const requestId = String(input.requestId ?? "").slice(0, 80) || undefined
  const materialId = await createMaterial(db, ownerUserId, studentId, {
    title: plan.title, subject: plan.subject, kind: plan.kind, workState: plan.workState, requestId,
    pages: pages.map((page) => (page.uploadId ? { uploadId: String(page.uploadId) } : { base64: String(page.base64), mime: String(page.mime) })),
  }, uploadsDir)
  return withWrite(db, async () => {
    await lockFamily(db, ownerUserId)
    // A retried upload returns the same material; keep one conversation entry for it.
    const existing = (await db.prepare("SELECT id FROM planner_messages WHERE student_id = ? AND role = 'tutor' AND params LIKE ?").get(studentId, `%"materialId":"${materialId}"%`)) as { id: string } | undefined
    if (existing) return { materialId, messageId: existing.id }
    const uploads = ((await db.prepare("SELECT upload_id FROM material_pages WHERE material_id = ? ORDER BY position").all(materialId)) as Array<{ upload_id: string | null }>).map((r) => r.upload_id).filter(Boolean)
    const count = pages.length, nouns = count === 1 ? "page" : "pages", these = count === 1 ? "this page" : "these pages", them = count === 1 ? "it" : "them"
    await addPlannerMessage(db, studentId, { role: "parent", body: text ? `Sent ${count} ${nouns}: ${text}` : `Sent ${count} ${nouns}.`, params: { uploads, materialId }, source: "photos" })
    const what = plan.kind === "homework" ? `${plan.subject} homework` : plan.kind === "practice_exam" ? `a ${plan.subject} practice test` : `marked ${plan.subject} work`
    if (plan.kind === "returned_test") {
      const id = await addPlannerMessage(db, studentId, { role: "tutor", body: `I saved ${count} ${nouns} as ${what}. Open ${them} to record the teacher's score or ask for a review.`, params: { materialId } })
      return { materialId, messageId: id }
    }
    const proposal: Proposal = plan.purpose === "test"
      ? { intent: "use_pages", params: { materialId, purpose: "test", testTitle: plan.testTitle, testDate: plan.testDate }, summary: `Read ${these} and point practice at the ${plan.subject} test on ${plan.testDate}.`, applyLabel: "Prepare for this test", undoable: false }
      : { intent: "use_pages", params: { materialId, purpose: "learning" }, summary: `Read ${these} and write fresh ${plan.subject} practice from ${them}.`, applyLabel: "Use for practice", undoable: false }
    const reply = `I saved ${count} ${nouns} as ${what}. ${plan.needsDate ? "If it is a test with a date, tell me the day and I will line missions up to it. " : ""}Press ${proposal.applyLabel} and I will read ${these} and build practice from ${them}.`
    const id = await addPlannerMessage(db, studentId, { role: "tutor", body: reply, status: "pending" })
    await finishPlannerMessage(db, studentId, id, { body: reply, intent: "use_pages", params: proposal, status: "proposed" })
    return { materialId, messageId: id }
  })
}

