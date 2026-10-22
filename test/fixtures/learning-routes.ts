import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDb } from '../../src/db.ts'
import { registerUser, openAuthSession } from '../../src/auth.ts'
import { startServer, jobHandlers, type AppOptions } from '../../src/server.ts'
import { learningNow, withLearningClock } from '../../src/learning-clock.ts'
import { createStudent, createTarget, saveAiSettings, sessionItems, loadAttempts, practiceRefreshContext, uploadedSourceText } from '../../src/services.ts'
import { createMaterial, configureMaterialLearning } from '../../src/schoolwork.ts'
import { createJob, runNextJob } from '../../src/jobs.ts'
import { retentionChecks } from '../../src/engine/evidence.ts'

export const FRACTION_TARGET = 'math.5.nf.a.1'
/** A fresh database and loopback server per test, with no background worker or HTTP clock controls. */
export async function learningRouteFixture(input: { ai?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'synthetic-learning-cycle-')), db = openDb(':memory:')
  let instant = Date.parse('2026-10-05T12:00:00.000Z'), failChecker = false
  const clock = () => new Date(instant), within = <T>(work: () => T) => withLearningClock(clock, work)
  const registered = await registerUser(db, 'cycle@example.invalid', 'synthetic-cycle-password')
  if (!registered.ok) throw new Error('Synthetic family registration failed.')
  const owner = registered.userId, auth = await openAuthSession(db, owner)
  const student = await within(() => createStudent(db, owner, { displayName: 'Synthetic fraction cycle', grade: 5, sessionCapMinutes: 10 }))
  await within(() => createTarget(db, owner, student, { title: 'Fractions learning cycle', conceptIds: [FRACTION_TARGET], deadline: '2026-11-05' }))
  if (input.ai !== false) await saveAiSettings(db, owner, { provider: 'openai', model: 'synthetic-local-judge', apiKey: 'synthetic-not-a-provider-key' })
  else await db.prepare("UPDATE users SET ai_provider = 'openai', ai_key = '', ai_model = '' WHERE id = ?").run(owner)
  const material = await within(() => createMaterial(db, owner, student, { kind: 'practice_exam', title: 'Synthetic dated source', subject: 'Math', workState: 'blank', transcription: 'Synthetic school coverage' }, dir))
  await within(() => configureMaterialLearning(db, owner, material, { purpose: 'test', testTitle: 'Synthetic near-term test', testDate: '2026-10-07' }))
  // Source transcription is fixture setup, before the route starts; no attempts or backdated history are inserted.
  await db.prepare('INSERT INTO material_questions (id, material_id, revision, number, prompt, readable, confidence) VALUES (?, ?, 1, ?, ?, 1, 1)')
    .run(crypto.randomUUID(), material, '1', 'Synthetic school coverage')
  const options: AppOptions = {
    db, uploadsDir: dir, runWorker: false, learningClock: clock,
    judgeResponse: async input => {
      instant += 2000
      if (failChecker) return { kind: 'failed' }
      const correct = input.response === input.rubric?.examples.meets
      return { kind: 'graded', path: 'two graders agreed', verdict: {
        correct, confidence: 1, reason: 'Synthetic checker fixture verified the authored example response.', errorType: correct ? null : 'misconception',
      } }
    },
    generatePractice: async () => { throw new Error('Synthetic generation interruption.') },
  }
  const server = await startServer({ ...options, host: '127.0.0.1', port: 0 })
  if (!server.listening) await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Synthetic server did not bind.')
  const baseURL = 'http://127.0.0.1:' + address.port
  const request = (path: string, body?: Record<string, unknown>) => fetch(baseURL + path, {
    method: body ? 'POST' : 'GET', redirect: 'manual',
    headers: { Cookie: 'tutor_session=' + auth.token, ...(body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : {}) },
    body: body ? JSON.stringify({ csrf: auth.csrf, ...body }) : undefined,
  })
  return {
    db, owner, student, material, auth, baseURL, clock, within, request,
    advance(ms: number) { instant += ms },
    failChecker(value: boolean) { failChecker = value },
    async drain() {
      for (let i = 0; i < 20; i++) if (!await runNextJob(db, jobHandlers(options))) return
      throw new Error('Synthetic job queue did not drain within its bound.')
    },
    items: (session: string) => sessionItems(db, session),
    attempts: () => within(() => loadAttempts(db, student)),
    retained: async () => retentionChecks(await within(() => loadAttempts(db, student))),
    source: () => within(() => uploadedSourceText(db, student, 'Math')),
    async failedGeneration() {
      const input = await within(() => practiceRefreshContext(db, owner, student, FRACTION_TARGET))
      const id = await within(() => createJob(db, owner, student, 'fresh_practice',
        { input, options: { mode: 'session', subject: 'Math', focusConceptId: FRACTION_TARGET, intent: 'practice' } }, 'synthetic-generation-failure'))
      await this.drain()
      return id
    },
    now: () => within(() => learningNow().toISOString()),
    async close() {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      db.close(); rmSync(dir, { recursive: true, force: true })
    },
  }
}

export type LearningRoute = Awaited<ReturnType<typeof learningRouteFixture>>
