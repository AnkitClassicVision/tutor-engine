import assert from "node:assert/strict"
import test from "node:test"
import { gradeResponse } from "../src/grade-response.ts"
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
const first = { ...evidence, correct: true, reason: "You linked floating to the water the bottles push away.", confidence: 0.95, errorType: null }
const second = (correct: boolean, confidence: number) => ({ rubricPoints: [{ point: "Links floating to displaced water", met: correct, quote: correct ? "push away enough water" : "" }], reasoningSound: correct, correct, confidence, reason: correct ? "Explains displacement." : "Does not explain why." })

test("every AI grade needs an independent second judgment that agrees", async () => {
  const agree = scriptedAsk({ write: { sequence: [first, second(true, 0.9)] } })
  assert.equal((await gradeResponse(input, ai, 25000, { ask: agree.ask }))?.correct, true)
  assert.equal(agree.calls.length, 2)
  const disagree = scriptedAsk({ write: { sequence: [first, second(false, 0.9)] } })
  assert.equal(await gradeResponse(input, ai, 25000, { ask: disagree.ask }), null, "disagreement leaves the answer for a parent")
  const doubtful = scriptedAsk({ write: { sequence: [first, second(true, 0.6)] } })
  assert.equal(await gradeResponse(input, ai, 25000, { ask: doubtful.ask }), null)
  const apply = scriptedAsk({ write: { sequence: [first, second(true, 0.95)] } })
  assert.equal((await gradeResponse({ ...input, bloomLevel: 3 }, ai, 25000, { ask: apply.ask }))?.correct, true)
  assert.equal(apply.calls.length, 2, "grades below Evaluate are double-checked too")
  // A grader fooled by a false reason is overruled when the independent check sees through it.
  const fooled = scriptedAsk({ write: { sequence: [first, second(false, 0.92)] } })
  assert.equal(await gradeResponse({ ...input, response: "It floats because bottles are blue." }, ai, 25000, { ask: fooled.ask }), null)
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
    assert.deepEqual(await auditSummary(f.db, f.student), { checked: 2, agreed: 1, waiting: 0 })
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
