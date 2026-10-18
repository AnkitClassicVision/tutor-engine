import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDb } from '../src/db.ts'
import { registerUser } from '../src/auth.ts'
import { createStudent, saveAiSettings, listStates, startTutorSession, sessionItems, titleMap, uploadedSourceText } from '../src/services.ts'
import { createMaterial, configureMaterialLearning, correctMaterial, applySchoolLearning } from '../src/schoolwork.ts'
import { createJob, runNextJob, ownedJob } from '../src/jobs.ts'
import { jobHandlers, resumeBuilds } from '../src/server.ts'

const original = 'What is 2 + 2?'
const concept = 'math.4.nbt.b.4'
const future = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
async function fixture(purpose: 'test' | 'learning' = 'test') {
  const dir = mkdtempSync(join(tmpdir(), 'school-learning-')), db = openDb(join(dir, 'test.sqlite'))
  const user = await registerUser(db, 'synthetic-school@example.invalid', 'long-fixture-password')
  if (!user.ok) throw Error('Fixture registration failed')
  const owner = user.userId, student = await createStudent(db, owner, { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 })
  await saveAiSettings(db, owner, { provider: 'openai', model: 'fixture', photoModel: 'fixture-photo', apiKey: 'synthetic-key' })
  const material = await createMaterial(db, owner, student, { kind: 'practice_exam', title: 'Sample maths test', subject: 'Math', workState: 'blank', transcription: original }, dir)
  const source = await configureMaterialLearning(db, owner, material, { purpose, testTitle: 'Friday maths', testDate: future() })
  const job = await createJob(db, owner, student, 'school_path', source, 'fixture-source')
  const title = (await titleMap(db, student))[concept]
  return { db, owner, student, material, source, job, dir, title, close() { db.close(); rmSync(dir, { recursive: true, force: true }) } }
}
function response(result: any) { return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] })) }
function curriculum(title: string, copy = false) {
  return { reason: 'The sample test covers addition; preserve existing progress.', topics: [{ title, recall: 'Add using place value.', example: '12 + 8 = 20.', nonExample: 'Ignoring place value.', questions: [{ prompt: copy ? original : 'What is 13 + 8?', answer: '21', bloomLevel: 3 }, { prompt: 'Create an addition question with a sum of 30 and solve it.', answer: 'Rubric: The terms sum to 30 and the solution is correct.', bloomLevel: 6 }] }] }
}
test('sample pages produce a durable dated practice focus without changing mastery or copying questions', async () => {
  const f = await fixture(), realFetch = globalThis.fetch, prompts: string[] = []
  const before = await listStates(f.db, f.student)
  globalThis.fetch = async (_url: any, init: any) => {
    const body = JSON.parse(init.body), prompt = body.messages.at(-1).content
    prompts.push(prompt)
    return response(body.messages[0].content.includes('# Read school material') ? { questions: [{ number: '1', prompt: original, readable: true, confidence: .99, conceptId: null, visibleWork: '4', answerKey: '4' }] } : curriculum(f.title))
  }
  try {
    const handlers = jobHandlers({ db: f.db, uploadsDir: f.dir })
    await runNextJob(f.db, handlers)
    const result = JSON.parse((await ownedJob(f.db, f.owner, f.job)).result!)
    assert.ok(result.nextJobId)
    await runNextJob(f.db, handlers)
    assert.equal((await ownedJob(f.db, f.owner, result.nextJobId)).status, 'succeeded')
    assert.ok(prompts[1].includes(original)); assert.ok(prompts[1].includes(future()))
    assert.match(await uploadedSourceText(f.db, f.student, 'Math'), /Sample maths test/)
    assert.deepEqual(await listStates(f.db, f.student), before)
    const target = f.db.prepare("SELECT * FROM targets WHERE student_id = ? AND kind = 'target'").get(f.student)!
    assert.equal(target.deadline, future()); assert.deepEqual(JSON.parse(String(target.concept_ids)), [concept])
    await applySchoolLearning(f.db, f.owner, f.source, [concept])
    assert.equal(f.db.prepare("SELECT count(*) n FROM targets WHERE kind = 'target'").get()!.n, 1)
    const session = await startTutorSession(f.db, f.owner, f.student, new Date(), { mode: 'assessment', subject: 'Math', targetId: String(target.id), materialId: f.material })
    const items = await sessionItems(f.db, session)
    assert.equal(items[0].concept_id, concept); assert.ok(items.every(i => i.prompt !== original))
    const afterDeadline = new Date(`${target.deadline}T12:00:00Z`)
    afterDeadline.setUTCDate(afterDeadline.getUTCDate() + 2)
    await assert.rejects(startTutorSession(f.db, f.owner, f.student, afterDeadline, { targetId: String(target.id) }), /no longer active/)
  } finally { globalThis.fetch = realFetch; f.close() }
})
test('learning-only school pages add coverage without creating a dated test or changing evidence', async () => {
  const f = await fixture('learning'), realFetch = globalThis.fetch
  const before = await listStates(f.db, f.student)
  globalThis.fetch = async (_url: any, init: any) => response(JSON.parse(init.body).messages[0].content.includes('# Read school material') ? { questions: [{ number: '1', prompt: original, readable: true, confidence: .99 }] } : curriculum(f.title))
  try {
    const handlers = jobHandlers({ db: f.db, uploadsDir: f.dir })
    await runNextJob(f.db, handlers); await runNextJob(f.db, handlers)
    assert.equal(f.db.prepare('SELECT learning_applied_revision FROM materials WHERE id = ?').get(f.material)!.learning_applied_revision, 1)
    assert.equal(f.db.prepare("SELECT count(*) n FROM targets WHERE kind = 'target'").get()!.n, 0)
    assert.ok(Number(f.db.prepare('SELECT count(*) n FROM practice_items').get()!.n) >= 2)
    assert.deepEqual(await listStates(f.db, f.student), before)
  } finally { globalThis.fetch = realFetch; f.close() }
})
test('correcting source while curriculum is running fences out its questions and target', async () => {
  const f = await fixture(), realFetch = globalThis.fetch
  globalThis.fetch = async (_url: any, init: any) => {
    const body = JSON.parse(init.body)
    if (body.messages[0].content.includes('# Read school material')) return response({ questions: [{ number: '1', prompt: original, readable: true, confidence: .99 }] })
    const page = f.db.prepare('SELECT id FROM material_pages WHERE material_id = ?').get(f.material)!
    await correctMaterial(f.db, f.owner, f.material, [{ id: page.id, transcription: 'Corrected coverage: multiplication' }])
    return response(curriculum(f.title))
  }
  try {
    const handlers = jobHandlers({ db: f.db, uploadsDir: f.dir })
    await runNextJob(f.db, handlers); await runNextJob(f.db, handlers)
    assert.equal(f.db.prepare("SELECT count(*) n FROM targets WHERE kind = 'target'").get()!.n, 0)
    assert.equal(f.db.prepare('SELECT count(*) n FROM practice_items').get()!.n, 0)
    assert.equal(f.db.prepare('SELECT learning_applied_revision FROM materials WHERE id = ?').get(f.material)!.learning_applied_revision, 0)
    assert.equal(await applySchoolLearning(f.db, f.owner, f.source, [concept]), false)
    assert.equal(f.db.prepare('SELECT build_status FROM subject_plans WHERE student_id = ?').get(f.student)!.build_status, 'failed')
  } finally { globalThis.fetch = realFetch; f.close() }
})
test('unreadable pages and copied source questions never become a test plan', async () => {
  for (const failure of ['unreadable', 'copied']) {
    const f = await fixture(), realFetch = globalThis.fetch
    globalThis.fetch = async (_url: any, init: any) => {
      const body = JSON.parse(init.body)
      return response(body.messages[0].content.includes('# Read school material') ? { questions: [{ number: '1', prompt: original, readable: failure !== 'unreadable', confidence: .99 }] } : curriculum(f.title, true))
    }
    try {
      const handlers = jobHandlers({ db: f.db, uploadsDir: f.dir })
      await runNextJob(f.db, handlers); await runNextJob(f.db, handlers)
      assert.equal(f.db.prepare("SELECT count(*) n FROM targets WHERE kind = 'target'").get()!.n, 0)
      assert.equal(f.db.prepare('SELECT count(*) n FROM practice_items').get()!.n, 0)
      assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE status = 'failed'").get()!.n, 1)
      assert.equal(f.db.prepare('SELECT test_date FROM materials WHERE id = ?').get(f.material)!.test_date, future())
    } finally { globalThis.fetch = realFetch; f.close() }
  }
})
test('school intent validates dates, ownership, idempotency and superseded settings', async () => {
  const f = await fixture()
  try {
    await assert.rejects(configureMaterialLearning(f.db, f.owner, f.material, { purpose: 'test', testTitle: 'Bad date', testDate: '2099-02-30' }), /valid date/)
    const other = await registerUser(f.db, 'other-school@example.invalid', 'long-fixture-password')
    if (!other.ok) throw Error()
    await assert.rejects(configureMaterialLearning(f.db, other.userId, f.material, { purpose: 'learning' }), /not found/)
    assert.deepEqual(await configureMaterialLearning(f.db, f.owner, f.material, { purpose: 'test', testTitle: 'Friday maths', testDate: future() }), f.source)
    await applySchoolLearning(f.db, f.owner, f.source, [concept])
    await configureMaterialLearning(f.db, f.owner, f.material, { purpose: '' })
    assert.equal(await applySchoolLearning(f.db, f.owner, f.source, [concept]), false)
    assert.equal(f.db.prepare("SELECT count(*) n FROM targets WHERE kind = 'target'").get()!.n, 0)
    assert.equal(await uploadedSourceText(f.db, f.student, 'Math'), '')
  } finally { f.close() }
})

test('a failed school curriculum retains source fences during startup recovery and can be retried', async () => {
  const f = await fixture(), realFetch = globalThis.fetch
  let unavailable = false
  globalThis.fetch = async (_url: any, init: any) => {
    const body = JSON.parse(init.body)
    if (body.messages[0].content.includes('# Read school material')) return response({ questions: [{ number: '1', prompt: original, readable: true, confidence: .99 }] })
    if (unavailable) throw new Error('Synthetic provider unavailable')
    return response(curriculum('Synthetic extra coverage'))
  }
  try {
    const handlers = jobHandlers({ db: f.db, uploadsDir: f.dir })
    await runNextJob(f.db, handlers); await runNextJob(f.db, handlers)
    const source = await configureMaterialLearning(f.db, f.owner, f.material, { purpose: 'test', testTitle: 'Changed test', testDate: future() })
    await createJob(f.db, f.owner, f.student, 'school_path', source, 'fixture-changed-source')
    await runNextJob(f.db, handlers)
    unavailable = true; await runNextJob(f.db, handlers)
    const pending = f.db.prepare("SELECT * FROM jobs WHERE kind = 'curriculum' ORDER BY rowid DESC LIMIT 1").get()!
    assert.equal(pending.status, 'failed')
    const jobs = f.db.prepare('SELECT count(*) n FROM jobs').get()!.n
    await resumeBuilds(f.db)
    assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get()!.n, jobs)
    assert.equal(f.db.prepare('SELECT build_status FROM subject_plans WHERE student_id = ?').get(f.student)!.build_status, 'failed')
    assert.equal(f.db.prepare('SELECT learning_applied_revision FROM materials WHERE id = ?').get(f.material)!.learning_applied_revision, 0)
    assert.equal(f.db.prepare("SELECT count(*) n FROM targets WHERE kind = 'target'").get()!.n, 0)
    const { changeJob } = await import('../src/jobs.ts')
    unavailable = false; await changeJob(f.db, f.owner, String(pending.id), 'retry')
    await runNextJob(f.db, handlers)
    assert.equal((await ownedJob(f.db, f.owner, String(pending.id))).status, 'succeeded')
    assert.equal(f.db.prepare('SELECT learning_applied_revision FROM materials WHERE id = ?').get(f.material)!.learning_applied_revision, 1)
  } finally { globalThis.fetch = realFetch; f.close() }
})
