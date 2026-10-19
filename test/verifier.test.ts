import assert from "node:assert/strict"
import test from "node:test"
import { gradeResponse, judgeAnswer } from "../src/grade-response.ts"
import { scriptedAsk } from "../src/runbook/golden.ts"
import { auditPage, auditSample, auditSummary, recordAudit } from "../src/grading-audit.ts"
import { armFor, experimentReport, isoWeek, setExperiment, RULE } from "../src/experiments.ts"
import { openDb } from "../src/db.ts"
import { registerUser } from "../src/auth.ts"
import { createStudent, loadAttempts } from "../src/services.ts"
import { sessionPage } from "../src/view.ts"

const ai = { provider: "openai" as const, model: "stub", apiKey: "synthetic" }
const input = { concept: "Floating", bloomLevel: 6 as const, prompt: "Design a raft and explain why it floats.", key: "Rubric: spreads load; links floating to displaced water.", response: "Bottles on both sides push away enough water." }
const evidence = { rubricPoints: [{ point: "Links floating to displaced water", met: true, quote: "push away enough water" }], reasoningSound: true }
const first = { ...evidence, doubts: [] as string[], correct: true, reason: "You linked floating to the water the bottles push away.", confidence: 0.95, errorType: null }
const unsureFirst = { ...first, confidence: 0.7, doubts: ["The answer could mean the bottles or the raft float."] }
const grounded = (correct: boolean, confidence: number, doubts: string[] = [], doubtAbout = doubts.length ? "answer" : "none") => ({ rubricPoints: [{ point: "Links floating to displaced water", met: correct, quote: correct ? "push away enough water" : "" }], reasoningSound: correct, groundedOn: ["idea", "own working"], doubts, doubtAbout, correct, reason: correct ? "You explained displacement." : "Say why the raft floats.", confidence, errorType: correct ? null : "misconception" })
const second = (correct: boolean, confidence: number) => ({ rubricPoints: [{ point: "Links floating to displaced water", met: correct, quote: correct ? "push away enough water" : "" }], reasoningSound: correct, correct, confidence, reason: correct ? "Explains displacement." : "Does not explain why." })

test("every AI grade needs an independent second judgment that agrees", async () => {
  const agree = scriptedAsk({ write: { sequence: [first, second(true, 0.9)] } })
  const graded = await judgeAnswer(input, ai, { ask: agree.ask })
  assert.equal(graded.kind, "graded"); assert.equal(graded.kind === "graded" && graded.path, "two graders agreed")
  assert.equal(agree.calls.length, 2)
  assert.equal((await gradeResponse({ ...input, bloomLevel: 3 }, ai, 25000, { ask: scriptedAsk({ write: { sequence: [first, second(true, 0.95)] } }).ask }))?.correct, true)
})

test("a disagreement or a grade under 85% confidence is grounded in the topic's material", async () => {
  // Disagreement: the grounding pass settles it.
  const dispute = scriptedAsk({ write: { sequence: [first, second(false, 0.9), grounded(false, 0.92)] } })
  const settled = await judgeAnswer({ ...input, response: "It floats because bottles are blue. push away enough water" }, ai, { ask: dispute.ask, grounding: { idea: "Things float when they push aside their weight in water." } })
  assert.equal(settled.kind, "graded"); assert.equal(settled.kind === "graded" && settled.path, "grounded"); assert.equal(settled.kind === "graded" && settled.verdict.correct, false)
  assert.equal(dispute.calls.length, 3)
  // Under 85%: no second grader, straight to grounding.
  const low = scriptedAsk({ write: { sequence: [unsureFirst, grounded(true, 0.9)] } })
  const lowResult = await judgeAnswer(input, ai, { ask: low.ask })
  assert.equal(lowResult.kind, "graded"); assert.equal(low.calls.length, 2)
  // Grounding counts at 80%: a grounded 82% settles it; a first attempt at 60% gets a focused second attempt.
  assert.equal((await judgeAnswer(input, ai, { ask: scriptedAsk({ write: { sequence: [unsureFirst, grounded(true, 0.82)] } }).ask })).kind, "graded")
  const recheck = scriptedAsk({ write: { sequence: [unsureFirst, grounded(true, 0.6, ["It is unclear whether 'it' means the raft."]), grounded(true, 0.85)] } })
  const settledSecond = await judgeAnswer(input, ai, { ask: recheck.ask })
  assert.equal(settledSecond.kind, "graded"); assert.equal(recheck.calls.length, 3, "first grade, two grounding attempts")
  // A doubt about the question itself is retired, not sent to the parent.
  const badKey = await judgeAnswer(input, ai, { ask: scriptedAsk({ write: { sequence: [unsureFirst, grounded(true, 0.5, ["The expected answer says 18, but 9 + 8 is 17."], "question")] } }).ask })
  assert.equal(badKey.kind, "question_problem")
  // Even a confident grounding cannot turn a faulty question into evidence.
  const inflated = await judgeAnswer(input, ai, { ask: scriptedAsk({ write: { sequence: [unsureFirst, grounded(true, 0.95, ["A recall sum cannot show creating something new."], "question")] } }).ask })
  assert.equal(inflated.kind, "question_problem")
})

test("still unsure after grounding goes to a parent with the reason; an unreachable AI is a retry, not a guess", async () => {
  const unsure = scriptedAsk({ write: { sequence: [unsureFirst, grounded(true, 0.6, ["Still unclear."]), grounded(true, 0.6, ["The topic's material does not settle whether 'it floats' means the raft."])] } })
  const escalated = await judgeAnswer(input, ai, { ask: unsure.ask })
  assert.equal(escalated.kind, "escalated")
  assert.match(escalated.kind === "escalated" ? escalated.doubt : "", /does not settle/)
  assert.doesNotMatch(escalated.kind === "escalated" ? escalated.doubt : "", /confident|grader/i, "parents read plain words, not grading terms")
  // When the grounding pass gives no usable reply, the parent reads the first check's reason.
  const noGround = scriptedAsk({ write: { sequence: [unsureFirst, { not: "a grade" }, { not: "a grade" }, { not: "a grade" }, { not: "a grade" }] } })
  const fallback = await judgeAnswer(input, ai, { ask: noGround.ask })
  assert.equal(fallback.kind, "escalated")
  assert.match(fallback.kind === "escalated" ? fallback.doubt : "", /bottles or the raft/)
  assert.equal(await gradeResponse(input, ai, 25000, { ask: scriptedAsk({ write: { sequence: [unsureFirst, grounded(true, 0.6, ["Unclear."]), grounded(true, 0.6, ["Unclear."])] } }).ask }), null)
  const down = await judgeAnswer(input, ai, { ask: async () => { throw new Error("offline") } })
  assert.equal(down.kind, "failed")
})

async function family() {
  const db = openDb(":memory:")
  const u = await registerUser(db, "verifier@example.com", "synthetic-password"); if (!u.ok) throw new Error()
  const student = await createStudent(db, u.userId, { displayName: "Synthetic learner", grade: 4, sessionCapMinutes: 25 })
  return { db, owner: u.userId, student }
}

function gradedItem(db: any, student: string, grader: string, startedAt = new Date().toISOString()) {
  const session = crypto.randomUUID(), id = crypto.randomUUID()
  db.prepare(`INSERT INTO tutor_sessions (id, student_id, started_at, modality, consecutive_step_downs, cap_minutes, continuity, mode, subject) VALUES (?, ?, ?, 'screen', 0, 25, '', 'session', 'Science')`).run(session, student, startedAt)
  db.prepare(`INSERT INTO session_items (id, session_id, position, beat, concept_id, bloom_level, prompt, answer, hints_json, surface, interleaved, hints_used, answered, given_answer, correct, grader, grading_reason, submitted_at) VALUES (?, ?, 1, 'frontier', 'custom.float', 5, ?, 'Rubric: reasons', '[]', 'screen', 0, 0, 1, 'Because it is lighter', 1, ?, 'Good reasons.', ?)`).run(id, session, `Which raft is better, and why? ${id}`, grader, startedAt)
  db.prepare(`INSERT INTO attempts (id, student_id, session_id, concept_id, bloom_level, day, correct, hints_used, interleaved, time_ms, error_type, modality, created_at) VALUES (?, ?, ?, 'custom.float', 5, ?, 1, 0, 0, 1000, NULL, 'screen', ?)`).run(id, student, session, startedAt.slice(0, 10), startedAt)
  return id
}

test("parents spot-check AI grades; a disputed grade counts neither way", async () => {
  const f = await family()
  try {
    const ai1 = gradedItem(f.db, f.student, "model:openai"), ai2 = gradedItem(f.db, f.student, "model:openai")
    gradedItem(f.db, f.student, "parent")
    const sample = await auditSample(f.db, f.student)
    assert.deepEqual(sample.map(i => i.id).sort(), [ai1, ai2].sort(), "only AI grades are sampled")
    assert.match(auditPage(f.student, "Synthetic learner", sample, { checked: 0, agreed: 0 }, {}), /I disagree/)
    assert.equal((await loadAttempts(f.db, f.student)).find(a => a.attemptId === ai1)?.evidenceCertainty, "confirmed")
    await recordAudit(f.db, f.student, ai1, false)
    await recordAudit(f.db, f.student, ai2, true)
    await assert.rejects(recordAudit(f.db, f.student, ai2, false), /already checked/)
    assert.equal((await loadAttempts(f.db, f.student)).find(a => a.attemptId === ai1)?.evidenceCertainty, "unresolved")
    assert.deepEqual(await auditSummary(f.db, f.student), { checked: 2, agreed: 1, waiting: 0, unsure: 0 })
    const other = await createStudent(f.db, f.owner, { displayName: "Other", grade: 4, sessionCapMinutes: 25 })
    await assert.rejects(recordAudit(f.db, other, ai2, true), /not available/)
  } finally { f.db.close() }
})

test("comparisons alternate by week, follow the rule fixed in advance, and hide the feature in off weeks", async () => {
  assert.equal(armFor("{}", "confidence-check", new Date("2026-10-07T12:00:00Z")), "on", "without a comparison the feature is on")
  const enrolledJson = JSON.stringify({ "confidence-check": "2026-09-01" })
  const odd = new Date("2026-10-07T12:00:00Z"), even = new Date("2026-10-14T12:00:00Z")
  assert.equal(isoWeek(odd) % 2, 1)
  assert.equal(armFor(enrolledJson, "confidence-check", odd), "on"); assert.equal(armFor(enrolledJson, "confidence-check", even), "off")
  const f = await family()
  try {
    assert.equal(await experimentReport(f.db, f.student, "confidence-check"), null)
    await setExperiment(f.db, f.student, "confidence-check", true, new Date("2026-09-07T12:00:00Z"))
    await assert.rejects(setExperiment(f.db, f.student, "unknown", true), /Unknown/)
    const early = await experimentReport(f.db, f.student, "confidence-check", new Date("2026-09-10T12:00:00Z"))
    assert.equal(early!.verdict, "not enough yet")
    // Four weeks, a mission and five fair checks a day, all correct: learning and return hold.
    for (let d = 0; d < 28; d++) {
      const day = new Date(Date.parse("2026-09-07T12:00:00Z") + d * 86400000).toISOString()
      for (let k = 0; k < 1; k++) gradedItem(f.db, f.student, "local", day)
    }
    const report = await experimentReport(f.db, f.student, "confidence-check", new Date("2026-10-05T12:00:00Z"))
    assert.ok(report!.on.weeks >= RULE.minWeeksPerArm && report!.off.weeks >= RULE.minWeeksPerArm)
    assert.equal(report!.enough, true, JSON.stringify(report))
    assert.equal(report!.verdict, "keep")
  } finally { f.db.close() }
  const html = (askSure: boolean) => sessionPage({ sessionId: "00000000-0000-0000-0000-000000000000", continuity: "", item: { id: "i", prompt: "2 + 2", concept_id: "c", beat: "frontier", hints_used: 0 }, position: 1, total: 1, feedback: null, onBreak: false, ended: false, capMinutes: 10, askSure })
  assert.match(html(true), /How sure are you/); assert.doesNotMatch(html(false), /How sure are you/)
})

test("an escalated answer waits for the parent, who is told why and decides", async () => {
  const { gradePendingResponses } = await import("../src/server.ts")
  const { escalatedItems, auditPage } = await import("../src/grading-audit.ts")
  const { reviewAnswer } = await import("../src/services.ts")
  const f = await family()
  try {
    const session = crypto.randomUUID(), item = crypto.randomUUID()
    f.db.prepare(`INSERT INTO tutor_sessions (id, student_id, started_at, modality, consecutive_step_downs, cap_minutes, continuity, mode, subject) VALUES (?, ?, ?, 'screen', 0, 25, '', 'session', 'Science')`).run(session, f.student, new Date().toISOString())
    f.db.prepare(`INSERT INTO session_items (id, session_id, position, beat, concept_id, bloom_level, prompt, answer, hints_json, surface, interleaved, hints_used, answered, given_answer, submitted_at) VALUES (?, ?, 1, 'frontier', 'custom.float', 5, 'Which raft is better, and why?', 'Rubric: weighs both rafts with a reason', '[]', 'screen', 0, 0, 1, 'the bottle one maybe', ?)`).run(item, session, new Date().toISOString())
    const judge = async () => ({ kind: "escalated" as const, doubt: "The answer says 'maybe' and gives no reason the material can check." })
    await gradePendingResponses(f.db, f.owner, session, judge)
    const waiting = await escalatedItems(f.db, f.student)
    assert.equal(waiting.length, 1); assert.match(waiting[0].grading_doubt, /no reason the material can check/)
    assert.match(String(f.db.prepare("SELECT grading_doubt FROM session_items WHERE id = ? /* still sealed */").get(item)!.grading_doubt), /^fam:v1:/, "the doubt is sealed for the family")
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM attempts WHERE id = ?").get(item)!.n, 0, "an escalated answer counts neither way")
    // Grading again does not re-ask the AI about an answer already waiting for the parent.
    let asked = 0
    await gradePendingResponses(f.db, f.owner, session, async () => { asked++; return { kind: "failed" as const } })
    assert.equal(asked, 0)
    const page = auditPage(f.student, "Synthetic learner", [], { checked: 0, agreed: 0 }, {}, waiting)
    assert.match(page, /The tutor isn’t fully sure about this answer/); assert.match(page, /Why the tutor isn’t sure/); assert.match(page, /It meets it/)
    await reviewAnswer(f.db, f.owner, session, { itemId: item, correct: false, grader: "parent", reason: "A parent decided." })
    assert.equal((await escalatedItems(f.db, f.student)).length, 0)
    assert.equal(f.db.prepare("SELECT correct FROM attempts WHERE id = ?").get(item)!.correct, 0)
  } finally { f.db.close() }
})


test("a question with a problem is retired quietly, and a rubric follows its question into grading", async () => {
  const { gradePendingResponses } = await import("../src/server.ts")
  const { escalatedItems } = await import("../src/grading-audit.ts")
  const { applyCurriculum, sessionItems, startTutorSession } = await import("../src/services.ts")
  const f = await family()
  try {
    const rubric = { mustShow: [{ point: "Names the plant in the light", acceptable: ["the one in the light", "the sunny one"] }], doesNotMeet: ["the dark one because it rests"], notRequired: ["spelling"], examples: { meets: "The one in the light makes food.", almost: "The sunny one.", notYet: "The dark one rests." } }
    await applyCurriculum(f.db, f.owner, f.student, "Science", [{ title: "Plants need light", recall: "Plants use light to make food.", example: "A sunny plant grows.", nonExample: "A plant in a cupboard thrives.", questions: [{ prompt: "Two plants: one in a cupboard, one by a window. Which stays healthier, and why?", answer: "Rubric: the window plant, because light lets it make food.", bloomLevel: 4, rubric }, { prompt: "What do plants need to make food?", answer: "light", bloomLevel: 1 }] }])
    assert.deepEqual(JSON.parse(String(f.db.prepare("SELECT rubric_json FROM practice_items WHERE student_id = ? AND bloom_level = 4").get(f.student)!.rubric_json)), rubric)
    const session = await startTutorSession(f.db, f.owner, f.student, new Date(), { subject: "Science", mode: "assessment" })
    const item = (await sessionItems(f.db, session)).find(i => String(i.prompt).startsWith("Two plants"))!
    assert.ok(item, "the open question reaches the session"); assert.ok(item.rubric_json, "with its rubric")
    f.db.prepare("UPDATE session_items SET answered = 1, given_answer = 'the window one', submitted_at = ? WHERE id = ?").run(new Date().toISOString(), item.id)
    let seen: unknown
    await gradePendingResponses(f.db, f.owner, session, async (input) => { seen = input.rubric; return { kind: "question_problem" as const, doubt: "The question cannot show what it is meant to check." } }, [String(item.id)])
    assert.deepEqual(seen, rubric, "graders receive the stored rubric")
    const after = (await sessionItems(f.db, session)).find(i => i.id === item.id)!
    assert.equal(Number(after.disputed), 1); assert.equal(after.grader, "retired"); assert.equal(after.correct, null)
    assert.equal((await escalatedItems(f.db, f.student)).length, 0, "a question problem never lands on the parent")
  } finally { f.db.close() }
})
