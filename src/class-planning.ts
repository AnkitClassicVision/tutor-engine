import { recordRun } from "./runbook/record.ts"
import { approvedMap, isBuiltIn, mapBrief, startResearchJob } from "./subject-map.ts"
import { createHash } from "node:crypto"
import type { Database as DatabaseSync } from "./database.ts"
import { createJob, type JobContext } from "./jobs.ts"
import { contentGrade } from "./engine/course.ts"
import { gradeLabel } from "./engine/grade.ts"
import { decisionContext } from "./decisions.ts"
import { planTalk, type TalkTurn } from "./talk.ts"
import type { SchoolSource } from "./schoolwork.ts"
import {
  aiConfigFor, assertStudent, finishTalk, latestDirection, listSubjectPlans, listTalk, listTalkSubjects, markPlanBuild, moveTalk,
  studentConcepts, topicCandidates, topicMenu, uploadedSourceText,
} from "./services.ts"

// Class planning shared by the parent planner, the legacy /talk route and the curriculum job.
export async function queueTalk(
  options: ClassTurnContext,
  ownerId: string,
  studentId: string,
  thread: string,
  message: string,
  prior: Array<{ role: string; body: string }>,
) {
  return (await createJob(options.db, ownerId, studentId, "talk", { thread, message, prior }, `talk:${crypto.randomUUID()}`))
}
export interface ClassTurnContext { db: DatabaseSync }
/** One model turn of class planning for a subject thread; used by the parent planner and the legacy /talk job. */
export async function planClassTurn(db: DatabaseSync, ownerId: string, studentId: string, thread: string, message: string, prior: Array<{ role: string; body: string }>) {
  const student = (await assertStudent(db, ownerId, studentId))
  const menu = (await topicMenu(db, ownerId, studentId))
  const level = contentGrade(student.grade, student.math_course || "grade")
  const courseTopics = (await studentConcepts(db, ownerId, studentId))
    .filter((concept) =>
      thread.toLowerCase() === "math" || thread === "new"
        ? concept.subject === "math" && concept.grade === level
        : concept.subject.toLowerCase() === thread.toLowerCase(),
    )
    .map((concept) => concept.title)
    .slice(0, 40)
  const existing = (menu.groups.find((group) => group.subject.toLowerCase() === thread.toLowerCase())?.topics ?? []).map((topic) => ({
    title: topic.title,
    strength: topic.strength,
  }))
  return planTalk(
    {
      subject: thread,
      gradeLabel: gradeLabel(student.grade),
      mathClass: menu.courseLabel,
      courseTopics,
      decisionHistory: (await decisionContext(db, ownerId, studentId)),
      existing,
      transcript: prior,
      latest: message,
    },
    (await aiConfigFor(db, ownerId)),
    40000,
    { record: report => recordRun(db, ownerId, studentId, report) },
  )
}
/** Commits a planning turn into the subject thread, renaming a "new" thread once the subject is known. */
export async function commitClassTurn(db: DatabaseSync, studentId: string, thread: string, turn: TalkTurn) {
  if (thread.toLowerCase() !== "new" && turn.proposal) turn.proposal.subject = thread
  let next = thread
  const named = turn.proposal?.subject?.trim() ?? ""
  if (thread.toLowerCase() === "new" && named && named.toLowerCase() !== "new") {
    await moveTalk(db, studentId, thread, named)
    next = named
  }
  await finishTalk(db, studentId, next, turn.reply, turn.proposal)
  return next
}
export async function processTalk(options: ClassTurnContext, ctx: JobContext, payload: any) {
  const ownerId = ctx.job.owner_user_id, studentId = ctx.job.student_id!, { thread, message, prior } = payload
  let nextSubject = thread
  await ctx.stage("Planning your class")
  try {
    const turn = await planClassTurn(options.db, ownerId, studentId, thread, message, prior)
    await ctx.commit(async () => { nextSubject = await commitClassTurn(options.db, studentId, thread, turn) })
    return { subject: nextSubject }
  } catch {
    await ctx.commit(async () => (await finishTalk(options.db, studentId, thread, "I could not finish that plan. Your input is saved. Try again.", null)))
    throw new Error("Class planning failed")
  }
}
export async function talkFor(db: DatabaseSync, ownerId: string, studentId: string, requested: string | null, speak: boolean, say = "") {
  const menu = (await topicMenu(db, ownerId, studentId))
  const subject = (requested || menu.subjects[0] || "new").trim() || "new"
  return {
    subject,
    open: Boolean(requested),
    speak,
    say: say.slice(0, 400),
    messages: (await listTalk(db, ownerId, studentId, subject)),
    threads: (await listTalkSubjects(db, ownerId, studentId)),
  }
}
export async function startCurriculumJob(
  db: DatabaseSync,
  ownerId: string,
  studentId: string,
  subject: string,
  direction = "",
  source?: SchoolSource,
) {
  // A subject the tutor has no course for is researched and approved by the parent before any teaching.
  const map = isBuiltIn(subject) ? null : await approvedMap(db, studentId, subject)
  if (!isBuiltIn(subject) && !map) {
    const known = (await db.prepare("SELECT count(*) AS n FROM custom_concepts WHERE student_id = ? AND lower(subject) = lower(?)").get(studentId, subject)) as { n: number }
    if (!Number(known.n)) {
      await markPlanBuild(db, studentId, subject, "building", "Researching this subject first. You approve its map before anything is taught.")
      return startResearchJob(db, ownerId, studentId, subject)
    }
  }
  const candidates = (await topicCandidates(db, ownerId, studentId, subject, "assessment"))
  const savedPlan = (await listSubjectPlans(db, ownerId, studentId)).find((plan) => plan.subject.toLowerCase() === subject.toLowerCase())
  const latest = [direction || (await latestDirection(db, studentId, subject))?.body || "", savedPlan?.agenda ? `Current agenda from the last checks:\n${savedPlan.agenda}` : ""]
    .filter(Boolean)
    .join("\n\n")
  const syllabus = [savedPlan?.syllabus_text ?? "", (await uploadedSourceText(db, studentId, subject))].filter(Boolean).join("\n\n")
  await markPlanBuild(db, studentId, subject, "building", "Questions are being written from the current sources.")
  const input = {
    subject, about: savedPlan?.about ?? "", syllabus, direction: latest,
    ageGrade: candidates.ageGrade, mathClass: candidates.mathClass, existing: candidates.topics,
    decisionHistory: (await decisionContext(db, ownerId, studentId)),
    ...(map ? { map: mapBrief(map) } : {}),
  }
  const revision = createHash("sha256").update(JSON.stringify({ input, source })).digest("hex")
  return (await createJob(db, ownerId, studentId, "curriculum", { subject, input, revision, ...(source ? { materialId: source.materialId, schoolSource: source } : {}) }, `curriculum:${studentId}:${revision}`))
}
