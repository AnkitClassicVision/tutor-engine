// Runs live cases against a real model and scores each runbook step for that model:
//   - every golden case marked "live", plus the realistic inputs in eval/live/<step>.json;
//   - accuracy where a case states the right answer (a grade, a verdict, a planner action);
//   - whole practice packs and missions from eval/live/packs.json, through the pack checks.
// It spends provider credit or plan usage, so it refuses to run without --confirm-spend.
//
//   TUTOR_EVAL_PROVIDER=openai TUTOR_EVAL_MODEL=<model> TUTOR_EVAL_KEY=... \
//     node --experimental-strip-types scripts/eval-runbooks.ts --confirm-spend [--only fresh-practice] [--details]
//
// --family-db <path> uses the AI connection a parent saved in that database (for example a ChatGPT plan
// signed in through the local test copy), with token refresh handled the same way as in the app.
// Optional reviewer on a different model: TUTOR_EVAL_CRITIC_PROVIDER / _MODEL / _KEY.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { normalizeProvider, type AiConfig } from "../src/ai.ts"
import { CONTRACTS } from "../src/runbook/registry.ts"
import { goldenCases } from "../src/runbook/golden.ts"
import { runContract } from "../src/runbook/run.ts"
import { openDb } from "../src/db.ts"
import { aiConfigFor } from "../src/services.ts"
import { RESEARCH_SUBJECT, researchAsk, concepts, type ResearchInput } from "../src/subject-map.ts"
import { canSearch } from "../src/research-web.ts"
import { briefFromWords, checkAndRepair, defaultPackAsk, PACK_SCHEMA, parsePackDraft, qaRules, writerBrief, type PackBrief } from "../src/pack.ts"
import { runbook } from "../src/pack-runbooks.ts"
import { gradeLabel } from "../src/engine/grade.ts"
import { judgeAnswer, type Judgment } from "../src/grade-response.ts"

const args = process.argv.slice(2)
if (!args.includes("--confirm-spend")) { console.error("This calls a real model and spends credit or plan usage. Re-run with --confirm-spend."); process.exit(2) }
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : ""
const details = args.includes("--details")
const config = (prefix: string): AiConfig | null => process.env[`${prefix}_PROVIDER`] ? { provider: normalizeProvider(String(process.env[`${prefix}_PROVIDER`])), model: String(process.env[`${prefix}_MODEL`] ?? ""), apiKey: String(process.env[`${prefix}_KEY`] ?? "") } : null
const familyDb = args.includes("--family-db") ? args[args.indexOf("--family-db") + 1] : ""
let ai = config("TUTOR_EVAL")
const family = familyDb ? openDb(familyDb) : null
const owner = family ? (await family.prepare("SELECT id FROM users WHERE ai_key != '' ORDER BY created_at LIMIT 1").get()) as { id: string } | undefined : undefined
if (family && !owner) { console.error("No saved AI connection in that database."); process.exit(2) }
if (family) ai = await aiConfigFor(family, owner!.id)
if (!ai || !ai.apiKey) { console.error("Set TUTOR_EVAL_PROVIDER, TUTOR_EVAL_MODEL and TUTOR_EVAL_KEY, or pass --family-db."); process.exit(2) }
const model: AiConfig = ai
// A saved sign-in is fetched fresh for each case, as the app does for each job, so a long run never outlives its token.
const fresh = async (): Promise<AiConfig> => family ? aiConfigFor(family, owner!.id) : model
const criticAi = config("TUTOR_EVAL_CRITIC")

interface LiveCase { name: string; input: unknown; expect?: Record<string, unknown> }
const liveFile = (id: string): LiveCase[] => { const path = new URL(`../eval/live/${id}.json`, import.meta.url); return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [] }

const results: Array<Record<string, unknown>> = []
const say = (line: string) => console.log(line)

for (const contract of CONTRACTS.filter(c => !only || c.id === only)) {
  const cases: LiveCase[] = [...goldenCases(contract.id).filter(c => c.live).map(c => ({ name: c.name, input: c.input })), ...liveFile(contract.id)]
  for (const live of cases) {
    // Research runs the way the app runs it: web search only when this connection really has it.
    const research = contract.id === RESEARCH_SUBJECT.id ? { ...(live.input as ResearchInput), searchable: canSearch(model), found: { web: false, urls: [] } } : null
    let output: any = null, report: any
    try {
      ;({ output, report } = research
        ? await runContract(RESEARCH_SUBJECT, research, await fresh(), { criticAi, ask: researchAsk(research), budgetMs: 260000 })
        : await runContract(contract, live.input as never, await fresh(), { criticAi }))
    } catch (error) { report = { outcome: "rejected", attempts: 0, ms: 0, issues: [{ rule: "crash", message: String(error), block: true }] } }
    const passed = output !== null
    // Where the case states the right answer, the output must match it as well as pass the checks.
    const wrong = live.expect && passed ? Object.entries(live.expect).filter(([key, value]) => (output as Record<string, unknown>)[key] !== value).map(([key, value]) => `${key}: expected ${String(value)}, got ${String((output as Record<string, unknown>)[key])}`) : []
    const accurate = live.expect ? passed && !wrong.length : null
    const size = research && output ? concepts(output).length : undefined
    results.push({ kind: "step", runbook: contract.id, version: contract.version, case: live.name, passed, accurate, wrong, outcome: report.outcome, attempts: report.attempts, ms: report.ms, concepts: size, research: research ? (research.found.web ? "web" : "knowledge") : undefined, blocks: report.issues.filter((i: any) => i.block).map((i: any) => i.rule), warnings: report.issues.filter((i: any) => !i.block).map((i: any) => i.rule) })
    say(`${passed ? (accurate === false ? "WRONG" : "PASS") : "FAIL"} ${contract.id}@${contract.version}: ${live.name} (${report.outcome}, ${report.attempts} attempt${report.attempts === 1 ? "" : "s"}, ${Math.round(report.ms / 1000)} s${size ? `, ${size} concepts` : ""})`)
    // Synthetic inputs only, so the rule messages are safe to print when asked for.
    if (details && !passed) for (const found of report.issues.filter((i: any) => i.block)) say(`    ${found.rule}${found.item === undefined ? "" : ` #${found.item}`}: ${found.message}`)
    for (const line of wrong) say(`    ${line}`)
  }
}

// Whole practice packs and missions: route, write, code checks, blind checker, repair, publish count.
if (!only || only === "packs") {
  for (const pack of liveFile("packs") as unknown as Array<{ name: string; request: string; subject: string; grade: number; expectRunbook: string }>) {
    const started = Date.now()
    const made = briefFromWords(pack.request, { name: "Synthetic", grade: pack.grade, reading: "explorer", classes: [pack.subject], today: new Date().toISOString().slice(0, 10) }, pack.subject)
    if (!("brief" in made)) { say(`FAIL packs: ${pack.name} (asked to clarify)`); results.push({ kind: "pack", case: pack.name, passed: false }); continue }
    const brief: PackBrief = made.brief, book = runbook(brief.runbook)
    let published = 0, written = 0, dropped = 0, topBloom = 0, rules: Record<string, number> = {}, error = ""
    try {
      const prompt = JSON.stringify({
        request: brief.request,
        learner: { grade: gradeLabel(pack.grade), readingLevel: "confident reader", subject: brief.subject },
        pack: { topic: brief.topic, skills: brief.skills, questionsPerSkill: brief.perSkill, testDate: brief.testDate, preferredFormats: brief.preferred, allowedFormats: book.formats, bloomRange: `${book.bloomMin}-${book.bloomMax}` },
      })
      const ai = await fresh()
      const draft = parsePackDraft(await defaultPackAsk("write", prompt, writerBrief(book), PACK_SCHEMA, ai))
      const checked = await checkAndRepair(draft, brief, book, qaRules(book, brief), ai, defaultPackAsk)
      ;({ published, written, dropped, rules } = checked.qa)
      topBloom = Math.max(0, ...checked.final.skills.flatMap(skill => skill.items.map(item => item.bloom)))
    } catch (failure) { error = failure instanceof Error ? failure.message : String(failure) }
    const routed = brief.runbook === pack.expectRunbook
    const passed = !error && published >= 4 && routed
    results.push({ kind: "pack", runbook: brief.runbook, case: pack.name, passed, routed, written, published, dropped, topBloom, rules, error, ms: Date.now() - started })
    say(`${passed ? "PASS" : "FAIL"} packs (${brief.runbook}): ${pack.name} (${published} of ${written} published, top Bloom ${topBloom}, ${Math.round((Date.now() - started) / 1000)} s)${routed ? "" : ` routed to ${brief.runbook}, expected ${pack.expectRunbook}`}${error ? ` error: ${error}` : ""}`)
  }
}

// Grading accuracy on the review pack: the full path, first grader and independent second check.
// The pack's expected verdicts are proposed, not yet hand-checked; "null" means the answer should stay for a parent.
if (only === "grading") {
  const pack = readFileSync(new URL("../eval/review-pack/cases.jsonl", import.meta.url), "utf8").trim().split("\n").map(line => JSON.parse(line)).filter(row => row.kind === "grading" || row.kind === "higher_bloom")
  for (const row of pack) {
    const started = Date.now()
    let judgment: Judgment = { kind: "failed" }, error = ""
    try { judgment = await judgeAnswer(row.input, await fresh(), { timeoutMs: 25000 }) } catch (failure) { error = String(failure) }
    const got = judgment.kind === "graded" ? judgment.verdict.correct : null, expected = row.expectedCorrect ?? null
    // Leaving an answer for a parent is never a wrong grade, but it is counted separately; an AI failure is neither.
    // A retired question counts neither way and never reaches the parent; it is right when the case expected no grade.
    const outcome = judgment.kind === "failed" ? "AI failed" : got === expected ? "right" : judgment.kind === "question_problem" ? "retired question" : got === null ? "left for a parent" : "wrong"
    const path = judgment.kind === "graded" ? judgment.path : judgment.kind
    const doubt = judgment.kind === "escalated" || judgment.kind === "question_problem" ? judgment.doubt : ""
    results.push({ kind: "grading", case: row.id, subject: row.subject, bloom: row.input.bloomLevel, tags: row.tags, expected, got, outcome, path, doubt, error, ms: Date.now() - started })
    say(`${outcome === "right" ? "RIGHT" : outcome === "wrong" ? "WRONG" : outcome === "AI failed" ? "FAIL " : "OPEN "} ${row.id} (${row.subject}, Bloom ${row.input.bloomLevel}${row.tags?.length ? `, ${row.tags.join(" ")}` : ""}): expected ${String(expected)}, got ${String(got)} via ${path} (${Math.round((Date.now() - started) / 1000)} s)${doubt ? `\n    doubt: ${doubt}` : ""}`)
  }
  const graded = results.filter(r => r.kind === "grading")
  say(`\nGrading on ${graded.length} review-pack cases: ${graded.filter(r => r.outcome === "right").length} right, ${graded.filter(r => r.outcome === "wrong").length} wrong, ${graded.filter(r => r.outcome === "left for a parent").length} left for a parent, ${graded.filter(r => r.outcome === "retired question").length} retired as faulty questions, ${graded.filter(r => r.outcome === "AI failed").length} AI failures; ${graded.filter(r => r.path === "grounded").length} settled by grounding.`)
}

const steps = results.filter(r => r.kind === "step"), packs = results.filter(r => r.kind === "pack")
const accuracy = steps.filter(r => r.accurate !== null)
say(`\n${model.provider}/${model.model || "default"}: ${steps.filter(r => r.passed).length}/${steps.length} step cases passed their checks; ${accuracy.filter(r => r.accurate).length}/${accuracy.length} with a known answer were right; ${packs.filter(r => r.passed).length}/${packs.length} packs and missions published.`)
mkdirSync(new URL("../evidence/runbook-eval/", import.meta.url), { recursive: true })
const file = new URL(`../evidence/runbook-eval/${model.provider}-${(model.model || "default").replace(/[^\w.-]/g, "_")}-${new Date().toISOString().slice(0, 10)}${only ? `-${only}` : ""}.json`, import.meta.url)
writeFileSync(file, JSON.stringify({ provider: model.provider, model: model.model, critic: criticAi ? { provider: criticAi.provider, model: criticAi.model } : null, ranAt: new Date().toISOString(), results }, null, 1))
say(`Saved ${file.pathname}`)
