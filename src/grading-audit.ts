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

export async function auditSummary(db: DatabaseSync, studentId: string) {
  const row = (await db.prepare("SELECT count(*) AS checked, coalesce(sum(parent_agrees), 0) AS agreed FROM grading_audits WHERE student_id = ?").get(studentId)) as { checked: number; agreed: number }
  return { checked: Number(row.checked), agreed: Number(row.agreed), waiting: (await auditSample(db, studentId, 20)).length }
}

export function auditPage(studentId: string, name: string, items: AuditItem[], summary: { checked: number; agreed: number }, titles: Record<string, string>) {
  const rate = summary.checked ? `You agreed with ${summary.agreed} of ${summary.checked} grades you checked (${Math.round((summary.agreed / summary.checked) * 100)}%).` : "You have not checked any grades yet."
  return `<p class="links"><a href="/students/${esc(studentId)}/scoreboard">${esc(name)}’s numbers</a></p>
  <h1>Check the tutor’s grading</h1>
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
