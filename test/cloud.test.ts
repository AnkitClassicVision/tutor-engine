import { configureStudentAccess, studentLogin } from '../src/student-access.ts'
import { reserveUpload } from '../src/upload-reservations.ts'
import { sweepPrivateFiles } from '../src/file-erasures.ts'
import { saveSchoolResult } from '../src/schoolwork.ts'
import test from 'node:test'
// Backups are sealed; the suite uses its own synthetic backup key.
process.env.TUTOR_BACKUP_KEY ||= (await import('node:crypto')).randomBytes(32).toString('base64')
import { hashToken } from '../src/auth.ts'
import { throttleKey } from '../src/auth-throttle.ts'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { withPostgres, closePostgres, postgresSql } from '../src/postgres.ts'
import { sealAllFamilyData } from '../src/family-crypto.ts'
import { registerUser, openAuthSession, readAuthSession, loginUser } from '../src/auth.ts'
import { createStudent, startTutorSession, sessionItems, submitAnswer, reviewAnswer, assertStudent, listStates, saveUpload, getUpload, createSheet, scoreSheet } from '../src/services.ts'
import { withWrite } from '../src/transaction.ts'
import { createJob, runNextJob, ownedJob, changeJob } from '../src/jobs.ts'
import { exportFamily, deleteFamily, issueAccountToken, flushMail, requestRecovery, consumeAccountToken } from '../src/accounts.ts'
import { readPrivateFile, deletePrivateFile } from '../src/storage.ts'
import { createMaterial, materialDetails, correctMaterial, configureMaterialLearning, applySchoolLearning } from '../src/schoolwork.ts'
import { createUploadIntent, completeUpload } from '../src/direct-uploads.ts'
import { put as clientPut, getPayloadFromClientToken } from '@vercel/blob/client'
import { renderSheetPdf } from '../src/pdf.ts'
import { createCloudBackup, restoreCloudBackup, verifyCloudBackup } from '../src/cloud-backup.ts'
import { prepareLocalMigration } from '../src/local-migration.ts'
import { openDb } from '../src/db.ts'
import { decryptSecret } from '../src/secrets.ts'
import { smtpFixture } from './smtp-fixture.ts'

const cloud = process.env.TUTOR_TEST_CLOUD === '1'
// These isolated schemas contain fixtures only. Vercel exports redact secrets;
// use an independent fixture key and allow the migration's local key file.
if (cloud) {
  process.env.TUTOR_PUBLIC = '0'
  process.env.TUTOR_ENCRYPTION_KEY = randomBytes(32).toString('base64')
}
test('PostgreSQL binds parameters without changing quoted question marks', () => {
  assert.equal(postgresSql("SELECT '?', 'it''s ?' WHERE id = ? AND owner = ?"), "SELECT '?', 'it''s ?' WHERE id = $1 AND owner = $2")
  for (const field of ['subject', 'materialId', 'questionId']) {
    assert.equal(postgresSql(`SELECT id FROM jobs WHERE json_extract(payload, '$.${field}') = ?`), `SELECT id FROM jobs WHERE (payload::jsonb ->> '${field}') = $1`)
  }
})
test('local migration preserves the source and restores schoolwork and progress into Neon', { skip: !cloud }, async () => {
  const schema = `tutor_test_${crypto.randomUUID().replaceAll('-', '')}`
  const root = await mkdtemp(join(tmpdir(), 'tutor-migration-test-'))
  const uploads = join(root, 'uploads'), source = join(root, 'source.sqlite')
  const previous = { storage: process.env.TUTOR_STORAGE, secret: process.env.TUTOR_SECRET_DIR, key: process.env.TUTOR_ENCRYPTION_KEY }
  process.env.TUTOR_STORAGE = 'local'; process.env.TUTOR_SECRET_DIR = root; delete process.env.TUTOR_ENCRYPTION_KEY
  const scoped = <T>(fn: Parameters<typeof withPostgres<T>>[0]) => withPostgres(async db => { await db.exec(`SET search_path TO ${schema}`); return fn(db) })
  const local = openDb(source)
  try {
    const user = await registerUser(local, `synthetic-${crypto.randomUUID()}@example.invalid`, 'synthetic-parent-password')
    assert.ok(user.ok)
    const student = await createStudent(local, user.userId, { displayName: 'Synthetic migration learner', grade: 4, sessionCapMinutes: 5 })
    const session = await startTutorSession(local, user.userId, student, new Date(), { durationMinutes: 3 })
    const item = (await sessionItems(local, session))[0]
    const submitted = await submitAnswer(local, user.userId, session, { itemId: String(item.id), answer: String(item.answer), timeMs: 1000 })
    if ('pendingReview' in submitted && submitted.pendingReview) await reviewAnswer(local, user.userId, session, { itemId: String(item.id), correct: true, grader: 'synthetic test fixture' })
    const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='
    await saveUpload(local, user.userId, student, { base64: image, mime: 'image/png' }, uploads)
    await local.prepare('UPDATE users SET ai_key = ? WHERE id = ?').run('synthetic-legacy-credential', user.userId)
    const job = await createJob(local, user.userId, student, 'grade', { sessionId: session }, 'synthetic-migration-job')
    const backup = join(root, 'backup')
    const prepared = await prepareLocalMigration(source, uploads, backup, root)
    assert.equal(prepared.students, 1); assert.equal(prepared.attempts, 1); assert.equal(prepared.filesVerified, 1)
    assert.equal((await ownedJob(local, user.userId, job)).status, 'queued')
    assert.equal((await local.prepare('SELECT count(*) n FROM attempts').get())?.n, 1)
    assert.equal((await local.prepare('SELECT ai_key FROM users WHERE id = ?').get(user.userId))?.ai_key, 'synthetic-legacy-credential')
    // Rehearse the pre-journey schema found in the real local store as well.
    const { backup: sqliteBackup, DatabaseSync } = await import('node:sqlite')
    const legacyPath = join(root, 'legacy.sqlite'); await sqliteBackup(local, legacyPath)
    const legacy = new DatabaseSync(legacyPath)
    legacy.exec('PRAGMA foreign_keys = OFF')
    for (const table of ['jobs', 'materials', 'material_pages', 'material_questions', 'homework_reviews', 'guided_attempts', 'school_results', 'followup_missions', 'path_revisions', 'oauth_states', 'account_tokens', 'mail_outbox']) legacy.exec(`DROP TABLE ${table}`)
    legacy.close()
    const legacyPrepared = await prepareLocalMigration(legacyPath, uploads, join(root, 'legacy-backup'), root)
    assert.equal(legacyPrepared.students, 1); assert.equal(legacyPrepared.attempts, 1)
    const originalLegacy = new DatabaseSync(legacyPath, { readOnly: true })
    assert.equal(originalLegacy.prepare("SELECT name FROM sqlite_master WHERE name = 'jobs'").get(), undefined)
    originalLegacy.close()
    process.env.TUTOR_STORAGE = 'blob'
    await withPostgres(async db => { await db.exec(`CREATE SCHEMA ${schema}`) })
    await scoped(async db => {
      for (const file of ['001-postgres.sql', '002-upload-intents.sql', '003-school-learning.sql', '004-school-result-requests.sql', '005-student-access.sql', '006-feedback-flow.sql', '007-parent-planner.sql', '008-learning-packs.sql', '009-chatgpt-plan.sql', '010-panel-round-2.sql', '011-hardening.sql', '012-worlds.sql', '013-student-link-hash.sql', '014-family-keys.sql', '015-runbook-runs.sql', '016-evidence-ladder.sql', '017-subject-maps.sql', '018-changed-minds.sql', '019-grading-audits.sql', '020-grading-doubt.sql', '021-rubrics.sql', '022-ux-workflows.sql', '023-ai-health.sql']) await db.exec(await readFile(new URL(`../src/migrations/${file}`, import.meta.url), 'utf8'))
      await restoreCloudBackup(db, join(backup, 'cloud-import'), uploads)
      assert.equal((await sessionItems(db, session))[0].answered, 1)
      assert.equal((await ownedJob(db, user.userId, job)).status, 'cancelled')
      const credential = String((await db.prepare('SELECT ai_key FROM users WHERE id = ?').get(user.userId))?.ai_key)
      assert.ok(credential.startsWith('enc:v2:')); assert.equal(decryptSecret(credential), 'synthetic-legacy-credential')
      const file = await db.prepare('SELECT stored_path FROM uploads LIMIT 1').get()
      assert.deepEqual(await readPrivateFile(String(file?.stored_path), uploads), Buffer.from(image, 'base64'))
    })
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(new URL('../evidence/', import.meta.url), { recursive: true })
    await writeFile(new URL('../evidence/cloud-restore.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), fixture: 'synthetic only', backend: 'Neon and private Vercel Blob', cloudBackupRestore: 'passed', recordsAndFileChecksums: 'passed', emptyDestinationGuard: 'passed', restoredProgressAndAuth: 'passed', independentRestoredFiles: 'passed', sqliteMigrationSourcePreserved: 'passed', legacyCredentialEncryption: 'passed', pendingJobsRequireRetry: 'passed' }, null, 2) + '\n')
  } finally {
    process.env.TUTOR_STORAGE = 'blob'
    await withPostgres(async db => {
      if (!(await db.prepare('SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?').get(schema))) return
      await db.exec(`SET search_path TO ${schema}`)
      for (const user of await db.prepare('SELECT id FROM users').all()) await deleteFamily(db, String(user.id), uploads)
      await db.exec(`DROP SCHEMA ${schema} CASCADE`)
    })
    local.close(); await rm(root, { recursive: true, force: true }); await closePostgres()
    for (const [key, value] of Object.entries({ TUTOR_STORAGE: previous.storage, TUTOR_SECRET_DIR: previous.secret, TUTOR_ENCRYPTION_KEY: previous.key })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  }
})
test('Neon preserves progress across connections, fences job commits, and isolates families', { skip: !cloud }, async () => {
  const schema = `tutor_test_${crypto.randomUUID().replaceAll('-', '')}`
  const restoredSchema = `${schema}_restored`
  const dir = await mkdtemp(join(tmpdir(), 'tutor-cloud-test-'))
  const sql = await readFile(new URL('../src/migrations/001-postgres.sql', import.meta.url), 'utf8')
  const scoped = <T>(fn: Parameters<typeof withPostgres<T>>[0]) => withPostgres(async db => {
    await db.exec(`SET search_path TO ${schema}`)
    return fn(db)
  })
  try {
    await withPostgres(async db => { await db.exec(`CREATE SCHEMA ${schema}`) })
    await scoped(async db => { await db.exec(sql); await db.exec(await readFile(new URL('../src/migrations/002-upload-intents.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/003-school-learning.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/004-school-result-requests.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/005-student-access.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/006-feedback-flow.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/007-parent-planner.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/008-learning-packs.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/009-chatgpt-plan.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/010-panel-round-2.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/011-hardening.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/012-worlds.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/013-student-link-hash.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/014-family-keys.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/015-runbook-runs.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/016-evidence-ladder.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/017-subject-maps.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/018-changed-minds.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/019-grading-audits.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/020-grading-doubt.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/021-rubrics.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/022-ux-workflows.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../src/migrations/023-ai-health.sql', import.meta.url), 'utf8')) })
    const fixture = await scoped(async db => {
      const a = await registerUser(db, `synthetic-${crypto.randomUUID()}@example.invalid`, 'synthetic-parent-password')
      const b = await registerUser(db, `synthetic-${crypto.randomUUID()}@example.invalid`, 'synthetic-parent-password')
      assert.ok(a.ok); assert.ok(b.ok)
      const student = await createStudent(db, a.userId, { displayName: 'Synthetic cloud learner', grade: 4, sessionCapMinutes: 10 })
      // Stored sealed for the family, read back plain.
      assert.equal(Number((await db.prepare("SELECT position('fam:v1:' in display_name) AS p FROM students WHERE id = ?").get(student))?.p), 1)
      assert.equal((await assertStudent(db, a.userId, student)).display_name, 'Synthetic cloud learner')
      const auth = await openAuthSession(db, a.userId)
      const session = await startTutorSession(db, a.userId, student, new Date(), { durationMinutes: 3 })
      const item = (await sessionItems(db, session))[0]
      const submitted = await submitAnswer(db, a.userId, session, { itemId: String(item.id), answer: String(item.answer), timeMs: 1000 })
      if ('pendingReview' in submitted && submitted.pendingReview) await reviewAnswer(db, a.userId, session, { itemId: String(item.id), correct: true, grader: 'synthetic test fixture' })
      await assert.rejects(assertStudent(db, b.userId, student), /not found/)
      return { owner: a.userId, other: b.userId, student, session, token: auth.token, item }
    })
    await scoped(async db => {
      assert.equal((await readAuthSession(db, fixture.token))?.userId, fixture.owner)
      assert.ok((await sessionItems(db, fixture.session))[0].answered)
      assert.ok((await listStates(db, fixture.student)).some(s => s.mastery > 0))
      const before = await db.prepare('SELECT count(*) n FROM attempts').get()
      assert.equal(before?.n, 1)
      await submitAnswer(db, fixture.owner, fixture.session, { itemId: String(fixture.item.id), answer: 'different', timeMs: 5000 })
      assert.equal((await db.prepare('SELECT count(*) n FROM attempts').get())?.n, before?.n)
      await assert.rejects(withWrite(db, async () => {
        await createStudent(db, fixture.owner, { displayName: 'Synthetic rolled back', grade: 3, sessionCapMinutes: 5 })
        throw new Error('synthetic rollback')
      }), /synthetic rollback/)
      assert.equal((await db.prepare('SELECT count(*) n FROM students').get())?.n, 1)
      const material = await createMaterial(db, fixture.owner, fixture.student, { kind: 'homework', workState: 'partial', transcription: 'Synthetic schoolwork', title: 'Synthetic', requestId: 'synthetic-material' }, dir)
      assert.equal(await createMaterial(db, fixture.owner, fixture.student, { kind: 'homework', workState: 'partial', transcription: 'Synthetic schoolwork', title: 'Synthetic', requestId: 'synthetic-material' }, dir), material)
      const details = await materialDetails(db, fixture.owner, material)
      await correctMaterial(db, fixture.owner, material, details.pages.map(p => ({ id: p.id, transcription: 'Synthetic correction' })))
      assert.equal((await materialDetails(db, fixture.owner, material)).material.revision, 2)
      const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
      const source = await configureMaterialLearning(db, fixture.owner, material, { purpose: 'test', testTitle: 'Synthetic dated test', testDate: date })
      const states = await listStates(db, fixture.student)
      await assert.rejects(configureMaterialLearning(db, fixture.other, material, { purpose: 'learning' }), /not found/)
      assert.equal(await applySchoolLearning(db, fixture.owner, source, [String(fixture.item.concept_id)]), true)
      assert.deepEqual(await listStates(db, fixture.student), states)
      assert.equal((await materialDetails(db, fixture.owner, material)).material.learning_applied_revision, 2)
      assert.equal((await db.prepare("SELECT count(*) n FROM targets WHERE student_id = ? AND kind = 'target'").get(fixture.student))?.n, 1)

      if (process.env.TUTOR_STORAGE === 'blob') {
        const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')
        const ticket = await createUploadIntent(db, fixture.owner, fixture.student, 'image/png')
        const claims = getPayloadFromClientToken(ticket.token)
        assert.equal(claims.maximumSizeInBytes, 15_000_000)
        assert.deepEqual(claims.allowedContentTypes, ['image/png'])
        assert.equal(claims.allowOverwrite, false)
        const blob = await clientPut(ticket.pathname, image, { access: 'private', token: ticket.token, contentType: 'image/png' })
        assert.equal(await completeUpload(db, fixture.owner, fixture.student, ticket.id, dir), ticket.id)
        assert.equal(await completeUpload(db, fixture.owner, fixture.student, ticket.id, dir), ticket.id)
        await assert.rejects(completeUpload(db, fixture.other, fixture.student, ticket.id, dir), /not found/)
        assert.equal(await getUpload(db, fixture.other, ticket.id), undefined)
        const stored = await getUpload(db, fixture.owner, ticket.id)
        assert.deepEqual(await readPrivateFile(stored!.stored_path, dir), image)
        const anonymous = await fetch(blob.url)
        assert.ok([401, 403].includes(anonymous.status)); await anonymous.body?.cancel()
        const photoMaterial = await createMaterial(db, fixture.owner, fixture.student, { kind: 'homework', workState: 'blank', title: 'Synthetic private photo', pages: [{ uploadId: ticket.id }] }, dir)
        assert.equal((await materialDetails(db, fixture.owner, photoMaterial)).pages[0].upload_id, ticket.id)
      }
      const sheet = await createSheet(db, fixture.owner, fixture.student)
      const scored = await scoreSheet(db, fixture.owner, sheet, [{ boxIndex: 1, answer: '4' }])
      assert.deepEqual(await scoreSheet(db, fixture.owner, sheet, [{ boxIndex: 1, answer: 'another' }]), scored)
      const pdf = await createJob(db, fixture.owner, fixture.student, 'pdf', { sheetId: sheet }, 'synthetic-pdf')
      await runNextJob(db, { pdf: (ctx, payload) => renderSheetPdf(db, dir, ctx, payload) })
      assert.equal((await ownedJob(db, fixture.owner, pdf)).status, 'succeeded')
      if (process.env.TUTOR_STORAGE === 'blob') {
        const result = JSON.parse((await ownedJob(db, fixture.owner, pdf)).result!)
        assert.equal((await readPrivateFile(result.storedPath, dir)).subarray(0, 4).toString(), '%PDF')
      }
      const failing = await createJob(db, fixture.owner, fixture.student, 'rollback', {}, 'synthetic-rollback')
      await runNextJob(db, { rollback: async ctx => { await ctx.commit(async () => {
        await createStudent(db, fixture.owner, { displayName: 'Synthetic job rollback', grade: 4, sessionCapMinutes: 5 })
        throw new Error('synthetic job rollback')
      }) } })
      assert.equal((await ownedJob(db, fixture.owner, failing)).status, 'failed')
      assert.equal((await db.prepare('SELECT count(*) n FROM students').get())?.n, 1)
    })
    // Two independent workers must claim different jobs even when they race.
    const duplicates = await Promise.all([1, 2].map(() => scoped(db => createJob(db, fixture.owner, fixture.student, 'race', {}, 'synthetic-race-1'))))
    assert.equal(duplicates[0], duplicates[1])
    await scoped(async db => {
      await createJob(db, fixture.owner, fixture.student, 'race', {}, 'synthetic-race-2')
    })
    const seen = new Set<string>()
    await Promise.all([1, 2].map(() => scoped(async db => {
      await runNextJob(db, { race: async ctx => {
        assert.ok(!seen.has(ctx.job.id)); seen.add(ctx.job.id)
        await new Promise(resolve => setTimeout(resolve, 50))
        await ctx.commit(async () => { await db.prepare('UPDATE students SET last_duration = 3 WHERE id = ?').run(fixture.student) })
      } })
    })))
    assert.equal(seen.size, 2)
    // Admission and authentication race through independent pool connections.
    const budget = await scoped(async db => {
      const email = `synthetic-budget-${crypto.randomUUID()}@example.invalid`
      const user = await registerUser(db, email, 'synthetic-parent-password'); assert.ok(user.ok)
      const student = await createStudent(db, user.userId, { displayName: 'Synthetic budget learner', grade: 4, sessionCapMinutes: 10 })
      const code = await configureStudentAccess(db, user.userId, student, '246810')
      return { owner: user.userId, student, email, code }
    })
    // Fifty wrong guesses race; only five may reach verification, and the correct secret is then refused too.
    const parentTries = await Promise.all(Array.from({ length: 50 }, () => scoped(db => loginUser(db, budget.email, 'wrong-synthetic-guess', new Date(), 5, 'synthetic-parent-source'))))
    assert.equal(parentTries.filter(r => !/Too many/.test(String(r.error))).length, 5)
    assert.equal((await scoped(db => loginUser(db, budget.email, 'synthetic-parent-password', new Date(), 5, 'synthetic-parent-source'))).ok, false)
    await Promise.all(Array.from({ length: 50 }, () => scoped(db => studentLogin(db, budget.code, '135791', new Date(), 'synthetic-pin-source'))))
    await scoped(async db => { assert.equal(Number((await db.prepare('SELECT count FROM auth_throttle WHERE key = ?').get(throttleKey('student', hashToken(budget.code))))!.count), 5) })
    assert.equal(await scoped(db => studentLogin(db, budget.code, '246810', new Date(), 'synthetic-pin-source')), null)
    await Promise.all(Array.from({ length: 50 }, () => scoped(db => requestRecovery(db, budget.email, 'synthetic-recovery-source'))))
    await scoped(async db => { assert.equal((await db.prepare("SELECT count(*) n FROM mail_outbox WHERE user_id = ? AND kind = 'recover'").get(budget.owner))!.n, 1) })
    const resetLinks = await scoped(async db => {
      await issueAccountToken(db, budget.owner, 'recover')
      return (await db.prepare("SELECT message FROM mail_outbox WHERE user_id = ? AND kind = 'recover' ORDER BY rowid").all(budget.owner)).map(row => new URL(JSON.parse(decryptSecret(String(row.message))).url).searchParams.get('token')!)
    })
    const resets = await Promise.allSettled(resetLinks.map(token => scoped(db => consumeAccountToken(db, token, 'recover', 'new-synthetic-password'))))
    assert.equal(resets.filter(r => r.status === 'fulfilled').length, 1)
    await scoped(async db => {
      assert.equal((await db.prepare('SELECT count(*) n FROM auth_sessions WHERE user_id = ?').get(budget.owner))!.n, 0)
      for (const token of resetLinks) await assert.rejects(consumeAccountToken(db, token, 'recover', 'other-synthetic-password'), /expired|used/)
    })
    const jobAdmissions = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => scoped(db => createJob(db, budget.owner, budget.student, 'synthetic-paid', {}, `budget-${i}`))))
    assert.equal(jobAdmissions.filter(r => r.status === 'fulfilled').length, 20)
    await scoped(async db => {
      await db.prepare("UPDATE jobs SET status = 'succeeded' WHERE owner_user_id = ?").run(budget.owner)
      for (let i = 40; i < 50; i++) {
        const id = await createJob(db, budget.owner, budget.student, 'synthetic-paid', {}, `budget-${i}`)
        await db.prepare("UPDATE jobs SET status = 'succeeded' WHERE id = ?").run(id)
      }
      await assert.rejects(createJob(db, budget.owner, budget.student, 'synthetic-paid', {}, 'over-hour'), /hour/)
      const id = (await db.prepare('SELECT id FROM jobs WHERE owner_user_id = ? LIMIT 1').get(budget.owner))!.id
      await db.prepare("UPDATE jobs SET status = 'failed', attempts = 3 WHERE id = ?").run(id)
      await assert.rejects(changeJob(db, budget.owner, String(id), 'retry'), /retry/)
    })
    const tickets = await Promise.allSettled(Array.from({ length: 20 }, () => scoped(db => {
      const id = crypto.randomUUID()
      return reserveUpload(db, budget.owner, budget.student, id, `blob:families/${budget.owner}/uploads/${id}.png`, 'image/png')
    })))
    assert.equal(tickets.filter(r => r.status === 'fulfilled').length, 12)
    await scoped(async db => {
      const noop = async () => {}
      await db.prepare('UPDATE upload_intents SET expires_at = ? WHERE owner_user_id = ?').run(new Date(Date.now() - 3600000).toISOString(), budget.owner)
      await sweepPrivateFiles(db, dir, noop)
      assert.equal((await db.prepare('SELECT count(*) n FROM upload_intents WHERE owner_user_id = ?').get(budget.owner))!.n, 0)
      await deleteFamily(db, budget.owner, dir, noop)
    })
    const smtp = await smtpFixture(), previousMail = { url: process.env.TUTOR_SMTP_URL, from: process.env.TUTOR_MAIL_FROM, provider: process.env.TUTOR_MAIL_PROVIDER }
    try {
      process.env.TUTOR_SMTP_URL = smtp.url; process.env.TUTOR_MAIL_FROM = 'Synthetic Tutor <fixture@example.invalid>'; process.env.TUTOR_MAIL_PROVIDER = 'smtp'
      await scoped(db => issueAccountToken(db, fixture.owner, 'verify'))
      await Promise.all([1, 2].map(() => scoped(db => flushMail(db, 1))))
      assert.equal(smtp.messages.length, 1)
      assert.match(smtp.messages[0], /Verify your Tutor family account/)
      await scoped(async db => { assert.equal((await db.prepare('SELECT count(*) n FROM mail_outbox WHERE sent_at IS NOT NULL AND message = ?').get(''))?.n, 1) })
    } finally {
      await smtp.close()
      for (const [key, value] of Object.entries({ TUTOR_SMTP_URL: previousMail.url, TUTOR_MAIL_FROM: previousMail.from, TUTOR_MAIL_PROVIDER: previousMail.provider })) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    }
    await scoped(async db => {
      const sheet = await createSheet(db, fixture.owner, fixture.student)
      const cancelledPdf = await createJob(db, fixture.owner, fixture.student, 'pdf', { sheetId: sheet }, 'synthetic-pdf-cancel-after-save')
      await runNextJob(db, { pdf: (ctx, payload) => renderSheetPdf(db, dir, { ...ctx, commit: async fn => {
        const committed = await ctx.commit(fn)
        await scoped(other => changeJob(other, fixture.owner, ctx.job.id, 'cancel'))
        return committed
      } }, payload) })
      const savedPdf = await ownedJob(db, fixture.owner, cancelledPdf)
      assert.equal(savedPdf.status, 'cancelled')
      assert.ok(JSON.parse(savedPdf.result!).storedPath)
      const job = await createJob(db, fixture.owner, fixture.student, 'cancel', {}, 'synthetic-cancel')
      await runNextJob(db, { cancel: async ctx => {
        await scoped(other => changeJob(other, fixture.owner, ctx.job.id, 'cancel'))
        assert.equal(await ctx.commit(() => { throw new Error('stale commit executed') }), false)
      } })
      assert.equal((await ownedJob(db, fixture.owner, job)).status, 'cancelled')
      const scoreInput = { requestId: 'synthetic-score', title: 'Synthetic teacher result', date: '2026-10-02', earned: 8, possible: 10, pages: [{ mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=' }] }
      const score = await saveSchoolResult(db, fixture.owner, fixture.student, scoreInput, dir)
      assert.equal(await saveSchoolResult(db, fixture.owner, fixture.student, scoreInput, dir), score)
      const scoredMaterial = (await db.prepare('SELECT material_id FROM school_results WHERE id = ?').get(score))!.material_id
      assert.equal((await materialDetails(db, fixture.owner, String(scoredMaterial))).material.kind, 'returned_test')
      await assert.rejects(saveSchoolResult(db, fixture.other, fixture.student, scoreInput, dir), /not found/)
      const backup = join(dir, 'backup')
      const snapshot = await createCloudBackup(db, backup, dir)
      assert.equal(snapshot.tables.students.length, 1)
      assert.ok(Object.keys(snapshot.files).length >= 1)
      assert.equal((await db.prepare('SELECT current_schema() AS name').get())?.name, schema)
      const restored = <T>(fn: Parameters<typeof withPostgres<T>>[0]) => withPostgres(async other => {
        await other.exec(`SET search_path TO ${restoredSchema}`)
        return fn(other)
      })
      await withPostgres(async other => { await other.exec(`CREATE SCHEMA ${restoredSchema}`) })
      await restored(async other => {
        await other.exec(sql)
        await other.exec(await readFile(new URL('../src/migrations/002-upload-intents.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/003-school-learning.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/004-school-result-requests.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/005-student-access.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/006-feedback-flow.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/007-parent-planner.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/008-learning-packs.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/009-chatgpt-plan.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/010-panel-round-2.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/011-hardening.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/012-worlds.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/013-student-link-hash.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/014-family-keys.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/015-runbook-runs.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/016-evidence-ladder.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/017-subject-maps.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/018-changed-minds.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/019-grading-audits.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/020-grading-doubt.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/021-rubrics.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/022-ux-workflows.sql', import.meta.url), 'utf8')); await other.exec(await readFile(new URL('../src/migrations/023-ai-health.sql', import.meta.url), 'utf8'))
        const report = await restoreCloudBackup(other, backup, dir)
        assert.equal(report.students, 1)
        // The restored family gets a fresh key and its data is sealed again.
        assert.ok((await sealAllFamilyData(other)) >= 1)
        assert.equal(Number((await other.prepare("SELECT position('fam:v1:' in display_name) AS p FROM students WHERE id = ?").get(fixture.student))?.p), 1)
        assert.equal((await assertStudent(other, fixture.owner, fixture.student)).display_name, 'Synthetic cloud learner')
        const restoredScore = (await other.prepare('SELECT * FROM school_results WHERE id = ?').get(score))!
        assert.equal(restoredScore.material_id, scoredMaterial); assert.equal(restoredScore.earned, 8)
        assert.equal(await saveSchoolResult(other, fixture.owner, fixture.student, scoreInput, dir), score)
        assert.equal((await materialDetails(other, fixture.owner, String(scoredMaterial))).pages.length, 1)
        const source = await other.prepare("SELECT * FROM materials WHERE test_title = 'Synthetic dated test'").get()
        assert.equal(source?.learning_purpose, 'test'); assert.equal(source?.learning_applied_revision, 2)
        assert.equal((await other.prepare('SELECT deadline FROM targets WHERE id = ?').get(source!.learning_target_id))?.deadline, source?.test_date)

        assert.equal((await sessionItems(other, fixture.session))[0].answered, 1)
        assert.ok((await listStates(other, fixture.student)).some(s => s.mastery > 0))
        assert.equal((await readAuthSession(other, fixture.token))?.userId, fixture.owner)
        assert.equal((await other.prepare('SELECT current_schema() AS name').get())?.name, restoredSchema)
        assert.equal((await db.prepare('SELECT current_schema() AS name').get())?.name, schema)
        const restoredFile = await other.prepare('SELECT stored_path FROM uploads LIMIT 1').get()
        const sourceFile = await db.prepare('SELECT stored_path FROM uploads LIMIT 1').get()
        assert.notEqual(restoredFile?.stored_path, sourceFile?.stored_path)
        assert.deepEqual(await readPrivateFile(String(restoredFile?.stored_path), dir), await readPrivateFile(String(sourceFile?.stored_path), dir))
        await assert.rejects(restoreCloudBackup(other, backup, dir), /empty destination/)
        await deleteFamily(other, fixture.owner, dir)
        await deleteFamily(other, fixture.other, dir)
      })
      const records = join(backup, 'records.json')
      const { writeFile, mkdir } = await import('node:fs/promises')
      await mkdir(new URL('../evidence/', import.meta.url), { recursive: true })
      const original = await readFile(records)
      await writeFile(records, Buffer.concat([original, Buffer.from('corrupt')]))
      await assert.rejects(verifyCloudBackup(backup), /checksum/)
      await writeFile(records, original)
      const exported = await exportFamily(db, fixture.owner, dir)
      assert.equal(exported.records.students.length, 1)
      await deleteFamily(db, fixture.owner, dir)
      assert.equal((await db.prepare('SELECT count(*) n FROM students').get())?.n, 0)
      await deleteFamily(db, fixture.other, dir)
      assert.equal((await db.prepare('SELECT count(*) n FROM users').get())?.n, 0)
    })
    const evidence = new URL('../evidence/cloud-restore.json', import.meta.url)
    const report = JSON.parse(await readFile(evidence, 'utf8'))
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(new URL('../evidence/', import.meta.url), { recursive: true })
    await writeFile(evidence, JSON.stringify({ ...report, checkedAt: new Date().toISOString(), schoolSourceIntentDateAndTargetRestore: 'passed', schoolResultPhotoLinkAndRetryRestore: 'passed' }, null, 2) + '\n')
  } finally {
    for (const target of [schema, restoredSchema]) await withPostgres(async db => {
      const exists = await db.prepare('SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?').get(target)
      if (!exists) return
      await db.exec(`SET search_path TO ${target}`)
      for (const user of await db.prepare('SELECT id FROM users').all()) await deleteFamily(db, String(user.id), dir)
      await db.exec(`DROP SCHEMA ${target} CASCADE`)
    })
    await rm(dir, { recursive: true, force: true })
    await closePostgres()
  }
})
