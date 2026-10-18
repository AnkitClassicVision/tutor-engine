import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDb } from "../src/db.ts"
import { registerUser } from "../src/auth.ts"
import { assertStudent, createStudent, createTarget, setPresentation, updateStudentProfile, addTalk, finishTalk } from "../src/services.ts"
import { acceptPlannerMessage, applyProposal, addPlannerMessage, finishPlannerMessage, plannerRow } from "../src/planner.ts"
import { undoCheck, undoDecision, undoStates } from "../src/undo.ts"
import { leaveNote, unreadNote, dismissNote } from "../src/notes.ts"
import { decisionHistory } from "../src/decisions.ts"

async function family() {
  const dir = mkdtempSync(join(tmpdir(), "tutor-undo-"))
  process.env.TUTOR_SECRET_DIR = dir
  const db = openDb(join(dir, "undo.sqlite"))
  const user = await registerUser(db, `undo-${crypto.randomUUID()}@example.invalid`, "synthetic-undo-password")
  if (!user.ok) throw new Error("registration failed")
  await db.prepare("UPDATE users SET ai_provider = 'openai', ai_key = '' WHERE id = ?").run(user.userId)
  const student: any = await createStudent(db, user.userId, { displayName: "Synthetic learner", grade: 3, sessionCapMinutes: 10 })
  return { db, owner: user.userId, student: String(student?.id ?? student) }
}
const latest = async (db: any, owner: string, student: string, kind: string) => (await decisionHistory(db, owner, student)).find((r: any) => r.kind === kind) as any

test("a planner change is undone from its card and both records then show as done", async () => {
  const f = await family()
  try {
    const sent = await acceptPlannerMessage(f.db, f.owner, f.student, "Make missions 15 minutes")
    const applied = await applyProposal(f.db, f.owner, f.student, sent.messageId)
    assert.ok(applied.decisionId, "the applied change keeps its decision id")
    assert.equal(Number((await assertStudent(f.db, f.owner, f.student)).session_cap_minutes), 15)
    const message = await undoDecision(f.db, f.owner, f.student, String(applied.decisionId))
    assert.match(message, /10 minutes/)
    assert.equal(Number((await assertStudent(f.db, f.owner, f.student)).session_cap_minutes), 10)
    assert.equal((await plannerRow(f.db, f.student, sent.messageId))?.status, "undone")
    await assert.rejects(undoDecision(f.db, f.owner, f.student, String(applied.decisionId)), /Already undone/)
    const underlying = await latest(f.db, f.owner, f.student, "presentation_changed")
    const check = await undoCheck(f.db, f.student, underlying)
    assert.equal(check.ok, false); assert.ok(!check.ok && check.done)
  } finally { f.db.close() }
})

test("an older change cannot overwrite a newer one", async () => {
  const f = await family()
  try {
    await setPresentation(f.db, f.owner, f.student, { cap: 15 })
    const first = await latest(f.db, f.owner, f.student, "presentation_changed")
    await setPresentation(f.db, f.owner, f.student, { cap: 20 })
    await assert.rejects(undoDecision(f.db, f.owner, f.student, first.id), /Changed again later/)
    const second = await latest(f.db, f.owner, f.student, "presentation_changed")
    await undoDecision(f.db, f.owner, f.student, second.id)
    assert.equal(Number((await assertStudent(f.db, f.owner, f.student)).session_cap_minutes), 15)
    await undoDecision(f.db, f.owner, f.student, first.id)
    assert.equal(Number((await assertStudent(f.db, f.owner, f.student)).session_cap_minutes), 10)
  } finally { f.db.close() }
})

test("test dates, profile changes and unread notes are undone; read notes are not", async () => {
  const f = await family()
  try {
    const targetId = await createTarget(f.db, f.owner, f.student, { title: "Friday quiz", deadline: "2099-01-01", conceptIds: ["math.primary.3.multiply"] })
    const target = await latest(f.db, f.owner, f.student, "target_added")
    assert.match(await undoDecision(f.db, f.owner, f.student, target.id), /Friday quiz is removed/)
    assert.equal(await f.db.prepare("SELECT id FROM targets WHERE id = ?").get(targetId), undefined)

    await updateStudentProfile(f.db, f.owner, f.student, { grade: 5, gradeHold: true })
    const profile = await latest(f.db, f.owner, f.student, "profile_changed")
    await undoDecision(f.db, f.owner, f.student, profile.id)
    assert.equal(Number((await assertStudent(f.db, f.owner, f.student)).grade), 3)

    await leaveNote(f.db, f.owner, f.student, "Proud of you")
    const note = await latest(f.db, f.owner, f.student, "parent_note_left")
    await undoDecision(f.db, f.owner, f.student, note.id)
    assert.equal(await unreadNote(f.db, f.student), undefined)

    const id = await leaveNote(f.db, f.owner, f.student, "Read me")
    await dismissNote(f.db, f.student, id)
    const read = await latest(f.db, f.owner, f.student, "parent_note_left")
    await assert.rejects(undoDecision(f.db, f.owner, f.student, read.id), /already read/)
  } finally { f.db.close() }
})

test("a class built from the planner is removed by undo until it has been practised", async () => {
  const f = await family()
  try {
    const proposal = { intent: "add_class", params: { thread: "Science", focus: "" }, summary: "Add Science: Cells", applyLabel: "Build Science", undoable: true }
    const build = async () => {
      await addTalk(f.db, f.owner, f.student, { subject: "Science", role: "parent", body: "Add science" })
      await addTalk(f.db, f.owner, f.student, { subject: "Science", role: "tutor", body: "Thinking", pending: true })
      await finishTalk(f.db, f.student, "Science", "Here is science.", { subject: "Science", about: "Cells", ready: true, mathCourse: "", topics: [{ title: "Cells", recall: "Cells are the units of life." }] })
      const id = await addPlannerMessage(f.db, f.student, { role: "tutor", body: "Here is science.", status: "pending" })
      await finishPlannerMessage(f.db, f.student, id, { body: "Here is science.", intent: "add_class", params: proposal, status: "proposed" })
      return applyProposal(f.db, f.owner, f.student, id)
    }
    const applied = await build()
    const concepts = (await f.db.prepare("SELECT concept_id FROM custom_concepts WHERE student_id = ? AND subject = 'Science'").all(f.student)) as any[]
    assert.equal(concepts.length, 1)
    assert.match(await undoDecision(f.db, f.owner, f.student, String(applied.decisionId)), /Science is removed/)
    assert.equal(((await f.db.prepare("SELECT count(*) n FROM custom_concepts WHERE student_id = ? AND subject = 'Science'").get(f.student)) as any).n, 0)
    assert.equal(await f.db.prepare("SELECT 1 FROM subject_plans WHERE student_id = ? AND subject = 'Science'").get(f.student), undefined)
    assert.equal(((await f.db.prepare("SELECT status FROM jobs WHERE id = ?").get(applied.jobId!)) as any).status, "cancelled")

    const again = await build()
    const concept = String(((await f.db.prepare("SELECT concept_id FROM custom_concepts WHERE student_id = ? AND subject = 'Science'").get(f.student)) as any).concept_id)
    await f.db.prepare("INSERT INTO attempts (id, student_id, session_id, concept_id, bloom_level, day, correct, hints_used, interleaved, time_ms, error_type, modality, created_at) VALUES (?, ?, 's', ?, 1, '2026-10-15', 1, 0, 0, 1000, NULL, 'text', ?)")
      .run(crypto.randomUUID(), f.student, concept, new Date().toISOString())
    await assert.rejects(undoDecision(f.db, f.owner, f.student, String(again.decisionId)), /already practised/)
    const { states } = await undoStates(f.db, f.student, await decisionHistory(f.db, f.owner, f.student))
    assert.equal(states.get(String(again.decisionId))?.ok, false)
  } finally { f.db.close() }
})
