import { sealForStudent } from "./family-crypto.ts"
import { UserError } from "./errors.ts"
import type { Database as DatabaseSync } from "./database.ts"
import { recordDecision } from "./decisions.ts"
import { changeJob } from "./jobs.ts"
import { assertStudent, markPlanBuild, parseSubjects, removeTarget, removeTopic, writeProgram } from "./services.ts"
import { withdrawNote } from "./notes.ts"
import { withWrite, lockFamily } from "./transaction.ts"
import { contentGrade } from "./engine/course.ts"

/**
 * Undo works from the before-state recorded with each change. A change is undone only when the record
 * still matches the child's current state, so an older change can never overwrite a newer one. Changes that
 * destroy learner evidence (removing a topic, answers, grading, school results) are not undoable.
 */
export const UNDOABLE = new Set(["planner_change_applied", "target_added", "presentation_changed", "profile_changed", "placement_changed", "parent_note_left", "school_source_added", "pack_published", "pack_settings_changed"])

export type UndoCheck = { ok: true } | { ok: false; reason: string; done?: boolean }
interface Record_ { id: string; kind: string; details: string; student_id?: string }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export async function undoneIds(db: DatabaseSync, studentId: string) {
  const rows = (await db.prepare("SELECT details FROM decision_records WHERE student_id = ? AND kind = 'change_undone'").all(studentId)) as Array<{ details: string }>
  return new Set(rows.map((r) => { try { return String(JSON.parse(r.details).undoes ?? "") } catch { return "" } }).filter(Boolean))
}

function intentOf(record: Record_, details: any): string {
  if (record.kind !== "planner_change_applied") return record.kind
  return ({ set_test: "target_added", set_minutes_presentation: "presentation_changed", set_grade_birthday: "profile_changed", parent_note: "parent_note_left", add_class: "class_built", change_class: "class_built" } as Record<string, string>)[String(details.intent)] ?? "unknown"
}

async function studentState(db: DatabaseSync, studentId: string) {
  return (await db.prepare("SELECT presentation, session_cap_minutes, birth_date, grade, grade_hold, math_course, subjects, pack_child_requests, pack_child_mode, pack_daily_limit FROM students WHERE id = ?").get(studentId)) as any
}

async function newClassConcepts(db: DatabaseSync, studentId: string, subject: string, before: string[]) {
  const rows = (await db.prepare("SELECT concept_id FROM custom_concepts WHERE student_id = ? AND lower(subject) = lower(?)").all(studentId, subject)) as Array<{ concept_id: string }>
  const keep = new Set(before)
  return rows.map((r) => r.concept_id).filter((id) => !keep.has(id))
}

export async function undoCheck(db: DatabaseSync, studentId: string, record: Record_, undone?: Set<string>): Promise<UndoCheck> {
  if (!UNDOABLE.has(record.kind)) return { ok: false, reason: "This kind of change cannot be undone." }
  if ((undone ?? (await undoneIds(db, studentId))).has(record.id)) return { ok: false, reason: "Already undone.", done: true }
  let d: any
  try { d = JSON.parse(record.details || "{}") } catch { return { ok: false, reason: "This change has no saved details." } }
  const state = await studentState(db, studentId)
  switch (intentOf(record, d)) {
    case "target_added": {
      if (!d.targetId) return { ok: false, reason: "Recorded before undo was available." }
      const exists = await db.prepare("SELECT id FROM targets WHERE id = ? AND student_id = ?").get(d.targetId, studentId)
      return exists ? { ok: true } : { ok: false, reason: "That test date is already gone.", done: true }
    }
    case "presentation_changed": {
      const current = { presentation: String(state.presentation ?? "auto"), cap: Number(state.session_cap_minutes) }
      if (!d.before || !d.after) return { ok: false, reason: "Recorded before undo was available." }
      if (same(current, d.before)) return { ok: false, reason: "Already back to how it was.", done: true }
      return same(current, d.after) ? { ok: true } : { ok: false, reason: "Changed again later. Undo the newer change first." }
    }
    case "profile_changed": {
      const current = { birthDate: state.birth_date ?? null, grade: Number(state.grade), gradeHold: Number(state.grade_hold ?? 0) }
      if (!d.before || !d.after) return { ok: false, reason: "Recorded before undo was available." }
      if (same(current, d.before)) return { ok: false, reason: "Already back to how it was.", done: true }
      return same(current, d.after) ? { ok: true } : { ok: false, reason: "Changed again later. Undo the newer change first." }
    }
    case "placement_changed": {
      const current = { mathCourse: String(state.math_course || "grade"), subjects: parseSubjects(state.subjects) }
      if (!d.before || !d.after) return { ok: false, reason: "Recorded before undo was available." }
      if (same(current, d.before)) return { ok: false, reason: "Already back to how it was.", done: true }
      return same(current, d.after) ? { ok: true } : { ok: false, reason: "Changed again later. Undo the newer change first." }
    }
    case "parent_note_left": {
      if (!d.noteId) return { ok: false, reason: "Recorded before undo was available." }
      const note = (await db.prepare("SELECT read_at FROM parent_notes WHERE id = ? AND student_id = ?").get(d.noteId, studentId)) as { read_at: string | null } | undefined
      if (!note) return { ok: false, reason: "That note was already replaced or taken back.", done: true }
      return note.read_at ? { ok: false, reason: "Your child already read this note.", done: true } : { ok: true }
    }
    case "school_source_added": {
      if (!d.sourceId) return { ok: false, reason: "Recorded before undo was available." }
      const exists = await db.prepare("SELECT id FROM subject_sources WHERE id = ? AND student_id = ?").get(d.sourceId, studentId)
      return exists ? { ok: true } : { ok: false, reason: "That note is already gone.", done: true }
    }
    case "pack_published": {
      const pack = (await db.prepare("SELECT status FROM packs WHERE id = ? AND student_id = ?").get(d.packId, studentId)) as { status: string } | undefined
      if (!pack || pack.status === "undone") return { ok: false, reason: "That practice is already removed.", done: true }
      return pack.status === "published" ? { ok: true } : { ok: false, reason: "This practice can no longer be removed." }
    }
    case "pack_settings_changed": {
      const current = { requests: String(state.pack_child_requests), approval: String(state.pack_child_mode), dailyLimit: Number(state.pack_daily_limit) }
      if (!d.before || !d.after) return { ok: false, reason: "Recorded before undo was available." }
      if (same(current, d.before)) return { ok: false, reason: "Already back to how it was.", done: true }
      return same(current, d.after) ? { ok: true } : { ok: false, reason: "Changed again later. Undo the newer change first." }
    }
    case "class_built": {
      if (!Array.isArray(d.conceptsBefore) || !d.subject) return { ok: false, reason: "Recorded before undo was available." }
      const added = await newClassConcepts(db, studentId, String(d.subject), d.conceptsBefore)
      if (added.length) {
        const placeholders = added.map(() => "?").join(", ")
        const practised = await db.prepare(`SELECT id FROM attempts WHERE student_id = ? AND concept_id IN (${placeholders}) LIMIT 1`).get(studentId, ...added)
        if (practised) return { ok: false, reason: "Your child already practised these topics. Change the class instead." }
      }
      return { ok: true }
    }
    default:
      return { ok: false, reason: "This change cannot be undone." }
  }
}

/** Reverses one recorded change and records the undo. Returns a sentence for the parent. */
export async function undoDecision(db: DatabaseSync, ownerUserId: string, studentId: string, decisionId: string, now = new Date()) {
  return withWrite(db, async () => {
    await lockFamily(db, ownerUserId)
    await assertStudent(db, ownerUserId, studentId)
    const record = (await db.prepare("SELECT id, kind, details, student_id FROM decision_records WHERE id = ? AND student_id = ?").get(decisionId, studentId)) as Record_ | undefined
    if (!record) throw new UserError("That change was not found.")
    const check = await undoCheck(db, studentId, record)
    if (!check.ok) throw new UserError(check.reason)
    const d = JSON.parse(record.details || "{}")
    const kind = intentOf(record, d)
    let message = "Undone."
    switch (kind) {
      case "target_added":
        await removeTarget(db, ownerUserId, studentId, String(d.targetId))
        message = `${d.title ? `${d.title} is` : "The test date is"} removed. Missions follow the regular plan again.`
        break
      case "presentation_changed":
        await db.prepare("UPDATE students SET presentation = ?, session_cap_minutes = ? WHERE id = ?").run(d.before.presentation, d.before.cap, studentId)
        message = `Practice is back to ${d.before.cap} minutes with the ${d.before.presentation} presentation.`
        break
      case "profile_changed": {
        await db.prepare("UPDATE students SET birth_date = ?, grade = ?, grade_hold = ? WHERE id = ?").run(await sealForStudent(db, studentId, d.before.birthDate), d.before.grade, d.before.gradeHold, studentId)
        const state = await studentState(db, studentId)
        await writeProgram(db, studentId, contentGrade(Number(d.before.grade), state.math_course || "grade"))
        message = "The birthday and grade are back to how they were."
        break
      }
      case "placement_changed": {
        const state = await studentState(db, studentId)
        await db.prepare("UPDATE students SET math_course = ?, subjects = ? WHERE id = ?").run(d.before.mathCourse, JSON.stringify(d.before.subjects), studentId)
        await writeProgram(db, studentId, contentGrade(Number(state.grade), d.before.mathCourse))
        message = "The math course and subjects are back to how they were."
        break
      }
      case "parent_note_left":
        await withdrawNote(db, studentId, String(d.noteId))
        message = "The note is taken back before your child saw it."
        break
      case "school_source_added":
        await db.prepare("DELETE FROM subject_sources WHERE id = ? AND student_id = ?").run(d.sourceId, studentId)
        message = "That note to the planner is removed. The next rebuild will not use it."
        break
      case "pack_published": {
        // Questions already answered and their evidence stay; only what has not been used is taken back.
        await db.prepare("DELETE FROM practice_items WHERE student_id = ? AND pack_id = ? AND used_at IS NULL").run(studentId, d.packId)
        let removed = 0
        for (const conceptId of Array.isArray(d.createdConcepts) ? d.createdConcepts : []) {
          const practised = await db.prepare("SELECT id FROM attempts WHERE student_id = ? AND concept_id = ? LIMIT 1").get(studentId, conceptId)
          if (!practised && await db.prepare("SELECT 1 FROM custom_concepts WHERE student_id = ? AND concept_id = ?").get(studentId, conceptId)) { await removeTopic(db, ownerUserId, studentId, String(conceptId)); removed++ }
        }
        if (d.targetId && await db.prepare("SELECT id FROM targets WHERE id = ? AND student_id = ?").get(d.targetId, studentId)) await removeTarget(db, ownerUserId, studentId, String(d.targetId))
        await db.prepare("UPDATE packs SET status = 'undone', updated_at = ? WHERE id = ? AND student_id = ?").run(now.toISOString(), d.packId, studentId)
        message = `${d.title ? `The ${d.title} practice is` : "That practice is"} removed${removed ? ` with ${removed} new topic${removed === 1 ? "" : "s"}` : ""}. Answers already given stay in the history.`
        break
      }
      case "pack_settings_changed":
        await db.prepare("UPDATE students SET pack_child_requests = ?, pack_child_mode = ?, pack_daily_limit = ? WHERE id = ?").run(d.before.requests, d.before.approval, d.before.dailyLimit, studentId)
        message = "What your child can ask for is back to how it was."
        break
      case "class_built": {
        const subject = String(d.subject)
        if (d.jobId) {
          const job = (await db.prepare("SELECT status FROM jobs WHERE id = ?").get(d.jobId)) as { status: string } | undefined
          if (job && ["queued", "running"].includes(job.status)) await changeJob(db, ownerUserId, String(d.jobId), "cancel")
        }
        if (d.sourceId) await db.prepare("DELETE FROM subject_sources WHERE id = ? AND student_id = ?").run(d.sourceId, studentId)
        const added = await newClassConcepts(db, studentId, subject, d.conceptsBefore)
        for (const conceptId of added) await removeTopic(db, ownerUserId, studentId, conceptId)
        const before = d.before ?? {}
        if (!before.planExisted) {
          await db.prepare("DELETE FROM subject_plans WHERE student_id = ? AND lower(subject) = lower(?)").run(studentId, subject)
          const remaining = await db.prepare("SELECT 1 FROM custom_concepts WHERE student_id = ? AND lower(subject) = lower(?) LIMIT 1").get(studentId, subject)
          const subjects = Array.isArray(before.subjects) ? before.subjects : parseSubjects((await studentState(db, studentId)).subjects).filter((s: string) => s.toLowerCase() !== subject.toLowerCase() || remaining)
          await db.prepare("UPDATE students SET subjects = ? WHERE id = ?").run(JSON.stringify(subjects.length ? subjects : ["Math"]), studentId)
          message = `${subject} is removed, with the ${added.length} topic${added.length === 1 ? "" : "s"} it added.`
        } else {
          await db.prepare("UPDATE subject_plans SET about = ?, agenda = ?, syllabus_name = CASE WHEN ? = '' THEN syllabus_name ELSE ? END WHERE student_id = ? AND lower(subject) = lower(?)")
            .run(before.about ?? "", before.agenda ?? "", before.syllabusName ?? "", before.syllabusName ?? "", studentId, subject)
          await markPlanBuild(db, studentId, subject, "ready", "")
          message = added.length
            ? `${subject} is back to its earlier plan. ${added.length} new topic${added.length === 1 ? " was" : "s were"} removed; questions already written for existing topics stay.`
            : `${subject} is back to its earlier plan.`
        }
        if (before.mathCourse) {
          const state = await studentState(db, studentId)
          if (String(state.math_course || "grade") !== before.mathCourse) {
            await db.prepare("UPDATE students SET math_course = ? WHERE id = ?").run(before.mathCourse, studentId)
            await writeProgram(db, studentId, contentGrade(Number(state.grade), before.mathCourse))
          }
        }
        break
      }
    }
    await recordDecision(db, studentId, "change_undone", "The parent undid an earlier change.", { undoes: decisionId, kind: record.kind, intent: d.intent ?? null, message }, now)
    if (record.kind === "planner_change_applied" && d.proposalId) await db.prepare("UPDATE planner_messages SET status = 'undone' WHERE id = ? AND student_id = ?").run(d.proposalId, studentId)
    return message
  })
}

/** Undo status for each record on the history page, computed in one pass. */
export async function undoStates(db: DatabaseSync, studentId: string, records: Array<Record<string, unknown>>) {
  const undone = await undoneIds(db, studentId)
  const states = new Map<string, UndoCheck>()
  for (const record of records) {
    if (!UNDOABLE.has(String(record.kind))) continue
    states.set(String(record.id), await undoCheck(db, studentId, { id: String(record.id), kind: String(record.kind), details: String(record.details) }, undone))
  }
  return { states, undone }
}
