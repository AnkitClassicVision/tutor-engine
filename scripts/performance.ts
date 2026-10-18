import { spawn } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { performance } from 'node:perf_hooks'
import { openDb } from '../src/db.ts'
import { registerUser, openAuthSession } from '../src/auth.ts'
import { createStudent, startTutorSession, sessionItems } from '../src/services.ts'
import { startServer } from '../src/server.ts'
import { createJob } from '../src/jobs.ts'
const dir = mkdtempSync(join(tmpdir(), 'tutor-load-')), db = openDb(join(dir, 'load.sqlite'))
const clients: any[] = [], registered = (await registerUser(db, 'load@example.com', 'load-test-password'))
if (!registered.ok) throw new Error('Setup failed')
const passwordHash = (await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(registered.userId))!.password_hash
for (let n = 0; n < 100; n++) {
  const owner = n === 0 ? registered.userId : crypto.randomUUID()
  if (n > 0) await db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(owner, `load-${n}@example.com`, passwordHash, new Date().toISOString())
  const student = (await createStudent(db, owner, { displayName: `Learner ${n}`, grade: 5, sessionCapMinutes: 10 })), auth = (await openAuthSession(db, owner)), session = (await startTutorSession(db, owner, student))
  const concepts = (await sessionItems(db, session)).map(i => i.concept_id)
  const insert = db.prepare('INSERT INTO attempts (id, student_id, session_id, concept_id, bloom_level, day, correct, hints_used, interleaved, time_ms, modality, created_at) VALUES (?, ?, ?, ?, 3, ?, ?, 0, ?, 1200, ?, ?)')
  await db.exec('BEGIN')
  for (let i = 0; i < 1000; i++) {
    const date = new Date(Date.now() - (1000 - i) * 60000).toISOString()
    insert.run(crypto.randomUUID(), student, session, concepts[i % concepts.length], date.slice(0, 10), i % 5 ? 1 : 0, i % 4 ? 0 : 1, 'screen', date)
  }
  await db.exec('COMMIT')
  await db.prepare("UPDATE session_items SET answered = 1, given_answer = 'fixture reasoning', correct = NULL WHERE session_id = ?").run(session)
  const job = (await createJob(db, owner, student, 'grade', { sessionId: session }, `load:${session}`))
  await db.prepare("UPDATE auth_sessions SET selected_student = ?, parent_unlocked_until = ? WHERE token_hash = ?").run(student, new Date(Date.now() + 15 * 60000).toISOString(), (await import("../src/auth.ts")).hashToken(auth.token))
  clients.push({ student, auth, session, job })
}
const server = (await startServer({ db, uploadsDir: join(dir, 'uploads'), host: '127.0.0.1', port: 0, runWorker: false }))
await once(server, 'listening')
const worker = spawn(process.execPath, ['--experimental-strip-types', 'scripts/performance-worker.ts'], { env: { ...process.env, TUTOR_DB: join(dir, 'load.sqlite'), TUTOR_UPLOADS: join(dir, 'uploads') }, stdio: ['ignore', 'ignore', 'inherit'] })
const address = server.address(); if (!address || typeof address === 'string') throw new Error()
const base = `http://127.0.0.1:${address.port}`, latency: number[] = [], errors: number[] = [], byPath: Record<string, number[]> = {}
const paths = (client: any) => [`/students/${client.student}`, `/students/${client.student}/map`, `/students/${client.student}/insights`, `/jobs/${client.job}/status`]
for (let round = 0; round < 5; round++) {
  await Promise.all((await Promise.all(clients.map(async client => {
    const path = paths(client)[round % 4], label = ['home', 'map', 'insights', 'job-status'][round % 4], started = performance.now()
    const response = await fetch(base + path, { headers: { cookie: `tutor_session=${client.auth.token}` } })
    await response.arrayBuffer(); const elapsed = performance.now() - started
    latency.push(elapsed); (byPath[label] ??= []).push(elapsed)
    if (response.status !== 200) errors.push(response.status)
  }))))
}
const percentile = (values: number[], p: number) => Math.round([...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(p * values.length))])
const report = { testedAt: new Date().toISOString(), environment: 'Local Node/SQLite, synthetic histories and model latency; not production capacity certification', students: 100, attempts: 100000, requests: latency.length, concurrentRequests: 100, backgroundJobs: 100, errors: errors.length, p50Ms: percentile(latency, .5), p99Ms: percentile(latency, .99), maxMs: Math.round(Math.max(...latency)), ordinaryTargetPassed: errors.length === 0 && percentile(latency, .99) < 1000, byPath: Object.fromEntries(Object.entries(byPath).map(([path, times]) => [path, { requests: times.length, p99Ms: percentile(times, .99) }])) }
mkdirSync('evidence', { recursive: true }); writeFileSync('evidence/performance.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2))
await new Promise<void>(resolve => server.close(() => resolve()));
// Let an in-flight simulated grading job finish before closing its connection.
worker.kill('SIGTERM'); await once(worker, 'exit'); db.close(); rmSync(dir, { recursive: true, force: true })
if (!report.ordinaryTargetPassed) process.exitCode = 1
