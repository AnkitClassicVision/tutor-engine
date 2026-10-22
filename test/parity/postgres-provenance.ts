// Explicit isolated test infrastructure. No DSN argument, env file, existing server or cloud resource is accepted.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Pool } from 'pg'
import { PostgresDatabase } from '../../src/postgres.ts'
import { POSTGRES_MIGRATIONS } from '../../src/migrations.ts'
import { openDb } from '../../src/db.ts'
import { migrateJourney } from '../../src/journey-db.ts'
import { cutoverLearningEvidence } from '../../src/evidence-cutover.ts'
import { adventureFor, listStates, loadAttempts, reviewAnswer, submitAnswer, acknowledgeFeedback, createStudent, createTarget, nextLearningAction, startTutorSession, sessionItems, finishAssessment, createSheet, getSheet, scoreSheet, pauseSession } from '../../src/services.ts'
import { freshEvidence, masteryMet } from '../../src/engine/mastery.ts'
import { retentionChecks, retentionPairs } from '../../src/engine/evidence.ts'
import { applicationTables } from '../../src/cloud-backup.ts'
import { evidenceId, evidenceAnswer, evidenceItem } from '../fixtures/evidence-history.ts'
import type { Database } from '../../src/database.ts'
import { acknowledgeAnswer, acknowledgeSaveVisible } from '../../src/turn-state.ts'
import { learningNow, withLearningClock } from '../../src/learning-clock.ts'
import { recordExposure } from '../../src/learning-exposure.ts'
import { taskMatches } from '../../src/task-evidence.ts'
import { independent } from '../../src/engine/mastery.ts'
import type { Item } from '../../src/engine/types.ts'

assert.equal(process.argv[2], '--isolated-local', 'Use the explicit isolated local parity command.')
for (const key of ['DATABASE_URL','DATABASE_URL_UNPOOLED','TUTOR_APP_DATABASE_URL','PGHOST','PGDATABASE','PGSERVICE'])
  assert.ok(!process.env[key], `${key} must be unset: this harness never accepts an existing database connection.`)
assert.notEqual(process.getuid?.(), 0, 'Run the disposable cluster as an unprivileged local user.')
const directory = await mkdtemp('/var/tmp/tutor-evidence-parity-')
const cluster = join(directory, 'cluster'), socket = join(directory, 'socket')
await mkdir(socket, { mode: 0o700 })
const localEnv = { PATH: process.env.PATH, LANG: 'C.UTF-8' }
function command(program: string, args: string[]) {
  const result = spawnSync(program, args, { env: localEnv, encoding: 'utf8', timeout: 45_000 })
  if (result.status !== 0) throw new Error(`${program} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`)
}
const owner = evidenceId('parity-owner'), student = evidenceId('parity-student')
const date = (day: number) => new Date(`2026-10-${String(day).padStart(2,'0')}T12:00:00Z`)
async function seed(db: Database) {
  await db.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').run(owner, 'isolated-parity@example.invalid', 'synthetic-unused-hash', date(1).toISOString())
  await db.prepare('INSERT INTO students (id,owner_user_id,display_name,grade,session_cap_minutes,created_at) VALUES (?,?,?,?,?,?)').run(student, owner, 'Synthetic parity learner', 3, 25, date(1).toISOString())
  for (const day of [1,2,3]) await evidenceAnswer(db, owner, student, `historical-earned-${day}`, date(day), { legacy: true, mixed: true })
  for (const day of [1,2]) await evidenceAnswer(db, owner, student, `historical-pending-${day}`, date(day), { legacy: true, mixed: true, concept: 'math.primary.1.subtract' })
  const pending = await evidenceItem(db, student, 'historical-open-review', date(3), { legacy: true, pending: true, level: 3 })
  await db.prepare("UPDATE session_items SET answered=1, given_answer='Synthetic reasons', submitted_at=? WHERE id=?").run(date(3).toISOString(), pending.id)
  const draft = await evidenceItem(db, student, 'historical-open-draft', date(3), { legacy: true, mode: 'session' })
  await db.prepare("UPDATE session_items SET draft_answer='Synthetic saved draft' WHERE id=?").run(draft.id)
}
async function exercise(db: Database) {
  assert.equal((await db.prepare('SELECT evidence_policy FROM students WHERE id=?').get(student))!.evidence_policy, null, 'migration does not silently cut over existing learners')
  const before = await listStates(db, student, date(4)), milestones = await adventureFor(db, owner, student)
  await cutoverLearningEvidence(db, owner, student, 'isolated-parity-cutover', date(4))
  assert.deepEqual(await listStates(db, student, date(4)), before)
  assert.deepEqual(await adventureFor(db, owner, student), milestones)
  const receipt = await db.prepare('SELECT states_json, milestones_json, created_at FROM learning_cutovers WHERE student_id=?').get(student)
  await cutoverLearningEvidence(db, owner, student, 'isolated-repeat-cutover', date(5))
  assert.deepEqual(await db.prepare('SELECT states_json, milestones_json, created_at FROM learning_cutovers WHERE student_id=?').get(student), receipt)
  assert.equal((await db.prepare('SELECT draft_answer FROM session_items WHERE id=?').get(evidenceId('historical-open-draft')))!.draft_answer, 'Synthetic saved draft')
  const openDraft = (await db.prepare('SELECT * FROM session_items WHERE id=?').get(evidenceId('historical-open-draft')))!
  await withLearningClock(() => date(5), async () => {
    await assert.rejects(() => pauseSession(db, owner, String(openDraft.session_id), { itemId: String(openDraft.id), revision: 'stale', answer: 'Rejected draft' }))
    assert.equal((await db.prepare('SELECT paused_at FROM tutor_sessions WHERE id=?').get(openDraft.session_id))!.paused_at, null)
    await pauseSession(db, owner, String(openDraft.session_id), { itemId: String(openDraft.id), revision: String(openDraft.revision_id), answer: 'Synthetic native pause draft' })
  })
  const nativePause = { draft: (await sessionItems(db, String(openDraft.session_id)))[0].draft_answer,
    pausedAt: (await db.prepare('SELECT paused_at FROM tutor_sessions WHERE id=?').get(openDraft.session_id))!.paused_at }
  assert.equal(nativePause.draft, 'Synthetic native pause draft'); assert.equal(nativePause.pausedAt, date(5).toISOString())
  const pending = await db.prepare('SELECT * FROM session_items WHERE id=?').get(evidenceId('historical-open-review'))
  await reviewAnswer(db, owner, String(pending!.session_id), { itemId: String(pending!.id), correct: true }, date(5))
  await reviewAnswer(db, owner, String(pending!.session_id), { itemId: String(pending!.id), correct: true }, date(5))
  await evidenceAnswer(db, owner, student, 'post-cutover-old-writer', date(5), { legacy: true, mixed: true, concept: 'math.primary.1.subtract' })
  assert.equal(masteryMet((await loadAttempts(db, student)).filter(a => a.conceptId === 'math.primary.1.subtract'), 2), false)
  const partner = await evidenceItem(db, student, 'new-partner', date(6), { mode: 'session' })
  const target = await evidenceItem(db, student, 'new-target', new Date(date(6).getTime()+5000), { mode: 'session', concept: 'math.primary.1.subtract', session: String(partner.session_id), position: 2 })
  await submitAnswer(db, owner, String(partner.session_id), { itemId: String(partner.id), answer: '4' }, new Date(date(6).getTime()+1000))
  await acknowledgeFeedback(db, owner, String(partner.session_id))
  await submitAnswer(db, owner, String(target.session_id), { itemId: String(target.id), answer: '4', confidence: 'sure', activeMs: 5500 }, new Date(date(6).getTime()+6000))
  await submitAnswer(db, owner, String(target.session_id), { itemId: String(target.id), answer: 'retry' }, new Date(date(6).getTime()+7000))
  await acknowledgeAnswer(db, String(target.session_id), String(target.id), new Date(date(6).getTime()+8000))
  await acknowledgeSaveVisible(db, String(target.session_id), String(target.id), String(target.revision_id), 2300)
  const timing = await db.prepare('SELECT answer_saved_at, submit_to_save_ms, active_work_ms, graded_at, grading_started_at, grading_finished_at FROM session_items WHERE id = ?').get(target.id)
  assert.equal(timing!.active_work_ms, 5500); assert.equal(timing!.submit_to_save_ms, 2300)
  await evidenceAnswer(db, owner, student, 'delayed-independent', date(15), { concept: 'math.primary.1.subtract' })
  const attempts = await loadAttempts(db, student)
  assert.ok(masteryMet(attempts.filter(a => a.conceptId === 'math.primary.1.subtract'), 2))
  assert.equal(attempts.find(a => a.attemptId === target.id)!.mixed!.partnerRevision, partner.revision_id)
  assert.ok(retentionPairs(attempts).some(p => p.unrefreshed))
  assert.equal(attempts.find(a => a.attemptId === evidenceId('post-cutover-old-writer'))!.evidencePolicy, 'unversioned')
  // The old reader still sees INTEGER 0/1 flags; it must not be used to calculate post-cutover mastery.
  const flags = await db.prepare('SELECT correct, hints_used, interleaved FROM attempts ORDER BY created_at,id').all()
  assert.ok(flags.every(row => typeof row.correct === 'number' && [0,1].includes(row.correct) && [0,1].includes(row.interleaved)))
  for (const table of ['learning_cutovers','learning_exposures']) {
    assert.ok((await applicationTables()).includes(table)); assert.ok(Number((await db.prepare(`SELECT count(*) n FROM ${table}`).get())!.n) > 0)
  }
  // Random revisions must be consistent within each store, then receive deterministic names for deep parity.
  const revisions = new Map(attempts.filter(a => a.task).map(a => [a.task!.revision, `revision:${a.attemptId}`]))
  const normalize = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'string' && revisions.has(item) ? revisions.get(item) : item))
  return normalize({ attempts, eligible: freshEvidence(attempts).map(a => a.attemptId), states: await listStates(db, student, date(15)),
    retention: retentionPairs(attempts), milestones: await adventureFor(db, owner, student), flags, timing, nativePause })
}
/** Exercise the authored check writer and every new scheduling query on both database adapters. */
async function exerciseFractionCycle(db: Database) {
  let time = date(5).getTime()
  return withLearningClock(() => new Date(time), async () => {
    const learner = await createStudent(db, owner, { displayName: 'Synthetic authored parity', grade: 5, sessionCapMinutes: 10 })
    const focus = 'math.5.nf.a.1'
    await createTarget(db, owner, learner, { title: 'Synthetic fraction target', deadline: '2026-11-05', conceptIds: [focus] })
    const decisions: Array<string | null> = []
    const next = async () => {
      const action = await nextLearningAction(db, owner, learner)
      decisions.push(action?.checkGoal ?? null)
      return action
    }
    const begin = (goal: string) => startTutorSession(db, owner, learner, learningNow(), { mode: 'assessment', goal, focusConceptId: focus })
    const answer = async (session: string, item: Record<string, any>, correct = true) => {
      assert.ok(taskMatches(item))
      // The parity harness substitutes only the renderer's display acknowledgment; submissions use the real writer.
      await db.prepare('UPDATE session_items SET shown_at = ?, visible_at = ? WHERE id = ?').run(learningNow().toISOString(), learningNow().toISOString(), item.id)
      await recordExposure(db, learner, session, item, 'question', learningNow(), true)
      time += 15000
      await submitAnswer(db, owner, session, { itemId: item.id, revision: item.revision_id,
        answer: correct ? item.rubric_json ? JSON.parse(item.rubric_json).examples.meets : String(item.answer) : '0' })
    }
    assert.equal((await next())?.checkGoal, 'diagnostic_check')
    const diagnostic = await begin('diagnostic_check')
    for (const item of await sessionItems(db, diagnostic)) await answer(diagnostic, item, item.concept_id !== focus)
    assert.equal((await next())?.conceptId, focus)
    const immediate = await begin('independent_check')
    for (const item of (await sessionItems(db, immediate)).slice(0, 2)) await answer(immediate, item)
    await finishAssessment(db, owner, immediate)
    assert.equal((await next())?.checkGoal, null)
    time += 7 * 86400000
    assert.equal((await next())?.checkGoal, 'delayed_check')
    const delayed = await begin('delayed_check')
    for (const item of await sessionItems(db, delayed)) await answer(delayed, item)
    const retained = retentionChecks(await loadAttempts(db, learner)).filter(pair => pair.after.sessionId === delayed)
    assert.equal(retained.length, 2)
    assert.ok(retained.every(pair => pair.comparison === 'validated' && pair.unrefreshed && pair.after.correct))
    assert.equal((await next())?.checkGoal, 'transfer_check')
    const transfer = await begin('transfer_check'), item = (await sessionItems(db, transfer))[0]
    await answer(transfer, item)
    await reviewAnswer(db, owner, transfer, { itemId: String(item.id), correct: true })
    assert.equal((await next())?.checkGoal, null)
    const attempts = await loadAttempts(db, learner)
    assert.ok(attempts.every(a => a.task?.outcomeId && a.task.parallelFormId && a.evidenceCertainty === 'confirmed'))
    assert.equal(retentionChecks(attempts).filter(pair => pair.after.kind === 'transfer').length, 0)
    return { decisions, forms: attempts.map(a => [a.conceptId, a.bloomLevel, a.correct, a.kind, a.task?.outcomeId, a.task?.parallelFormId]),
      retained: retained.map(pair => [pair.comparison, pair.unrefreshed, pair.after.day]) }
  })
}
const evidenceColumns: Record<string,string[]> = {
  students: ['evidence_policy','experiment_policy'], attempts: ['evidence_policy','evidence_json'],
  session_items: ['evidence_purpose','evidence_policy','revision_id','task_evidence','mixed_evidence','submitted_revision','confidence_at','confidence_revision','confidence_support'],
}
async function exercisePaper(db: Database) {
  return withLearningClock(() => date(6), async () => {
    const learner = await createStudent(db, owner, { displayName: 'Synthetic paper parity', grade: 5, sessionCapMinutes: 10 })
    await createTarget(db, owner, learner, { title: 'Paper parity target', deadline: '2026-11-05', conceptIds: ['math.5.nf.a.1'] })
    const outcomes = []
    for (const help of ['unknown', 'content', 'none'] as const) {
      const sheet = await createSheet(db, owner, learner), payload = JSON.parse(String((await getSheet(db, owner, sheet)).spec_json))
      const items = payload.items as Item[]
      const results = await scoreSheet(db, owner, sheet, [
        { boxIndex: 3, answer: items[2].answer }, { boxIndex: 4, answer: items[3].rubric!.examples.meets },
      ], learningNow(), { version: 1, basis: 'self-reported', help, confirmed: true })
      assert.equal(results.filter(row => row.unanswered).length, 2)
      const pending = results[3]
      assert.equal(pending.pendingReview, true)
      await reviewAnswer(db, owner, pending.reviewSessionId, { itemId: items[3].itemId, correct: true })
      await reviewAnswer(db, owner, pending.reviewSessionId, { itemId: items[3].itemId, correct: true })
      assert.deepEqual(await scoreSheet(db, owner, sheet, [{ boxIndex: 3, answer: 'different' }]), results)
      const attempts = (await loadAttempts(db, learner)).filter(a => items.some(item => item.itemId === a.attemptId)).sort((a, b) => a.bloomLevel - b.bloomLevel)
      assert.equal(attempts.length, 2)
      for (const attempt of attempts) {
        const row = await db.prepare('SELECT * FROM session_items WHERE id = ?').get(attempt.attemptId)
        assert.ok(taskMatches(row!)); assert.equal(attempt.task?.revision, payload.tasks[attempt.attemptId].revision)
        assert.equal(attempt.task?.sourceId, sheet); assert.equal(attempt.paperConditions?.help, help)
        assert.equal(independent(attempt), help === 'none')
      }
      outcomes.push(attempts.map(a => [a.bloomLevel, a.task?.parallelFormId, a.evidenceCertainty, a.supportUsed, a.paperConditions, independent(a)]))
    }
    return outcomes
  })
}
let started = false
let pool: Pool | undefined
try {
  command('initdb', ['-D', cluster, '-U', 'tutor_parity', '-A', 'trust', '--no-locale', '--encoding=UTF8'])
  command('pg_ctl', ['-D', cluster, '-l', join(directory,'server.log'), '-o', `-h '' -k ${socket} -p 55439`, '-w', 'start'])
  started = true
  pool = new Pool({ host: socket, port: 55439, user: 'tutor_parity', database: 'postgres', max: 1, connectionTimeoutMillis: 5000 })
  const client = await pool.connect()
  try {
    const identity = (await client.query("SELECT current_setting('data_directory') AS path, current_setting('listen_addresses') AS addresses")).rows[0]
    assert.equal(identity.path, cluster); assert.equal(identity.addresses, '', 'only the private Unix socket may listen')
    const evidenceStart = POSTGRES_MIGRATIONS.indexOf('025-learning-evidence.sql')
    const migrations = await Promise.all(POSTGRES_MIGRATIONS.slice(evidenceStart).map(file => readFile(new URL(`../../src/migrations/${file}`, import.meta.url), 'utf8')))
    for (const populated of [false,true]) {
      const schema = populated ? 'synthetic_upgrade' : 'synthetic_fresh'
      await client.query(`CREATE SCHEMA ${schema}`); await client.query(`SET search_path TO ${schema}`)
      const db = new PostgresDatabase(client)
      for (const file of POSTGRES_MIGRATIONS.slice(0, populated ? evidenceStart : undefined)) await db.exec(await readFile(new URL(`../../src/migrations/${file}`, import.meta.url), 'utf8'))
      await seed(db)
      for (let repeat = 0; repeat < 2; repeat++) for (const migration of migrations) await db.exec(migration)
      const pgResult = await exercise(db)
      const pgFractions = await exerciseFractionCycle(db)
      const pgPaper = await exercisePaper(db)
      let sqlite = openDb(join(directory, `${schema}.sqlite`))
      try {
        if (populated) {
          sqlite.exec('DROP TABLE learning_exposures; DROP TABLE learning_cutovers')
          for (const [table, columns] of Object.entries(evidenceColumns)) for (const column of columns) sqlite.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`)
          sqlite.exec('ALTER TABLE session_items DROP COLUMN scaffold_json')
          sqlite.exec('ALTER TABLE session_items DROP COLUMN lesson_json')
          for (const column of ['answer_saved_at', 'submit_to_save_ms', 'active_work_ms', 'grading_started_at', 'grading_finished_at', 'graded_at']) sqlite.exec(`ALTER TABLE session_items DROP COLUMN ${column}`)
        }
        await seed(sqlite)
        migrateJourney(sqlite); migrateJourney(sqlite)
        const sqliteResult = await exercise(sqlite)
        const sqliteFractions = await exerciseFractionCycle(sqlite)
        const sqlitePaper = await exercisePaper(sqlite)
        assert.deepEqual(pgResult, sqliteResult, `${schema}: projected attempts, eligibility, mastery, retention and receipts must agree`)
        assert.deepEqual(pgFractions, sqliteFractions, `${schema}: authored outcomes, check scheduling and validated delayed pairs must agree`)
        assert.deepEqual(pgPaper, sqlitePaper, `${schema}: paper identity, reviewed rubrics, conditions, blanks and duplicate submissions must agree`)
        sqlite.close(); sqlite = openDb(join(directory, `${schema}.sqlite`))
        assert.equal((await loadAttempts(sqlite, student)).length, (sqliteResult as any).attempts.length, 'reopening and repeat migration preserves attempts')
      } finally { sqlite.close() }
      console.log(`PASS ${schema}: migration, cutover replay, old-writer compatibility, grading retries, mixed evidence, authored fractions checks, paper lifecycle, retention and deep SQLite/PostgreSQL parity`)
    }
  } finally { client.release() }
} finally {
  await pool?.end()
  if (started) command('pg_ctl', ['-D', cluster, '-m', 'immediate', '-w', 'stop'])
  await rm(directory, { recursive: true, force: true })
}
