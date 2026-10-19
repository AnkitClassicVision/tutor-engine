import assert from "node:assert/strict"
import test from "node:test"
import { conceptLadder, ladderSummary } from "../src/engine/ladder.ts"
import { gainOnFairChecks } from "../src/engine/gain.ts"
import type { AttemptRecord, BloomLevel } from "../src/engine/types.ts"
import { openDb } from "../src/db.ts"
import { registerUser } from "../src/auth.ts"
import { applyCurriculum, createStudent, loadAttempts, sessionItems, startTutorSession, submitAnswer } from "../src/services.ts"
import { learningMeasures } from "../src/learning-metrics.ts"
import { scoreboardPage } from "../src/view.ts"

let n = 0
const attempt = (day: string, level: number, correct: boolean, extra: Partial<AttemptRecord> = {}): AttemptRecord => ({
  attemptId: `a${++n}`, createdAt: `${day}T10:00:${String(n % 60).padStart(2, "0")}Z`, studentId: "s", sessionId: `x${n}`, conceptId: "c", bloomLevel: level as BloomLevel, day,
  correct, hintsUsed: 0, interleaved: false, timeMs: 1000, errorType: null, modality: "screen", fresh: true, evidenceCertainty: "confirmed", supportUsed: "none", ...extra,
})

test("the ladder separates help, independence, memory and use somewhere new", () => {
  assert.deepEqual(conceptLadder("c", []).reached, [])
  const helped = conceptLadder("c", [attempt("2026-09-01", 3, true, { hintsUsed: 1, supportUsed: "hint" })])
  assert.deepEqual(helped.reached, ["practiced", "assisted"]); assert.equal(helped.band, "none")
  assert.match(helped.next, /on their own/)
  const own = conceptLadder("c", [attempt("2026-09-01", 3, true), attempt("2026-09-09", 2, true)])
  assert.deepEqual(own.reached, ["practiced", "independent", "retained7"]); assert.equal(own.band, "use"); assert.equal(own.since, "2026-09-01")
  // A repeated question, an unresolved grade or a hinted answer is not independent evidence.
  const notOwn = conceptLadder("c", [attempt("2026-09-01", 6, true, { fresh: false }), attempt("2026-09-02", 6, true, { evidenceCertainty: "unresolved" })])
  assert.equal(notOwn.band, "none"); assert.ok(!notOwn.reached.includes("independent"))
  const top = conceptLadder("c", [attempt("2026-09-01", 5, true), attempt("2026-09-05", 4, true, { kind: "transfer" }), attempt("2026-09-29", 3, true)])
  assert.deepEqual(top.reached, ["practiced", "independent", "retained7", "retained28", "transferred"])
  assert.equal(top.band, "judge"); assert.equal(top.goalMet, true)
  const summary = ladderSummary([helped, own, top])
  assert.equal(summary.goalMet, 1); assert.equal(summary.bands.judge, 1); assert.equal(summary.steps.independent, 2)
})

test("before and after needs enough fair checks a week apart and reports uncertainty", () => {
  const early = Array.from({ length: 6 }, (_, i) => attempt(`2026-09-0${i + 1}`, 2, i < 2))
  assert.equal(gainOnFairChecks(early).enough, false)
  assert.match(gainOnFairChecks(early).note, /Needs 12/)
  const close = [...early, ...Array.from({ length: 6 }, (_, i) => attempt("2026-09-06", 3, true))]
  assert.equal(gainOnFairChecks(close).enough, false)
  const later = [...early, ...Array.from({ length: 6 }, (_, i) => attempt(`2026-09-2${i}`, 3, true))]
  const gain = gainOnFairChecks(later)
  assert.equal(gain.enough, true)
  assert.equal(Math.round(gain.before!.accuracy * 100), 33); assert.equal(gain.after!.accuracy, 1)
  assert.equal(gain.size, "large"); assert.ok(gain.effect! > 1.5)
  assert.equal(gain.demandChange, 1)
  assert.match(gain.note, /risen/)
  // Hinted answers never enter the comparison.
  const hinted = [...later.slice(0, 6), ...Array.from({ length: 6 }, (_, i) => attempt(`2026-09-2${i}`, 3, true, { hintsUsed: 1, supportUsed: "hint" }))]
  assert.equal(gainOnFairChecks(hinted).enough, false)
})

test("a question written as transfer becomes transfer evidence, and confidence is kept beside the answer", async () => {
  const db = openDb(":memory:")
  try {
    const u = await registerUser(db, "ladder@example.com", "synthetic-password"); if (!u.ok) throw new Error()
    const student = await createStudent(db, u.userId, { displayName: "Synthetic learner", grade: 5, sessionCapMinutes: 25 })
    await applyCurriculum(db, u.userId, student, "Science", [{ title: "Floating and sinking", recall: "Things float when they are less dense than water.", example: "Wood floats.", nonExample: "A stone floats.",
      questions: [{ prompt: "A raft floats 4 children on 10 empty bottles. About how many children could it float on 20 bottles?", answer: "8", bloomLevel: 3, transfer: true }, { prompt: "How many of these float: a cork, a coin, a leaf?", answer: "2", bloomLevel: 1 }] }])
    const stored = db.prepare("SELECT prompt, evidence_kind FROM practice_items WHERE student_id = ? ORDER BY prompt").all(student) as Array<Record<string, string>>
    assert.deepEqual(stored.map(row => row.evidence_kind), ["transfer", "practice"])
    const session = await startTutorSession(db, u.userId, student, new Date(), { subject: "Science", mode: "assessment" })
    const items = await sessionItems(db, session)
    const transfer = items.find(item => String(item.prompt).startsWith("A raft floats"))
    assert.ok(transfer, "the transfer question reaches the session")
    assert.equal(transfer!.evidence_kind, "transfer")
    for (const item of items) {
      if (item.answered) continue
      if (item.id !== transfer!.id) { await submitAnswer(db, u.userId, session, { itemId: String(item.id), answer: String(item.answer) }); continue }
      await submitAnswer(db, u.userId, session, { itemId: String(item.id), answer: "8", confidence: "sure" })
      break
    }
    const recorded = (await loadAttempts(db, student)).find(a => a.attemptId === transfer!.id)
    assert.equal(recorded?.kind, "transfer"); assert.equal(recorded?.confidence, "sure")
    const measures = await learningMeasures(db, student)
    assert.equal(measures.at(-1)!.key, "calibration"); assert.equal(measures.at(-1)!.enough, false)
  } finally { db.close() }
})

test("the numbers page shows the ladder and the fair-check comparison to parents", () => {
  const rows = [conceptLadder("c", [attempt("2026-09-01", 5, true), attempt("2026-09-05", 4, true, { kind: "transfer" }), attempt("2026-09-29", 3, true)])]
  const html = scoreboardPage("Synthetic", "00000000-0000-0000-0000-000000000000", { conceptsMasteredThisWeek: [], frontier: [], stuck: [], errorTrend: [], justRightRatio: null, retention7: { checked: 0, held: 0 }, retention30: { checked: 0, held: 0 } } as any, { c: "Fractions" }, [], { ladders: rows, gain: gainOnFairChecks([]) })
  assert.match(html, /How far the thinking has climbed/)
  assert.match(html, /1 meet the full goal/)
  assert.match(html, /Used somewhere new/)
  assert.match(html, /Needs 12 fair checks; 0 so far/)
  assert.match(html, /describes your child against their own start; it does not show what caused the change/)
  // Cohen's h is never put on Bloom's 2-sigma scale.
  assert.match(html, /not on the same scale as Bloom/); assert.doesNotMatch(html, /would match/)
  // A rise in thinking level is described as a different kind of question, never as harder questions.
  const window = (accuracy: number, demand: number, from: string, to: string) => ({ checks: 6, correct: Math.round(accuracy * 6), accuracy, low: accuracy - .2, high: Math.min(1, accuracy + .2), demand, from, to })
  const gained = scoreboardPage("Synthetic", "00000000-0000-0000-0000-000000000000", { conceptsMasteredThisWeek: [], frontier: [], stuck: [], errorTrend: [], justRightRatio: null, retention7: { checked: 0, held: 0 }, retention30: { checked: 0, held: 0 } } as any, { c: "Fractions" }, [], { ladders: rows, gain: { enough: true, checks: 12, before: window(.5, 2, "2026-09-01", "2026-09-03"), after: window(.83, 3.5, "2026-09-20", "2026-09-22"), effect: .72, size: "medium", demandChange: 1.5, note: "" } })
  assert.match(gained, /asked for more kinds of thinking \(up 1\.5 of a level\)\. That is a different kind of question, not proof of a harder one/)
  assert.doesNotMatch(gained, /got harder/)
})

test("a memory step shown at a lower thinking level says so on the parent ladder (owner decision 2026-10-19)", () => {
  const row = conceptLadder("c", [attempt("2026-09-01", 5, true), attempt("2026-09-09", 2, true), attempt("2026-09-30", 5, true)])
  assert.deepEqual(row.memoryLevel, { retained7: 5, retained28: 5 }, "the highest later success counts")
  const lower = conceptLadder("c", [attempt("2026-09-01", 5, true), attempt("2026-09-09", 2, true)])
  assert.equal(lower.band, "judge"); assert.equal(lower.memoryLevel.retained7, 2)
  const html = scoreboardPage("Synthetic", "00000000-0000-0000-0000-000000000000", { conceptsMasteredThisWeek: [], frontier: [], stuck: [], errorTrend: [], justRightRatio: null, retention7: { checked: 0, held: 0 }, retention30: { checked: 0, held: 0 } } as any, { c: "Fractions" }, [], { ladders: [lower, conceptLadder("d", [attempt("2026-09-01", 3, true, { conceptId: "d" }), attempt("2026-09-09", 3, true, { conceptId: "d" })])], gain: gainOnFairChecks([]) })
  assert.match(html, /Remembered after a week \(at the basics level\)/)
  assert.equal((html.match(/\(at the [a-z-]+ level\)/g) ?? []).length, 1, "a memory at the topic's own level gets no extra label")
})
