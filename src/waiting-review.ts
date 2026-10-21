// One spaced-review question while a long job prepares new work (panel round 2, item 5).
// The card is offered only to a child using the device, never on a parent-unlocked page,
// so a grown-up's answer cannot become the learner's evidence. Nothing is stored until
// the learner answers; the answer goes through the same scoring as a mission.
import { createHash, randomUUID } from 'node:crypto'
import { stampTask } from './task-evidence.ts'
import { openAssessment } from './assessment.ts'
import type { Database as DatabaseSync } from './database.ts'
import type { Job } from './jobs.ts'
import { loadBackbone } from './engine/graph.ts'
import { generateItem } from './engine/items.ts'
import { needsJudgment, nonAttempt } from './engine/score.ts'
import { dayStamp } from './engine/dates.ts'
import { promptIdentity } from './session-feedback.ts'
import { listStates, seenPrompts, sessionItems, studentConcepts, submitAnswer } from './services.ts'
import { recordDecision } from './decisions.ts'
import type { BloomLevel } from './engine/types.ts'

export type WaitingReview =
  | { state: 'ask'; conceptId: string; title: string; prompt: string; ref: string; reask?: boolean }
  | { state: 'done'; title: string; correct: boolean; clue: string }

const goalFor = (jobId: string) => `waiting_review:${jobId}`
/** A fingerprint of the question shown, so an answer is never scored against a different question. */
const refFor = (prompt: string) => createHash('sha256').update(promptIdentity(prompt)).digest('base64url').slice(0, 16)
const terminal = (job: Job) => ['succeeded', 'failed', 'cancelled'].includes(job.status)
async function assessmentWaiting(db: DatabaseSync, owner: string, job: Job) {
  const payload = JSON.parse(job.payload)
  return payload.options?.mode === 'assessment' || Boolean(job.student_id && await openAssessment(db, owner, job.student_id))
}

/** Concepts the job itself is preparing, so the card is spaced retrieval rather than a preview. */
async function jobConcepts(db: DatabaseSync, job: Job): Promise<Set<string>> {
  const payload = JSON.parse(job.payload)
  const ids = new Set<string>([payload.input?.concept?.conceptId, payload.conceptId, payload.focusConceptId].filter(Boolean).map(String))
  if (payload.packId) {
    const pack = await db.prepare('SELECT concept_ids FROM packs WHERE id = ?').get(String(payload.packId))
    try { for (const id of JSON.parse(String(pack?.concept_ids ?? '[]'))) ids.add(String(id)) } catch {}
  }
  return ids
}

/** The due review question for this job, chosen and regenerated on the server only. */
export async function chooseReview(db: DatabaseSync, owner: string, job: Job) {
  if (await assessmentWaiting(db, owner, job)) return null
  const studentId = String(job.student_id)
  const graph = loadBackbone(), today = dayStamp(new Date()), skip = await jobConcepts(db, job)
  const concepts = await studentConcepts(db, owner, studentId)
  const due = (await listStates(db, studentId))
    .filter((s) => s.nextDue <= today && s.independentChecks && !skip.has(s.conceptId) && graph.nodes.has(s.conceptId) && concepts.some((c) => c.conceptId === s.conceptId))
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue))
  const seen = await seenPrompts(db, studentId)
  for (const state of due) {
    const node = graph.nodes.get(state.conceptId)!
    const base = parseInt(createHash('sha256').update(`${job.id}:${state.conceptId}`).digest('hex').slice(0, 8), 16)
    for (const bloom of [Math.min(3, Math.max(2, state.bloomLevel)), 2] as BloomLevel[]) {
      for (let tries = 0; tries < 12; tries++) {
        const item = generateItem(node, bloom, base + tries)
        const gradable = { answer: item.answer, format: 'text', choices: null }
        if (needsJudgment(gradable, item.bloomLevel) || seen.has(promptIdentity(item.prompt))) continue
        return { conceptId: state.conceptId, title: concepts.find((c) => c.conceptId === state.conceptId)?.title ?? node.title, item }
      }
    }
  }
  return null
}

export async function waitingReview(db: DatabaseSync, owner: string, job: Job, childAtDevice: boolean, reask = false): Promise<WaitingReview | null> {
  if (!job.student_id || !childAtDevice || terminal(job)) return null
  if (await assessmentWaiting(db, owner, job)) return null
  const done = await db.prepare('SELECT id FROM tutor_sessions WHERE student_id = ? AND goal = ? LIMIT 1').get(String(job.student_id), goalFor(job.id))
  if (done) {
    const item = (await sessionItems(db, String(done.id)))[0]
    if (!item) return null
    let clue = ''
    try { clue = String(JSON.parse(String(item.hints_json ?? '[]'))[0] ?? '') } catch {}
    const title = (await studentConcepts(db, owner, String(job.student_id))).find((c) => c.conceptId === item.concept_id)?.title ?? String(item.concept_id)
    return { state: 'done', title, correct: item.correct === 1, clue }
  }
  if (terminal(job)) return null
  const review = await chooseReview(db, owner, job)
  return review ? { state: 'ask', conceptId: review.conceptId, title: review.title, prompt: review.item.prompt, ref: refFor(review.item.prompt), reask } : null
}

/** Score the learner's answer as a one-question review session. Returns false for a non-attempt. */
export async function answerWaitingReview(db: DatabaseSync, owner: string, job: Job, answer: string, ref: string, now = new Date()): Promise<'scored' | 'reask' | 'changed'> {
  if (!job.student_id) throw new Error('This job has no learner.')
  if (await assessmentWaiting(db, owner, job)) return 'changed'
  const studentId = String(job.student_id)
  if (await db.prepare('SELECT id FROM tutor_sessions WHERE student_id = ? AND goal = ? LIMIT 1').get(studentId, goalFor(job.id))) return 'scored'
  const review = terminal(job) ? null : await chooseReview(db, owner, job)
  if (!review || refFor(review.item.prompt) !== ref) return 'changed'
  if (nonAttempt({ answer: review.item.answer, format: 'text', choices: null }, answer)) return 'reask'
  const sessionId = randomUUID(), itemId = randomUUID()
  // The unique goal index lets only one answer per job create the review, even when two arrive at once.
  const created = await db.prepare(`INSERT INTO tutor_sessions (id, student_id, started_at, modality, consecutive_step_downs, cap_minutes, continuity, mode, subject, goal)
    VALUES (?, ?, ?, 'screen', 0, 3, ?, 'session', 'Math', ?) ON CONFLICT DO NOTHING`).run(sessionId, studentId, now.toISOString(), 'A quick review while new work was prepared.', goalFor(job.id))
  if (!created.changes) return 'scored'
  const item = review.item
  await db.prepare(`INSERT INTO session_items (id, session_id, position, beat, concept_id, bloom_level, prompt, answer, hints_json, surface,
    interleaved, partner_concept_id, hints_used, answered, format, choices_json, explanation) VALUES (?, ?, 1, 'review', ?, ?, ?, ?, ?, ?, 0, NULL, 0, 0, 'text', NULL, '')`)
    .run(itemId, sessionId, review.conceptId, item.bloomLevel, item.prompt, item.answer, JSON.stringify(item.hintLadder), item.surface)
  await stampTask(db, itemId, 'builtin')
  await recordDecision(db, studentId, 'waiting_review', 'One due review question was offered while new work was prepared.', { sessionId, jobId: job.id, conceptId: review.conceptId }, now)
  await submitAnswer(db, owner, sessionId, { itemId, answer }, now)
  await db.prepare("UPDATE tutor_sessions SET ended_at = ?, end_reason = 'waiting_review', pending_feedback = NULL WHERE id = ? AND ended_at IS NULL").run(now.toISOString(), sessionId)
  return 'scored'
}
