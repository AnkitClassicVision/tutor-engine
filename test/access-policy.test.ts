import assert from "node:assert/strict"
import test from "node:test"
import { measuredSkill, supportSuppliesSkill } from "../src/engine/access.ts"
import { independent } from "../src/engine/mastery.ts"
import { openDb } from "../src/db.ts"
import { registerUser } from "../src/auth.ts"
import { createStudent, learningOverview, loadAttempts } from "../src/services.ts"
import { sessionPage } from "../src/view.ts"

test("the measured skill comes from the subject; maths and science are reasoning", () => {
  for (const [subject, skill] of [["Reading", "reading"], ["Phonics", "reading"], ["English Language Arts", "reading"], ["ELA", "reading"], ["Spelling", "spelling"], ["Weekly spelling words", "spelling"], ["Math", "reasoning"], ["Science", "reasoning"], ["", "reasoning"], ["Spreadsheets", "reasoning"], ["Special topics", "reasoning"], ["Bread making", "reasoning"], ["Misspellings", "reasoning"], ["Reading comprehension", "reading"]] as const)
    assert.equal(measuredSkill(subject), skill, subject)
  assert.equal(supportSuppliesSkill("reading", ["read_aloud"]), true)
  assert.equal(supportSuppliesSkill("reading", ["voice_entry"]), false)
  assert.equal(supportSuppliesSkill("spelling", ["voice_entry"]), true)
  assert.equal(supportSuppliesSkill("spelling", ["read_aloud"]), false)
  assert.equal(supportSuppliesSkill("reasoning", ["read_aloud", "voice_entry"]), false)
})

test("read-aloud makes a reading check supported; a maths check stays independent (owner decision 2026-10-19)", async () => {
  const db = openDb(":memory:")
  try {
    const u = await registerUser(db, "access-policy@example.com", "synthetic-password"); if (!u.ok) throw new Error()
    const student = await createStudent(db, u.userId, { displayName: "Synthetic learner", grade: 2, sessionCapMinutes: 10 })
    const add = (subject: string, access: string | null, concept = 'custom.c') => {
      const session = crypto.randomUUID(), id = crypto.randomUUID(), now = new Date().toISOString()
      db.prepare(`INSERT INTO tutor_sessions (id, student_id, started_at, modality, consecutive_step_downs, cap_minutes, continuity, mode, subject) VALUES (?, ?, ?, 'screen', 0, 10, '', 'session', ?)`).run(session, student, now, subject)
      db.prepare(`INSERT INTO session_items (id, session_id, position, beat, concept_id, bloom_level, prompt, answer, hints_json, surface, interleaved, hints_used, answered, given_answer, correct, submitted_at, access_support) VALUES (?, ?, 1, 'frontier', ?, 2, ?, 'cat', '[]', 'screen', 0, 0, 1, 'cat', 1, ?, ?)`).run(id, session, concept, `Synthetic ${id}`, now, access)
      db.prepare(`INSERT INTO attempts (id, student_id, session_id, concept_id, bloom_level, day, correct, hints_used, interleaved, time_ms, error_type, modality, created_at) VALUES (?, ?, ?, ?, 2, ?, 1, 0, 0, 1000, NULL, 'screen', ?)`).run(id, student, session, concept, now.slice(0, 10), now)
      return id
    }
    const reading = add("Reading", "read_aloud"), readingAlone = add("Reading", null), maths = add("Math", "read_aloud"), spelling = add("Spelling", "voice_entry"), spellingRead = add("Spelling", "read_aloud")
    const byId = Object.fromEntries((await loadAttempts(db, student)).map(a => [a.attemptId, a]))
    assert.equal(byId[reading].supportUsed, "access"); assert.equal(independent(byId[reading]), false)
    assert.equal(byId[readingAlone].supportUsed, "none")
    assert.equal(byId[maths].supportUsed, "none"); assert.deepEqual(byId[maths].accessSupport, ["read_aloud"])
    assert.equal(byId[spelling].supportUsed, "access")
    assert.equal(byId[spellingRead].supportUsed, "none", "hearing the spelling prompt is access, not the skill")
    // The question's own subject decides, not the mission's: a reading review inside a maths mission, and the reverse.
    db.prepare(`INSERT INTO custom_concepts (concept_id, student_id, subject, grade, title, recall, example, non_example, purpose, created_at) VALUES ('custom.sight', ?, 'Reading', 2, 'Sight words', '', '', '', '', ?)`).run(student, new Date().toISOString())
    const readingInMaths = add("Math", "read_aloud", "custom.sight"), mathsInReading = add("Reading", "read_aloud", "math.primary.1.add")
    const again = Object.fromEntries((await loadAttempts(db, student)).map(a => [a.attemptId, a]))
    assert.equal(again[readingInMaths].supportUsed, "access"); assert.equal(again[mathsInReading].supportUsed, "none")
    // Help through read-aloud is still counted as supported work for the parent.
    const overview = await learningOverview(db, u.userId, student)
    assert.equal(overview.supported, 3, "reading with read-aloud, spelling by voice, and the reading review in maths")
    // Hints and homework still take precedence.
    const hinted = add("Reading", "read_aloud"); db.prepare("UPDATE attempts SET hints_used = 1 WHERE id = ?").run(hinted); db.prepare("UPDATE session_items SET hints_used = 1 WHERE id = ?").run(hinted)
    assert.equal((await loadAttempts(db, student)).find(a => a.attemptId === hinted)!.supportUsed, "hint")
  } finally { db.close() }
})

test("ages 5–7 do not get reading questions read aloud automatically, judged by the question's own subject", () => {
  const page = (subject: string) => sessionPage({ sessionId: "00000000-0000-0000-0000-000000000000", continuity: "", item: { id: "i", prompt: "Read the word: cat", concept_id: "c", beat: "frontier", hints_used: 0 }, position: 1, total: 1, feedback: null, onBreak: false, ended: false, capMinutes: 10, band: "5-7", subject })
  assert.doesNotMatch(page("Reading"), /data-autoread/); assert.match(page("Reading"), /Read aloud/)
  assert.match(page("Math"), /data-autoread/); assert.match(page("Spelling"), /data-autoread/)
  const review = sessionPage({ sessionId: "00000000-0000-0000-0000-000000000000", continuity: "", item: { id: "i", prompt: "Read the word: dog", concept_id: "custom.sight", beat: "review", hints_used: 0 }, position: 1, total: 1, feedback: null, onBreak: false, ended: false, capMinutes: 10, band: "5-7", subject: "Math", itemSubject: "Reading" })
  assert.doesNotMatch(review, /data-autoread/, "a reading review inside a maths mission is not read automatically")
})
