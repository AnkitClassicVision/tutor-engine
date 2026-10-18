import { test } from "node:test"
import assert from "node:assert/strict"
import { aiConnectionProblem, isAiConnectionError } from "../src/services.ts"

test("a missing or host-only AI connection is reported before work starts", () => {
  const previous = process.env.TUTOR_PUBLIC
  try {
    process.env.TUTOR_PUBLIC = "1"
    assert.match(aiConnectionProblem({ provider: "grok", hasKey: false, model: "" }), /No AI is connected/)
    assert.match(aiConnectionProblem({ provider: "openrouter", hasKey: false, model: "x" }), /No AI is connected/)
    assert.match(aiConnectionProblem({ provider: "openrouter", hasKey: true, model: "" }), /Choose a text model/)
    assert.equal(aiConnectionProblem({ provider: "openai", hasKey: true, model: "" }), "")
    delete process.env.TUTOR_PUBLIC
    assert.equal(aiConnectionProblem({ provider: "grok", hasKey: false, model: "" }), "")
    assert.match(aiConnectionProblem({ provider: "openai", hasKey: false, model: "" }), /No AI is connected/)
  } finally { if (previous === undefined) delete process.env.TUTOR_PUBLIC; else process.env.TUTOR_PUBLIC = previous }
})

test("configuration failures are distinguished from other job errors", () => {
  assert.equal(isAiConnectionError(new Error("Host CLI credentials are disabled.")), true)
  assert.equal(isAiConnectionError(new Error("Add an API key in AI settings.")), true)
  assert.equal(isAiConnectionError(new Error("The AI service rejected the key or the model name.")), true)
  assert.equal(isAiConnectionError(new Error("The model did not return JSON.")), false)
})
