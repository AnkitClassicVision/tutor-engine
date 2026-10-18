import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { registerUser } from "../src/auth.ts"
import { openDb } from "../src/db.ts"
import { curriculumPrompt, curriculumSystemPrompt, readSyllabusUpload } from "../src/plan-subject.ts"
import { aiSettings, applyCurriculum, createStudent, listAdded, retireUnusedQuestions, saveAiSettings, saveSubjectPlan } from "../src/services.ts"

test("a pasted syllabus is kept and a curriculum does not duplicate a topic", async () => {
  const notes = readSyllabusUpload({ text: "Week 1: cell parts.\nWeek 2: photosynthesis.", name: "unit.txt" })
  assert.equal(notes.text.includes("photosynthesis"), true)
  const dir = mkdtempSync(join(tmpdir(), "tutor-plan-"))
  const db = openDb(join(dir, "tutor.sqlite"))
  const now = new Date(2026, 9, 4)
  const user = (await registerUser(db, "plan@example.com", "correct-horse", now))
  assert.equal(user.ok, true)
  if (!user.ok) return
  const studentId = (await createStudent(db, user.userId, { displayName: "Rae", birthDate: "2016-01-09", sessionCapMinutes: 20 }, now))
  await saveSubjectPlan(db, user.userId, studentId, {
    subject: "Science",
    about: "Life science for this year",
    syllabusText: notes.text,
    syllabusName: notes.name,
  })
  const topics = [
    {
      title: "Name the cell parts",
      recall: "A cell has a membrane, cytoplasm, and genetic material",
      example: "The membrane is the outer boundary",
      nonExample: "The cell wall is the only part that matters",
      questions: [
        { prompt: "What is the outer boundary of an animal cell?", answer: "The membrane" },
        { prompt: "Which part holds the genetic material?", answer: "The nucleus" },
      ],
    },
  ]
  const first = (await applyCurriculum(db, user.userId, studentId, "Science", topics, now))
  const second = (await applyCurriculum(db, user.userId, studentId, "Science", topics, now))
  assert.equal(first.created, 1)
  assert.equal(first.questions, 2)
  assert.equal(second.created, 0)
  assert.equal(second.questions, 0)
  const library = (await listAdded(db, user.userId, studentId))
  const topic = library.topics.find((item) => item.title === "Name the cell parts")
  assert.equal(topic?.subject, "Science")
  assert.equal(topic?.problems.length, 2)
  const subjects = (await db.prepare("SELECT subjects FROM students WHERE id = ?").get(studentId)) as { subjects: string }
  assert.equal(subjects.subjects.includes("Science"), true)
  await retireUnusedQuestions(db, studentId, "Science")
  const after = (await listAdded(db, user.userId, studentId))
  assert.equal(after.topics.find((item) => item.title === "Name the cell parts")?.problems.length, 0)
  const rewritten = (await applyCurriculum(
    db,
    user.userId,
    studentId,
    "Science",
    [
      {
        ...topics[0],
        questions: [{ prompt: "The quiz graph shows height flat after which day?", answer: "Day 6" }],
      },
    ],
    now,
  ))
  assert.equal(rewritten.created, 0)
  assert.equal(rewritten.questions, 1)
  const fresh = (await listAdded(db, user.userId, studentId))
  assert.equal(fresh.topics.find((item) => item.title === "Name the cell parts")?.problems[0]?.prompt.includes("quiz graph"), true)
  await saveAiSettings(db, user.userId, { provider: "openai", model: "gpt-4.1-mini", apiKey: "sk-test-secret" })
  const shown = (await aiSettings(db, user.userId))
  assert.equal(shown.provider, "openai")
  assert.equal(shown.hasKey, true)
  assert.equal(JSON.stringify(shown).includes("sk-test-secret"), false)
})

test("the curriculum prompt uses teaching skills and the student's misses", () => {
  const system = curriculumSystemPrompt()
  const prompt = curriculumPrompt({
    subject: "Science",
    about: "Cells and graphs",
    syllabus: "Week 2 includes a line graph of plant height.",
    direction: "The quiz missed the graph.",
    ageGrade: 7,
    mathClass: "Pre-algebra",
    existing: [{ id: "custom.1", title: "Read a line graph", strength: "Shaky", misses: 3, errors: ["mixed up the axes"] }],
  })
  for (const name of ["Say the idea back", "Explain why", "A real situation", "More than one step", "Two cases", "Read the chart", "A few sentences"]) {
    assert.equal(system.includes(name), true, name)
  }
  assert.equal(system.includes("no parent menu"), true)
  assert.equal(prompt.includes("mixed up the axes"), true)
  assert.equal(prompt.includes("Question types"), false)
  assert.equal(prompt.includes("Word problem"), false)
})
