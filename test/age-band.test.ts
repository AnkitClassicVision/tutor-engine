import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../src/db.ts'
import { registerUser } from '../src/auth.ts'
import { ageBand, numberChoices, presentationFor } from '../src/engine/age.ts'
import { createStudent, startTutorSession, sessionItems, submitAnswer, setPresentation, resumeSession, loadAttempts } from '../src/services.ts'
import { sessionPage } from '../src/view.ts'

const years = (n: number) => new Date(Date.now() - n * 365.25 * 86400000).toISOString().slice(0, 10)

test('one rule gives every learner an age band; a parent override and the old settings still work', () => {
  assert.equal(ageBand({ birth_date: years(6) }), '5-7')
  assert.equal(ageBand({ birth_date: years(7.9) }), '5-7')
  assert.equal(ageBand({ birth_date: years(8.1) }), '8-10')
  assert.equal(ageBand({ birth_date: years(10.5) }), '8-10')
  assert.equal(ageBand({ birth_date: years(12) }), '11-14')
  assert.equal(ageBand({ grade: 1 }), '5-7'); assert.equal(ageBand({ grade: 4 }), '8-10'); assert.equal(ageBand({ grade: 7 }), '11-14')
  assert.equal(ageBand({ presentation: '11-14', birth_date: years(6) }), '11-14', 'a parent can override')
  assert.equal(ageBand({ presentation: 'junior', birth_date: years(13) }), '8-10')
  assert.equal(ageBand({ presentation: 'explorer', birth_date: years(6) }), '11-14')
  assert.equal(presentationFor('5-7'), 'junior'); assert.equal(presentationFor('8-10'), 'junior'); assert.equal(presentationFor('11-14'), 'explorer')
})

test('number tiles hold the answer and three believable near misses in a stable order', () => {
  const tiles = numberChoices('42', '6 baskets hold 7 apples each. How many apples?', 99)!
  assert.equal(tiles.length, 4); assert.equal(new Set(tiles).size, 4)
  assert.ok(tiles.includes('42')); assert.ok(tiles.includes('13'), 'adding instead of multiplying is offered')
  assert.ok(tiles.every((t) => /^\d+$/.test(t) && Number(t) >= 0))
  assert.deepEqual(numberChoices('42', '6 baskets hold 7 apples each.', 99), tiles)
  assert.equal(numberChoices('3/4', 'Add 1/4 + 2/4.', 1), null)
  assert.equal(numberChoices('Rubric: explain', 'Explain', 1), null)
})

test('the youngest band answers first checks with tiles; scoring, evidence and resume are unchanged', async () => {
  const db = openDb(':memory:')
  try {
    const u = await registerUser(db, 'bands@example.com', 'synthetic-password'); assert.ok(u.ok)
    const young = await createStudent(db, u.userId, { displayName: 'Synthetic young learner', grade: 1, birthDate: years(6.5), sessionCapMinutes: 25 } as any)
    const older = await createStudent(db, u.userId, { displayName: 'Synthetic older learner', grade: 4, birthDate: years(9.5), sessionCapMinutes: 25 } as any)
    const now = new Date()
    const youngSession = await startTutorSession(db, u.userId, young, now, { focusConceptId: 'math.primary.1.add', goal: 'harder_probe' })
    const youngItems = await sessionItems(db, youngSession)
    const tiled = youngItems.filter((i) => i.format === 'choice')
    assert.ok(tiled.length >= 1, 'number questions in a first check become tiles')
    for (const item of tiled) assert.ok(JSON.parse(String(item.choices_json)).includes(String(item.answer)))
    const olderItems = await sessionItems(db, await startTutorSession(db, u.userId, older, now, { focusConceptId: 'math.primary.1.add', goal: 'harder_probe' }))
    assert.equal(olderItems.filter((i) => i.format === 'choice').length, 0, 'older bands keep typed answers')
    // The page reads the question aloud and shows the tiles.
    const first = youngItems.find((i) => i.answered === 0)!
    const page = sessionPage({ sessionId: youngSession, continuity: '', item: first, position: 1, total: youngItems.length, feedback: null, onBreak: false, ended: false, capMinutes: 25, band: '5-7' })
    assert.match(page, /data-autoread/); assert.match(page, /data-autoread-toggle/)
    assert.doesNotMatch(sessionPage({ sessionId: youngSession, continuity: '', item: first, position: 1, total: 6, feedback: null, onBreak: false, ended: false, capMinutes: 25, band: '8-10' }), /data-autoread/)
    // A tiled item is scored the same way: the right tile is correct and counts.
    const target = youngItems.find((i) => i.answered === 0)!
    if (target.format === 'choice') {
      await submitAnswer(db, u.userId, youngSession, { itemId: String(target.id), answer: String(target.answer) }, now)
      const attempts = await loadAttempts(db, young)
      assert.equal(attempts.length, 1); assert.ok(attempts[0].correct)
    }
    // Resuming a mission keeps the tiles.
    await db.prepare("UPDATE tutor_sessions SET ended_at = ?, end_reason = 'attention' WHERE id = ?").run(now.toISOString(), youngSession)
    const resumed = await resumeSession(db, u.userId, youngSession)
    const carried = (await sessionItems(db, resumed)).filter((i) => i.format === 'choice')
    assert.equal(carried.length, (await sessionItems(db, youngSession)).filter((i) => i.answered === 0 && i.format === 'choice').length)
    for (const item of carried) assert.ok(JSON.parse(String(item.choices_json)).length === 4)
    // Parents choose a band; anything else is refused.
    await setPresentation(db, u.userId, older, { presentation: '5-7' })
    await assert.rejects(setPresentation(db, u.userId, older, { presentation: 'toddler' }), /Choose a presentation/)
  } finally { db.close() }
})
