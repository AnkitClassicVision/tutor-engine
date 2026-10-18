import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { registerUser } from "../src/auth.ts"
import { openDb } from "../src/db.ts"
import { gradeFromBirthday } from "../src/engine/grade.ts"
import { addLearning, createStudent, listAdded, removeTopic, startTutorSession } from "../src/services.ts"

test("a birthday sets the grade from the September 1 cutoff", () => {
  const october = new Date(2026, 9, 4)
  assert.equal(gradeFromBirthday("2015-06-15", october), 6)
  assert.equal(gradeFromBirthday("2015-10-15", october), 5)
  assert.equal(gradeFromBirthday("2015-09-01", october), 6)
  assert.equal(gradeFromBirthday("2015-06-15", new Date(2026, 7, 15)), 5)
})

test("a parent can add a year topic, a learn-next topic, and an exact practice problem", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tutor-topics-"))
  const db = openDb(join(dir, "tutor.sqlite"))
  const now = new Date(2026, 9, 4)
  const user = (await registerUser(db, "parent@example.com", "correct-horse"))
  assert.equal(user.ok, true)
  if (!user.ok) return
  const studentId = (await createStudent(
    db,
    user.userId,
    { displayName: "Ada", birthDate: "2015-06-15", sessionCapMinutes: 25 },
    now,
  ))
  const saved = (await db.prepare("SELECT grade, grade_hold FROM students WHERE id = ?").get(studentId)) as {
    grade: number
    grade_hold: number
  }
  assert.equal(saved.grade, 6)
  assert.equal(saved.grade_hold, 0)

  const yearId = (await addLearning(
    db,
    user.userId,
    studentId,
    { purpose: "year", subject: "Science", title: "Name the independent variable", recall: "The variable you change on purpose" },
    now,
  ))
  const program = (await db.prepare("SELECT concept_ids FROM targets WHERE student_id = ? AND kind = 'program'").get(studentId)) as {
    concept_ids: string
  }
  assert.equal(program.concept_ids.includes(yearId), true)

  await addLearning(
    db,
    user.userId,
    studentId,
    {
      purpose: "special",
      subject: "Science",
      title: "Read a line graph",
      recall: "A rising line means growth",
      prompt: "On which day was the plant tallest?",
      answer: "Day 6",
    },
    now,
  )
  const sessionId = (await startTutorSession(db, user.userId, studentId, now, { mode: "homework", subject: "Science" }))
  const prompts = (await db.prepare("SELECT prompt, answer FROM session_items WHERE session_id = ?").all(sessionId)) as Array<{
    prompt: string
    answer: string
  }>
  assert.equal(
    prompts.some((item) => item.prompt === "On which day was the plant tallest?" && item.answer === "Day 6"),
    true,
  )

  await addLearning(
    db,
    user.userId,
    studentId,
    {
      purpose: "practice",
      conceptId: yearId,
      problems: "Name the variable you change. | independent\nName the variable you measure. | dependent",
    },
    now,
  )
  const library = (await listAdded(db, user.userId, studentId))
  const year = library.topics.find((topic) => topic.conceptId === yearId)
  assert.equal(year?.problems.length, 2)
  await removeTopic(db, user.userId, studentId, yearId)
  const after = (await listAdded(db, user.userId, studentId))
  assert.equal(after.topics.some((topic) => topic.conceptId === yearId), false)
})
