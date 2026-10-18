import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { openDb } from "../src/db.ts"
import { registerUser } from "../src/auth.ts"
import { loadBackbone } from "../src/engine/graph.ts"
import { generateItem } from "../src/engine/items.ts"
import { emptyState, estimatedRetention, reduceState, workingBloom } from "../src/engine/mastery.ts"
import { weeklyScoreboard } from "../src/engine/scoreboard.ts"
import { decisionContext, decisionHistory } from "../src/decisions.ts"
import { requiresJudgment } from "../src/engine/score.ts"
import { gradeResponse, parseRubricVerdict } from "../src/grade-response.ts"
import { gradePendingResponses } from "../src/server.ts"
import { curriculumPrompt, curriculumSystemPrompt, parseCurriculum, planCurriculum } from "../src/plan-subject.ts"
import { planningBrief } from "../src/talk.ts"
import { addLearning, applyCurriculum, createStudent, createTarget, nextLearningAction, reviewAnswer, saveAiSettings, saveRecap, scoreSheet, createSheet, sessionItems, startTutorSession, submitAnswer } from "../src/services.ts"
import type { AttemptRecord } from "../src/engine/types.ts"
import { assessmentEvidence } from "../src/assessment-evidence.ts"
import type { AiProvider } from "../src/ai.ts"

const now = new Date(2026, 9, 5, 12)
const valid = {
  reason: "The newest test focuses on unlike denominators; the standing course stays.",
  topics: [{
    title: "Add unlike-denominator fractions", recall: "Use a common denominator before adding",
    example: "1/2 + 1/3 = 5/6", nonExample: "1/2 + 1/3 = 2/5",
    questions: [
      { prompt: "Add 1/4 and 1/3.", answer: "7/12", bloomLevel: 3 },
      { prompt: "Write and solve a new fraction problem. Explain your check.", answer: "Rubric: produce an original problem, use a common denominator, and check the sum.", bloomLevel: 6 },
    ],
  }],
}
const input = { subject: "Math", about: "Fractions", syllabus: "Fractions this year.", direction: "Friday test on unlike denominators.", ageGrade: 5, mathClass: "Grade-level math", existing: [] }

async function learner() {
  const db = openDb(":memory:")
  const user = (await registerUser(db, "spec@example.com", "correct-horse", now))
  assert.ok(user.ok)
  const studentId = (await createStudent(db, user.userId, { displayName: "Learner", grade: 5, sessionCapMinutes: 25 }, now))
  const conceptId = "math.5.nf.a.1"
  await db.prepare("UPDATE learner_states SET bloom_level = 2, mastery = 0, status = 'frontier' WHERE student_id = ? AND concept_id = ?").run(studentId, conceptId)
  await createTarget(db, user.userId, studentId, { title: "Fractions Friday", deadline: "2026-10-09", conceptIds: [conceptId] }, now)
  return { db, ownerId: user.userId, studentId, conceptId }
}

test("both planning stages include the maintained course contract and all pedagogical spec layers", () => {
  const spec = readFileSync(new URL("../Tutor Engine — The Shape (v1 spec).md", import.meta.url), "utf8")
  const excerpt = spec.slice(spec.indexOf("## Layer 0"), spec.indexOf("## Device mapping")).trim()
  for (const prompt of [planningBrief(), curriculumSystemPrompt()]) assert.ok(prompt.includes(excerpt))
  const longSource = `${"Earlier syllabus.\n".repeat(1000)}Newest source: interpret the graph.`
  assert.ok(curriculumPrompt({ ...input, syllabus: longSource }).includes("Newest source: interpret the graph."))
})

test("curriculum contracts reject malformed or incomplete results instead of silently dropping topics", () => {
  for (const raw of [JSON.stringify(valid), JSON.stringify({ structuredOutput: valid }), JSON.stringify({ text: JSON.stringify(valid) })]) {
    assert.deepEqual(parseCurriculum(raw), valid)
  }
  const malformed = [
    { ...valid, topics: [] }, { ...valid, topics: Array(7).fill(valid.topics[0]) },
    { ...valid, topics: [...valid.topics, valid.topics[0]] }, { ...valid, reason: 42 },
    { ...valid, mastered: true },
    { ...valid, topics: [{ ...valid.topics[0], questions: valid.topics[0].questions.slice(0, 1) }] },
    { ...valid, topics: [{ ...valid.topics[0], questions: [{ ...valid.topics[0].questions[0], bloomLevel: 7 }, valid.topics[0].questions[1]] }] },
    { ...valid, topics: [{ ...valid.topics[0], questions: [valid.topics[0].questions[0], { ...valid.topics[0].questions[1], answer: "produced" }] }] },
  ]
  for (const value of malformed) assert.equal(parseCurriculum(JSON.stringify(value)), null)
})

test("API providers receive the same course instructions and share result validation", async (t) => {
  const captured: string[] = []
  let malformed = false
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(String(options.body))
    captured.push(body.system ?? body.messages[0].content)
    const content = JSON.stringify(malformed ? { ...valid, topics: [] } : valid)
    return new Response(JSON.stringify(body.system ? { content: [{ text: content }] } : { choices: [{ message: { content } }] }), { status: 200 })
  })
  for (const provider of ["openai", "xai", "anthropic"] as AiProvider[]) {
    assert.deepEqual(await planCurriculum(input, { provider, model: "test", apiKey: "test-only" }), valid)
    malformed = true
    assert.equal(await planCurriculum(input, { provider, model: "test", apiKey: "test-only" }), null)
    malformed = false
  }
  assert.equal(new Set(captured).size, 1)
})

test("comparable successes adapt across sessions without changing past answers", async () => {
  const { db, ownerId, studentId, conceptId } = await learner()
  try {
    // A synthetic isolated sequence, all at Apply on the same topic.
    const sessionId = await startTutorSession(db, ownerId, studentId, now, { mode: "assessment" })
    const template = (await sessionItems(db, sessionId))[0]
    await db.prepare("DELETE FROM session_items WHERE session_id = ?").run(sessionId)
    for (let i = 1; i <= 7; i++) await db.prepare(`INSERT INTO session_items (id, session_id, position, beat, concept_id, bloom_level, prompt, answer, hints_json, surface, interleaved, hints_used, answered) VALUES (?, ?, ?, 'frontier', ?, 3, ?, '4', ?, 'screen', 0, 0, 0)`).run(crypto.randomUUID(), sessionId, i, conceptId, `Fresh check ${i}: 2 + 2`, template.hints_json)
    const original = await sessionItems(db, sessionId)
    for (let i = 0; i < 6; i++) await submitAnswer(db, ownerId, sessionId, { itemId: String(original[i].id), answer: "4" }, new Date(now.getTime() + i * 1000))
    const adjusted = await sessionItems(db, sessionId)
    assert.equal(adjusted[6].bloom_level, 4)
    assert.notEqual(adjusted[6].prompt, original[6].prompt)
    assert.deepEqual(adjusted.slice(0, 6).map(i => i.prompt), original.slice(0, 6).map(i => i.prompt))
  } finally { db.close() }
})

test("mixed Bloom misses do not trigger an adjustment without comparable evidence", async () => {
  const { db, ownerId, studentId } = await learner()
  try {
    const sessionId = await startTutorSession(db, ownerId, studentId, now, { mode: "assessment" })
    const original = await sessionItems(db, sessionId)
    for (let i = 0; i < 5; i++) {
      await db.prepare("UPDATE session_items SET prompt = ?, bloom_level = ? WHERE id = ?").run(`Fresh miss ${i}`, i % 2 + 1, original[i].id)
      await submitAnswer(db, ownerId, sessionId, { itemId: String(original[i].id), answer: "definitely wrong" }, new Date(now.getTime() + i * 1000))
    }
    assert.equal((await sessionItems(db, sessionId))[5].prompt, original[5].prompt)
    assert.equal((await db.prepare("SELECT modality FROM tutor_sessions WHERE id = ?").get(sessionId))!.modality, "paper")
  } finally { db.close() }
})

test("a school overlay reuses backbone IDs and preserves learner evidence and Bloom labels", async () => {
  const { db, ownerId, studentId, conceptId } = (await learner())
  try {
    const concept = loadBackbone().nodes.get(conceptId)!
    const before = (await db.prepare("SELECT * FROM learner_states WHERE student_id = ? AND concept_id = ?").get(studentId, conceptId))
    const result = (await applyCurriculum(db, ownerId, studentId, "Math", [{ ...valid.topics[0], title: concept.title }], now))
    assert.equal(result.created, 0)
    assert.equal(result.questions, 2)
    assert.deepEqual((await db.prepare("SELECT * FROM learner_states WHERE student_id = ? AND concept_id = ?").get(studentId, conceptId)), before)
    const rows = (await db.prepare("SELECT concept_id, bloom_level FROM practice_items WHERE student_id = ? ORDER BY rowid").all(studentId))
    assert.deepEqual(rows.map((row) => row.bloom_level), [3, 6])
    assert.ok(rows.every((row) => row.concept_id === conceptId))
  } finally { db.close() }
})

test("every backbone Apply generator measures its concept instead of silently falling back to addition", () => {
  const graph = loadBackbone()
  for (const concept of graph.nodes.values()) {
    const item = generateItem(concept, 3, 42)
    assert.ok(item.answer)
    if (concept.conceptId !== "math.4.nbt.b.4") assert.doesNotMatch(item.prompt, /^Compute \d+ \+ \d+\.$/, concept.conceptId)
  }
  for (const [id, match] of [
    ["math.8.ee.c.7", /\(x \+/], ["math.8.ee.a.1", /2\^/],
    ["math.hsa.apr.b.3", /Factor/], ["math.hsa.rei.b.4", /both solutions/],
  ] as const) assert.match(generateItem(graph.nodes.get(id)!, 3, 42).prompt, match)
  assert.equal(workingBloom({ ...emptyState("concept", "2026-10-05"), bloomLevel: 4 }), 5)
  assert.equal(workingBloom({ ...emptyState("concept", "2026-10-05"), bloomLevel: 5 }), 6)
  assert.match(generateItem(graph.nodes.get("math.5.nf.a.1")!, 5, 42).prompt, /Judge both/)
  assert.match(generateItem(graph.nodes.get("math.5.nf.a.1")!, 6, 42).prompt, /Write a problem/)
})

test("written production awaits review and preserves the actual evidence, while recap alone awards no Bloom success", async () => {
  const { db, ownerId, studentId } = (await learner())
  try {
    const sessionId = (await startTutorSession(db, ownerId, studentId, now))
    const current = (await sessionItems(db, sessionId))[0]
    await db.prepare("UPDATE session_items SET bloom_level = 6, answer = ?, interleaved = 0, hints_used = 2 WHERE id = ?")
      .run("Rubric: make an original fraction problem, solve it, and check it.", current.id)
    assert.equal(requiresJudgment("Rubric: make an original example", 6), true)
    const submitted = (await submitAnswer(db, ownerId, sessionId, { itemId: String(current.id), answer: "I made a new problem and explained my solution.", timeMs: 2200 }, now))
    assert.equal("pendingReview" in submitted && submitted.pendingReview, true)
    assert.equal((await db.prepare("SELECT count(*) AS n FROM attempts WHERE session_id = ?").get(sessionId))?.n, 0)
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    await reviewAnswer(db, ownerId, sessionId, { itemId: String(current.id), correct: true }, tomorrow)
    const attempt = (await db.prepare("SELECT * FROM attempts WHERE session_id = ?").get(sessionId))!
    assert.equal(attempt.day, "2026-10-05")
    assert.equal(attempt.bloom_level, 6)
    assert.equal(attempt.hints_used, 2)
    assert.equal(attempt.interleaved, 0)
    await assert.rejects(async () => (await reviewAnswer(db, ownerId, sessionId, { itemId: String(current.id), correct: true }, tomorrow)), /waiting for review/)
    await saveRecap(db, ownerId, sessionId, { learned: "Fractions", hard: "Checking", tellFriend: "Use equal pieces", productionSuccess: true }, tomorrow)
    assert.equal((await db.prepare("SELECT count(*) AS n FROM attempts WHERE session_id = ?").get(sessionId))?.n, 1)
    const sheetId = (await createSheet(db, ownerId, studentId, tomorrow))
    const results = (await scoreSheet(db, ownerId, sheetId, [], tomorrow))
    assert.ok(results.some((row) => row.pendingReview && row.reviewSessionId))
  } finally { db.close() }
})

test("automatic rubric grading persists a real model verdict while uncertain output stays pending", async (t) => {
  const { db, ownerId, studentId } = (await learner())
  let confidence = 0.95
  try {
    await saveAiSettings(db, ownerId, { provider: "openai", model: "test-grader", apiKey: "test-only" })
    t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      assert.match(body.messages[0].content, /keyword overlap/)
      assert.match(body.messages[1].content, /original fraction problem/)
      const verdict = { correct: true, reason: "The original problem has a correct common-denominator solution and an independent check.", confidence, errorType: null }
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(verdict) } }] }), { status: 200 })
    })
    const sessionId = (await startTutorSession(db, ownerId, studentId, now))
    for (const index of [0, 1]) {
      const item = (await sessionItems(db, sessionId))[index]
      await db.prepare("UPDATE session_items SET bloom_level = 6, answer = ?, answered = 1, given_answer = ?, submitted_at = ? WHERE id = ?")
        .run("Rubric: create an original fraction problem and check it.", "An original fraction problem with a complete solution and check.", now.toISOString(), item.id)
      await gradePendingResponses(db, ownerId, sessionId, gradeResponse, [String(item.id)])
      const graded = (await sessionItems(db, sessionId))[index]
      if (index === 0) {
        assert.equal(graded.correct, 1)
        assert.equal(graded.grader, "model:openai")
        assert.match(String(graded.grading_reason), /independent check/)
        confidence = 0.5
      } else assert.equal(graded.correct, null)
    }
    assert.equal((await db.prepare("SELECT count(*) AS n FROM attempts WHERE session_id = ?").get(sessionId))?.n, 1)
    assert.equal(parseRubricVerdict(JSON.stringify({ correct: true, confidence: 0.99, reason: "Looks good", errorType: "misconception" })), null)
    assert.equal(parseRubricVerdict(JSON.stringify({ correct: "yes", confidence: 1, reason: "Good", errorType: null })), null)
  } finally { db.close() }
})

test("decision history survives model switches, preserves reasons, and enforces ownership without exposing keys", async () => {
  const { db, ownerId, studentId } = (await learner())
  try {
    const original = (await decisionHistory(db, ownerId, studentId))
    assert.equal(original[0].kind, "target_added")
    await saveAiSettings(db, ownerId, { provider: "openai", model: "first-model", apiKey: "secret-one" })
    await startTutorSession(db, ownerId, studentId, now, { intent: "practice" })
    await saveAiSettings(db, ownerId, { provider: "anthropic", model: "second-model", apiKey: "secret-two" })
    const cards = (await decisionHistory(db, ownerId, studentId))
    assert.ok(cards.some((card) => card.id === original[0].id && card.reason === original[0].reason))
    assert.ok(cards.some((card) => card.provider === "openai" && card.kind === "session_started"))
    assert.ok(cards.some((card) => card.provider === "anthropic" && card.kind === "ai_settings_changed"))
    assert.ok(cards.every((card) => typeof card.spec_revision === "string" && card.spec_revision.length === 64))
    const context = (await decisionContext(db, ownerId, studentId))
    assert.ok(curriculumPrompt({ ...input, decisionHistory: context }).includes(String(original[0].reason)))
    assert.doesNotMatch(JSON.stringify(cards), /secret-one|secret-two/)
    const other = (await registerUser(db, "other-spec@example.com", "correct-horse", now))
    assert.ok(other.ok)
    await assert.rejects(async () => (await decisionHistory(db, other.userId, studentId)), /Student not found/)
  } finally { db.close() }
})

test("next action prioritizes an upcoming test and ignores unsupported seeded review claims", async () => {
  const { db, ownerId, studentId, conceptId } = (await learner())
  try {
    const scienceId = (await addLearning(db, ownerId, studentId, { purpose: "year", subject: "Science", title: "Explain a fair experiment", recall: "Change one variable and keep the other conditions the same" }, now))
    await db.prepare("UPDATE learner_states SET status = 'review_due', bloom_level = 2, mastery = 1, next_due = '2026-10-04', stability_days = 7 WHERE student_id = ? AND concept_id = ?").run(studentId, scienceId)
    assert.equal((await nextLearningAction(db, ownerId, studentId, now))?.conceptId, conceptId)
    const practiceId = (await startTutorSession(db, ownerId, studentId, now, { mode: "session", subject: "Math" }))
    assert.ok((await sessionItems(db, practiceId)).every((item) => item.concept_id !== scienceId))
    const checkId = (await startTutorSession(db, ownerId, studentId, now, { mode: "assessment", subject: "Math" }))
    assert.ok((await sessionItems(db, checkId)).every((item) => item.concept_id !== scienceId))
    await db.prepare("UPDATE targets SET deadline = '2026-10-01' WHERE student_id = ? AND kind = 'target'").run(studentId)
    const due = (await nextLearningAction(db, ownerId, studentId, now))
    assert.notEqual(due?.conceptId, scienceId)
    assert.match(due!.reason, /standing course/)
    assert.equal(due?.retentionEstimate, null)
  } finally { db.close() }
})

test("forgetting estimates decay and retention evidence checks the mastered rung without extra hints", () => {
  assert.equal(estimatedRetention(7, 0), 1)
  assert.equal(estimatedRetention(7, 7), 0.9)
  assert.ok(estimatedRetention(7, 14) < estimatedRetention(7, 7))
  const base: AttemptRecord = { attemptId: "1", studentId: "s", sessionId: "a", conceptId: "fractions", bloomLevel: 3, day: "2026-10-01", correct: true, hintsUsed: 0, interleaved: false, timeMs: 1000, errorType: null, modality: "paper" }
  const wins: AttemptRecord[] = [base, { ...base, attemptId: "2" }, { ...base, attemptId: "3", sessionId: "b", day: "2026-10-02", interleaved: true }]
  const easier = { ...base, attemptId: "4", sessionId: "c", bloomLevel: 2 as const, day: "2026-10-10" }
  const hinted = { ...base, attemptId: "5", sessionId: "c", day: "2026-10-10", hintsUsed: 2 }
  const board = weeklyScoreboard({ attempts: [...wins, easier, hinted], states: [], weekStart: "2026-10-05", today: "2026-10-10" })
  assert.equal(board.retention7.checked, 0)
  const delayed = weeklyScoreboard({ attempts: [...wins, easier, hinted, { ...base, attemptId: "6", sessionId: "d", day: "2026-10-11" }], states: [], weekStart: "2026-10-05", today: "2026-10-11" })
  assert.deepEqual(delayed.retention7, { checked: 1, held: 1 })
  const chronologicalWins = wins.map((row, index) => ({ ...row, createdAt: `2026-10-0${index === 2 ? 2 : 1}T12:00:0${index}.000Z` }))
  const miss = { ...base, attemptId: "0", sessionId: "c", day: "2026-10-02", createdAt: "2026-10-02T13:00:00.000Z", correct: false, errorType: "procedural_slip" as const }
  assert.equal(reduceState("fractions", [...chronologicalWins, miss], "2026-10-02", "paper").status, "review_due")
})

test("assessment evidence excludes practiced wording and hints while keeping uncertain verdicts separate", async () => {
  const { db, ownerId, studentId } = (await learner())
  try {
    const practice = (await startTutorSession(db, ownerId, studentId, now, { mode: "homework" }))
    const check = (await startTutorSession(db, ownerId, studentId, now, { mode: "assessment" }))
    const practiceItem = (await sessionItems(db, practice))[0]
    await db.prepare("UPDATE session_items SET prompt = 'Previously practiced question', answered = 1, correct = 1 WHERE id = ?").run(practiceItem.id)
    const items = (await sessionItems(db, check))
    for (let i = 0; i < 4; i++) await db.prepare("UPDATE session_items SET answered = 1, bloom_level = 3, prompt = ?, correct = ?, hints_used = ? WHERE id = ?")
      .run(i === 0 ? "Previously practiced question" : `Fresh assessment question ${i}`, i === 3 ? null : 1, i === 1 ? 1 : 0, items[i].id)
    const evidence = (await assessmentEvidence(db, studentId))
    assert.equal(evidence.reduce((sum, row) => sum + row.checked, 0), 1)
    assert.equal(evidence.reduce((sum, row) => sum + row.held, 0), 1)
    assert.equal(evidence.reduce((sum, row) => sum + row.excluded, 0), 2)
    assert.equal(evidence.reduce((sum, row) => sum + row.pending, 0), 1)
  } finally { db.close() }
})
