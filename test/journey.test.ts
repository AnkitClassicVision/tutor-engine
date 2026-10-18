import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.ts'
import { registerUser, openAuthSession, readAuthSession, hashToken } from '../src/auth.ts'
import { createStudent, startTutorSession, sessionItems, submitAnswer, enforceSessionTime, resumeSession, aiConfigFor, saveAiSettings, listStates, useHint } from '../src/services.ts'
import { createJob, runNextJob, changeJob, ownedJob } from '../src/jobs.ts'
import { createMaterial, correctMaterial, ownedQuestion, extractMaterial, validateQuestions, reviewMaterial, saveSchoolResult } from '../src/schoolwork.ts'
import { radarEvidence } from '../src/journey-view.ts'
import { authorizeStudentPath } from '../src/journey-routes.ts'
import { exportFamily, deleteFamily, issueAccountToken, consumeAccountToken } from '../src/accounts.ts'
import { decryptSecret } from '../src/secrets.ts'

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'journey-')), db = openDb(join(dir, 'test.sqlite'))
  const user = (await registerUser(db, 'journey@example.com', 'a-long-password'))
  if (!user.ok) throw new Error('Registration failed')
  const owner = user.userId, student = (await createStudent(db, owner, { displayName: 'June', grade: 5, sessionCapMinutes: 25 }))
  return { db, owner, student, dir }
}
async function question(db: any, material: string, revision = 1, readable = 1) {
  const id = crypto.randomUUID()
  await db.prepare(`INSERT INTO material_questions (id, material_id, revision, number, prompt, visible_work, answer_key, concept_id, readable, confidence) VALUES (?, ?, ?, '12b', 'What is 2 + 2?', '4', '4', 'math.fractions.add_unlike', ?, 1)`).run(id, material, revision, readable)
  return id
}

test('a failed job commit rolls back nested writes and a second connection can cancel before commit', async () => {
  const f = (await fixture()), other = openDb(join(f.dir, 'test.sqlite'))
  try {
    const failed = (await createJob(f.db, f.owner, f.student, 'atomic', {}, 'atomic'))
    await runNextJob(f.db, { atomic: async ctx => {
      await ctx.commit(async () => {
        await createStudent(f.db, f.owner, { displayName: 'Rolled back', grade: 3, sessionCapMinutes: 5 })
        throw new Error('Fail after nested writes')
      })
    } })
    assert.equal((await ownedJob(f.db, f.owner, failed)).status, 'failed')
    assert.equal((await f.db.prepare('SELECT count(*) n FROM students').get())!.n, 1)
    const cancelled = (await createJob(f.db, f.owner, f.student, 'cancel-check', {}, 'cancel-check'))
    await runNextJob(f.db, { 'cancel-check': async ctx => {
      await changeJob(other, f.owner, ctx.job.id, 'cancel')
      assert.equal((await ctx.commit(() => { throw new Error('Stale commit must not run') })), false)
    } })
    assert.equal((await ownedJob(f.db, f.owner, cancelled)).status, 'cancelled')
  } finally { other.close(); f.db.close(); rmSync(f.dir, { recursive: true, force: true }) }
})

test('short blocks remember choice, clamp legacy caps, and enforce time on GET', async () => {
  const { db, owner, student } = (await fixture())
  const now = new Date('2026-10-01T12:00:00Z')
  const session = (await startTutorSession(db, owner, student, now, { durationMinutes: 3 }))
  assert.equal((await db.prepare('SELECT cap_minutes FROM tutor_sessions WHERE id = ?').get(session))!.cap_minutes, 3)
  assert.equal((await db.prepare('SELECT last_duration FROM students WHERE id = ?').get(student))!.last_duration, 3)
  assert.equal((await enforceSessionTime(db, owner, session, new Date('2026-10-01T12:03:00Z'))).end_reason, 'attention')
  const old = (await sessionItems(db, session)).map(i => i.prompt)
  const next = (await resumeSession(db, owner, session))
  assert.deepEqual((await sessionItems(db, next)).map(i => i.prompt), old)
  assert.equal((await db.prepare('SELECT cap_minutes FROM tutor_sessions WHERE id = ?').get(next))!.cap_minutes, 3)
  await db.prepare('UPDATE students SET session_cap_minutes = 4 WHERE id = ?').run(student)
  const bounded = (await startTutorSession(db, owner, student, new Date(), { durationMinutes: 5 }))
  assert.equal((await db.prepare('SELECT cap_minutes FROM tutor_sessions WHERE id = ?').get(bounded))!.cap_minutes, 3)
  await assert.doesNotReject(async () => (await startTutorSession(db, owner, student)))
  await db.prepare('UPDATE students SET session_cap_minutes = 60 WHERE id = ?').run(student)
  const capped = (await startTutorSession(db, owner, student, new Date(), { durationMinutes: 25 }))
  assert.equal((await db.prepare('SELECT cap_minutes FROM tutor_sessions WHERE id = ?').get(capped))!.cap_minutes, 25)
  await assert.rejects(async () => (await startTutorSession(db, owner, student, new Date(), { durationMinutes: 4 })))
  db.close()
})
test('duplicate answers commit one attempt and assisted work does not establish mastery', async () => {
  const { db, owner, student } = (await fixture())
  const id = (await startTutorSession(db, owner, student))
  const first = (await sessionItems(db, id))[0]
  await db.prepare('UPDATE session_items SET answer = ?, bloom_level = 1 WHERE id = ?').run('4', first.id as string)
  await useHint(db, owner, id, String(first.id))
  const input = { itemId: String(first.id), answer: '4', timeMs: 1000 }
  await submitAnswer(db, owner, id, input); await submitAnswer(db, owner, id, input)
  assert.equal((await db.prepare('SELECT count(*) n FROM attempts WHERE session_id = ?').get(id))!.n, 1)
  assert.equal((await listStates(db, student)).find(s => s.conceptId === first.concept_id)!.bloomLevel, 0)
  db.close()
})
test('jobs persist, deduplicate, cancel safely and retry without stale lease commits', async () => {
  const { db, owner, student } = (await fixture())
  const id = (await createJob(db, owner, student, 'slow', { value: 1 }, 'same'))
  assert.equal((await createJob(db, owner, student, 'slow', { value: 1 }, 'same')), id)
  await assert.rejects(async () => (await createJob(db, owner, student, 'slow', { value: 2 }, 'same')))
  let commits = 0
  await runNextJob(db, { slow: async ctx => { await ctx.stage('Checking your reasoning'); await changeJob(db, owner, id, 'cancel'); assert.equal((await ctx.commit(() => commits++)), false); return {} } })
  assert.equal((await ownedJob(db, owner, id)).status, 'cancelled'); assert.equal(commits, 0)
  await changeJob(db, owner, id, 'retry')
  await runNextJob(db, { slow: async ctx => { await ctx.commit(() => commits++); return { done: true } } })
  assert.equal(commits, 1); assert.equal((await ownedJob(db, owner, id)).status, 'succeeded')
  assert.equal(await runNextJob(db, {}), false)
  db.close()
})
test('expired running job is recovered after database reopen and failures preserve payload', async () => {
  const f = (await fixture()), id = (await createJob(f.db, f.owner, f.student, 'work', { saved: 'private work' }, 'restart'))
  await f.db.prepare("UPDATE jobs SET status = 'running', lease_until = '2000-01-01', run_token = 'lost-process' WHERE id = ?").run(id)
  f.db.close()
  const db = openDb(join(f.dir, 'test.sqlite'))
  await runNextJob(db, { work: async () => { throw new Error('Do not log child data or provider tokens') } })
  assert.equal((await ownedJob(db, f.owner, id)).status, 'failed')
  assert.equal(JSON.parse((await ownedJob(db, f.owner, id)).payload).saved, 'private work')
  assert.equal((await ownedJob(db, f.owner, id)).error!.includes('provider tokens'), false)
  db.close()
})
test('locked student endpoints reject sibling records and grading overrides', async () => {
  const { db, owner, student } = (await fixture()), sibling = (await createStudent(db, owner, { displayName: 'Jay', grade: 4, sessionCapMinutes: 5 }))
  const session = (await startTutorSession(db, owner, student)), other = (await startTutorSession(db, owner, sibling))
  const auth = { id: 'auth', userId: owner, csrf: 'csrf', parentUnlocked: false, selectedStudent: student }
  assert.equal((await authorizeStudentPath(db, auth, `/session/${session}/answer`, 'POST')), true)
  assert.equal((await authorizeStudentPath(db, auth, `/session/${session}/review`, 'POST')), false)
  assert.equal((await authorizeStudentPath(db, auth, `/session/${other}`, 'GET')), false)
  for (const path of ['/settings', '/family/export', `/students/${student}/parent`, `/students/${student}/history`]) assert.equal((await authorizeStudentPath(db, auth, path, 'GET')), false)
  assert.equal((await authorizeStudentPath(db, auth, `/students/${sibling}`, 'GET')), false)
  db.close()
})
test('credentials are encrypted and provider switches never reuse the previous provider key', async () => {
  const { db, owner } = (await fixture())
  await saveAiSettings(db, owner, { provider: 'openai', model: 'model-a', apiKey: 'private-api-key' })
  const stored = String((await db.prepare('SELECT ai_key FROM users WHERE id = ?').get(owner))!.ai_key)
  assert.match(stored, /^enc:v2:/); assert.equal(stored.includes('private-api-key'), false)
  assert.equal((await aiConfigFor(db, owner)).apiKey, 'private-api-key')
  await assert.rejects(async () => (await saveAiSettings(db, owner, { provider: 'anthropic', model: '', apiKey: '' })))
  const tampered = stored.slice(0, -3) + 'xxx'; assert.throws(() => decryptSecret(tampered))
  db.close()
})
test('material revisions preserve originals, hide stale questions, and uploads deduplicate', async () => {
  const { db, owner, student, dir } = (await fixture())
  const input = { title: 'Homework', subject: 'Math', kind: 'homework', workState: 'partial', requestId: 'upload-1', pages: [{ transcription: '12b: What is 2 + 2? My answer: 4' }] }
  const material = (await createMaterial(db, owner, student, input, dir))
  assert.equal((await createMaterial(db, owner, student, input, dir)), material)
  const q = (await question(db, material))
  const pages = (await db.prepare('SELECT id FROM material_pages WHERE material_id = ?').all(material))
  await correctMaterial(db, owner, material, [{ id: pages[0].id, transcription: 'Corrected text' }])
  await assert.rejects(async () => (await ownedQuestion(db, owner, q)))
  assert.ok((await db.prepare('SELECT id FROM material_questions WHERE id = ?').get(q)))
  db.close()
})
test('unreadable extraction and review remain unresolved and never create learning attempts', async () => {
  const { db, owner, student, dir } = (await fixture())
  const material = (await createMaterial(db, owner, student, { title: 'Blurry', kind: 'homework', workState: 'completed', pages: [{ transcription: 'Unreadable handwriting' }] }, dir))
  const q = (await question(db, material, 1, 0))
  const id = (await createJob(db, owner, student, 'review', { materialId: material, revision: 1 }, 'review-blurry'))
  await runNextJob(db, { review: async (ctx, p) => (await reviewMaterial(db, ctx, p)) })
  assert.equal((await db.prepare('SELECT verdict FROM homework_reviews WHERE question_id = ?').get(q))!.verdict, 'unresolved')
  assert.equal((await db.prepare('SELECT count(*) n FROM attempts WHERE student_id = ?').get(student))!.n, 0)
  assert.equal(validateQuestions({ questions: [{ number: '1', prompt: 'uncertain', readable: true, confidence: .4, conceptId: 'invented' }] }, new Set())[0].readable, false)
  db.close()
})
test('stale extraction cannot commit over a corrected page', async () => {
  const { db, owner, student, dir } = (await fixture())
  const material = (await createMaterial(db, owner, student, { kind: 'homework', workState: 'blank', pages: [{ transcription: '2 + 2?' }] }, dir))
  const page = (await db.prepare('SELECT id FROM material_pages WHERE material_id = ?').get(material))!
  await correctMaterial(db, owner, material, [{ id: page.id, transcription: '3 + 3?' }])
  const id = (await createJob(db, owner, student, 'extract', { materialId: material, revision: 1 }, 'stale'))
  await runNextJob(db, { extract: async (ctx, p) => (await extractMaterial(db, ctx, p)) })
  assert.equal(JSON.parse((await ownedJob(db, owner, id)).result!).superseded, true)
  assert.equal((await db.prepare('SELECT count(*) n FROM material_questions WHERE material_id = ?').get(material))!.n, 0)
  db.close()
})
test('school totals keep provenance and cannot alter concept mastery', async () => {
  const { db, owner, student } = (await fixture()), before = (await listStates(db, student))
  const result = (await saveSchoolResult(db, owner, student, { title: 'School quiz', date: '2026-10-02', earned: 9, possible: 10, notes: 'Teacher returned it' }))
  assert.match(String((await db.prepare('SELECT provenance FROM school_results WHERE id = ?').get(result))!.provenance), /teacher/)
  assert.deepEqual((await listStates(db, student)), before)
  db.close()
})
test('radar requires five fresh unaided checks on two days at the selected difficulty', async () => {
  const { db, owner, student } = (await fixture()), session = (await startTutorSession(db, owner, student, new Date(), { mode: 'assessment' })), items = (await sessionItems(db, session)), concept = String(items[0].concept_id)
  for (const [i, item] of (items.slice(0, 5)).entries()) { await db.prepare("UPDATE session_items SET concept_id = ?, bloom_level = 3, prompt = ?, answered = 1, correct = 1, hints_used = 0, submitted_at = ? WHERE id = ?").run(concept, `Fresh ${i}`, i < 3 ? '2026-10-01T12:00:00Z' : '2026-10-02T12:00:00Z', item.id as string); }
  assert.equal((await radarEvidence(db, student, concept))[2].percentage, 100)
  await db.prepare('UPDATE session_items SET hints_used = 1 WHERE id = ?').run(items[0].id as string)
  assert.equal((await radarEvidence(db, student, concept))[2].percentage, null)
  db.close()
})
test('recovery tokens are hashed, one-use, expiring and invalidate existing sessions', async () => {
  const { db, owner } = (await fixture()), session = (await openAuthSession(db, owner))
  await issueAccountToken(db, owner, 'recover')
  const outbox = (await db.prepare('SELECT message FROM mail_outbox WHERE user_id = ?').get(owner))!
  const url = new URL(JSON.parse(decryptSecret(String(outbox.message))).url), token = url.searchParams.get('token')!
  assert.ok((await db.prepare('SELECT token_hash FROM account_tokens WHERE token_hash = ?').get(hashToken(token))))
  await consumeAccountToken(db, token, 'recover', 'new-long-password')
  assert.equal((await readAuthSession(db, session.token)), null)
  await assert.rejects(async () => (await consumeAccountToken(db, token, 'recover', 'new-long-password')))
  db.close()
})
test('family export omits credentials and family deletion leaves other owners untouched', async () => {
  const { db, owner, student, dir } = (await fixture())
  const other = (await registerUser(db, 'other@example.com', 'other-long-password')); if (!other.ok) throw new Error()
  await createStudent(db, other.userId, { displayName: 'Other', grade: 4, sessionCapMinutes: 5 })
  await createMaterial(db, owner, student, { kind: 'homework', workState: 'blank', pages: [{ transcription: 'My question' }] }, dir)
  await startTutorSession(db, owner, student)
  const data = (await exportFamily(db, owner, dir))
  assert.equal(JSON.stringify(data).includes('password_hash'), false)
  assert.equal(JSON.stringify(data).includes('ai_key'), false)
  await deleteFamily(db, owner, dir)
  assert.equal((await db.prepare('SELECT count(*) n FROM students WHERE owner_user_id = ?').get(owner))!.n, 0)
  assert.equal((await db.prepare('SELECT count(*) n FROM students WHERE owner_user_id = ?').get(other.userId))!.n, 1)
  db.close(); rmSync(dir, { recursive: true, force: true })
})

test('backup and restore rehearse database integrity, upload checksums, and saved jobs', async () => {
  const { backupFamilyStore, restoreStore } = await import('../src/backup.ts')
  const f = (await fixture()), backup = join(f.dir, 'backup'), restored = join(f.dir, 'restored')
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='
  const material = (await createMaterial(f.db, f.owner, f.student, { title: 'Saved photo', kind: 'homework', workState: 'blank', pages: [{ mime: 'image/png', base64 }] }, join(f.dir, 'uploads')))
  await createJob(f.db, f.owner, f.student, 'extract', { materialId: material, revision: 1 }, 'backup-job')
  const result = await backupFamilyStore(f.db, join(f.dir, 'uploads'), backup)
  assert.equal(result.integrity, 'ok'); assert.equal(result.uploadsVerified, 1)
  restoreStore(backup, restored)
  const restoredDb = openDb(join(restored, 'tutor.sqlite'))
  assert.equal((await restoredDb.prepare('SELECT count(*) n FROM jobs').get())!.n, 1)
  const restoredUpload = (await restoredDb.prepare('SELECT stored_path FROM uploads').get())!
  assert.ok(String(restoredUpload.stored_path).startsWith(restored))
  assert.equal((await import('node:fs')).readFileSync(String(restoredUpload.stored_path)).toString('base64'), base64)
  assert.equal((await restoredDb.prepare('SELECT title FROM materials WHERE id = ?').get(material))!.title, 'Saved photo')
  // Reports carry counts only, never images or learner responses.
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync('evidence', { recursive: true }); writeFileSync('evidence/restore.json', JSON.stringify({ testedAt: new Date().toISOString(), fixture: true, ...result }, null, 2) + '\n')
  restoredDb.close(); f.db.close(); rmSync(f.dir, { recursive: true, force: true })
})

test('PDF rendering runs as an owned durable job and persists a private artifact', async () => {
  const { createSheet } = await import('../src/services.ts'), { renderSheetPdf } = await import('../src/pdf.ts')
  const f = (await fixture()), sheet = await createSheet(f.db, f.owner, f.student), id = (await createJob(f.db, f.owner, f.student, 'pdf', { sheetId: sheet }, 'pdf-1'))
  await runNextJob(f.db, { pdf: (ctx, payload) => renderSheetPdf(f.db, f.dir, ctx, payload) })
  assert.equal((await ownedJob(f.db, f.owner, id)).status, 'succeeded')
  const bytes = (await import('node:fs')).readFileSync(join(f.dir, f.owner, `${id}.pdf`))
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF')
  assert.deepEqual(JSON.parse((await ownedJob(f.db, f.owner, id)).result!), { sheetId: sheet, file: true })
  f.db.close(); rmSync(f.dir, { recursive: true, force: true })
})
test('duplicate paper checks retain the first submission and commit each verdict once', async () => {
  const { createSheet, scoreSheet } = await import('../src/services.ts')
  const { db, owner, student } = (await fixture()), sheet = await createSheet(db, owner, student)
  const first = await scoreSheet(db, owner, sheet, [{ boxIndex: 1, answer: '4' }])
  const attempts = (await db.prepare('SELECT count(*) n FROM attempts WHERE student_id = ?').get(student))!.n
  const second = await scoreSheet(db, owner, sheet, [{ boxIndex: 1, answer: 'different answer' }])
  assert.deepEqual(second, first)
  assert.equal((await db.prepare('SELECT count(*) n FROM attempts WHERE student_id = ?').get(student))!.n, attempts)
  db.close()
})

test('teacher-result photos save atomically, retry once, stay private and preserve mastery', async () => {
  const f = await fixture()
  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='
  const input = { title: 'Synthetic marked quiz', date: '2026-10-02', earned: 8, possible: 10, requestId: 'result-photos', pages: [{ mime: 'image/png', base64: image }, { transcription: 'Synthetic marked page two' }] }
  try {
    const before = await listStates(f.db, f.student)
    const [result, retry] = await Promise.all([saveSchoolResult(f.db, f.owner, f.student, input, f.dir), saveSchoolResult(f.db, f.owner, f.student, input, f.dir)])
    assert.equal(result, retry)
    const row = (await f.db.prepare('SELECT * FROM school_results WHERE id = ?').get(result))!
    assert.equal(row.earned, 8); assert.equal(row.possible, 10); assert.match(String(row.provenance), /parent-entered teacher/)
    const material = (await f.db.prepare('SELECT * FROM materials WHERE id = ?').get(row.material_id))!
    assert.equal(material.kind, 'returned_test'); assert.equal(material.work_state, 'completed')
    assert.deepEqual((await f.db.prepare('SELECT position FROM material_pages WHERE material_id = ? ORDER BY position').all(material.id)).map(p => p.position), [1, 2])
    assert.equal((await f.db.prepare('SELECT count(*) n FROM school_results').get())!.n, 1)
    await assert.rejects(saveSchoolResult(f.db, f.owner, f.student, { ...input, earned: 9 }, f.dir), /already saved/)
    const sibling = await createStudent(f.db, f.owner, { displayName: 'Synthetic sibling', grade: 3, sessionCapMinutes: 5 })
    await assert.rejects(saveSchoolResult(f.db, f.owner, sibling, { ...input, pages: [], materialId: material.id }, f.dir), /another student/)
    const upload = (await f.db.prepare('SELECT upload_id FROM material_pages WHERE material_id = ? ORDER BY position').get(material.id))!
    await assert.rejects(saveSchoolResult(f.db, f.owner, sibling, { ...input, pages: [{ uploadId: upload.upload_id }] }, f.dir), /Photo not found/)
    assert.equal((await f.db.prepare('SELECT count(*) n FROM materials').get())!.n, 1)
    assert.deepEqual(await listStates(f.db, f.student), before)
    assert.equal((await f.db.prepare('SELECT count(*) n FROM attempts').get())!.n, 0)
    const exported = await exportFamily(f.db, f.owner, f.dir)
    assert.equal(exported.records.school_results[0].material_id, material.id)
    assert.equal(exported.records.uploads.length, 1)
    await deleteFamily(f.db, f.owner, f.dir)
    assert.equal((await f.db.prepare('SELECT count(*) n FROM school_results').get())!.n, 0)
    assert.equal((await f.db.prepare('SELECT count(*) n FROM uploads').get())!.n, 0)
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }) }
})
test('invalid scores and a failed score insert leave no result, pages or private files', async () => {
  const f = await fixture()
  const input = { title: 'Synthetic quiz', date: '2026-10-02', earned: 8, possible: 10, pages: [{ mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=' }] }
  try {
    for (const invalid of [{ earned: '' }, { earned: 11 }, { possible: 0 }, { date: '2026-02-30' }]) await assert.rejects(saveSchoolResult(f.db, f.owner, f.student, { ...input, ...invalid }, f.dir), /valid score/)
    f.db.exec("CREATE TRIGGER fail_result BEFORE INSERT ON school_results BEGIN SELECT RAISE(ABORT, 'Synthetic failed result'); END")
    await assert.rejects(saveSchoolResult(f.db, f.owner, f.student, input, f.dir), /Synthetic failed result/)
    for (const table of ['school_results', 'materials', 'material_pages', 'uploads', 'decision_records']) assert.equal((await f.db.prepare(`SELECT count(*) n FROM ${table}`).get())!.n, 0)
    const { readdirSync } = await import('node:fs')
    assert.equal(readdirSync(join(f.dir, f.owner)).length, 0)
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }) }
})
