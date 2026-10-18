import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDb } from "../src/db.ts"
import { registerUser } from "../src/auth.ts"
import { createStudent, nextLearningAction, retireUnusedQuestions, startTutorSession, sessionItems, submitAnswer } from "../src/services.ts"
import { runNextJob } from "../src/jobs.ts"
import { briefFromWords, checkAndRepair, makePlannedPack, packRow, publishPack, qaRules, requestPack, runPack, setPackSettings, topicFrom, PackLimit, PackScope, type PackAsk, type PackBrief } from "../src/pack.ts"
import { checkItem, evaluate, type PackDraft, type PackItem } from "../src/pack-qa.ts"
import { runbook } from "../src/pack-runbooks.ts"
import { scoreItem } from "../src/engine/score.ts"
import { undoDecision } from "../src/undo.ts"

async function family(grade = 5) {
  const dir = mkdtempSync(join(tmpdir(), "tutor-pack-"))
  process.env.TUTOR_SECRET_DIR = dir
  const db = openDb(join(dir, "pack.sqlite"))
  const user = await registerUser(db, `pack-${crypto.randomUUID()}@example.invalid`, "synthetic-pack-password")
  if (!user.ok) throw new Error("registration failed")
  const student: any = await createStudent(db, user.userId, { displayName: "Synthetic learner", grade, sessionCapMinutes: 25 })
  return { db, owner: user.userId, student: String(student?.id ?? student) }
}

const fraction = (a: number, b: number, c: number, d: number, bloom: number): PackItem => {
  const n = a * d + c * b, den = b * d, g = gcd(n, den)
  return {
    prompt: `Add ${a}/${b} + ${c}/${d}. Give the answer in lowest terms.`, answer: `${n / g}/${den / g}`, format: "number", choices: null, work: `${a}/${b} + ${c}/${d}`,
    hints: ["Find a denominator both fractions can share.", "Rewrite each fraction with that denominator.", "Add the numerators and keep the shared denominator."],
    explanation: `Rewrite both fractions over ${den}, add the tops, then simplify.`, bloom,
  }
}
function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : a }
const choice: PackItem = {
  prompt: "Which is the first step to add 3/5 + 1/2?", answer: "Find a common denominator", format: "choice",
  choices: ["Add the tops and the bottoms", "Find a common denominator", "Multiply both fractions by 2"],
  work: null, hints: ["Think about what has to match before adding.", "Look at the bottom numbers.", "Fifths and halves are different sizes."], explanation: "Fractions can only be added when the parts are the same size, so the denominators must match first.", bloom: 2,
}
const goodDraft = (): PackDraft => ({
  interpretation: "Adding fractions with unlike denominators, ready for Friday's quiz.",
  lesson: { hook: "Recipes add fractions all the time.", steps: ["Find a common denominator.", "Rewrite each fraction.", "Add the numerators."], workedExample: "1/3 + 1/4: twelfths, 4/12 + 3/12 = 7/12.", quickCheck: { question: "1/2 + 1/4?", answer: "3/4" } },
  skills: [{ title: "Add fractions with unlike denominators", recall: "Make the denominators match before adding.", example: "1/2 + 1/3 = 5/6", nonExample: "1/2 + 1/3 = 2/5", items: [fraction(1, 2, 1, 4, 1), fraction(1, 3, 1, 6, 2), choice, fraction(2, 3, 1, 4, 3), fraction(3, 4, 1, 6, 3), fraction(2, 5, 1, 3, 3)] }],
})

/** A stub model: writes the given draft, answers checks correctly from the keys it was given, and records every call. */
function stubAsk(draft: PackDraft, overrides: { checkAnswers?: Record<string, string>; repair?: (ids: string[]) => Record<string, PackItem> } = {}) {
  const calls: Array<{ kind: string; prompt: string }> = []
  const keyed = new Map<string, string>()
  draft.skills.forEach((skill, s) => skill.items.forEach((item, i) => keyed.set(`s${s}i${i}`, item.answer)))
  const ask: PackAsk = async (kind, prompt) => {
    calls.push({ kind, prompt })
    if (kind === "write") return JSON.stringify({ structuredOutput: draft })
    if (kind === "check") {
      const items = JSON.parse(prompt).items as Array<{ id: string; prompt: string }>
      for (const item of items) assert.ok(!JSON.stringify(item).includes('"answer"'), "the checker never sees the key")
      return JSON.stringify({ structuredOutput: { items: items.map((item) => ({ id: item.id, answer: overrides.checkAnswers?.[item.id] ?? keyed.get(item.id) ?? "", onTopic: 5, ageFit: 5, issue: "" })) } })
    }
    const ids = (JSON.parse(prompt).items as Array<{ id: string }>).map((item) => item.id)
    const fixed = overrides.repair?.(ids) ?? {}
    return JSON.stringify({ structuredOutput: { items: Object.entries(fixed).map(([id, item]) => ({ id, item })) } })
  }
  return { ask, calls }
}

const handlers = (db: any, ask: PackAsk) => ({ pack: (ctx: any, payload: any) => runPack({ db }, ctx, payload, ask) })
const rid = () => crypto.randomUUID()

test("everyday words become a brief: subject, topic, count, test date and runbook", () => {
  const context = { name: "Synthetic", grade: 5, reading: "explorer" as const, classes: ["Math", "Science"], today: "2026-10-16" }
  const read = briefFromWords("Can you make 10 questions on adding fractions with unlike denominators for my quiz on Friday", context)
  assert.ok("brief" in read)
  const brief = read.brief
  assert.equal(brief.subject, "Math"); assert.equal(brief.runbook, "pack-math-procedure")
  assert.equal(brief.topic, "adding fractions with unlike denominators"); assert.equal(brief.testDate, "2026-10-23")
  assert.equal(brief.skills, 1); assert.equal(brief.perSkill, 10)
  assert.equal(topicFrom("I want to practise the water cycle please"), "the water cycle")
  const words = briefFromWords("vocabulary words for chapter 3", { ...context, classes: ["Math", "English"] })
  assert.ok("brief" in words && words.brief.subject === "English" && words.brief.runbook === "pack-vocabulary")
  const story = briefFromWords("15 fraction word problems", context)
  assert.ok("brief" in story && story.brief.runbook === "pack-math-word-problems" && story.brief.skills === 3)
  const vague = briefFromWords("help me get better", context)
  assert.ok("clarify" in vague && vague.chips.includes("Science"))
})

test("the code gate rejects every broken question, whatever model wrote it", () => {
  const rules = qaRules(runbook("pack-math-procedure"), { grade: 5 } as PackBrief)
  const ok = fraction(1, 2, 1, 4, 3)
  assert.deepEqual(checkItem(ok, rules), [])
  const defects: Array<[string, PackItem, string]> = [
    ["wrong key", { ...ok, answer: "2/6" }, "key"],
    ["missing work", { ...ok, work: null }, "work"],
    ["unparseable work", { ...ok, work: "half plus a quarter" }, "work"],
    ["hint gives it away", { ...ok, hints: ["a", "b", "The answer is 3/4."] }, "hint_reveals"],
    ["two hints", { ...ok, hints: ["a", "b"] }, "hints"],
    ["no explanation", { ...ok, explanation: "" }, "explanation"],
    ["format not in runbook", { ...ok, format: "word" }, "format"],
    ["too demanding", { ...ok, bloom: 6 }, "bloom"],
    ["key not among options", { ...choice, answer: "Guess" }, "key"],
    ["duplicate options", { ...choice, choices: ["A", "a", "Find a common denominator"] }, "choices"],
    ["all of the above", { ...choice, choices: ["Find a common denominator", "Add", "All of the above"] }, "choices"],
    ["unsafe text", { ...ok, prompt: "How do I hurt myself with fractions?" }, "safety"],
  ]
  for (const [name, item, rule] of defects) assert.ok(checkItem(item, rules).some((issue) => issue.block && issue.rule === rule), name)
  const vocab = qaRules(runbook("pack-vocabulary"), { grade: 4 } as PackBrief)
  const word: PackItem = { prompt: "Which word means very tired?", answer: "exhausted", format: "word", choices: null, work: null, hints: ["It is an adjective.", "Think of a long day.", "It starts with ex-."], explanation: "Exhausted means extremely tired.", bloom: 1 }
  assert.deepEqual(checkItem(word, vocab), [])
  assert.ok(checkItem({ ...word, prompt: "Use exhausted in a sentence: the word that means very tired is ___" }, vocab).some((i) => i.rule === "prompt_reveals"))
  assert.ok(checkItem({ ...word, format: "written", answer: "A sentence" }, vocab).some((i) => i.rule === "key"))
  assert.equal(evaluate("process.exit()"), null)
  assert.deepEqual(evaluate("3/4 - 1/3"), { n: 5, d: 12 })
})

test("format-aware marking accepts letters, option text, mixed numbers and units", () => {
  const item = { answer: "Find a common denominator", format: "choice", choices: choice.choices }
  assert.ok(scoreItem(item, "B").correct); assert.ok(scoreItem(item, "find a common denominator").correct); assert.ok(!scoreItem(item, "A").correct)
  assert.ok(scoreItem({ answer: "1 1/2", format: "number" }, "3/2").correct)
  assert.ok(scoreItem({ answer: "12 cm", format: "number" }, "12").correct)
  assert.ok(scoreItem({ answer: "exhausted", format: "word" }, "Exhausted.").correct)
})

test("a request becomes a checked, published pack whose questions lead the next mission", async () => {
  const f = await family()
  try {
    const made = await requestPack(f.db, f.owner, f.student, { text: "fractions with unlike denominators", by: "parent", requestId: rid() })
    assert.equal(made.kind, "pack")
    const packId = made.kind === "pack" ? made.pack.id : ""
    const { ask, calls } = stubAsk(goodDraft())
    assert.equal(await runNextJob(f.db, handlers(f.db, ask)), true)
    const pack = (await packRow(f.db, packId))!
    assert.equal(pack.status, "published", pack.note)
    assert.deepEqual(calls.map((c) => c.kind), ["write", "check"], "a clean pack needs no repair call")
    const qa = JSON.parse(pack.qa_json!)
    assert.equal(qa.published, 6); assert.equal(qa.modelChecked, true); assert.equal(qa.recomputed, 5)
    const items = (await f.db.prepare("SELECT format, choices_json, hints_json, explanation FROM practice_items WHERE pack_id = ?").all(packId)) as any[]
    assert.equal(items.length, 6); assert.ok(items.some((i) => i.format === "choice" && JSON.parse(i.choices_json).length === 3))
    const next = (await nextLearningAction(f.db, f.owner, f.student))!
    assert.equal(next.packId, packId); assert.equal(next.lessonFirst, true)
    const session = await startTutorSession(f.db, f.owner, f.student, new Date(), { subject: "Math", focusConceptId: next.conceptId })
    const served = await sessionItems(f.db, session)
    const fromPack = served.filter((i) => i.concept_id === next.conceptId)
    assert.ok(fromPack.length >= 4)
    assert.ok(fromPack.every((i) => goodDraft().skills[0].items.some((p) => p.prompt === i.prompt)), "every slot on the requested topic is a pack question")
    assert.ok(fromPack.every((i) => !String(i.hints_json).includes(String(i.answer))), "pack hints never show the key")
    // A class rebuild leaves pack questions alone.
    await retireUnusedQuestions(f.db, f.student, "Math")
    assert.ok(Number(((await f.db.prepare("SELECT count(*) n FROM practice_items WHERE pack_id = ?").get(packId)) as any).n) >= 1)
  } finally { f.db.close() }
})

test("an answer the independent check disputes is repaired once, and only that question is sent", async () => {
  const f = await family()
  try {
    const made = await requestPack(f.db, f.owner, f.student, { text: "fractions with unlike denominators", by: "parent", requestId: rid() })
    const packId = made.kind === "pack" ? made.pack.id : ""
    let repairIds: string[] = []
    const { ask, calls } = stubAsk(goodDraft(), { checkAnswers: { s0i3: "3/7" }, repair: (ids) => { repairIds = ids; return { s0i3: fraction(1, 5, 1, 2, 3) } } })
    await runNextJob(f.db, handlers(f.db, ask))
    const pack = (await packRow(f.db, packId))!
    assert.equal(pack.status, "published")
    assert.deepEqual(repairIds, ["s0i3"]); assert.deepEqual(calls.map((c) => c.kind), ["write", "check", "repair"])
    const qa = JSON.parse(pack.qa_json!); assert.equal(qa.repaired, 1); assert.equal(qa.checkerDisagreed, 1)
    const prompts = ((await f.db.prepare("SELECT prompt FROM practice_items WHERE pack_id = ?").all(packId)) as any[]).map((r) => r.prompt)
    assert.ok(prompts.includes("Add 1/5 + 1/2. Give the answer in lowest terms.")); assert.ok(!prompts.includes("Add 2/3 + 1/4. Give the answer in lowest terms."))
  } finally { f.db.close() }
})

test("a skill with too few good questions is left out, and a pack with none fails honestly", async () => {
  const draft = goodDraft()
  draft.skills.push({ title: "Subtract fractions", recall: "Match denominators, then subtract.", example: "1/2 - 1/4 = 1/4", nonExample: "1/2 - 1/4 = 0/2", items: [0, 1, 2, 3, 4, 5].map((n) => ({ ...fraction(1, 2, 1, 3 + n, 3), prompt: `Subtract 1/2 - 1/${3 + n}.`, answer: "9/9" })) })
  const checked = await checkAndRepair(draft, { request: "fractions", gradeLabel: "Grade 5", subject: "Math", grade: 5 } as PackBrief, runbook("pack-math-procedure"), qaRules(runbook("pack-math-procedure"), { grade: 5 } as PackBrief), { provider: "grok", model: "", apiKey: "" }, stubAsk(draft).ask)
  assert.equal(checked.final.skills.length, 1); assert.equal(checked.qa.dropped, 6)
  const f = await family()
  try {
    const bad = goodDraft(); bad.skills[0].items = bad.skills[0].items.map((item) => ({ ...item, answer: item.format === "number" ? "99/100" : item.answer, format: item.format }))
    bad.skills[0].items = bad.skills[0].items.filter((i) => i.format === "number")
    const made = await requestPack(f.db, f.owner, f.student, { text: "fractions with unlike denominators", by: "parent", requestId: rid() })
    await runNextJob(f.db, handlers(f.db, stubAsk(bad).ask))
    const pack = (await packRow(f.db, made.kind === "pack" ? made.pack.id : ""))!
    assert.equal(pack.status, "failed"); assert.match(pack.note, /No questions passed/)
  } finally { f.db.close() }
})

test("a job that stopped after writing resumes without writing again", async () => {
  const f = await family()
  try {
    const made = await requestPack(f.db, f.owner, f.student, { text: "fractions with unlike denominators", by: "parent", requestId: rid() })
    const packId = made.kind === "pack" ? made.pack.id : ""
    await f.db.prepare("UPDATE packs SET draft_json = ?, status = 'checking' WHERE id = ?").run(JSON.stringify(goodDraft()), packId)
    const { ask, calls } = stubAsk(goodDraft())
    await runNextJob(f.db, handlers(f.db, ask))
    assert.deepEqual(calls.map((c) => c.kind), ["check"])
    assert.equal((await packRow(f.db, packId))!.status, "published")
  } finally { f.db.close() }
})

test("show me first holds the pack for the parent, and undo keeps answered work", async () => {
  const f = await family()
  try {
    const made = await requestPack(f.db, f.owner, f.student, { text: "fractions with unlike denominators for the quiz on 2099-01-08", by: "parent", mode: "review", requestId: rid() })
    const packId = made.kind === "pack" ? made.pack.id : ""
    await runNextJob(f.db, handlers(f.db, stubAsk(goodDraft()).ask))
    assert.equal((await packRow(f.db, packId))!.status, "review")
    assert.equal(Number(((await f.db.prepare("SELECT count(*) n FROM practice_items WHERE pack_id = ?").get(packId)) as any).n), 0, "nothing reaches the child before Publish")
    const pack = await publishPack(f.db, f.owner, packId)
    assert.ok(pack.target_id, "a named test date becomes a target")
    const conceptId = JSON.parse(pack.concept_ids)[0]
    const session = await startTutorSession(f.db, f.owner, f.student, new Date(), { subject: "Math", focusConceptId: conceptId })
    const first = (await sessionItems(f.db, session))[0]
    await submitAnswer(f.db, f.owner, session, { itemId: String(first.id), answer: String(first.answer) })
    const message = await undoDecision(f.db, f.owner, f.student, pack.decision_id!)
    assert.match(message, /removed/)
    assert.equal((await packRow(f.db, packId))!.status, "undone")
    assert.equal(Number(((await f.db.prepare("SELECT count(*) n FROM practice_items WHERE pack_id = ? AND used_at IS NULL").get(packId)) as any).n), 0)
    assert.ok(await f.db.prepare("SELECT id FROM attempts WHERE student_id = ?").get(f.student), "answers stay")
    assert.equal(await f.db.prepare("SELECT id FROM targets WHERE id = ?").get(pack.target_id), undefined)
  } finally { f.db.close() }
})

test("children's requests respect the parent's controls, limits, safety and repeated sends", async () => {
  const f = await family()
  try {
    const unsafe = await requestPack(f.db, f.owner, f.student, { text: "how to hurt myself", by: "child", requestId: rid() })
    assert.equal(unsafe.kind, "safety")
    assert.equal(Number(((await f.db.prepare("SELECT count(*) n FROM packs").get()) as any).n), 0)
    const outside = await requestPack(f.db, f.owner, f.student, { text: "the water cycle", by: "child", requestId: rid() })
    assert.equal(outside.kind, "clarify", "a subject outside the child's classes asks first")
    const id = rid()
    const first = await requestPack(f.db, f.owner, f.student, { text: "times tables for 7", by: "child", requestId: id })
    const again = await requestPack(f.db, f.owner, f.student, { text: "times tables for 7", by: "child", requestId: id })
    assert.ok(first.kind === "pack" && again.kind === "pack" && first.pack.id === again.pack.id && again.existing)
    const busy = await requestPack(f.db, f.owner, f.student, { text: "division facts", by: "child", requestId: rid() })
    assert.ok(busy.kind === "pack" && busy.existing && first.kind === "pack" && busy.pack.id === first.pack.id, "one pack is made at a time")
    await f.db.prepare("UPDATE packs SET status = 'published'").run()
    await setPackSettings(f.db, f.owner, f.student, { dailyLimit: 1 })
    await assert.rejects(requestPack(f.db, f.owner, f.student, { text: "division facts", by: "child", requestId: rid() }), PackLimit)
    await setPackSettings(f.db, f.owner, f.student, { requests: "off", dailyLimit: 3 })
    await assert.rejects(requestPack(f.db, f.owner, f.student, { text: "division facts", by: "child", requestId: rid() }), PackScope)
    await setPackSettings(f.db, f.owner, f.student, { requests: "classes", approval: "plan" })
    const plan = await requestPack(f.db, f.owner, f.student, { text: "division facts", by: "child", requestId: rid() })
    assert.ok(plan.kind === "pack" && plan.pack.status === "brief" && !plan.pack.job_id, "show the plan first waits for Make it")
    const queued = await makePlannedPack(f.db, f.owner, plan.kind === "pack" ? plan.pack.id : "", { count: 18 })
    assert.equal(queued.status, "queued"); assert.equal(JSON.parse(queued.brief_json).count, 18)
    const thread = (await f.db.prepare("SELECT body FROM planner_messages WHERE student_id = ? AND source = 'child'").all(f.student)) as any[]
    assert.ok(thread.some((row) => /asked for practice/.test(row.body)), "the parent sees the child's requests")
  } finally { f.db.close() }
})

test("every pack runbook ships with the routing and quality fields the gate needs", () => {
  for (const id of ["pack-math-procedure", "pack-math-word-problems", "pack-vocabulary", "pack-concept-check"] as const) {
    const book = runbook(id)
    assert.ok(book.formats.length && book.keywords.length && book.bloomMin >= 1 && book.bloomMax <= 6, id)
    assert.match(readFileSync(new URL(`../skills/${id}/SKILL.md`, import.meta.url), "utf8"), /## Hints/)
  }
})

test("the checked-in defect set: the code gate catches every broken question and passes every good one", () => {
  const rows = readFileSync(new URL("../eval/packs/defects.jsonl", import.meta.url), "utf8").trim().split("\n").map((line) => JSON.parse(line))
  const missed: string[] = [], flagged: string[] = []
  for (const row of rows) {
    const issues = checkItem(row.item, qaRules(runbook(row.runbook), { grade: row.grade } as PackBrief))
    if (row.expect === null) { if (issues.some((issue) => issue.block)) flagged.push(`${row.id}: ${issues.map((i) => i.rule).join(", ")}`) }
    else if (!issues.some((issue) => issue.block && issue.rule === row.expect)) missed.push(`${row.id} (got ${issues.map((i) => i.rule).join(", ") || "nothing"})`)
  }
  assert.ok(rows.filter((row) => row.expect).length >= 50, "at least fifty deliberate defects")
  assert.deepEqual(missed, []); assert.deepEqual(flagged, [])
})

test("a child's request that names a test never sets a dated target", async () => {
  const f = await family()
  try {
    await setPackSettings(f.db, f.owner, f.student, { requests: "any", approval: "now", dailyLimit: 3 })
    const made = await requestPack(f.db, f.owner, f.student, { text: "fractions for the quiz on 2099-01-08", by: "child", requestId: rid() })
    const packId = made.kind === "pack" ? made.pack.id : ""
    await runNextJob(f.db, handlers(f.db, stubAsk(goodDraft()).ask))
    const pack = await packRow(f.db, packId)
    assert.equal(pack!.status, "published")
    const targets = await f.db.prepare("SELECT kind, deadline FROM targets WHERE student_id = ? AND kind != 'program'").all(f.student) as any[]
    assert.ok(targets.length && targets.every((t) => t.kind === "curiosity"), "the test date stays a curiosity until a parent sets it")
  } finally { f.db.close() }
})
