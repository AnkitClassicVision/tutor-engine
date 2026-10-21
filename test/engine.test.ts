import assert from "node:assert/strict"
import test from "node:test"
import { inferError } from "../src/engine/diagnose.ts"
import { loadBackbone, prerequisiteClosure, probeFailures } from "../src/engine/graph.ts"
import { generateItem } from "../src/engine/items.ts"
import { masteryMet, projectState, reduceState } from "../src/engine/mastery.ts"
import { fractionString, scoreAnswer } from "../src/engine/score.ts"
import { weeklyScoreboard } from "../src/engine/scoreboard.ts"
import { buildQueue, mixCounts } from "../src/engine/select.ts"
import { buildSheet } from "../src/engine/sheets.ts"
import { activeFocus } from "../src/engine/targets.ts"
import { nextThermostat } from "../src/engine/thermostat.ts"
import type { AttemptRecord, BloomLevel, LearnerConceptState } from "../src/engine/types.ts"

const graph = loadBackbone()

function attempt(overrides: Partial<AttemptRecord> & { attemptId: string }): AttemptRecord {
  return {
    studentId: "student",
    sessionId: "session-a",
    conceptId: "math.5.nf.a.1",
    bloomLevel: 3,
    day: "2026-10-01",
    correct: true,
    hintsUsed: 0,
    interleaved: false,
    timeMs: 1000,
    errorType: null,
    modality: "paper",
    ...overrides,
  }
}

test("backbone is one acyclic math graph and polynomials rest on fraction foundations", () => {
  assert.equal(graph.nodes.size >= 20, true)
  const closure = prerequisiteClosure(graph, ["math.hsa.apr.b.3"])
  assert.equal(closure[0], "math.4.nf.a.1")
  assert.ok(closure.indexOf("math.4.nf.a.1") < closure.indexOf("math.5.nf.a.1"))
  assert.ok(closure.includes("math.hsa.apr.a.1"))
  assert.ok(closure.includes("math.hsa.apr.b.3"))
  assert.equal(closure.includes("math.7.rp.a.3"), false)
})

test("probe teaches at most three failing foundations, not a mastered prerequisite", () => {
  const open = probeFailures(graph, ["math.hsa.apr.b.3"], {}, 3)
  assert.deepEqual(open, ["math.4.nf.a.1", "math.4.nf.b.3", "math.5.nf.a.1"])
  const states = {
    "math.4.nf.a.1": { mastery: 1, status: "mastered" as const },
    "math.4.nf.b.3": { mastery: 1, status: "mastered" as const },
  }
  assert.deepEqual(probeFailures(graph, ["math.hsa.apr.b.3"], states, 3), [
    "math.5.nf.a.1",
    "math.6.ee.a.2",
    "math.6.ee.b.7",
  ])
})

test("mastery needs three counted successes, two sessions, two days, and one mix", () => {
  const wins = [
    attempt({ attemptId: "1", sessionId: "a", day: "2026-10-01" }),
    attempt({ attemptId: "2", sessionId: "a", day: "2026-10-01" }),
    attempt({ attemptId: "3", sessionId: "b", day: "2026-10-02", interleaved: true }),
  ]
  assert.equal(masteryMet(wins, 3), true)
  assert.equal(masteryMet(wins.map((row) => ({ ...row, day: "2026-10-01" })), 3), false)
  assert.equal(masteryMet(wins.map((row) => ({ ...row, interleaved: false })), 3), false)
  assert.equal(masteryMet(wins.map((row) => ({ ...row, hintsUsed: 2 })), 3), false)
  const state = reduceState("math.5.nf.a.1", wins, "2026-10-02", "paper")
  assert.equal(state.bloomLevel, 3)
  assert.equal(state.mastery, 1)
  assert.equal(state.status, "mastered")
})

test("a miss after mastery returns the concept to review and does not zero it", () => {
  const rows = [
    attempt({ attemptId: "1", sessionId: "a", day: "2026-10-01" }),
    attempt({ attemptId: "2", sessionId: "a", day: "2026-10-01" }),
    attempt({ attemptId: "3", sessionId: "b", day: "2026-10-02", interleaved: true }),
    attempt({ attemptId: "4", sessionId: "c", day: "2026-10-03", correct: false, errorType: "procedural_slip" }),
  ]
  const state = reduceState("math.5.nf.a.1", rows, "2026-10-03", "paper")
  assert.equal(state.bloomLevel, 3)
  assert.equal(state.status, "review_due")
  assert.ok(state.mastery >= 0.4)
  assert.ok(state.mastery < 1)
})

test("three weak sessions mark the concept stuck", () => {
  const rows = ["a", "b", "c"].map((sessionId, index) =>
    attempt({
      attemptId: sessionId,
      sessionId,
      day: `2026-10-0${index + 1}`,
      correct: false,
      errorType: "misconception",
    }),
  )
  const state = reduceState("math.5.nf.a.1", rows, "2026-10-03", "paper")
  assert.equal(state.status, "stuck")
})

test("historical seeded mastery is retained in the base but current claims require evidence", () => {
  const base: LearnerConceptState = {
    conceptId: "math.4.nf.a.1",
    bloomLevel: 2,
    mastery: 1,
    stabilityDays: 30,
    nextDue: "2026-10-11",
    errorSignatures: [],
    hintsLast10: 0,
    masteredIn: "paper",
    status: "mastered",
  }
  const next = projectState(
    base,
    [attempt({ attemptId: "m", conceptId: "math.4.nf.a.1", bloomLevel: 2, correct: false, errorType: "retrieval_gap" })],
    "2026-10-04",
  )
  assert.equal(next.bloomLevel, 0)
  assert.equal(next.status, "frontier")
  assert.equal(base.bloomLevel, 2)
})

test("thermostat holds the 85 percent band and stops at the attention cap", () => {
  const base = {
    consecutiveStepDowns: 0,
    modality: "paper" as const,
    timeOnItemMs: 1000,
    medianTimeMs: 1000,
    frustrated: false,
    minutesInBlock: 4,
    attentionBlockMinutes: 25,
  }
  assert.equal(nextThermostat({ ...base, recentCorrect: [true, true, true, true, true, true] }).type, "step_up")
  assert.equal(nextThermostat({ ...base, recentCorrect: [true, true, true, true, true, false] }).type, "hold")
  assert.equal(nextThermostat({ ...base, recentCorrect: [true, true, true, true, false, false] }).type, "step_down")
  assert.deepEqual(
    nextThermostat({ ...base, consecutiveStepDowns: 2, recentCorrect: [false, false, false, false, false, false] }),
    { type: "change_modality", to: "voice" },
  )
  assert.deepEqual(nextThermostat({ ...base, minutesInBlock: 25, recentCorrect: [true, true, true, true, true, true] }), {
    type: "end_session",
    reason: "attention",
  })
  assert.equal(
    nextThermostat({ ...base, timeOnItemMs: 5000, medianTimeMs: 1000, recentCorrect: [true] }).type,
    "hint_then_break",
  )
  assert.equal(nextThermostat({ ...base, recentCorrect: [true, false] }).type, "hold")
})

test("a 20-item mix is 60, 25, and 15, and a dated target outranks the program", () => {
  assert.deepEqual(mixCounts(20), { frontier: 12, review: 5, stretch: 3 })
  const queue = buildQueue({
    frontierConceptId: "math.5.nf.a.1",
    frontierBloom: 3,
    review: [{ conceptId: "math.4.nf.a.1", bloom: 1 }],
    stretchConceptId: "math.6.rp.a.1",
  })
  assert.equal(queue.length, 12)
  assert.equal(queue.filter((slot) => slot.beat === "warmup").length, 3)
  assert.equal(queue.filter((slot) => slot.beat === "frontier").length, 7)
  assert.equal(queue.filter((slot) => slot.beat === "stretch" && slot.interleaved).length, 2)
  const focus = activeFocus(
    [
      { id: "p", kind: "program", title: "Year", deadline: null, conceptIds: ["math.6.ee.a.2"], priority: 1 },
      { id: "t", kind: "target", title: "Friday", deadline: "2026-10-09", conceptIds: ["math.hsa.apr.b.3"], priority: 2 },
      { id: "old", kind: "target", title: "Done", deadline: "2026-10-01", conceptIds: ["math.4.nbt.b.4"], priority: 9 },
    ],
    "2026-10-04",
  )
  assert.equal(focus?.id, "t")
  const after = activeFocus(
    [{ id: "old", kind: "target", title: "Done", deadline: "2026-10-01", conceptIds: ["math.4.nbt.b.4"], priority: 9 }, { id: "p", kind: "program", title: "Year", deadline: null, conceptIds: ["math.6.ee.a.2"], priority: 1 }],
    "2026-10-04",
  )
  assert.equal(after?.id, "p")
})

test("unlike-fraction items match an independent sum and the hint ladder hides then shows the answer", () => {
  const concept = graph.nodes.get("math.5.nf.a.1")!
  const first = generateItem(concept, 3, 7)
  const again = generateItem(concept, 3, 7)
  assert.deepEqual(first, again)
  for (const seed of [1, 2, 7, 99]) {
    const item = generateItem(concept, 3, seed)
    const match = item.prompt.match(/^Add (\d+)\/(\d+) \+ (\d+)\/(\d+)\.$/)
    assert.ok(match)
    const [, a, b, c, d] = match.map(Number)
    assert.notEqual(b, d)
    assert.equal(item.answer, fractionString(a * d + c * b, b * d))
    assert.equal(scoreAnswer(item.answer, item.answer).correct, true)
    assert.equal(item.hintLadder[0].includes(item.answer), false)
    assert.equal(item.hintLadder[1].includes(item.answer), false)
    assert.equal(item.hintLadder[2].includes(item.answer), true)
  }
  const understand = generateItem(concept, 2 as BloomLevel, 2)
  const lines = Object.fromEntries(
    understand.prompt
      .split("\n")
      .filter((line) => line.startsWith("A)") || line.startsWith("B)"))
      .map((line) => [line[0], line.slice(3)]),
  )
  // Recognition examples and the authored independent forms have separate bounded case books.
  const match = lines[understand.answer].match(/Add (\d+)\/(\d+) \+ (\d+)\/(\d+)/)
  assert.ok(match)
  const [, a, b, c, d] = match.map(Number)
  assert.ok(lines[understand.answer].includes('The sum is ' + fractionString(a * d + c * b, b * d)))
  assert.notEqual(generateItem(concept, 2, 99).prompt, understand.prompt)
})

test("scoring accepts equivalent rationals and a blank is not a guess", () => {
  assert.equal(scoreAnswer("1/2", "0.5").correct, true)
  assert.equal(scoreAnswer("1/2", "2/4").correct, true)
  assert.equal(scoreAnswer("A", "a").correct, true)
  assert.deepEqual(scoreAnswer("1/2", "  "), { correct: false, confidence: 0 })
  assert.equal(inferError({ raw: "", correct: false, timeMs: 10, medianTimeMs: 10, sameWrongAnswerSeen: false, lateInSession: false }), "retrieval_gap")
})

test("a sheet carries its id, four corner marks, and one box per item inside the page", () => {
  const spec = buildSheet("sheet-41", ["i1", "i2", "i3", "i4"])
  assert.equal(spec.qrPayload, "sheet-41")
  assert.equal(spec.cornerMarks.length, 4)
  assert.equal(spec.boxes.length, 4)
  for (const box of spec.boxes) {
    assert.ok(box.x >= 0 && box.y >= 0)
    assert.ok(box.x + box.w <= spec.page.width)
    assert.ok(box.y + box.h <= spec.page.height)
  }
})

test("the weekly scoreboard reports the six parent metrics", () => {
  const attempts = [
    attempt({ attemptId: "1", sessionId: "a", day: "2026-10-01" }),
    attempt({ attemptId: "2", sessionId: "a", day: "2026-10-01" }),
    attempt({ attemptId: "3", sessionId: "b", day: "2026-10-02", interleaved: true }),
    attempt({ attemptId: "4", sessionId: "c", day: "2026-10-09", correct: true }),
    attempt({ attemptId: "5", sessionId: "d", day: "2026-10-01", correct: false, errorType: "procedural_slip", conceptId: "math.6.ee.b.7" }),
    attempt({ attemptId: "6", sessionId: "e", day: "2026-10-02", correct: false, errorType: "procedural_slip", conceptId: "math.6.ee.b.7" }),
    attempt({ attemptId: "7", sessionId: "f", day: "2026-10-03", correct: false, errorType: "misconception", conceptId: "math.6.ee.b.7" }),
  ]
  const board = weeklyScoreboard({
    attempts,
    states: [
      {
        conceptId: "math.5.nf.a.1",
        bloomLevel: 3,
        mastery: 1,
        stabilityDays: 3,
        nextDue: "2026-10-05",
        errorSignatures: [],
        hintsLast10: 0,
        masteredIn: "paper",
        status: "mastered",
      },
      {
        conceptId: "math.6.ee.b.7",
        bloomLevel: 0,
        mastery: 0,
        stabilityDays: 1,
        nextDue: "2026-10-04",
        errorSignatures: ["misconception"],
        hintsLast10: 0,
        masteredIn: null,
        status: "frontier",
      },
    ],
    weekStart: "2026-09-28",
    today: "2026-10-04",
  })
  assert.ok(board.conceptsMasteredThisWeek.some((row) => row.conceptId === "math.5.nf.a.1" && row.bloomLevel === 3))
  assert.equal(board.retention7.checked, 1)
  assert.equal(board.retention7.held, 1)
  assert.equal(board.retention30.checked, 0)
  assert.equal(board.justRightRatio, null)
  assert.ok(board.timeToMasteryDays.some((row) => row.conceptId === "math.5.nf.a.1"))
  assert.ok(board.errorTrend.some((row) => row.errorType === "procedural_slip"))
  assert.ok(board.stuck.some((row) => row.conceptId === "math.6.ee.b.7"))
  assert.ok(board.frontier.some((row) => row.conceptId === "math.6.ee.b.7"))
})
