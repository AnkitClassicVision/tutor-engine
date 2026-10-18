import assert from "node:assert/strict"
import test from "node:test"
import { readPatterns } from "../src/engine/patterns.ts"

const topic = "Locate regions and read how land and water shape life"

test("a check stores an overt miss and a quieter short-answer pattern", () => {
  const note = readPatterns({
    subject: "Social Studies",
    items: [
      { title: topic, prompt: "A map of Cairo does not label the Nile.", given: "regions", correct: false, errorType: "retrieval_gap" },
      { title: topic, prompt: "Write two or three sentences about Mombasa.", given: "place", correct: false, errorType: "retrieval_gap" },
      { title: "Read a map", prompt: "A map of Muscat does not label the coast.", given: "People live by the harbor because the coast lets them trade.", correct: true, errorType: null },
    ],
    history: [],
  })
  assert.match(note.overt, /2 misses/)
  assert.match(note.subtle, /few words/)
  assert.match(note.trend, /first stored read/)
  assert.match(note.nextMove, /clarifying question/)
})

test("the same quiet pattern on a later check becomes a trend", () => {
  const note = readPatterns({
    subject: "Social Studies",
    items: [
      { title: topic, prompt: "A map of Cairo.", given: "idk", correct: false, errorType: "retrieval_gap" },
      { title: topic, prompt: "A map of Muscat.", given: "no", correct: false, errorType: "retrieval_gap" },
    ],
    history: [{ overt: `They held 1 of 3 in Social Studies. ${topic} took 2 misses.`, subtle: "Most misses are only a few words." }],
  })
  assert.match(note.trend, /Short answers showed up again/)
  assert.match(note.trend, /lasting/)
})
