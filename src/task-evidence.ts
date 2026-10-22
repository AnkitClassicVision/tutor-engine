import { createHash, randomUUID } from 'node:crypto'
import type { Database, Row } from './database.ts'
import type { TaskEvidence, ResponseForm, ConfidenceEvidence } from './engine/evidence.ts'
import { withWrite } from './transaction.ts'
import { approvedFractionForm } from './engine/fraction-forms.ts'
import { readPaperWork } from './paper-work.ts'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const supportHash = (item: Row) => item.scaffold_json || item.lesson_json ? hash(JSON.stringify([item.scaffold_json ?? null, item.lesson_json ?? null])) : undefined
export const promptIdentity = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
export function responseForm(item: Row): ResponseForm {
  if (item.format === 'choice' || item.format === 'steps') return item.format
  if (/^[+-]?(?:\d+(?:\.\d+)?|\d+\s*\/\s*\d+)$/.test(String(item.answer ?? '').trim())) return 'number'
  return item.format === 'text' ? 'text' : 'unknown'
}
export function taskEvidence(item: Row, origin: TaskEvidence['origin'], sourceId: string | null = null): TaskEvidence {
  return { version: 1, revision: randomUUID(), origin, sourceId, conceptId: String(item.concept_id), demand: Number(item.bloom_level),
    role: item.evidence_kind === 'transfer' ? 'transfer' : 'practice', responseForm: responseForm(item),
    promptHash: hash(promptIdentity(item.prompt)), rubricHash: hash(JSON.stringify([item.answer, item.rubric_json ?? null])),
    ...(supportHash(item) ? { supportHash: supportHash(item) } : {}),
    outcomeId: null, parallelFormId: null, ...approvedFractionForm(item) }
}
export function readTask(raw: unknown): TaskEvidence | undefined {
  try {
    const value = JSON.parse(String(raw))
    if (value?.version !== 1 || typeof value.revision !== 'string' || value.revision.length > 80
      || !['builtin', 'practice', 'designed', 'paper'].includes(value.origin) || typeof value.conceptId !== 'string'
      || !Number.isInteger(value.demand) || value.demand < 1 || value.demand > 6
      || !['practice', 'transfer'].includes(value.role) || !['number', 'choice', 'steps', 'text', 'unknown'].includes(value.responseForm)
      || !/^[a-f0-9]{64}$/.test(value.promptHash) || !/^[a-f0-9]{64}$/.test(value.rubricHash)
      || value.supportHash !== undefined && !/^[a-f0-9]{64}$/.test(value.supportHash)
      || ![value.sourceId, value.outcomeId, value.parallelFormId].every(x => x === null || typeof x === 'string' && x.length <= 160)) return undefined
    return value as TaskEvidence
  } catch { return undefined }
}
export function taskMatches(item: Row, task = readTask(item.task_evidence)): boolean {
  const approved = approvedFractionForm(item)
  return Boolean(task && task.revision === item.revision_id && task.conceptId === item.concept_id && task.demand === Number(item.bloom_level)
    && (!task.outcomeId && !task.parallelFormId || task.outcomeId === approved?.outcomeId && task.parallelFormId === approved?.parallelFormId)
    && task.role === (item.evidence_kind === 'transfer' ? 'transfer' : 'practice') && task.responseForm === responseForm(item)
    && task.supportHash === supportHash(item)
    && task.promptHash === hash(promptIdentity(item.prompt)) && task.rubricHash === hash(JSON.stringify([item.answer, item.rubric_json ?? null])))
}
export async function stampTask(db: Database, itemId: string, origin: TaskEvidence['origin'], sourceId: string | null = null) {
  const item = await db.prepare('SELECT * FROM session_items WHERE id = ?').get(itemId)
  if (!item) throw new Error('Cannot record provenance for a missing question.')
  const task = taskEvidence(item, origin, sourceId)
  await db.prepare('UPDATE session_items SET evidence_policy = 1, revision_id = ?, task_evidence = ?, mixed_evidence = NULL WHERE id = ?')
    .run(task.revision, JSON.stringify(task), itemId)
  return task
}
export function readConfidence(item: Row): ConfidenceEvidence | undefined {
  if (!item.confidence_at || !item.confidence_revision || item.confidence_support == null) return undefined
  return { at: String(item.confidence_at), revision: String(item.confidence_revision), supportAtCapture: Number(item.confidence_support) !== 0 }
}
/** Item metadata is frozen at submission; an asynchronous grade may only inherit that revision. */
export async function snapshotAttempt(db: Database, item: Row) {
  const task = readTask(item.task_evidence)
  if (Number(item.evidence_policy) === 1 && (!taskMatches(item, task) || item.submitted_revision !== task?.revision)) throw new Error('Question revision changed after submission.')
  let paper
  if (task?.origin === 'paper' && task.sourceId) {
    const sheet = await db.prepare('SELECT spec_json FROM sheets WHERE id = ?').get(task.sourceId)
    try { paper = readPaperWork(JSON.parse(String(sheet?.spec_json)).work)?.conditions ?? undefined } catch { /* historical conditions stay unknown */ }
  }
  const json = Number(item.evidence_policy) === 1 ? JSON.stringify({ task, confidence: readConfidence(item), mixed: item.mixed_evidence ? JSON.parse(String(item.mixed_evidence)) : null, paper }) : null
  await db.prepare('UPDATE attempts SET evidence_policy = ?, evidence_json = ? WHERE id = ?').run(item.evidence_policy ?? null, json, item.id)
}

/** Retire the unused identity; keep its original question available for audits and stale callbacks. */
export async function replaceUnseenTask(db: Database, item: Row, replacement: Row, origin: TaskEvidence['origin'], sourceId: string | null = null) {
  return withWrite(db, async () => {
    const session = await db.prepare('SELECT mode, ended_at FROM tutor_sessions WHERE id = ?').get(item.session_id)
    const current = await db.prepare('SELECT * FROM session_items WHERE id = ?').get(item.id)
    if (!session || session.mode === 'assessment' || session.ended_at || !current || current.answered || current.skipped
      || current.shown_at || current.visible_at || String(current.draft_answer ?? '').trim()) return null
    if (await db.prepare("SELECT id FROM learning_exposures WHERE item_id = ? AND kind = 'lesson' LIMIT 1").get(item.id)) return null
    const id = randomUUID()
    const next: Row = { ...current, ...replacement, id, interleaved: 0, partner_concept_id: null, mixed_evidence: null,
      shown_at: null, visible_at: null, confidence: null, confidence_at: null, confidence_revision: null, confidence_support: null,
      submitted_revision: null, task_evidence: null, revision_id: null, draft_answer: null, given_answer: null,
      rubric_json: replacement.rubric_json ?? null, scaffold_json: replacement.scaffold_json ?? null,
      lesson_json: replacement.lesson_json ?? (replacement.concept_id === undefined || replacement.concept_id === current.concept_id ? current.lesson_json : null), evidence_kind: replacement.evidence_kind ?? 'practice' }
    // Planned guided/faded help is never reset to independence by changing the prompt.
    next.hints_used = Math.max(Number(current.hints_used), Number(replacement.hints_used ?? 0))
    if (next.hints_used) {
      let hints: string[] = []; try { hints = JSON.parse(String(next.hints_json)) } catch { /* no content claim */ }
      next.hint_text = hints[Math.min(next.hints_used - 1, Math.max(0, hints.length - 1))] ?? current.hint_text
    } else next.hint_text = null
    const columns = (await db.prepare('PRAGMA table_info(session_items)').all()).map(c => String(c.name)).filter(name => name !== 'rowid')
    await db.prepare(`INSERT INTO session_items (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...columns.map(name => next[name] ?? null))
    await db.prepare("UPDATE session_items SET skipped = 1, skip_reason = 'replaced_before_display' WHERE id = ?").run(item.id)
    await stampTask(db, id, origin, sourceId)
    return id
  })
}
