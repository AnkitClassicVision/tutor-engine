import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDb } from "../src/db.ts"
import { registerUser } from "../src/auth.ts"
import { createStudent, listTalk, latestProposal, assertStudent } from "../src/services.ts"
import { createJob, runNextJob } from "../src/jobs.ts"
import {
  acceptPlannerMessage, applyProposal, draftPlannerTurn, finishPlannerMessage, listPlanner, parsePlannerTurn, plannerContext, plannerRow,
  processPlanner, validateProposal, PlannerConflict, type PlannerContext,
} from "../src/planner.ts"
import { unreadNote } from "../src/notes.ts"

async function family() {
  const dir = mkdtempSync(join(tmpdir(), "tutor-planner-"))
  process.env.TUTOR_SECRET_DIR = dir
  const db = openDb(join(dir, "planner.sqlite"))
  const user = await registerUser(db, `planner-${crypto.randomUUID()}@example.invalid`, "synthetic-planner-password")
  if (!user.ok) throw new Error("registration failed")
  const student: any = await createStudent(db, user.userId, { displayName: "Synthetic learner", grade: 3, sessionCapMinutes: 10 })
  // An API provider without a key means "no AI connected" in every mode; the local CLI default would count as connected.
  await db.prepare("UPDATE users SET ai_provider = 'openai', ai_key = '' WHERE id = ?").run(user.userId)
  return { db, owner: user.userId, student: String(student?.id ?? student) }
}

const context: PlannerContext = {
  studentId: "s", name: "Synthetic learner", grade: 3, gradeLabel: "Grade 3", birthDate: null, gradeHold: false, presentation: "auto", cap: 10, today: "2026-10-15",
  classes: ["Math"], topics: [{ conceptId: "math.primary.3.multiply", title: "Equal groups", subject: "math" }, { conceptId: "math.primary.3.share", title: "Share equally", subject: "math" }],
  next: { title: "Equal groups", subject: "Math", reason: "This is the next open concept." }, week: { mastered: [], frontier: ["Equal groups"], stuck: [], held: 0, checked: 0 }, tests: [],
}

test("model turns are parsed defensively and unknown intents never become actions", () => {
  const turn = parsePlannerTurn(JSON.stringify({ reply: "Sure.", intent: "set_test", needsClarification: false, params: { title: "Friday quiz", date: "2026-10-23", topics: ["Equal groups"] } }))
  assert.equal(turn?.intent, "set_test"); assert.deepEqual(turn?.params.topics, ["Equal groups"])
  assert.equal(parsePlannerTurn(JSON.stringify({ reply: "Hmm", intent: "delete_everything", params: {} }))?.intent, "unknown")
  assert.equal(parsePlannerTurn("not json"), null)
  assert.equal(parsePlannerTurn(JSON.stringify({ structuredOutput: { reply: "Ok", intent: "question", params: {} } }))?.intent, "question")
})

test("the fallback drafts the right intent without a model", () => {
  assert.equal(draftPlannerTurn("There is a test on equal groups next Friday", context).intent, "set_test")
  assert.equal(draftPlannerTurn("Make missions 15 minutes", context).intent, "set_minutes_presentation")
  assert.equal(draftPlannerTurn("Tell him: great work this week", context).intent, "parent_note")
  assert.equal(draftPlannerTurn("Make math easier this week", context).intent, "change_class")
  assert.equal(draftPlannerTurn("Add a spelling class with ten words a week", context).intent, "add_class")
  assert.equal(draftPlannerTurn("How is she doing?", context).intent, "question")
  assert.equal(draftPlannerTurn("banana", context).intent, "unknown")
})

test("proposals are validated with the same rules as the forms", () => {
  const past = validateProposal({ reply: "", intent: "set_test", params: { title: "Quiz", date: "2026-10-01", topics: ["Equal groups"] }, needsClarification: false }, context)
  assert.ok("clarify" in past && /passed/.test(past.clarify))
  const noTopics = validateProposal({ reply: "", intent: "set_test", params: { title: "Quiz", date: "2026-10-23", topics: ["Volcanoes"] }, needsClarification: false }, context)
  assert.ok("clarify" in noTopics)
  const good = validateProposal({ reply: "", intent: "set_test", params: { title: "Quiz", date: "2026-10-23", topics: ["equal groups"] }, needsClarification: false }, context)
  assert.ok("proposal" in good && good.proposal.params.conceptIds && (good.proposal.params.conceptIds as string[])[0] === "math.primary.3.multiply")
  const cap = validateProposal({ reply: "", intent: "set_minutes_presentation", params: { minutes: 40 }, needsClarification: false }, context)
  assert.ok("clarify" in cap)
  const note = validateProposal({ reply: "", intent: "parent_note", params: { text: "x".repeat(201) }, needsClarification: false }, context)
  assert.ok("clarify" in note)
  const question = validateProposal({ reply: "Fine.", intent: "question", params: {}, needsClarification: false }, context)
  assert.ok("none" in question)
})

test("without an AI connection a message is answered at once and applying changes the record", async () => {
  const f = await family()
  try {
    const first = await acceptPlannerMessage(f.db, f.owner, f.student, "Make missions 15 minutes", "test")
    assert.equal(first.aiConnected, false); assert.equal(first.proposal?.intent, "set_minutes_presentation")
    const second = await acceptPlannerMessage(f.db, f.owner, f.student, "Tell her: great week", "test")
    assert.equal(second.proposal?.intent, "parent_note")
    const firstRow = await plannerRow(f.db, f.student, first.messageId)
    assert.equal(firstRow?.status, "superseded")
    await assert.rejects(applyProposal(f.db, f.owner, f.student, first.messageId), PlannerConflict)
    const applied = await applyProposal(f.db, f.owner, f.student, second.messageId)
    assert.equal(applied.applied, true)
    assert.equal((await unreadNote(f.db, f.student))?.body, "great week")
    const again = await applyProposal(f.db, f.owner, f.student, second.messageId)
    assert.equal(again.message, "Already applied.")
    const third = await acceptPlannerMessage(f.db, f.owner, f.student, "Use 15 minutes per mission", "test")
    await applyProposal(f.db, f.owner, f.student, third.messageId)
    assert.equal(Number((await assertStudent(f.db, f.owner, f.student)).session_cap_minutes), 15)
    assert.equal((await listPlanner(f.db, f.owner, f.student)).length, 6)
  } finally { f.db.close() }
})

test("the planner job mirrors class planning into the class thread and offers a build", async () => {
  const f = await family()
  try {
    await f.db.prepare("UPDATE users SET ai_provider = 'openai', ai_key = 'enc', ai_model = 'x' WHERE id = ?").run(f.owner)
    const accepted = await acceptPlannerMessage(f.db, f.owner, f.student, "Add a science class about cells and energy", "test")
    assert.ok(accepted.jobId)
    const ask = async () => ({ reply: "A science class it is.", intent: "add_class" as const, params: { subject: "Science", about: "cells and energy" }, needsClarification: false })
    const original = globalThis.fetch
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: "Here is your science class plan.", subject: "Science", about: "Cells and energy", mathCourse: "", ready: true, topics: [{ title: "Cells", recall: "Cells are the units of life." }, { title: "Energy", recall: "Energy moves through living things." }] }) } }] }), { status: 200 })
    try {
      await runNextJob(f.db, { planner: (ctx, payload) => processPlanner({ db: f.db }, ctx, payload, ask) })
    } finally { globalThis.fetch = original }
    const row = await plannerRow(f.db, f.student, accepted.messageId)
    assert.equal(row?.status, "proposed"); assert.match(row?.body ?? "", /science class plan/)
    assert.equal((await listTalk(f.db, f.owner, f.student, "Science")).length, 2)
    assert.equal((await latestProposal(f.db, f.student, "Science"))?.ready, true)
    const applied = await applyProposal(f.db, f.owner, f.student, accepted.messageId)
    assert.ok(applied.jobId); assert.match(applied.location, /classes#learning-plan$/)
    // Science is new to this child, so it is researched and approved before anything is taught.
    const pending = await f.db.prepare("SELECT kind FROM jobs WHERE id = ?").get(applied.jobId!)
    assert.equal(pending?.kind, "research_subject")
    assert.match(applied.message, /researched first/)
  } finally { f.db.close() }
})

test("a pending message blocks a second one until it finishes", async () => {
  const f = await family()
  try {
    await f.db.prepare("UPDATE users SET ai_provider = 'openai', ai_key = 'enc', ai_model = 'x' WHERE id = ?").run(f.owner)
    const first = await acceptPlannerMessage(f.db, f.owner, f.student, "How is this week going?", "test")
    await assert.rejects(acceptPlannerMessage(f.db, f.owner, f.student, "And next week?", "test"), PlannerConflict)
    await finishPlannerMessage(f.db, f.student, first.messageId, { body: "Fine.", intent: "question", params: {}, status: "" })
    const second = await acceptPlannerMessage(f.db, f.owner, f.student, "And next week?", "test")
    assert.ok(second.jobId)
    assert.ok((await plannerContext(f.db, f.owner, f.student)).classes.length >= 0)
    assert.ok(await createJob(f.db, f.owner, f.student, "planner", { messageId: "x", message: "y" }, "planner:test-key"))
  } finally { f.db.close() }
})

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nO3NQQkAAAgEsOtvODPYxBQ+hMH+S02fikAgEAgEAoFAIPgSLOeI7HlLIQSFAAAAAElFTkSuQmCC'

test("photos are filed from the parent's words without a model", async () => {
  const { photoPlan } = await import("../src/planner.ts")
  assert.equal(photoPlan("math homework", context).kind, "homework")
  const test = photoPlan("practice test for the quiz on 2026-10-23", context)
  assert.equal(test.kind, "practice_exam"); assert.equal(test.purpose, "test"); assert.equal(test.testDate, "2026-10-23")
  assert.equal(photoPlan("study guide for a test", context).needsDate, true)
  assert.equal(photoPlan("marked quiz she got back", context).kind, "returned_test")
  assert.equal(photoPlan("", context).subject, "Math")
})

test("photos sent from the planner are saved once, shown in the thread, and applied as practice", async () => {
  const f = await family()
  try {
    const { acceptPlannerPhotos } = await import("../src/planner.ts")
    const uploads = join(mkdtempSync(join(tmpdir(), "tutor-planner-uploads-")))
    const sent = await acceptPlannerPhotos(f.db, f.owner, f.student, { message: "math homework, not started", pages: [{ base64: PNG, mime: "image/png" }, { base64: PNG, mime: "image/png" }], requestId: "photo-request-1" }, uploads)
    const again = await acceptPlannerPhotos(f.db, f.owner, f.student, { message: "math homework, not started", pages: [{ base64: PNG, mime: "image/png" }, { base64: PNG, mime: "image/png" }], requestId: "photo-request-1" }, uploads)
    assert.equal(again.materialId, sent.materialId); assert.equal(again.messageId, sent.messageId)
    const rows = await listPlanner(f.db, f.owner, f.student)
    assert.equal(rows.length, 2)
    assert.equal(JSON.parse(rows[0].params).uploads.length, 2)
    assert.equal(rows[1].status, "proposed")
    const material = (await f.db.prepare("SELECT kind, work_state, subject FROM materials WHERE id = ?").get(sent.materialId)) as any
    assert.deepEqual({ kind: material.kind, work: material.work_state }, { kind: "homework", work: "blank" })
    const applied = await applyProposal(f.db, f.owner, f.student, sent.messageId)
    assert.equal(applied.location, `/materials/${sent.materialId}`)
    assert.equal(((await f.db.prepare("SELECT kind FROM jobs WHERE id = ?").get(applied.jobId!)) as any).kind, "school_path")
    assert.equal(((await f.db.prepare("SELECT learning_purpose FROM materials WHERE id = ?").get(sent.materialId)) as any).learning_purpose, "learning")
    await assert.rejects(acceptPlannerPhotos(f.db, f.owner, f.student, { pages: [] }, uploads), /at least one photo/)
    await assert.rejects(acceptPlannerPhotos(f.db, f.owner, f.student, { pages: [{ base64: PNG, mime: "image/gif" }] }, uploads), /JPEG or PNG/)
    const marked = await acceptPlannerPhotos(f.db, f.owner, f.student, { message: "marked quiz", pages: [{ base64: PNG, mime: "image/png" }] }, uploads)
    assert.equal((await plannerRow(f.db, f.student, marked.messageId))?.status, "")
  } finally { f.db.close() }
})
