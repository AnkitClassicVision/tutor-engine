import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { routeRunbook, runbook } from "../src/pack-runbooks.ts"
import { checkItem } from "../src/pack-qa.ts"
import { mapContext } from "../src/pack.ts"
import { noteChangedMind, changedMinds } from "../src/museum.ts"
import { teachingMovesBrief } from "../src/content-skills.ts"
import { openDb } from "../src/db.ts"
import { registerUser } from "../src/auth.ts"
import { createStudent } from "../src/services.ts"
import { studentHome } from "../src/journey-view.ts"
import { startMapRow, saveResearch, decideMap } from "../src/subject-map.ts"

test("asking for a challenge, a case or a debate routes to a mission in any subject", () => {
  assert.equal(routeRunbook("Science", "A challenge mission on magnets"), "pack-mission")
  assert.equal(routeRunbook("Math", "a detective case about fractions"), "pack-mission")
  assert.equal(routeRunbook("History", "debate who built the pyramids"), "pack-mission")
  assert.notEqual(routeRunbook("Math", "times tables for my quiz on Friday"), "pack-mission")
  const mission = runbook("pack-mission")
  assert.equal(mission.bloomMin, 3); assert.equal(mission.bloomMax, 6)
  assert.match(mission.text, /Fix the mix-up/); assert.match(mission.text, /Defend it/)
  assert.match(teachingMovesBrief(), /Fix the mix-up/)
  // A create-level written question with a reasoning key passes the pack's code rules.
  const issues = checkItem({ prompt: "Design a raft for 6 toy animals using only 10 bottles. Explain why it will float.", answer: "Rubric: spreads the load across the bottles and says floating depends on displacing enough water.", format: "written", choices: null, work: null, hints: ["What makes something float?", "Where would the weight go?", "How much water do the bottles push aside?"], explanation: "Floating needs enough displaced water.", bloom: 6, rubric: { mustShow: [{ point: "Spreads the load and links floating to displaced water", acceptable: ["spreads the weight", "bottles push water away", "enough water is pushed aside"] }], doesNotMeet: ["says it floats because bottles are light only"], notRequired: ["spelling"], examples: { meets: "Five bottles each side spread the weight and push away enough water.", almost: "Use lots of bottles.", notYet: "It floats because plastic is light." } } }, { formats: mission.formats, bloomMin: 3, bloomMax: 6, requireWork: false, grade: 4 })
  assert.equal(issues.filter(i => i.block).length, 0, JSON.stringify(issues))
})

async function family() {
  const db = openDb(":memory:")
  const u = await registerUser(db, "missions@example.com", "synthetic-password"); if (!u.ok) throw new Error()
  const student = await createStudent(db, u.userId, { displayName: "Synthetic learner", grade: 4, sessionCapMinutes: 25 })
  return { db, owner: u.userId, student }
}

test("a mission uses the matching concept and real misconceptions from the approved map", async () => {
  const f = await family()
  try {
    const map = JSON.parse(readFileSync(new URL("../eval/golden/research-subject.json", import.meta.url), "utf8"))[0].replies.write
    const mapId = await startMapRow(f.db, f.student, "Volcanoes")
    await saveResearch(f.db, f.student, mapId, { map, web: true })
    assert.deepEqual(await mapContext(f.db, f.student, "Volcanoes", "magma and lava"), {}, "a draft map is not used")
    await decideMap(f.db, f.student, mapId, "approved")
    const context = await mapContext(f.db, f.student, "Volcanoes", "A challenge mission on magma and lava") as any
    assert.equal(context.subjectMap.concept, "Magma and lava")
    assert.equal(context.subjectMap.misconceptions[0].belief, "All mountains are volcanoes.")
  } finally { f.db.close() }
})

test("a miss followed by a correct higher-level explanation in the same mission is kept as a changed mind", async () => {
  const f = await family()
  try {
    const session = crypto.randomUUID(), started = new Date().toISOString()
    f.db.prepare(`INSERT INTO tutor_sessions (id, student_id, started_at, modality, consecutive_step_downs, cap_minutes, continuity, mode, subject) VALUES (?, ?, ?, 'screen', 0, 25, '', 'session', 'Science')`).run(session, f.student, started)
    const item = (position: number, bloom: number, given: string, correct: number | null) => {
      const id = crypto.randomUUID()
      f.db.prepare(`INSERT INTO session_items (id, session_id, position, beat, concept_id, bloom_level, prompt, answer, hints_json, surface, interleaved, hints_used, answered, given_answer, correct) VALUES (?, ?, ?, 'frontier', 'custom.float', ?, ?, 'key', '[]', 'screen', 0, 0, 1, ?, ?)`).run(id, session, position, bloom, `Question ${position}`, given, correct)
      return id
    }
    item(1, 3, "Heavy things always sink", 0)
    const low = item(2, 3, "It floats", 1)
    const high = item(3, 5, "A big ship floats because it pushes aside lots of water", 1)
    assert.equal(await noteChangedMind(f.db, session, low), false, "a lower-level success is not enough")
    assert.equal(await noteChangedMind(f.db, session, high), true)
    assert.equal(await noteChangedMind(f.db, session, high), true, "recording twice keeps one entry")
    const minds = await changedMinds(f.db, f.student)
    assert.equal(minds.length, 1); assert.equal(minds[0].before_answer, "Heavy things always sink")
    assert.match(String(f.db.prepare("SELECT before_answer FROM changed_minds /* still sealed */").get()!.before_answer), /^fam:v1:/)
    const home = await studentHome(f.db, f.owner, f.student, true)
    assert.match(home, /Museum of changed minds/); assert.match(home, /Heavy things always sink/)
  } finally { f.db.close() }
})
