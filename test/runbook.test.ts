import assert from "node:assert/strict"
import test from "node:test"
import { CONTRACTS } from "../src/runbook/registry.ts"
import { fingerprint, goldenCases, scriptedAsk } from "../src/runbook/golden.ts"
import { runContract } from "../src/runbook/run.ts"
import { schemaErrors } from "../src/runbook/schema.ts"
import { bloomCue, childSafe, noLeak, readingGrade } from "../src/runbook/gates.ts"
import versions from "../src/runbook/versions.json" with { type: "json" }

const ai = { provider: "openai" as const, model: "golden-stub", apiKey: "synthetic" }

for (const contract of CONTRACTS) {
  const cases = goldenCases(contract.id)
  test(`${contract.id} has golden cases covering acceptance and refusal`, () => {
    assert.ok(cases.length >= 3, `${contract.id} needs at least three golden cases`)
    assert.ok(cases.some(c => c.expect.outcome !== "rejected"), "at least one case must pass")
    assert.ok(cases.some(c => c.expect.outcome === "rejected"), "at least one case must be refused")
  })
  for (const golden of cases) {
    test(`${contract.id}: ${golden.name}`, async () => {
      const { ask } = scriptedAsk(golden.replies)
      const { output, report } = await runContract(contract, golden.input as never, ai, { ask })
      const rules = report.issues.map(found => found.rule)
      assert.equal(report.outcome, golden.expect.outcome, `outcome; issues: ${JSON.stringify(report.issues)}`)
      assert.equal(output === null, golden.expect.outcome === "rejected")
      for (const rule of golden.expect.rules ?? []) assert.ok(rules.includes(rule), `expected rule ${rule} in ${rules.join(", ")}`)
      for (const rule of golden.expect.absent ?? []) assert.ok(!rules.some((found, index) => found === rule && report.issues[index].block), `rule ${rule} must not block`)
      assert.equal(report.runbook, contract.id); assert.equal(report.version, contract.version)
    })
  }
  test(`${contract.id} instructions are locked to version ${contract.version}`, () => {
    const lock = (versions as Record<string, { version: number; fingerprint: string }>)[contract.id]
    const now = fingerprint(contract, cases[0]?.input ?? {})
    assert.ok(lock, `add ${contract.id} to src/runbook/versions.json: {"version": ${contract.version}, "fingerprint": "${now}"}`)
    assert.equal(lock.version, contract.version, "versions.json and the contract disagree on the version")
    assert.equal(lock.fingerprint, now, `instructions changed: bump ${contract.id} to version ${contract.version + 1} and set its fingerprint to ${now}`)
  })
}

test("schema checker holds replies to their declared shape", () => {
  const schema = { type: "object" as const, additionalProperties: false, required: ["a"], properties: { a: { type: "array" as const, minItems: 1, items: { type: "integer" as const, minimum: 1 } } } }
  assert.deepEqual(schemaErrors({ a: [1, 2] }, schema), [])
  assert.ok(schemaErrors({ a: [] }, schema).length)
  assert.ok(schemaErrors({ a: [0.5] }, schema).length)
  assert.ok(schemaErrors({ a: [1], b: 1 }, schema).some(error => error.includes("not allowed")))
})

test("shared rules catch leaks, unsafe asks, hard reading and missing Bloom cues", () => {
  assert.equal(noLeak("The capital of France is Paris. What is the capital of France?", "Paris, France")[0], undefined)
  assert.equal(noLeak("Photosynthesis makes food from light. What process makes food from light?", "photosynthesis")[0].rule, "answer_leak")
  assert.equal(noLeak("What is 2 + 2?", "4").length, 0)
  assert.equal(childSafe(["Tell me your home address so I can mail a prize."])[0].rule, "child_safety")
  assert.equal(childSafe(["Which fraction is larger, 2/3 or 3/5?"]).length, 0)
  assert.ok(readingGrade("The cat sat on the mat. It was a sunny day and the cat was happy.") < 4)
  assert.ok(readingGrade("Photosynthetic organisms synthesize carbohydrates utilizing electromagnetic radiation absorbed by chlorophyll pigments.") > 12)
  assert.equal(bloomCue("Design your own word problem that uses 3/4.", 6).length, 0)
  assert.equal(bloomCue("What is 3/4 of 12?", 6)[0].block, false)
})

test("every runbook file carries the standard header", async () => {
  const { readdirSync } = await import("node:fs")
  const { skillMeta } = await import("../src/skill-text.ts")
  const names = readdirSync(new URL("../skills", import.meta.url), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
  assert.ok(names.length >= 19)
  for (const name of names) {
    const meta = skillMeta(name)
    assert.equal(meta.name, name, `${name}: name`)
    assert.ok((meta.description ?? "").length > 20, `${name}: description`)
    assert.ok(Number(meta.version) >= 1, `${name}: version`)
    assert.ok(["planner", "coach", "verifier"].includes(meta.role), `${name}: role`)
  }
  for (const contract of CONTRACTS) for (const skill of contract.skills) assert.ok(names.includes(skill), `${contract.id} loads missing runbook ${skill}`)
})

test("a run stops cleanly when its time budget is spent", async () => {
  const [contract] = CONTRACTS
  const { ask, calls } = scriptedAsk({ write: {} })
  const { output, report } = await runContract(contract, goldenCases(contract.id)[0].input as never, ai, { ask, budgetMs: 5000 })
  assert.equal(output, null); assert.equal(report.outcome, "rejected")
  assert.deepEqual(calls, []); assert.ok(report.issues.some(found => found.rule === "time"))
})
