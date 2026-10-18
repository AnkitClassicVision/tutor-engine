import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { registerUser } from "../src/auth.ts"
import { applyTopicPick, biasTowardWeak, contentGrade, paceFor } from "../src/engine/course.ts"
import { designQuestion } from "../src/engine/items.ts"
import { scoreAnswer } from "../src/engine/score.ts"
import { keepKnownIds } from "../src/choose-topics.ts"
import { openDb } from "../src/db.ts"
import { buildQueue } from "../src/engine/select.ts"
import { addLearning, createStudent, setPlacement, startTutorSession } from "../src/services.ts"

test("homework and assessment share a skill and not a sentence", () => {
  const topic = { title: "Locate regions and read how land and water shape life", recall: "Land and water change where people live and how they travel." }
  const homework = designQuestion({ ...topic, job: "homework", kind: "apply", seed: 1 })
  const assessment = designQuestion({ ...topic, job: "assessment", kind: "apply", seed: 1, seen: [homework.prompt] })
  const created = designQuestion({ ...topic, job: "homework", kind: "create", seed: 2, seen: [homework.prompt, assessment.prompt] })
  assert.notEqual(homework.prompt, assessment.prompt)
  assert.match(homework.prompt, /A map of/)
  assert.doesNotMatch(homework.prompt, /Look at setting|Application, on the/)
  assert.match(assessment.prompt, /solid answer/)
  assert.match(created.prompt, /Write two or three sentences/)
  assert.match(homework.answer, /^Rubric:/)
  const again = designQuestion({ ...topic, job: "homework", kind: "apply", seed: 1, seen: [homework.prompt] })
  assert.notEqual(again.prompt, homework.prompt)
  const held = scoreAnswer(homework.answer, "Land and water change where people live and how they travel across a place they have not studied before.")
  const label = scoreAnswer(homework.answer, "regions")
  assert.equal(held.correct, true)
  assert.equal(label.correct, false)
})

test("a class can sit above or below the birthday grade", () => {
  assert.equal(contentGrade(7, "remedial"), 5)
  assert.equal(contentGrade(7, "grade"), 7)
  assert.equal(contentGrade(7, "prealgebra"), 8)
  assert.equal(contentGrade(7, "algebra"), 9)
  const slow = paceFor(0.5)
  const fast = paceFor(0.95)
  assert.ok(slow.review > slow.frontier)
  assert.ok(slow.itemCount > fast.itemCount)
  assert.ok(fast.stretch > fast.review)
})

test("homework repeats the topics that were just missed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tutor-course-"))
  const db = openDb(join(dir, "tutor.sqlite"))
  const now = new Date(2026, 9, 4)
  const user = (await registerUser(db, "class@example.com", "correct-horse", now))
  assert.equal(user.ok, true)
  if (!user.ok) return
  const studentId = (await createStudent(db, user.userId, { displayName: "Sam", birthDate: "2014-08-20", sessionCapMinutes: 25 }, now))
  await setPlacement(db, user.userId, studentId, { mathCourse: "prealgebra", subjects: ["Math", "Science"] })
  const program = (await db.prepare("SELECT concept_ids FROM targets WHERE student_id = ? AND kind = 'program'").get(studentId)) as {
    concept_ids: string
  }
  assert.equal(program.concept_ids.includes("math.8.ee.c.7"), true)
  assert.equal(program.concept_ids.includes("math.4.nf.a.1"), false)
  await db.prepare(
    `INSERT INTO tutor_sessions (id, student_id, started_at, modality, consecutive_step_downs, cap_minutes, continuity, mode, subject)
     VALUES ('past', ?, ?, 'paper', 0, 25, 'Earlier check', 'homework', 'Math')`,
  ).run(studentId, now.toISOString())
  await db.prepare(
    `INSERT INTO attempts (
      id, student_id, session_id, concept_id, bloom_level, day, correct, hints_used, interleaved, time_ms, error_type, modality, created_at
    ) VALUES ('miss', ?, 'past', 'math.8.ee.c.7', 3, '2026-10-04', 0, 0, 0, 1000, 'procedural_slip', 'paper', ?)`,
  ).run(studentId, now.toISOString())
  const sessionId = (await startTutorSession(db, user.userId, studentId, now, { mode: "homework", subject: "Math" }))
  const rows = (await db.prepare("SELECT concept_id FROM session_items WHERE session_id = ?").all(sessionId)) as Array<{ concept_id: string }>
  const misses = rows.filter((row) => row.concept_id === "math.8.ee.c.7").length
  assert.ok(misses >= 3, `expected more work on the miss, saw ${misses}`)
  await addLearning(db, user.userId, studentId, {
    purpose: "year",
    subject: "Social Studies",
    title: "Locate regions and read how land and water shape life",
    recall: "Land and water change where people live and how they travel.",
  }, now)
  const socialId = (await startTutorSession(db, user.userId, studentId, now, { mode: "homework", subject: "Social Studies" }))
  const social = (await db.prepare("SELECT concept_id, prompt, answer FROM session_items WHERE session_id = ?").all(socialId)) as Array<{
    concept_id: string
    prompt: string
    answer: string
  }>
  assert.equal(social.some((item) => item.concept_id.startsWith("math.")), false)
  assert.equal(social.some((item) => /land and water/i.test(item.prompt) && !/Look at setting/.test(item.prompt)), true)
})

test("a model pick is limited to the offered topics and fills the homework", () => {
  const packet = {
    useCase: "homework" as const,
    subject: "Math",
    ageGrade: 7,
    mathClass: "Pre-algebra",
    topics: [
      { id: "math.8.ee.c.7", title: "Solve linear equations that need expansion", strength: "Shaky", misses: 2, errors: ["procedural_slip"] },
      { id: "math.8.ee.a.1", title: "Apply integer exponent rules", strength: "Not started", misses: 0, errors: [] },
    ],
  }
  assert.deepEqual(keepKnownIds(packet, ["math.8.ee.c.7", "not-a-topic", "math.8.ee.c.7", "math.8.ee.a.1"]), [
    "math.8.ee.c.7",
    "math.8.ee.a.1",
  ])
  const slots = buildQueue({
    frontierConceptId: "math.8.f.b.4",
    frontierBloom: 3,
    review: [],
    stretchConceptId: null,
    counts: { frontier: 4, review: 1, stretch: 1 },
  })
  const picked = applyTopicPick(slots, ["math.8.ee.c.7", "math.8.ee.a.1"], "homework")
  assert.equal(picked.filter((slot) => slot.beat !== "stretch" && slot.conceptId === "math.8.ee.c.7").length >= 2, true)
})

test("a weak topic takes over most of the frontier slots", () => {
  const slots = buildQueue({
    frontierConceptId: "math.8.f.b.4",
    frontierBloom: 3,
    review: [{ conceptId: "math.8.ee.a.1", bloom: 2 }],
    stretchConceptId: "math.8.ee.c.7",
    counts: { frontier: 6, review: 4, stretch: 2 },
  })
  const biased = biasTowardWeak(slots, ["math.8.ee.c.7"], 3)
  const focused = biased.filter((slot) => slot.conceptId === "math.8.ee.c.7").length
  assert.ok(focused >= 4)
})
