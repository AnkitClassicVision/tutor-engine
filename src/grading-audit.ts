// Parents check a small sample of the tutor's AI grades. Agreement is tracked; a disputed grade is
// kept on record but counts neither way, so a grading mistake never becomes mastery or a gap.
import type { Database as DatabaseSync } from "./database.ts"
import { UserError } from "./errors.ts"
import { recordDecision } from "./decisions.ts"
import { csrfField, esc } from "./view.ts"
import { BLOOM_NAME } from "./engine/types.ts"

export interface AuditItem { id: string; concept_id: string; bloom_level: number; prompt: string; answer: string; given_answer: string; correct: number; grader: string; grading_reason: string }

export async function auditSample(db: DatabaseSync, studentId: string, limit = 5, now = new Date()): Promise<AuditItem[]> {
  const since = new Date(now.getTime() - 30 * 86400000).toISOString()
  return (await db.prepare(`SELECT i.id, i.concept_id, i.bloom_level, i.prompt, i.answer, i.given_answer, i.correct, i.grader, i.grading_reason
    FROM session_items i JOIN tutor_sessions s ON s.id = i.session_id
    WHERE s.student_id = ? AND i.grader LIKE 'model:%' AND i.correct IS NOT NULL AND i.disputed = 0 AND coalesce(i.submitted_at, s.started_at) >= ?
      AND NOT EXISTS (SELECT 1 FROM grading_audits a WHERE a.item_id = i.id)
    ORDER BY i.bloom_level DESC, i.submitted_at DESC LIMIT ?`).all(studentId, since, limit)) as unknown as AuditItem[]
}

export async function recordAudit(db: DatabaseSync, studentId: string, itemId: string, agrees: boolean, now = new Date()) {
  const item = (await db.prepare(`SELECT i.id, i.correct, i.grader, i.concept_id FROM session_items i JOIN tutor_sessions s ON s.id = i.session_id WHERE i.id = ? AND s.student_id = ? AND i.grader LIKE 'model:%' AND i.correct IS NOT NULL`).get(itemId, studentId)) as { id: string; correct: number; grader: string; concept_id: string } | undefined
  if (!item) throw new UserError("That grade is not available to check.")
  if (await db.prepare("SELECT id FROM grading_audits WHERE item_id = ?").get(itemId)) throw new UserError("You already checked this grade.")
  await db.prepare("INSERT INTO grading_audits (id, student_id, item_id, grader, ai_correct, parent_agrees, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), studentId, itemId, item.grader, item.correct, agrees ? 1 : 0, now.toISOString())
  if (!agrees) {
    await db.prepare("UPDATE session_items SET disputed = 1 WHERE id = ?").run(itemId)
    await recordDecision(db, studentId, "grading_disputed", "A parent disagreed with the AI's grade. The answer stays on record but no longer counts as evidence either way.", { itemId, conceptId: item.concept_id, grader: item.grader, aiCorrect: item.correct === 1 }, now)
  }
}

export interface ConcernItem { id: string; concept_id: string; bloom_level: number; prompt: string; answer: string; given_answer: string; correct: number; grading_reason: string }

/** A child thinks a grade is wrong. One concern per answer, however many taps. The grade counts as it stands
 * until a parent decides, so a child cannot remove a miss by tapping; the parent can make it count neither way. */
export async function raiseConcern(db: DatabaseSync, studentId: string, sessionId: string, itemId: string, now = new Date()) {
  const item = (await db.prepare("SELECT id, correct, disputed, concern, concept_id FROM session_items WHERE id = ? AND session_id = ? AND answered = 1").get(itemId, sessionId)) as { id: string; correct: number | null; disputed: number; concern: string | null; concept_id: string } | undefined
  // Only a miss can be questioned: a concern about a win could otherwise be used to remove it.
  if (!item || item.correct !== 0 || item.disputed) throw new UserError("That answer is not waiting for a check.")
  if (item.concern) return
  await db.prepare("UPDATE session_items SET concern = 'open' WHERE id = ? AND concern IS NULL").run(itemId)
  await recordDecision(db, studentId, "child_concern", "The child thinks a grade may be wrong. It counts as it stands until a parent decides.", { itemId, conceptId: item.concept_id, correct: false }, now)
}

export async function concernItems(db: DatabaseSync, studentId: string): Promise<ConcernItem[]> {
  return (await db.prepare(`SELECT i.id, i.concept_id, i.bloom_level, i.prompt, i.answer, i.given_answer, i.correct, i.grading_reason
    FROM session_items i JOIN tutor_sessions s ON s.id = i.session_id
    WHERE s.student_id = ? AND i.concern = 'open' ORDER BY i.submitted_at`).all(studentId)) as unknown as ConcernItem[]
}

/** The parent keeps the grade, or agrees it is wrong: then the answer stays on record and counts neither way, as with any parent dispute. */
export async function resolveConcern(db: DatabaseSync, studentId: string, itemId: string, gradeWrong: boolean, now = new Date()) {
  const item = (await concernItems(db, studentId)).find(row => row.id === itemId)
  if (!item) throw new UserError("That answer is no longer waiting for you.")
  await db.prepare(`UPDATE session_items SET concern = ?${gradeWrong ? ", disputed = 1" : ""} WHERE id = ?`).run(gradeWrong ? "upheld" : "kept", itemId)
  await recordDecision(db, studentId, gradeWrong ? "grading_disputed" : "child_concern_kept", gradeWrong ? "A parent agreed with the child that a grade was wrong. The answer stays on record but no longer counts as evidence either way." : "A parent looked at the child's concern and kept the grade.", { itemId, conceptId: item.concept_id, correct: item.correct === 1 }, now)
}

export interface EscalatedItem { id: string; session_id: string; concept_id: string; bloom_level: number; prompt: string; answer: string; given_answer: string; grading_doubt: string }

/** Written answers saved while no AI could check them (or still waiting for a grade). The parent can decide them here. */
export async function waitingItems(db: DatabaseSync, studentId: string): Promise<EscalatedItem[]> {
  return (await db.prepare(`SELECT i.id, i.session_id, i.concept_id, i.bloom_level, i.prompt, i.answer, i.given_answer, i.grading_doubt
    FROM session_items i JOIN tutor_sessions s ON s.id = i.session_id
    WHERE s.student_id = ? AND i.answered = 1 AND i.correct IS NULL AND i.grading_doubt IS NULL AND i.disputed = 0 AND i.skipped = 0 AND coalesce(trim(i.given_answer), '') <> '' ORDER BY i.submitted_at`).all(studentId)) as unknown as EscalatedItem[]
}

/** Answers the tutor was still not fully confident about after grounding. They wait for a parent and count neither way. */
export async function escalatedItems(db: DatabaseSync, studentId: string): Promise<EscalatedItem[]> {
  return (await db.prepare(`SELECT i.id, i.session_id, i.concept_id, i.bloom_level, i.prompt, i.answer, i.given_answer, i.grading_doubt
    FROM session_items i JOIN tutor_sessions s ON s.id = i.session_id
    WHERE s.student_id = ? AND i.answered = 1 AND i.correct IS NULL AND i.grading_doubt IS NOT NULL ORDER BY i.submitted_at`).all(studentId)) as unknown as EscalatedItem[]
}

export async function auditSummary(db: DatabaseSync, studentId: string) {
  const row = (await db.prepare("SELECT count(*) AS checked, coalesce(sum(parent_agrees), 0) AS agreed FROM grading_audits WHERE student_id = ?").get(studentId)) as { checked: number; agreed: number }
  return { checked: Number(row.checked), agreed: Number(row.agreed), waiting: (await auditSample(db, studentId, 20)).length, unsure: (await escalatedItems(db, studentId)).length + (await concernItems(db, studentId)).length }
}

export function auditPage(studentId: string, name: string, items: AuditItem[], summary: { checked: number; agreed: number }, titles: Record<string, string>, unsure: EscalatedItem[] = [], concerns: ConcernItem[] = [], waiting: EscalatedItem[] = []) {
  const rate = summary.checked ? `You agreed with ${summary.agreed} of ${summary.checked} grades you checked (${Math.round((summary.agreed / summary.checked) * 100)}%).` : "You have not checked any grades yet."
  const unsureSection = unsure.length ? `<section class="panel unsure" aria-labelledby="unsure-title"><h2 id="unsure-title">The tutor isn’t fully sure about ${unsure.length === 1 ? "this answer" : `these ${unsure.length} answers`}</h2>
    <p>Two graders and a check against the topic’s own material still left some doubt, so you decide. Until you do, ${unsure.length === 1 ? "it counts" : "they count"} neither way.</p>
    ${unsure.map(item => `<article class="audit-item">
      <p class="fine">${esc(titles[item.concept_id] ?? item.concept_id)} · ${esc(BLOOM_NAME[item.bloom_level] ?? "")}</p>
      <p><strong>Question:</strong> ${esc(item.prompt)}</p>
      <p><strong>${esc(name)} answered:</strong> ${esc(item.given_answer)}</p>
      <p><strong>What a good answer needs:</strong> ${esc(item.answer.replace(/^rubric:\s*/i, ""))}</p>
      <p class="doubt"><strong>Why the tutor isn’t sure:</strong> ${esc(item.grading_doubt)}</p>
      <div class="audit-actions">
        <form method="post" action="/students/${esc(studentId)}/grading/${esc(item.id)}/decide">${csrfField()}<input type="hidden" name="correct" value="1"><button type="submit">It meets it</button></form>
        <form method="post" action="/students/${esc(studentId)}/grading/${esc(item.id)}/decide">${csrfField()}<input type="hidden" name="correct" value="0"><button type="submit" class="ghost">Not yet</button></form>
      </div>
    </article>`).join("")}
  </section>` : ""
  const concernSection = concerns.length ? `<section class="panel concerns" aria-labelledby="concerns-title"><h2 id="concerns-title">${esc(name)} thinks ${concerns.length === 1 ? "a grade is" : `${concerns.length} grades are`} wrong</h2>
    <p>The grade counts as it stands until you decide. If it is wrong, the answer stays on record and counts neither way.</p>
    ${concerns.map(item => `<article class="audit-item">
      <p class="fine">${esc(titles[item.concept_id] ?? item.concept_id)} · ${esc(BLOOM_NAME[item.bloom_level] ?? "")}</p>
      <p><strong>Question:</strong> ${esc(item.prompt)}</p>
      <p><strong>${esc(name)} answered:</strong> ${esc(item.given_answer)}</p>
      <p><strong>The tutor’s answer:</strong> ${esc(item.answer.replace(/^rubric:\s*/i, ""))}</p>
      <p><strong>The tutor said:</strong> ${item.correct ? "Meets it" : "Not yet"}. ${esc(item.grading_reason ?? "")}</p>
      <div class="audit-actions">
        <form method="post" action="/students/${esc(studentId)}/grading/${esc(item.id)}/concern">${csrfField()}<input type="hidden" name="wrong" value="1"><button type="submit">The grade is wrong</button></form>
        <form method="post" action="/students/${esc(studentId)}/grading/${esc(item.id)}/concern">${csrfField()}<input type="hidden" name="wrong" value="0"><button type="submit" class="ghost">Keep the grade</button></form>
      </div>
    </article>`).join("")}
  </section>` : ""
  const waitingSection = waiting.length ? `<section class="panel waiting" id="waiting" aria-labelledby="waiting-title"><h2 id="waiting-title">${waiting.length === 1 ? "A written answer is" : `${waiting.length} written answers are`} waiting for you</h2>
    <p>These have not been checked yet. Until you decide, ${waiting.length === 1 ? "it counts" : "they count"} neither way.</p>
    ${waiting.map(item => `<article class="audit-item">
      <p class="fine">${esc(titles[item.concept_id] ?? item.concept_id)} · ${esc(BLOOM_NAME[item.bloom_level] ?? "")}</p>
      <p><strong>Question:</strong> ${esc(item.prompt)}</p>
      <p><strong>${esc(name)} answered:</strong> ${esc(item.given_answer)}</p>
      <p><strong>What a good answer needs:</strong> ${esc(item.answer.replace(/^rubric:\s*/i, ""))}</p>
      <div class="audit-actions">
        <form method="post" action="/students/${esc(studentId)}/grading/${esc(item.id)}/decide">${csrfField()}<input type="hidden" name="correct" value="1"><button type="submit">It meets it</button></form>
        <form method="post" action="/students/${esc(studentId)}/grading/${esc(item.id)}/decide">${csrfField()}<input type="hidden" name="correct" value="0"><button type="submit" class="ghost">Not yet</button></form>
      </div>
    </article>`).join("")}
  </section>` : ""
  return `<p class="links"><a href="/students/${esc(studentId)}/scoreboard">${esc(name)}’s numbers</a></p>
  <h1>Check the tutor’s grading</h1>
  ${concernSection}
  ${waitingSection}
  ${unsureSection}
  <p>The AI grades written answers. Checking a few keeps it honest: if you disagree, that answer stops counting either way. ${esc(rate)}</p>
  ${items.length ? items.map(item => `<article class="panel audit-item">
    <p class="fine">${esc(titles[item.concept_id] ?? item.concept_id)} · ${esc(BLOOM_NAME[item.bloom_level] ?? "")}</p>
    <p><strong>Question:</strong> ${esc(item.prompt)}</p>
    <p><strong>${esc(name)} answered:</strong> ${esc(item.given_answer)}</p>
    <p><strong>What a good answer needs:</strong> ${esc(item.answer.replace(/^rubric:\s*/i, ""))}</p>
    <p><strong>The AI said:</strong> ${item.correct ? "Meets it" : "Not yet"}. ${esc(item.grading_reason ?? "")}</p>
    <div class="audit-actions">
      <form method="post" action="/students/${esc(studentId)}/grading/${esc(item.id)}">${csrfField()}<input type="hidden" name="agree" value="1"><button type="submit">I agree</button></form>
      <form method="post" action="/students/${esc(studentId)}/grading/${esc(item.id)}">${csrfField()}<input type="hidden" name="agree" value="0"><button type="submit" class="ghost">I disagree</button></form>
    </div>
  </article>`).join("") : "<p>Nothing to check right now. New AI grades appear here as your child works.</p>"}`
}
