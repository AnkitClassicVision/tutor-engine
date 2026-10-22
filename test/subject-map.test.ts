import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { askResearch } from "../src/research-web.ts"
import { approveMap, decideMap, latestMap, mapRow, mapBrief, researchAsk, runResearchJob, startResearchJob, subjectMaps, startMapRow, saveResearch, type ResearchInput, type SubjectMap } from "../src/subject-map.ts"
import { startCurriculumJob } from "../src/class-planning.ts"
import { openDb } from "../src/db.ts"
import { registerUser } from "../src/auth.ts"
import { createStudent, saveAiSettings, studentConcepts, applyCurriculum } from "../src/services.ts"
import { deleteFamily } from "../src/accounts.ts"
import { scriptedAsk } from "../src/runbook/golden.ts"
import { subjectMapPage, mapsSection } from "../src/subject-map-view.ts"
import { mapContext } from '../src/pack.ts'
import { lessonCard } from '../src/view.ts'
import { selectTeaching } from '../src/engine/teaching.ts'

const golden = JSON.parse(readFileSync(new URL("../eval/golden/research-subject.json", import.meta.url), "utf8"))
const goodMap = golden[0].replies.write, goodReview = golden[0].replies.critic
const urls: string[] = golden[0].input.found.urls

test("each provider's web search returns text and only the https links it found", async (t) => {
  const bodies: any[] = []
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    bodies.push({ url, body: JSON.parse(String(init.body)) })
    if (url.includes("openai.com")) return Response.json({ output: [{ type: "web_search_call" }, { type: "message", content: [{ type: "output_text", text: "{\"a\":1}", annotations: [{ type: "url_citation", url: urls[0], title: "NG" }, { type: "url_citation", url: "http://insecure.example/x", title: "x" }] }] }] })
    if (url.includes("anthropic.com")) return Response.json({ content: [{ type: "server_tool_use" }, { type: "web_search_tool_result", content: [{ type: "web_search_result", url: urls[1], title: "USGS" }] }, { type: "text", text: "{\"b\":2}", citations: [{ type: "web_search_result_location", url: urls[0], title: "NG" }] }] })
    return Response.json({ choices: [{ message: { content: "{\"c\":3}", annotations: [{ type: "url_citation", url_citation: { url: `${urls[1]}#section`, title: "USGS" } }] } }] })
  })
  const openai = await askResearch({ provider: "openai", model: "m", apiKey: "k" }, "sys", "user", 5000)
  assert.equal(openai.text, "{\"a\":1}"); assert.deepEqual(openai.citations.map(c => c.url), [urls[0]])
  assert.deepEqual(bodies[0].body.tools, [{ type: "web_search" }])
  const anthropic = await askResearch({ provider: "anthropic", model: "m", apiKey: "k" }, "sys", "user", 5000)
  assert.equal(anthropic.text, "{\"b\":2}"); assert.deepEqual(anthropic.citations.map(c => c.url).sort(), [...urls].sort())
  assert.equal(bodies[1].body.tools[0].type, "web_search_20250305")
  const openrouter = await askResearch({ provider: "openrouter", model: "m", apiKey: "k" }, "sys", "user", 5000)
  assert.deepEqual(openrouter.citations.map(c => c.url), [urls[1]])
  assert.deepEqual(bodies[2].body.plugins, [{ id: "web", max_results: 6 }])
  await assert.rejects(askResearch({ provider: "xai", model: "m", apiKey: "k" }, "sys", "user", 5000), /no web search/)
})

test("research falls back to the model's own knowledge when search is not available, and says so", async () => {
  const input = { found: { web: true, urls: [] } } as unknown as ResearchInput
  const { ask, calls } = scriptedAsk({ write: { ok: true } })
  const reply = await researchAsk(input, ask)({ system: "s", prompt: "p", schema: "{}", ai: { provider: "xai", model: "", apiKey: "k" }, timeoutMs: 1000, purpose: "write", runbook: "research-subject" })
  assert.equal(reply, "{\"ok\":true}"); assert.equal(input.found.web, false); assert.deepEqual(calls, ["write"])
})

async function family() {
  const db = openDb(":memory:")
  const u = await registerUser(db, "maps@example.com", "synthetic-password"); if (!u.ok) throw new Error()
  const student = await createStudent(db, u.userId, { displayName: "Synthetic learner", grade: 3, sessionCapMinutes: 25 })
  await saveAiSettings(db, u.userId, { provider: "xai", model: "fixture", apiKey: "synthetic-key" })
  const ctx = (job: any) => ({ job, stage: async () => {}, active: async () => true, commit: async (fn: any) => { await fn(); return true } })
  return { db, owner: u.userId, student, ctx }
}

test("a new subject is researched and approved by the parent before anything is taught", async () => {
  const f = await family()
  const uploads = mkdtempSync(join(tmpdir(), "tutor-maps-"))
  try {
    // Math keeps its built-in course; a new subject starts with research instead of questions.
    const jobId = await startCurriculumJob(f.db, f.owner, f.student, "Volcanoes")
    const job = f.db.prepare("SELECT kind, payload FROM jobs WHERE id = ?").get(jobId) as { kind: string; payload: string }
    assert.equal(job.kind, "research_subject")
    assert.equal(await startCurriculumJob(f.db, f.owner, f.student, "Volcanoes"), jobId, "asking again reuses the pending research")
    const payload = JSON.parse(job.payload)
    // Without web search the reply's links cannot be checked, so they are removed and the map says so.
    const { ask } = scriptedAsk({ write: goodMap, critic: goodReview })
    const result = await runResearchJob(f.db, f.ctx({ owner_user_id: f.owner, student_id: f.student }), payload, ask)
    assert.equal(result.location, `/students/${f.student}/maps/${payload.mapId}`)
    const row = (await mapRow(f.db, f.student, payload.mapId))!
    assert.equal(row.status, "draft"); assert.equal(row.research, "knowledge")
    const map = JSON.parse(row.map_json)
    assert.ok(map.sources.every((s: any) => s.url === ""))
    assert.match(String(f.db.prepare("SELECT map_json FROM subject_maps WHERE id = ? /* still sealed */").get(payload.mapId)!.map_json), /^fam:v1:/, "the map is sealed for the family")
    const page = subjectMapPage(f.student, "Synthetic learner", row, jobId)
    assert.match(page, /without a web search/); assert.match(page, /Approve and start teaching/); assert.match(page, /Judging and creating/)
    // Approval turns the map into topics with prerequisites, then writes questions from it.
    await approveMap(f.db, f.owner, f.student, payload.mapId)
    const concepts = (await studentConcepts(f.db, f.owner, f.student)).filter(c => c.subject === "Volcanoes")
    assert.equal(concepts.length, 5)
    const magma = f.db.prepare("SELECT prereqs, map_key FROM custom_concepts WHERE student_id = ? AND title = 'Magma and lava'").get(f.student) as { prereqs: string; map_key: string }
    const base = f.db.prepare("SELECT concept_id FROM custom_concepts WHERE student_id = ? AND title = 'What a volcano is'").get(f.student) as { concept_id: string }
    assert.equal(magma.map_key, "magma-and-lava"); assert.deepEqual(JSON.parse(magma.prereqs), [base.concept_id])
    const curriculum = await startCurriculumJob(f.db, f.owner, f.student, "Volcanoes")
    const built = JSON.parse(String(f.db.prepare("SELECT kind, payload FROM jobs WHERE id = ?").get(curriculum)!.payload))
    assert.equal(f.db.prepare("SELECT kind FROM jobs WHERE id = ?").get(curriculum)!.kind, "curriculum")
    assert.match(built.input.map, /Approved subject map for Volcanoes/); assert.match(built.input.map, /All mountains are volcanoes/)
    await assert.rejects(decideMap(f.db, f.student, payload.mapId, "rejected"), /Only a draft/)
    assert.match(mapsSection(f.student, ["Math", "Volcanoes"], await subjectMaps(f.db, f.student)), /Approved/)
    // Asking for changes researches a new version and replaces the waiting draft.
    const again = await startResearchJob(f.db, f.owner, f.student, "Volcanoes", "Add more about Hawaii.")
    const second = JSON.parse(String(f.db.prepare("SELECT payload FROM jobs WHERE id = ?").get(again)!.payload))
    assert.equal(second.change, "Add more about Hawaii."); assert.equal((await latestMap(f.db, f.student, "Volcanoes"))!.version, 2)
    // Deleting the family deletes its maps.
    await deleteFamily(f.db, f.owner, uploads, async () => {})
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM subject_maps").get()!.n, 0)
  } finally { f.db.close(); rmSync(uploads, { recursive: true, force: true }) }
})

test("research that fails its checks leaves a clear note and nothing to approve", async () => {
  const f = await family()
  try {
    const jobId = await startResearchJob(f.db, f.owner, f.student, "Chess")
    const payload = JSON.parse(String(f.db.prepare("SELECT payload FROM jobs WHERE id = ?").get(jobId)!.payload))
    const { ask } = scriptedAsk({ write: "not json" })
    await runResearchJob(f.db, f.ctx({ owner_user_id: f.owner, student_id: f.student }), payload, ask)
    const row = (await mapRow(f.db, f.student, payload.mapId))!
    assert.equal(row.status, "failed"); assert.match(row.note, /did not pass its checks/)
    await assert.rejects(approveMap(f.db, f.owner, f.student, payload.mapId), /Only a draft/)
    assert.match(subjectMapPage(f.student, "Synthetic learner", row, jobId), /Try the research again/)
  } finally { f.db.close() }
})

test("a cancelled research job is not reused; the subject can be researched again", async () => {
  const f = await family()
  try {
    const first = await startResearchJob(f.db, f.owner, f.student, "Chess")
    assert.equal(await startResearchJob(f.db, f.owner, f.student, "Chess"), first)
    f.db.prepare("UPDATE jobs SET status = 'cancelled' WHERE id = ?").run(first)
    const second = await startResearchJob(f.db, f.owner, f.student, "Chess")
    assert.notEqual(second, first)
    assert.equal((await latestMap(f.db, f.student, "Chess"))!.version, 2)
  } finally { f.db.close() }
})

test("a researched subject is listed under subject maps even before it has a class", () => {
  const html = mapsSection("s", ["Math"], [{ id: "m", student_id: "s", subject: "Chess", version: 1, status: "draft", research: "web", map_json: "", note: "", created_at: "", decided_at: null, job_id: null }])
  assert.match(html, /Chess/); assert.match(html, /Waiting for your approval/); assert.doesNotMatch(html, /<strong>Math/)
})

test('approved teaching follows stable keys through confusable titles and map revisions', async () => {
  const f = await family()
  try {
    const map: SubjectMap = structuredClone(goodMap)
    map.subject = 'Fractions lab'
    const magnitude = map.groups[0].concepts[0], addition = map.groups[0].concepts[1]
    Object.assign(magnitude, { key: 'fraction-magnitude', title: 'Fraction magnitude', dimension: 'conceptual', idea: 'Compare fractions using the same whole.', prereqs: [], crossLinks: [] })
    magnitude.contrast = { example: 'On equal wholes, one half is larger than one third.', nonExample: 'A larger denominator always makes a larger fraction.' }
    magnitude.misconceptions = [{ belief: 'Three parts must be more than two parts.', probe: 'Are the wholes the same size?', fix: 'Compare the sizes of the equal parts of the same whole.' }]
    Object.assign(addition, { key: 'fraction-addition', title: 'Fraction addition', dimension: 'procedural', idea: 'Rename the parts to the same size before adding.', prereqs: [magnitude.key], crossLinks: [] })
    addition.contrast = { example: 'One half plus one quarter is three quarters.', nonExample: 'Add the denominators when adding fractions.' }
    addition.misconceptions = [{ belief: 'Add tops and bottoms.', probe: 'Are halves and quarters the same size?', fix: 'Rename one half as two quarters, then count quarters.' }]
    const install = async (next: SubjectMap) => {
      const id = await startMapRow(f.db, f.student, next.subject)
      await saveResearch(f.db, f.student, id, { map: next, web: false })
      await approveMap(f.db, f.owner, f.student, id)
      return id
    }
    await install(map)
    const nodes = await studentConcepts(f.db, f.owner, f.student)
    const mag = nodes.find(c => c.teaching?.key === magnitude.key)!, add = nodes.find(c => c.teaching?.key === addition.key)!
    assert.ok(mag && add)
    assert.deepEqual(add.prereqs, [mag.conceptId])
    const saved = await applyCurriculum(f.db, f.owner, f.student, map.subject, [{ mapKey: addition.key, title: magnitude.title, recall: 'A generated reinterpretation must not replace approval.', example: 'Generated example', nonExample: 'Generated nonexample', questions: [{ prompt: 'A fresh synthetic question for the selected key.', answer: '4', bloomLevel: 3 }] }])
    assert.deepEqual(saved.conceptIds, [add.conceptId], 'the key binds the writer even when titles are confusable')
    assert.equal((await studentConcepts(f.db, f.owner, f.student)).find(c => c.conceptId === add.conceptId)!.recall, addition.idea)
    await assert.rejects(applyCurriculum(f.db, f.owner, f.student, map.subject, [{ mapKey: 'missing-key', title: addition.title, recall: '', example: '', nonExample: '', questions: [] }]), /missing or ambiguous/)
    await assert.rejects(applyCurriculum(f.db, f.owner, f.student, map.subject, [
      { mapKey: addition.key, title: addition.title, recall: '', example: '', nonExample: '', questions: [{ prompt: 'Synthetic partial publication must roll back.', answer: '4' }] },
      { mapKey: 'missing-key', title: magnitude.title, recall: '', example: '', nonExample: '', questions: [] },
    ]), /missing or ambiguous/)
    assert.equal(f.db.prepare("SELECT count(*) n FROM practice_items WHERE prompt = 'Synthetic partial publication must roll back.'").get()!.n, 0)
    const vague = await mapContext(f.db, f.student, map.subject, 'fractions')
    assert.equal(vague.subjectMap, undefined, 'word overlap cannot choose either route')
    assert.equal((await mapContext(f.db, f.student, map.subject, addition.title)).subjectMap?.key, addition.key)
    assert.equal((await mapContext(f.db, f.student, map.subject, addition.title, { conceptId: mag.conceptId })).subjectMap?.key, magnitude.key, 'explicit identity wins over confusable wording')
    for (const reference of [{ mapKey: 'unknown' }, { conceptId: 'math.5.nf.a.1' }, { conceptId: mag.conceptId, mapKey: addition.key }]) {
      assert.equal((await mapContext(f.db, f.student, map.subject, addition.title, reference)).subjectMap, undefined)
    }
    assert.equal(selectTeaching([magnitude, { ...addition, title: magnitude.title }], magnitude.title), null, 'ambiguous exact titles remain unbound')
    assert.equal(selectTeaching([addition, addition], addition.title, addition.key), null, 'duplicate keys remain unbound')
    assert.equal(selectTeaching([{ ...addition, idea: 'x'.repeat(301) }], addition.title), null, 'oversized stored context is rejected')
    const magnitudeHtml = lessonCard('synthetic', mag), additionHtml = lessonCard('synthetic', add)
    assert.match(magnitudeHtml, /data-teaching-route="conceptual"/)
    assert.match(magnitudeHtml, /Compare the ideas/)
    assert.match(magnitudeHtml, /Compare the sizes of the equal parts/)
    assert.doesNotMatch(magnitudeHtml, /Rename one half as two quarters/)
    assert.match(additionHtml, /data-teaching-route="procedural"/)
    assert.match(additionHtml, /Follow the reasons/)
    assert.match(additionHtml, /Rename one half as two quarters/)
    const brief = mapBrief(map)
    for (const field of [addition.key, 'procedural', addition.contrast.nonExample, addition.misconceptions[0].fix]) assert.ok(brief.includes(field))
    addition.title = 'Rename and add fractional parts'
    const revision = await install(map)
    const revised = (await studentConcepts(f.db, f.owner, f.student)).find(c => c.teaching?.key === addition.key)!
    assert.equal(revised.conceptId, add.conceptId, 'a renamed approved concept retains its history')
    assert.equal(revised.title, addition.title)
    assert.ok(revised.mapVersion?.startsWith(revision))
    assert.equal((await mapContext(f.db, f.student, map.subject, 'Fraction addition', { mapKey: addition.key })).conceptId, add.conceptId)
    const builtIn = (await studentConcepts(f.db, f.owner, f.student)).find(c => c.conceptId === 'math.5.nf.a.1')!
    assert.equal(builtIn.teaching, undefined, 'a custom map does not attach itself to a built-in by overlapping words')
  } finally { f.db.close() }
})
