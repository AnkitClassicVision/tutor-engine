import assert from "node:assert/strict"
import test from "node:test"
import { writeFileSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { classifyError, classifyResponse, currentHealth, USED_UP_RETRY_MS, AiProviderError } from "../src/ai-health.ts"
import { ChatGptError } from "../src/chatgpt.ts"
import { askModel } from "../src/ai.ts"
import { openDb } from "../src/db.ts"
import { registerUser } from "../src/auth.ts"
import { aiConfigFor, aiConnectionProblem, aiSettings, createStudent, saveAiSettings } from "../src/services.ts"
import { cameraPage, parentTools, studentHome } from "../src/journey-view.ts"

test("WF-01: lasting provider failures are classified; temporary ones are not", () => {
  assert.equal(classifyResponse(401, ""), "revoked"); assert.equal(classifyResponse(403, ""), "revoked")
  assert.equal(classifyResponse(402, ""), "used_up")
  assert.equal(classifyResponse(429, '{"error":{"code":"insufficient_quota"}}'), "used_up")
  assert.equal(classifyResponse(429, "Rate limit reached for requests"), null, "a plain rate limit is temporary")
  assert.equal(classifyResponse(503, "overloaded"), null); assert.equal(classifyResponse(500, ""), null)
  assert.equal(classifyResponse(404, ""), "model"); assert.equal(classifyResponse(400, "The model `x` does not exist"), "model")
  // Review round 3: a passing outage, a flagged message or a ChatGPT token refresh never becomes a lasting state.
  assert.equal(classifyResponse(503, "The model is not available right now"), null)
  assert.equal(classifyResponse(500, "model not found in cache"), null)
  assert.equal(classifyResponse(403, '{"error":{"message":"Input was flagged by moderation"}}'), null)
  assert.equal(classifyError(new ChatGptError("reconnect")), null, "a 401 first refreshes the token; a failed refresh is shown by the credential")
  assert.equal(classifyError(new ChatGptError("limit")), null, "a plain ChatGPT 429 is a rate limit")
  assert.equal(classifyError(Object.assign(new ChatGptError("limit"), { usageLimit: true })), "used_up")
  assert.equal(classifyError(new ChatGptError("not_eligible")), "not_eligible"); assert.equal(classifyError(new ChatGptError("temporary")), null)
  assert.equal(classifyError(new Error("timeout")), null)
  const now = Date.now()
  assert.equal(currentHealth("used_up", new Date(now - 1000).toISOString(), now), "used_up")
  assert.equal(currentHealth("used_up", new Date(now - USED_UP_RETRY_MS - 1000).toISOString(), now), null, "a used-up plan is tried again after an hour")
  assert.equal(currentHealth("revoked", new Date(now - 10 * USED_UP_RETRY_MS).toISOString(), now), "revoked")
  assert.equal(currentHealth("unknown", "", now), null)
})

test("WF-01: a failed call sets the family's state, a working call clears it, and no error text is stored", async () => {
  const db = openDb(":memory:"), realFetch = globalThis.fetch
  try {
    const u = await registerUser(db, "ai-health@example.com", "synthetic-password"); if (!u.ok) throw new Error()
    await saveAiSettings(db, u.userId, { provider: "openai", model: "gpt-synthetic", apiKey: "sk-synthetic", photoModel: "" })
    const prompt = join(mkdtempSync(join(process.env.TMPDIR || tmpdir(), "ai-health-")), "p.txt"); writeFileSync(prompt, "Say hi.")
    const ask = async () => askModel(prompt, "{}", "Reply.", 5000, await aiConfigFor(db, u.userId))
    globalThis.fetch = async () => new Response('{"error":{"message":"Incorrect API key provided: sk-synthetic"}}', { status: 401 })
    await assert.rejects(ask(), AiProviderError)
    const row = db.prepare("SELECT ai_health, ai_health_at FROM users WHERE id = ?").get(u.userId)!
    assert.equal(row.ai_health, "revoked"); assert.ok(row.ai_health_at)
    assert.doesNotMatch(JSON.stringify(db.prepare("SELECT * FROM users WHERE id = ?").get(u.userId)), /Incorrect API key/, "no provider text is stored")
    assert.match(aiConnectionProblem(await aiSettings(db, u.userId)), /no longer accepted/)
    // A temporary failure leaves the state alone; a working call clears it.
    globalThis.fetch = async () => new Response("Rate limit reached", { status: 429 })
    await assert.rejects(ask()); assert.equal(db.prepare("SELECT ai_health FROM users WHERE id = ?").get(u.userId)!.ai_health, "revoked")
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 })
    await ask()
    assert.equal(db.prepare("SELECT ai_health FROM users WHERE id = ?").get(u.userId)!.ai_health, null)
    // Saving settings clears a state too.
    db.prepare("UPDATE users SET ai_health = 'model', ai_health_at = ? WHERE id = ?").run(new Date().toISOString(), u.userId)
    await saveAiSettings(db, u.userId, { provider: "openai", model: "gpt-other", apiKey: "", photoModel: "" })
    assert.equal((await aiSettings(db, u.userId)).health, null)
  } finally { globalThis.fetch = realFetch; db.close() }
})

test("WF-01: each state reaches the child home, the parent banner and controls, and photo reading tells the truth", async () => {
  const db = openDb(":memory:")
  try {
    const u = await registerUser(db, "ai-states@example.com", "synthetic-password"); if (!u.ok) throw new Error()
    await saveAiSettings(db, u.userId, { provider: "openai", model: "gpt-synthetic", apiKey: "sk-synthetic", photoModel: "" })
    const older = await createStudent(db, u.userId, { displayName: "Synthetic older", grade: 4, sessionCapMinutes: 10 })
    const young = await createStudent(db, u.userId, { displayName: "Synthetic young", birthDate: new Date(Date.now() - 6.5 * 365.25 * 86400000).toISOString().slice(0, 10), sessionCapMinutes: 10 })
    const set = (state: string | null) => db.prepare("UPDATE users SET ai_health = ?, ai_health_at = ? WHERE id = ?").run(state, new Date().toISOString(), u.userId)
    assert.doesNotMatch(await studentHome(db, u.userId, older, false, false), /data-ai-missing/, "a working connection shows nothing")
    for (const [state, child, parent] of [["revoked", /can.{1,6}t connect right now/, /no longer accepted/], ["used_up", /resting for now/, /used up its allowance/], ["not_eligible", /can.{1,6}t connect right now/, /ChatGPT account can.{1,6}t be used/], ["model", /can.{1,6}t connect right now/, /isn.{1,6}t available any more/]] as const) {
      set(state)
      const home = await studentHome(db, u.userId, older, false, false)
      assert.match(home, new RegExp(`data-ai-state="${state}"`)); assert.match(home, child); assert.match(home, /You can still practise/)
      const youngHome = await studentHome(db, u.userId, young, false, false)
      assert.match(youngHome, child); assert.doesNotMatch(youngHome, /You can still practise/, "ages 5–7 get one short line"); assert.match(youngHome, /Hear this/)
      const overview = await parentTools(db, u.userId, older, "", "Math", { view: "overview" as any })
      assert.match(overview, parent); assert.match(overview, /Open AI settings/)
      assert.match(await parentTools(db, u.userId, older, "", "Math", { view: "controls" as any }), parent)
    }
    set(null)
    // No photo model: the photo page and controls say so; a ChatGPT plan reads photos itself.
    assert.match(await cameraPage(db, u.userId, older), /To read it, type the page/)
    assert.match(await parentTools(db, u.userId, older, "", "Math", { view: "controls" as any }), /Photo reading is off/)
    await saveAiSettings(db, u.userId, { provider: "openai", model: "gpt-synthetic", apiKey: "", photoModel: "gpt-vision-synthetic" })
    assert.doesNotMatch(await cameraPage(db, u.userId, older), /To read it, type the page/)
  } finally { db.close() }
})

test("WF-01: the mission page shows the state's child line where talk-through would be", async () => {
  const { sessionPage } = await import("../src/view.ts")
  const { feedbackState } = await import("../src/session-feedback.ts")
  const miss = { id: "i1", answered: 1, correct: 0, prompt: "3 + 4", answer: "7", given_answer: "8", concept_id: "math.primary.1.add", bloom_level: 3, grading_reason: "", hints_used: 0, beat: "frontier" }
  const next = { id: "i2", answered: 0, prompt: "2 + 5", concept_id: "math.primary.1.add", beat: "frontier", hints_used: 0 }
  const page = (aiChildLine?: string) => sessionPage({ sessionId: "00000000-0000-0000-0000-000000000000", continuity: "", item: next, position: 2, total: 6, feedback: null, onBreak: false, ended: false, capMinutes: 10, band: "8-10", aiMissing: true, aiChildLine, feedbackReview: feedbackState("session", [miss, next] as any, 0) })
  assert.match(page("My AI helper is resting for now."), /data-ai-talk-off>My AI helper is resting for now\./)
  assert.match(page(), /data-ai-talk-off>Talking it through needs an AI connection/)
})
