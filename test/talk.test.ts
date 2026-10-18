import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { registerUser } from "../src/auth.ts"
import { openDb } from "../src/db.ts"
import { acceptPlan, addTalk, createStudent, finishTalk, latestProposal, listTalk, reviseAgenda, studentProgress } from "../src/services.ts"
import { studentPage } from "../src/view.ts"
import { readModelJson } from "../src/ai.ts"
import { curriculumSystemPrompt } from "../src/plan-subject.ts"
import { draftFromWords, lessonOpening, parentAgrees, parseTalk, planningBrief } from "../src/talk.ts"

test("a talk plan is parsed and is not ready until it has a class and topics", () => {
  const ready = parseTalk(
    JSON.stringify({
      structuredOutput: {
        reply: "Cells, energy, and one graph. Press Build this.",
        subject: "Biology",
        about: "Seventh-grade life science",
        mathCourse: "",
        ready: true,
        topics: [{ title: "Cell parts", recall: "A cell has a membrane and genetic material" }],
      },
    }),
  )
  assert.equal(ready?.proposal?.ready, true)
  assert.equal(ready?.proposal?.subject, "Biology")
  const vague = parseTalk(JSON.stringify({ reply: "Which class?", subject: "", about: "", mathCourse: "", ready: true, topics: [] }))
  assert.equal(vague?.proposal ?? null, null)
  assert.equal(parseTalk("not json"), null)
  const wrapped = parseTalk(JSON.stringify({ text: JSON.stringify({ reply: "Cells and energy. Press Build this.", subject: "Biology", about: "Life science", mathCourse: "", ready: true, topics: [{ title: "Cells", recall: "A cell has a membrane" }] }) }))
  assert.equal(wrapped?.proposal?.subject, "Biology")
  assert.equal(readModelJson(JSON.stringify({ text: "{\"reply\":\"Hello.\"}" })).reply, "Hello.")
})

test("agreement is a short yes, and a sentence still becomes a plan", () => {
  assert.equal(parentAgrees("Yes."), true)
  assert.equal(parentAgrees("Build this"), true)
  assert.equal(parentAgrees("Add biology and also change math"), false)
  const draft = draftFromWords("Add biology. Cells, energy, and one graph of plant height.", "new")
  assert.equal(draft.proposal?.subject, "Biology")
  assert.deepEqual(draft.proposal?.topics.map((topic) => topic.title), ["Cells", "energy", "one graph of plant height"])
  assert.equal(draft.proposal?.ready, true)
  assert.equal(draft.reply.includes("Build this"), true)
  const brief = planningBrief()
  assert.equal(brief.startsWith("-"), false)
  assert.equal(brief.includes("## Layer 0"), true)
  assert.equal(brief.includes("Plan from the uploads"), true)
  assert.equal(curriculumSystemPrompt().includes("Design the questions"), true)
  assert.equal(curriculumSystemPrompt().includes("Revise the agenda"), true)
  assert.equal(brief.includes("Build this"), true)
  assert.equal(brief.includes("question types"), true)
})

test("building waits for an agreed plan, and a finished check has a lesson", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tutor-talk-"))
  const db = openDb(join(dir, "tutor.sqlite"))
  const now = new Date(2026, 9, 4)
  const user = (await registerUser(db, "talk@example.com", "correct-horse", now))
  assert.equal(user.ok, true)
  if (!user.ok) return
  const studentId = (await createStudent(db, user.userId, { displayName: "Rae", birthDate: "2016-01-09", sessionCapMinutes: 20 }, now))
  await assert.rejects(async () => (await acceptPlan(db, user.userId, studentId, "new")), /Talk through the plan first/)
  await addTalk(db, user.userId, studentId, {
    subject: "new",
    role: "tutor",
    body: "Here is the plan.",
    proposal: {
      subject: "Biology",
      about: "Cells and energy",
      ready: true,
      mathCourse: "",
      topics: [{ title: "Cell parts", recall: "A cell has a membrane" }],
    },
  })
  assert.equal((await latestProposal(db, studentId, "new"))?.subject, "Biology")
  const lesson = lessonOpening([
    { title: "Cell parts", prompt: "Name the outer boundary.", answer: "The membrane", correct: false },
    { title: "Energy", prompt: "Where does the light go?", answer: "Into food", correct: true },
  ])
  assert.equal(lesson.includes("You held 1 of 2"), true)
  assert.equal(lesson.includes("The membrane"), true)
  assert.equal(lesson.includes("Rae"), false)
  assert.equal(lesson.split("Cell parts").length, 2)
  const messages = (await listTalk(db, user.userId, studentId, "new"))
  assert.equal(messages.length, 1)
  await addTalk(db, user.userId, studentId, { subject: "Biology", role: "tutor", body: "Thinking about this class.", pending: true })
  const waiting = (await studentProgress(db, user.userId, studentId))
  assert.equal(waiting.pending.includes("Biology"), true)
  await finishTalk(db, studentId, "Biology", "Cells and energy. Press Build this.", {
    subject: "Biology",
    about: "Cells",
    ready: true,
    mathCourse: "",
    topics: [{ title: "Cells", recall: "A cell has a membrane" }],
  })
  const done = (await listTalk(db, user.userId, studentId, "Biology"))
  assert.equal(done.at(-1)?.body.includes("Build this"), true)
  assert.equal(done.at(-1)?.proposal.includes("pending"), false)
  const accepted = (await acceptPlan(db, user.userId, studentId, "Biology"))
  assert.equal(accepted.subject, "Biology")
  const posted = (await db.prepare("SELECT title FROM custom_concepts WHERE student_id = ? AND subject = ?").get(studentId, "Biology")) as { title: string }
  assert.equal(posted.title, "Cells")
  const planRow = (await db.prepare("SELECT build_status, build_note FROM subject_plans WHERE student_id = ? AND subject = ?").get(studentId, "Biology")) as {
    build_status: string
    build_note: string
  }
  assert.equal(planRow.build_status, "building")
  assert.equal(planRow.build_note.includes("Topics are posted"), true)
  const concept = (await db.prepare("SELECT concept_id FROM custom_concepts WHERE student_id = ? AND subject = ?").get(studentId, "Biology")) as { concept_id: string }
  await db.prepare(
    `INSERT INTO tutor_sessions (id, student_id, started_at, modality, consecutive_step_downs, cap_minutes, continuity, mode, subject)
     VALUES ('check', ?, ?, 'paper', 0, 25, '', 'homework', 'Biology')`,
  ).run(studentId, now.toISOString())
  await db.prepare(
    `INSERT INTO session_items (
      id, session_id, position, beat, concept_id, bloom_level, prompt, answer, hints_json, surface, interleaved, hints_used, answered, correct, error_type
    ) VALUES ('item', 'check', 1, 'frontier', ?, 3, 'Apply the cell idea.', 'Rubric: membrane', '[]', 'paper', 0, 0, 1, 0, 'concept_gap')`,
  ).run(concept.concept_id)
  const agenda = (await reviseAgenda(db, studentId, "Biology", "check"))
  assert.match(agenda, /Cells/)
  assert.match(agenda, /assessment/)
  const page = studentPage({
    student: { id: studentId, display_name: "Rae", grade: 5, session_cap_minutes: 20, birth_date: "2016-01-09", grade_hold: 0 },
    today: now,
    states: [],
    concepts: [],
    menu: { ageGrade: 5, courseLabel: "Grade-level math", mathCourse: "grade", subjects: ["Biology"], nextFocus: [], groups: [{ subject: "Biology", topics: [] }] },
    added: { topics: [], extras: [] },
    plans: [{ subject: "Biology", about: "Cells", syllabus_name: "Conversation", build_status: "building", build_note: "Writing questions." }],
    live: "Biology:building",
  })
  assert.equal(page.includes("Building the curriculum"), true)
  assert.equal(page.includes('data-live="Biology:building"'), true)
  assert.equal(page.includes("mastery"), true)
})
