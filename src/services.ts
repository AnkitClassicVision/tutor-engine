import { noteChangedMind } from "./museum.ts"
import { currentHealth, HEALTH_CHILD, HEALTH_PARENT, type AiHealth } from "./ai-health.ts"
import { conceptSubject, measuredSkill, supportSuppliesSkill } from "./engine/access.ts"
import type { Rubric } from "./rubric.ts"
import { sealFor, sealForStudent } from "./family-crypto.ts"
import { WORLDS } from './worlds.ts'
import { validateImage, stripImageMetadata } from "./image-validation.ts"
import { reserveUpload } from "./upload-reservations.ts"
import { UserError } from "./errors.ts"
import { childAnswer, childReasonText } from "./child-words.ts"
import { FreshPracticeRequired, type FreshContext } from './fresh-practice.ts'
import { feedbackState, promptIdentity } from './session-feedback.ts'
import { learningMilestones } from "./engine/adventure.ts"
import { cloudStorage, storePrivateFile, deletePrivateFile } from "./storage.ts"
import { onWriteRollback } from "./transaction.ts"
import { withWrite, lockFamily, withDatabaseScope } from './transaction.ts'
import { encryptSecret, decryptSecret } from "./secrets.ts"
import { missionArc } from "./engine/arc.ts"
import { PRESENTATIONS, ageBand, numberChoices } from "./engine/age.ts"
import { ChatGptError, chatgptAccessToken, chatgptConfig, distrustChatGptToken, readCredential, type ChatGptCredential, type ChatGptModel } from "./chatgpt.ts"
import type { AiProvider } from "./ai.ts"
import { randomInt, randomBytes } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Database as DatabaseSync } from "./database.ts"
import type { SQLInputValue } from "node:sqlite"
import { decisionContext, recordDecision } from "./decisions.ts"
import { assessmentEvidence } from "./assessment-evidence.ts"
import { corrective, inferError } from "./engine/diagnose.ts"
import { addDays, dayStamp, daysBetween } from "./engine/dates.ts"
import {
  applyTopicPick,
  biasTowardWeak,
  contentGrade,
  COURSE_LABEL,
  nextCourse,
  paceFor,
  strengthLabel,
  type MathCourse,
} from "./engine/course.ts"
import { gradeFromBirthday, gradeLabel, nextGradeChange } from "./engine/grade.ts"
import { buildGraph, loadBackbone, probeFailures, type ConceptGraph } from "./engine/graph.ts"
import { designQuestion, generateItem } from "./engine/items.ts"
import { readPatterns } from "./engine/patterns.ts"
import { emptyState, estimatedRetention, freshEvidence, initialState, projectState, workingBloom } from "./engine/mastery.ts"
import { needsJudgment, nonAttempt, requiresJudgment, scoreAnswer, scoreItem, type Gradable } from "./engine/score.ts"
import { weeklyScoreboard } from "./engine/scoreboard.ts"
import { buildQueue } from "./engine/select.ts"
import { buildSheet } from "./engine/sheets.ts"
import { activeFocus } from "./engine/targets.ts"
import { nextThermostat } from "./engine/thermostat.ts"
import { BLOOM_NAME, type AttemptRecord, type BloomLevel, type ConceptNode, type ErrorType, type LearnerConceptState, type Mode } from "./engine/types.ts"
import { lessonOpening, type ClassProposal, type ScoreLine } from "./talk.ts"

const graph = loadBackbone()

interface StudentRow {
  id: string
  owner_user_id: string
  display_name: string
  grade: number
  session_cap_minutes: number
  created_at: string
  birth_date: string | null
  grade_hold: number
  math_course: MathCourse
  subjects: string
  experiments?: string
}

export async function createStudent(
  db: DatabaseSync,
  ownerUserId: string,
  input: { displayName: string; grade?: number; birthDate?: string; gradeHold?: boolean; sessionCapMinutes: number },
  now = new Date(),
) {
  return withWrite(db, async () => {
    await lockFamily(db, ownerUserId)
    const name = input.displayName.trim()
    if (name.length < 1 || name.length > 80) throw new UserError("Student name is required.")
    const birthday = validBirthday(input.birthDate)
    const cap = input.sessionCapMinutes || 25
    if (!Number.isInteger(cap) || cap < 3 || cap > 25) throw new UserError("Session cap must be between 3 and 25 minutes.")
    let grade = Number(input.grade)
    let hold = 0
    if (birthday) {
      const computed = boundedGrade(gradeFromBirthday(birthday, now))
      if (input.gradeHold && Number.isInteger(grade)) {
        grade = boundedGrade(grade)
        hold = 1
      } else {
        grade = computed
      }
    } else if (!Number.isInteger(grade)) {
      throw new UserError("Add a birthday, or choose a grade.")
    } else {
      grade = boundedGrade(grade)
      hold = 1
    }
    const id = crypto.randomUUID()
    const today = dayStamp(now)
    const insertStudent = db.prepare(
      "INSERT INTO students (id, owner_user_id, display_name, grade, session_cap_minutes, created_at, birth_date, grade_hold) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    const insertState = db.prepare(
      `INSERT INTO learner_states (
        student_id, concept_id, bloom_level, mastery, stability_days, next_due, error_signatures, hints_last_10, mastered_in, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const insertTarget = db.prepare(
      "INSERT INTO targets (id, student_id, kind, title, deadline, concept_ids, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    await insertStudent.run(id, ownerUserId, await sealFor(db, ownerUserId, name), grade, cap, now.toISOString(), await sealFor(db, ownerUserId, birthday), hold)
    const yearIds: string[] = []
    for (const concept of graph.nodes.values()) {
      const state = initialState(concept, grade, today)
      await insertState.run(
        id,
        state.conceptId,
        state.bloomLevel,
        state.mastery,
        state.stabilityDays,
        state.nextDue,
        JSON.stringify(state.errorSignatures),
        state.hintsLast10,
        state.masteredIn,
        state.status,
      )
      if (concept.grade === grade && concept.subject === "math") yearIds.push(concept.conceptId)
    }
    await insertTarget.run(
      crypto.randomUUID(),
      id,
      "program",
      `${gradeLabel(grade)} math`,
      null,
      JSON.stringify(yearIds),
      1,
      now.toISOString(),
    )
    return id
  })
}

export async function assertStudent(db: DatabaseSync, ownerUserId: string, studentId: string, now = new Date()): Promise<StudentRow> {
  await lockFamily(db, ownerUserId)
  const row = (await db.prepare("SELECT * FROM students WHERE id = ? AND owner_user_id = ?").get(studentId, ownerUserId)) as
    | StudentRow
    | undefined
  if (!row) throw new UserError("Student not found.")
  return (await refreshGrade(db, row, now))
}

export async function listStudents(db: DatabaseSync, ownerUserId: string) {
  return (await db.prepare("SELECT * FROM students WHERE owner_user_id = ? ORDER BY created_at").all(ownerUserId)) as unknown as StudentRow[]
}

export async function listStates(db: DatabaseSync, studentId: string): Promise<LearnerConceptState[]> {
  const rows = (await db.prepare("SELECT * FROM learner_states WHERE student_id = ?").all(studentId)) as Array<Record<string, SQLInputValue>>
  const attempts = await loadAttempts(db, studentId)
  const today = dayStamp(new Date())
  const byConcept = new Map<string, AttemptRecord[]>()
  for (const attempt of attempts) {
    const group = byConcept.get(attempt.conceptId) ?? []
    group.push(attempt)
    byConcept.set(attempt.conceptId, group)
  }
  return rows.map(row => projectState(rowToState(row), byConcept.get(String(row.concept_id)) ?? [], today))
}

export async function createTarget(
  db: DatabaseSync,
  ownerUserId: string,
  studentId: string,
  input: { title: string; deadline: string; conceptIds: string[]; kind?: "target" | "curiosity"; notBefore?: string },
  now = new Date(),
) {
  await assertStudent(db, ownerUserId, studentId)
  const known = (await studentGraph(db, studentId))
  const conceptIds = input.conceptIds.filter((id) => known.nodes.has(id))
  if (!conceptIds.length) throw new UserError("Pick at least one concept.")
  const title = input.title.trim()
  if (!title) throw new UserError("Name the target.")
  if (input.kind !== "curiosity" && !/^\d{4}-\d{2}-\d{2}$/.test(input.deadline)) {
    throw new UserError("A dated target needs a deadline.")
  }
  if (input.kind !== "curiosity" && input.notBefore && input.deadline < input.notBefore) throw new UserError("The test date has already passed. Pick a date from today onward.")
  const id = crypto.randomUUID()
  await db.prepare(
    "INSERT INTO targets (id, student_id, kind, title, deadline, concept_ids, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    studentId,
    input.kind ?? "target",
    title,
    input.kind === "curiosity" ? null : input.deadline,
    JSON.stringify(conceptIds),
    input.kind === "curiosity" ? 0 : 10,
    now.toISOString(),
  )
  await recordDecision(db, studentId, "target_added", "The requested dated test or curiosity scope overlays the standing program.", {
    targetId: id, title, conceptIds, deadline: input.kind === "curiosity" ? null : input.deadline, kind: input.kind ?? "target",
  }, now)
  return id
}

export async function removeTarget(db: DatabaseSync, ownerUserId: string, studentId: string, targetId: string) {
  await assertStudent(db, ownerUserId, studentId)
  const result = await db.prepare("DELETE FROM targets WHERE id = ? AND student_id = ? AND kind != 'program'").run(targetId, studentId)
  return Number(result.changes) > 0
}

export { PRESENTATIONS }
export async function setPresentation(db: DatabaseSync, ownerUserId: string, studentId: string, input: { presentation?: string; cap?: number }) {
  const student = await assertStudent(db, ownerUserId, studentId)
  const before = { presentation: String((student as any).presentation ?? "auto"), cap: Number(student.session_cap_minutes) }
  const presentation = input.presentation ?? before.presentation, cap = input.cap ?? before.cap
  if (!PRESENTATIONS.includes(presentation as (typeof PRESENTATIONS)[number]) || !Number.isInteger(cap) || cap < 3 || cap > 25) throw new UserError("Choose a presentation and cap from 3 to 25 minutes.")
  await db.prepare("UPDATE students SET presentation = ?, session_cap_minutes = ? WHERE id = ?").run(presentation, cap, studentId)
  const after = { presentation, cap }
  if (before.presentation !== after.presentation || before.cap !== after.cap) await recordDecision(db, studentId, "presentation_changed", "The parent changed how practice is presented or how long it may run.", { before, after })
  return { before, after }
}

/** A child (or parent) picks the visual world; it is cosmetic and never touches learning records. */
export async function setWorld(db: DatabaseSync, ownerUserId: string, studentId: string, world: string) {
  await assertStudent(db, ownerUserId, studentId)
  if (!WORLDS.some((w) => w.id === world)) throw new UserError("Pick one of the worlds.")
  await db.prepare("UPDATE students SET world = ? WHERE id = ?").run(world, studentId)
}

export async function startTutorSession(
  db: DatabaseSync,
  ownerUserId: string,
  studentId: string,
  now = new Date(),
  options: {
    mode?: "session" | "assessment" | "homework"
    subject?: string
    picked?: { conceptIds: string[]; reason: string }
    focusConceptId?: string
    intent?: string
    durationMinutes?: number
    goal?: string
    materialId?: string
    questionId?: string
    targetId?: string
    /** Ordinary practice runs as a lesson-to-close arc; packs and checks pass false or a goal. */
    arc?: boolean
  } = {},
): Promise<string> {
  return withWrite(db, async (): Promise<string> => {
    const mode = options.mode ?? "session"
    const subject = (options.subject ?? "Math").trim() || "Math"
    let student = (await assertStudent(db, ownerUserId, studentId, now))
    if (sameSubject(subject, "Math")) student = (await maybeAdvanceCourse(db, student))
    const requested = options.durationMinutes ?? Number((student as any).last_duration ?? 10)
    if (![3, 5, 10, 15, 20, 25].includes(requested)) throw new UserError("Choose 3, 5, 10, 15, 20, or 25 minutes.")
    const duration = [3, 5, 10, 15, 20, 25].filter(n => n <= Math.min(requested, student.session_cap_minutes, 25)).at(-1) ?? 3
    const known = (await studentGraph(db, studentId))
    const today = dayStamp(now)
    const states = (await listStates(db, studentId))
    const byId = Object.fromEntries(states.map((state) => [state.conceptId, state]))
    const targets = (await loadTargets(db, studentId))
    const selected = options.targetId ? targets.find(t => t.id === options.targetId && t.kind === 'target' && t.deadline && t.deadline >= today) : null
    if (options.targetId && !selected) throw new UserError('This test focus is no longer active. Choose a current test or ordinary practice.')
    const focus = selected ?? activeFocus(targets, today)
    const focusSubject = focus?.conceptIds.map((id) => known.nodes.get(id)?.subject).find(Boolean)
    if (selected && (!focusSubject || !sameSubject(focusSubject, subject))) throw new UserError('Choose the subject for this test.')
    const roots =
      focus && focus.conceptIds.length && focusSubject && sameSubject(focusSubject, subject)
        ? focus.conceptIds
        : rootsForSubject(known, student, subject)
    if (!roots.length) throw new UserError(`Add a ${subject} topic before starting that subject.`)
    const subjectIds = new Set(
      [...known.nodes.values()].filter((concept) => sameSubject(concept.subject, subject)).map((concept) => concept.conceptId),
    )
    const weak = (await weakConceptIds(db, studentId, now)).filter((id) => subjectIds.has(id))
    const openCourse = roots.filter((id) => byId[id]?.status !== "mastered" || (byId[id]?.bloomLevel ?? 0) < 3)
    const preferred = options.focusConceptId && subjectIds.has(options.focusConceptId) ? options.focusConceptId : null
    const relevantGap = weak.find(id => roots.includes(id) || roots.some(root => known.nodes.get(root)?.prereqs.includes(id)))
    const frontierId = preferred ?? (relevantGap && mode !== 'assessment' ? relevantGap : openCourse[0] ?? roots[0])
    const frontier = (subjectIds.has(frontierId) ? known.nodes.get(frontierId) : undefined) ?? known.nodes.get(roots[0])
    if (!frontier) throw new UserError("No concept is available for this student.")
    const review = states
      .filter((state) => (subjectIds.has(state.conceptId) || mode === "session") && state.conceptId !== frontier.conceptId && state.nextDue <= today && (state.status === "mastered" || state.status === "review_due" || weak.includes(state.conceptId)))
      .sort((a, b) => a.nextDue.localeCompare(b.nextDue) || a.stabilityDays - b.stabilityDays)
      .map((state) => ({ conceptId: state.conceptId, bloom: Math.max(1, state.bloomLevel) as BloomLevel }))
    const stretch = roots.find((id) => id !== frontier.conceptId) ?? null
    const comparable = await rollingSix(db, studentId, frontier.conceptId, workingBloom(byId[frontier.conceptId]))
    const pace = mode === "assessment" ? { itemCount: 6, frontier: 4, review: 1, stretch: 1 } : paceFor(comparable.length >= 6 ? comparable.filter(Boolean).length / comparable.length : null)
    const queued = buildQueue({
      frontierConceptId: frontier.conceptId,
      frontierBloom: options.goal === "parallel_practice" ? 3 : preferred && byId[preferred]?.nextDue <= today && (byId[preferred]?.status === "mastered" || byId[preferred]?.status === "review_due")
        ? Math.max(1, byId[preferred].bloomLevel) as BloomLevel : workingBloom(byId[frontier.conceptId]),
      review,
      stretchConceptId: stretch,
      itemCount: pace.itemCount,
      counts: { frontier: pace.frontier, review: pace.review, stretch: pace.stretch },
    })
    const biased = mode === "homework" ? biasTowardWeak(queued, weak, workingBloom(byId[weak[0] ?? ""])) : queued
    const pickedIds = (options.picked?.conceptIds ?? []).filter((id) => known.nodes.has(id))
    let queue = pickedIds.length && mode !== "session" ? applyTopicPick(biased, pickedIds, mode) : biased
    const unfamiliar = (byId[frontier.conceptId]?.independentChecks ?? 0) < 2
    // The youngest band answers first checks on number questions with four large tiles.
    const probeMission = mode === "session" && (unfamiliar || options.goal === "harder_probe")
    // A first check cut short by time or a pause carries on in the next mission instead of starting over.
    if (probeMission && options.goal !== "resume") {
      const open = await db.prepare(`SELECT s.id FROM tutor_sessions s WHERE s.student_id = ? AND s.mode = 'session' AND s.goal IN ('probe', 'harder_probe')
        AND ((s.ended_at IS NOT NULL AND s.end_reason = 'attention') OR (s.ended_at IS NULL AND s.paused_at IS NOT NULL)) AND s.started_at >= ?
        AND (s.carried_from IS NOT NULL OR EXISTS (SELECT 1 FROM session_items i WHERE i.session_id = s.id AND i.answered = 1))
        AND EXISTS (SELECT 1 FROM session_items i WHERE i.session_id = s.id AND i.answered = 0 AND i.skipped = 0 AND i.concept_id = ?)
        ORDER BY s.started_at DESC LIMIT 1`).get(studentId, new Date(now.getTime() - 7 * 86400000).toISOString(), frontier.conceptId)
      if (open) return resumeSession(db, ownerUserId, String(open.id), duration)
    }
    const arcMission = mode === "session" && !probeMission && !options.goal && options.intent === "practice" && options.arc !== false && !options.materialId && !options.questionId
    const tiles = probeMission && ageBand(student, now.getTime()) === "5-7"
    if (mode === "session" && (unfamiliar || options.goal === "harder_probe")) {
      const start = options.goal === "harder_probe" ? Math.min(6, Math.max(3, workingBloom(byId[frontier.conceptId]) + 1)) : workingBloom(byId[frontier.conceptId])
      queue = [start, Math.min(6, start + 1), start, start, Math.min(6, start + 1), Math.min(6, start + 1)].map((level, i) => ({
        beat: i < 2 ? "warmup" : i === 5 ? "stretch" : "frontier",
        conceptId: frontier.conceptId, bloomLevel: level as BloomLevel,
        interleaved: i === 5 && Boolean(frontier.prereqs[0]), partnerConceptId: i === 5 ? frontier.prereqs[0] ?? null : null, scored: true,
      }))
    }
    // Keep one established idea in a short diagnostic mission, while checking the new focus.
    if (mode === 'session' && unfamiliar && review[0] && queue.length >= 6) queue[2] = {
      beat: 'warmup', conceptId: review[0].conceptId, bloomLevel: review[0].bloom,
      interleaved: false, partnerConceptId: null, scored: true,
    }
    if (arcMission) queue = missionArc(queue, duration)
    const continuity = options.picked?.reason
      ? `${options.picked.reason} ${(await continuityLine(db, studentId, today))}`
      : (await continuityLine(db, studentId, today))
    const sessionId = crypto.randomUUID()
    const seen = (await seenPrompts(db, studentId))
    const recallChecks = new Set<string>()
    const job = mode === "assessment" ? "assessment" : "homework"
    await db.prepare(
      `INSERT INTO tutor_sessions (
        id, student_id, started_at, modality, consecutive_step_downs, cap_minutes, continuity, mode, subject
      ) VALUES (?, ?, ?, 'paper', 0, ?, ?, ?, ?)`,
    ).run(sessionId, studentId, now.toISOString(), duration, continuity, mode, subject)
    await db.prepare("UPDATE students SET last_duration = ? WHERE id = ?").run(requested, studentId)
    await db.prepare("UPDATE tutor_sessions SET requested_at = ? WHERE id = ?").run(now.toISOString(), sessionId)
    await db.prepare("UPDATE tutor_sessions SET goal = ?, material_id = ?, question_id = ?, lesson_done = ? WHERE id = ?").run(options.goal ?? (probeMission ? "probe" : options.intent ?? mode), options.materialId ?? null, options.questionId ?? null, arcMission ? 0 : 1, sessionId)
    for (const [index, slot] of (queue).entries()) {
      const concept = known.nodes.get(slot.conceptId)!
      const partner = slot.partnerConceptId ? known.nodes.get(slot.partnerConceptId) ?? null : null
      const item = generateItem(concept, slot.bloomLevel, randomInt(1, 1_000_000_000), {
        interleaved: slot.interleaved,
        partner,
        itemId: crypto.randomUUID(),
      })
      const practice = (await claimPractice(db, studentId, slot.conceptId, now, slot.bloomLevel, seen))
      const fresh = practice && !isGenericDrill(practice.prompt)
      const designed = concept.conceptId.startsWith("math.") || (slot.bloomLevel !== 3 && slot.bloomLevel !== 6)
        ? null
        : designQuestion({
            title: concept.title,
            recall: concept.recall,
            job,
            kind: slot.bloomLevel === 6 ? "create" : "apply",
            seed: index + 1 + concept.title.length,
            seen: [...seen],
          })
      const prompt = fresh ? practice.prompt : designed?.prompt ?? item.prompt
      const answer = fresh ? practice.answer : designed?.answer ?? item.answer
      const bloom = fresh ? practice.bloom : designed?.bloom ?? item.bloomLevel
      const hints = fresh && practice.hints?.length
        ? practice.hints
        : fresh || designed
          ? ["What is this question asking you to do?", "Write the first step or one relevant observation and explain it.", `Compare your work with this key or rubric: ${answer}. Then try a new parallel example.`]
          : item.hintLadder
      let selectedPrompt = prompt, selectedAnswer = answer, selectedBloom = bloom, selectedHints = hints
      let selectedFormat = fresh ? practice.format : "text", selectedChoices = fresh ? practice.choices : null, selectedExplanation = fresh ? practice.explanation : ""
      for (let tries = 0; seen.has(promptIdentity(selectedPrompt)) && tries < 24; tries++) {
        const alternative = generateItem(concept, slot.bloomLevel, randomInt(1, 1_000_000_000), { itemId:item.itemId, interleaved:slot.interleaved, partner })
        selectedPrompt=alternative.prompt; selectedAnswer=alternative.answer; selectedBloom=alternative.bloomLevel; selectedHints=alternative.hintLadder
        selectedFormat="text"; selectedChoices=null; selectedExplanation=""
      }
      if (tiles && selectedFormat === "text" && !selectedChoices) {
        const choices = numberChoices(String(selectedAnswer), String(selectedPrompt), parseInt(item.itemId.replace(/-/g, "").slice(0, 8), 16))
        if (choices) { selectedFormat = "choice"; selectedChoices = choices }
      }
      const recallKey = `${item.conceptId}:${selectedAnswer}`
      const repeated = seen.has(promptIdentity(selectedPrompt)) || (mode !== "assessment" && selectedBloom === 1 && recallChecks.has(recallKey))
      if (selectedBloom === 1 && !repeated) recallChecks.add(recallKey)
      if (!repeated) seen.add(promptIdentity(selectedPrompt))
      await db.prepare(
        `INSERT INTO session_items (
          id, session_id, position, beat, concept_id, bloom_level, prompt, answer, hints_json, surface,
          interleaved, partner_concept_id, hints_used, answered, format, choices_json, explanation
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
      ).run(
        item.itemId,
        sessionId,
        index + 1,
        slot.beat,
        item.conceptId,
        selectedBloom,
        selectedPrompt,
        selectedAnswer,
        JSON.stringify(selectedHints),
        item.surface,
        item.interleaved ? 1 : 0,
        item.partnerConceptId,
        selectedFormat,
        selectedChoices ? JSON.stringify(selectedChoices) : null,
        selectedExplanation,
      )
      if (repeated) await db.prepare("UPDATE session_items SET skipped = 1, skip_reason = 'repeated_prompt' WHERE id = ?").run(item.itemId)
      // A question written to use the idea somewhere new is transfer evidence when answered unaided.
      if (fresh && practice.kind === "transfer" && selectedPrompt === practice.prompt) await db.prepare("UPDATE session_items SET evidence_kind = 'transfer' WHERE id = ?").run(item.itemId)
      // The rubric written with the question travels with it, so grading marks against it.
      if (fresh && practice.rubric && selectedPrompt === practice.prompt) await db.prepare("UPDATE session_items SET rubric_json = ? WHERE id = ?").run(practice.rubric, item.itemId)
      // Guided work starts with the fuller hint showing and faded work with the first one; both count as help.
      if (slot.beat === "guided" || slot.beat === "faded") {
        const shown = slot.beat === "guided" ? selectedHints[1] ?? selectedHints[0] : selectedHints[0]
        if (shown) await db.prepare("UPDATE session_items SET hint_text = ?, hints_used = 1 WHERE id = ?").run(shown, item.itemId)
      }
    }
    if (!(await sessionItems(db, sessionId)).length) throw new FreshPracticeRequired(frontier.conceptId, subject)
    await recordDecision(db, studentId, "session_started", unfamiliar ? "Start with two brief probes, then practice and a fresh independent check. Placement remains provisional." : continuity, {
      sessionId, mode, subject, intent: options.intent ?? mode, targetId: focus?.id ?? null,
      reviewConcepts: review.map((row) => row.conceptId), frontier: frontier.conceptId, pace,
      placement: byId[frontier.conceptId]?.placement ?? "provisional", contentGrade: frontier.grade,
      decisionReason: "School level selects an initial topic; independent evidence selects Bloom demand. Diagnostic results remain provisional until repeated across days.",
    }, now)
    return sessionId
  })
}

export async function nextLearningAction(db: DatabaseSync, ownerId: string, studentId: string, now = new Date()) {
  const student = (await assertStudent(db, ownerId, studentId, now))
  const known = (await studentGraph(db, studentId))
  const today = dayStamp(now)
  const states = (await listStates(db, studentId))
  const focus = activeFocus((await loadTargets(db, studentId)), today)
  const pack = await packFocus(db, studentId, known, now)
  let conceptId = pack?.conceptId ?? (focus?.kind === "target" ? focus.conceptIds[0] : undefined)
  let reason = pack ? pack.reason : conceptId ? `${focus!.title} is due ${focus!.deadline}; it leads until then.` : ""
  const followup = (await db.prepare("SELECT concept_id FROM followup_missions WHERE student_id = ? AND due <= ? AND completed_session IS NULL ORDER BY due LIMIT 1").get(studentId, today))
  if (!conceptId && followup && known.nodes.has(String(followup.concept_id))) { conceptId = String(followup.concept_id); reason = "A follow-up from your schoolwork is ready. Try a new parallel question." }
  const weak = (await weakConceptIds(db, studentId, now))[0]
  const due = states.filter((state) => known.nodes.has(state.conceptId) && state.nextDue <= today
    && Boolean(state.independentChecks))
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue))[0]
  if (!conceptId && weak) { conceptId = weak; reason = "Recent answers show a gap here; practice it before adding difficulty." }
  if (!conceptId && due) { conceptId = due.conceptId; reason = `A retention check is due ${due.nextDue}; recall it before moving on.` }
  if (!conceptId) {
    const newest = (await db.prepare("SELECT subject FROM subject_sources WHERE student_id = ? ORDER BY rowid DESC LIMIT 1").get(studentId))
    const candidates = [...known.nodes.values()].filter((node) => !newest || sameSubject(node.subject, String(newest.subject)))
    conceptId = candidates.find((node) => states.find((state) => state.conceptId === node.conceptId)?.status !== "mastered" && node.grade === contentGrade(student.grade, student.math_course))?.conceptId
      ?? candidates.find((node) => states.find((state) => state.conceptId === node.conceptId)?.status !== "mastered")?.conceptId
      ?? focus?.conceptIds[0]
    reason = newest ? "The newest school material sets the next focus; the standing course stays." : "This is the next open concept in the standing course."
  }
  const concept = conceptId ? known.nodes.get(conceptId) : null
  const state = states.find((row) => row.conceptId === conceptId)
  const last = (await db.prepare("SELECT day FROM attempts WHERE student_id = ? AND concept_id = ? ORDER BY created_at DESC LIMIT 1").get(studentId, conceptId ?? ""))
  const retentionEstimate = state && last ? estimatedRetention(state.stabilityDays, daysBetween(String(last.day), today)) : null
  return concept ? { conceptId: concept.conceptId, title: concept.title, subject: concept.subject, reason, retentionEstimate, packId: pack?.conceptId === concept.conceptId ? pack.packId : null, lessonFirst: Boolean(pack?.lessonFirst && pack.conceptId === concept.conceptId) } : null
}

/**
 * A learning pack someone asked for in the last two weeks leads until its questions are used. The first visit starts
 * with the pack's short lesson; later visits move to the next skill that still has questions waiting.
 */
async function packFocus(db: DatabaseSync, studentId: string, known: ConceptGraph, now: Date) {
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString()
  const packs = (await db.prepare("SELECT id, title, concept_ids, first_session_id FROM packs WHERE student_id = ? AND status = 'published' AND published_at >= ? ORDER BY published_at DESC LIMIT 3")
    .all(studentId, since)) as Array<{ id: string; title: string; concept_ids: string; first_session_id: string | null }>
  for (const pack of packs) {
    let ids: string[] = []
    try { ids = JSON.parse(pack.concept_ids) } catch { ids = [] }
    for (const conceptId of ids) {
      if (!known.nodes.has(conceptId)) continue
      const left = Number(((await db.prepare("SELECT count(*) AS n FROM practice_items WHERE student_id = ? AND pack_id = ? AND concept_id = ? AND used_at IS NULL").get(studentId, pack.id, conceptId)) as { n: number }).n)
      if (left >= 2) return { packId: pack.id, conceptId, lessonFirst: !pack.first_session_id, reason: pack.first_session_id ? `More from your ${pack.title} practice is ready.` : `Your ${pack.title} practice is ready. It starts with a one-minute lesson.` }
    }
  }
  return null
}

/** Finds a topic by name: the learner's own topic first, then the built-in course. */
export async function findConceptByTitle(db: DatabaseSync, studentId: string, subject: string, title: string) {
  const own = (await db.prepare("SELECT concept_id FROM custom_concepts WHERE student_id = ? AND lower(subject) = lower(?) AND lower(title) = lower(?)").get(studentId, subject, title)) as { concept_id: string } | undefined
  if (own) return own.concept_id
  return [...graph.nodes.values()].find((node) => sameSubject(node.subject, subject) && node.title.toLowerCase() === title.trim().toLowerCase())?.conceptId ?? null
}

/** Adds a one-off topic for a learning pack. It does not join the standing course and creates no test date. */
export async function addPackConcept(db: DatabaseSync, studentId: string, input: { subject: string; title: string; recall: string; example: string; nonExample: string }, now = new Date()) {
  const student = (await db.prepare("SELECT grade FROM students WHERE id = ?").get(studentId)) as { grade: number } | undefined
  if (!student) throw new UserError("Student not found.")
  const conceptId = `custom.${crypto.randomUUID()}`
  await db.prepare(
    "INSERT INTO custom_concepts (concept_id, student_id, subject, grade, title, recall, example, non_example, purpose, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'special', ?)",
  ).run(conceptId, studentId, input.subject, Number(student.grade), input.title, input.recall || input.title, input.example || input.title, input.nonExample || `Not an example of ${input.title}`, now.toISOString())
  const fresh = emptyState(conceptId, dayStamp(now))
  await db.prepare(
    `INSERT INTO learner_states (
      student_id, concept_id, bloom_level, mastery, stability_days, next_due, error_signatures, hints_last_10, mastered_in, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(studentId, conceptId, fresh.bloomLevel, fresh.mastery, fresh.stabilityDays, fresh.nextDue, "[]", 0, null, fresh.status)
  return conceptId
}

/** Stores one checked learning-pack question with its format, options, hints and explanation. */
export async function insertPackItem(db: DatabaseSync, studentId: string, packId: string, conceptId: string,
  item: { prompt: string; answer: string; bloom: number; format: string; choices: string[] | null; hints: string[]; explanation: string; rubric?: Rubric | null }, now = new Date()) {
  await db.prepare(
    "INSERT INTO practice_items (id, student_id, concept_id, prompt, answer, bloom_level, created_at, pack_id, format, choices_json, hints_json, explanation, rubric_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(crypto.randomUUID(), studentId, conceptId, item.prompt, item.answer, item.bloom, now.toISOString(), packId, item.format, item.choices ? JSON.stringify(item.choices) : null, JSON.stringify(item.hints), item.explanation, item.rubric ? JSON.stringify(item.rubric) : null)
}

export async function getOwnedSession(db: DatabaseSync, ownerUserId: string, sessionId: string) {
  await lockFamily(db, ownerUserId)
  const row = (await db
    .prepare(
      `SELECT tutor_sessions.*, students.owner_user_id, students.display_name
       FROM tutor_sessions JOIN students ON students.id = tutor_sessions.student_id
       WHERE tutor_sessions.id = ? AND students.owner_user_id = ?`,
    )
    .get(sessionId, ownerUserId)) as Record<string, SQLInputValue> | undefined
  if (!row) throw new UserError("Session not found.")
  return row
}

export async function sessionItems(db: DatabaseSync, sessionId: string) {
  return (await db.prepare("SELECT * FROM session_items WHERE session_id = ? AND skipped = 0 ORDER BY position").all(sessionId)) as Array<
    Record<string, SQLInputValue>
  >
}

export async function submitAnswer(
  db: DatabaseSync,
  ownerUserId: string,
  sessionId: string,
  input: { itemId: string; answer: string; timeMs?: number; errorType?: ErrorType; frustrated?: boolean; confidence?: string },
  now = new Date(),
) {
  return withWrite(db, async () => {
    let session = (await getOwnedSession(db, ownerUserId, sessionId))
    if (session.ended_at) return { ended: true as const, reason: String(session.end_reason ?? "done") }
    if (session.paused_at) {
      // Answering after a pause picks the clock up where it stopped; time away never counts.
      const away = Math.max(0, now.getTime() - Date.parse(String(session.paused_at)))
      // The shifted start keeps the time cap honest; the original request time and the total pause are kept apart.
      await db.prepare("UPDATE tutor_sessions SET started_at = ?, paused_at = NULL, paused_ms = coalesce(paused_ms, 0) + ? WHERE id = ?").run(new Date(Date.parse(String(session.started_at)) + away).toISOString(), Math.round(away), sessionId)
      session = (await getOwnedSession(db, ownerUserId, sessionId))
    }
    const started = new Date(String(session.started_at)).getTime()
    const minutes = (now.getTime() - started) / 60000
    if (minutes >= Number(session.cap_minutes)) {
      await endSession(db, sessionId, "attention", now)
      return { ended: true as const, reason: "attention" }
    }
    if (session.break_until && String(session.break_until) > now.toISOString()) {
      return { ended: false as const, break: true as const }
    }
    const items = (await sessionItems(db, sessionId))
    const current = items.find((item) => item.answered === 0)
    const priorSubmission = items.find(item => item.id === input.itemId && item.answered === 1)
    if (priorSubmission) return { ended: false as const, duplicate: true, pendingReview: priorSubmission.correct == null }
    if (feedbackState(String(session.mode), items, Number(session.feedback_cursor ?? 0)).checkpoint) throw new UserError("Review your feedback before the next question.")
    if (!current || current.id !== input.itemId) throw new UserError("That item is not the current one.")
    const raw = input.answer ?? ""
    // How sure the child said they were. Optional; stored beside the answer to compare with the result.
    if (["sure", "think", "guess"].includes(String(input.confidence))) await db.prepare("UPDATE session_items SET confidence = ? WHERE id = ?").run(input.confidence!, current.id)
    const expected = String(current.answer)
    const gradable = itemGradable(current)
    const scored = scoreItem(gradable, raw)
    const timeMs = Math.max(0, Math.min(input.timeMs ?? 0, 30 * 60 * 1000))
    // Not a try at the question: ask again without scoring, diagnosing, grading or spending the prompt.
    const notTried = nonAttempt(gradable, raw)
    if (notTried) {
      let earlier = 0
      try { const pending = session.pending_feedback ? JSON.parse(String(session.pending_feedback)) : null; if (pending?.action === "reask" && pending.itemId === current.id) earlier = Number(pending.count) || 1 } catch { earlier = 0 }
      const count = earlier + 1
      await db.prepare("UPDATE session_items SET draft_answer = NULL WHERE id = ?").run(current.id)
      await db.prepare("UPDATE tutor_sessions SET pending_feedback = ? WHERE id = ?").run(JSON.stringify({ action: "reask", itemId: current.id, prompt: current.prompt, count, reason: notTried }), sessionId)
      await recordDecision(db, String(session.student_id), "non_attempt", "The reply was not a try at the question, so it was not scored and the question was asked again.", {
        sessionId, itemId: current.id, conceptId: current.concept_id, reason: notTried, count,
      }, now)
      return { ended: false as const, reask: true as const, count }
    }
    if (needsJudgment(gradable, Number(current.bloom_level)) || !raw.trim() || /^(?:\?|unreadable|unclear|illegible)$/i.test(raw.trim())) {
      await db.prepare("UPDATE session_items SET answered = 1, given_answer = ?, time_ms = ?, submitted_at = ?, correct = NULL WHERE id = ?")
        .run(await sealForStudent(db, String(session.student_id), raw), timeMs, now.toISOString(), current.id)
      await db.prepare("UPDATE tutor_sessions SET pending_feedback = NULL WHERE id = ?").run(sessionId)
      await recordDecision(db, String(session.student_id), "answer_submitted", "Written reasoning requires a rubric verdict before it can count.", {
        sessionId, itemId: current.id, conceptId: current.concept_id, bloomLevel: current.bloom_level,
      }, now)
      return { ended: false as const, pendingReview: true as const, correct: null }
    }
    const previousTimes = items.filter((item) => item.answered === 1 && item.time_ms != null).map((item) => Number(item.time_ms))
    const median = medianOf(previousTimes)
    const priorWrong = (await db
      .prepare(
        `SELECT given_answer FROM session_items
         WHERE concept_id = ? AND answered = 1 AND correct = 0 AND given_answer IS NOT NULL
         AND session_id IN (SELECT id FROM tutor_sessions WHERE student_id = ?)`,
      )
      .all(String(current.concept_id), String(session.student_id))) as Array<{ given_answer: string }>
    const sameWrong = priorWrong.some((row) => normalizeLoose(row.given_answer) === normalizeLoose(raw) && raw.trim())
    const errorType = scored.correct
      ? null
      : input.errorType ??
        inferError({
          raw,
          correct: false,
          timeMs,
          medianTimeMs: median,
          sameWrongAnswerSeen: sameWrong,
          lateInSession: Number(current.position) > 6,
        })
    const attemptId = String(current.id)
    const today = dayStamp(now)
    await db.prepare(
      `INSERT INTO attempts (
        id, student_id, session_id, concept_id, bloom_level, day, correct, hints_used, interleaved, time_ms, error_type, modality, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      attemptId,
      session.student_id,
      sessionId,
      current.concept_id,
      current.bloom_level,
      today,
      scored.correct ? 1 : 0,
      current.hints_used,
      current.interleaved,
      timeMs,
      errorType,
      current.surface,
      now.toISOString(),
    )
    await db.prepare(
      "UPDATE session_items SET answered = 1, correct = ?, error_type = ?, time_ms = ?, given_answer = ?, submitted_at = ? WHERE id = ?",
    ).run(scored.correct ? 1 : 0, errorType, timeMs, await sealForStudent(db, String(session.student_id), raw), now.toISOString(), current.id)
    if (scored.correct) await noteChangedMind(db, sessionId, String(current.id), now)
    const teachingConcept = (await studentGraph(db, String(session.student_id))).nodes.get(String(current.concept_id))
    const recovery = scored.correct ? null : childCorrection(errorType ? corrective(errorType).label : "Let’s check the idea", current, teachingConcept)
    const flags = (await rollingSix(db, String(session.student_id), String(current.concept_id), Number(current.bloom_level)))
    const action = nextThermostat({
      recentCorrect: flags,
      consecutiveStepDowns: Number(session.consecutive_step_downs),
      modality: session.modality as Mode,
      timeOnItemMs: timeMs || null,
      medianTimeMs: median,
      frustrated: input.frustrated === true,
      minutesInBlock: minutes,
      attentionBlockMinutes: Number(session.cap_minutes),
    })
    let consecutive = Number(session.consecutive_step_downs)
    let modality = String(session.modality)
    let breakUntil: string | null = null
    if (action.type === "step_down") consecutive += 1
    if (action.type === "step_up" || action.type === "change_modality" || action.type === "hold" || scored.correct) consecutive = 0
    if (action.type === "change_modality") modality = action.to
    if (action.type === "hint_then_break") breakUntil = new Date(now.getTime() + 2 * 60 * 1000).toISOString()
    if (action.type === "end_session") await endSession(db, sessionId, "attention", now)
    else {
      await db.prepare(
        "UPDATE tutor_sessions SET consecutive_step_downs = ?, modality = ?, break_until = ?, pending_feedback = ? WHERE id = ?",
      ).run(
        consecutive,
        modality,
        breakUntil,
        JSON.stringify({
          correct: scored.correct,
          errorType,
          itemId: current.id,
          corrective: recovery,
          action: action.type,
          confidence: ["sure", "think", "guess"].includes(String(input.confidence)) ? input.confidence : null,
        }),
        sessionId,
      )
      if (action.type === "step_up" || action.type === "step_down") {
        const next = (await sessionItems(db, sessionId)).find((item) => item.answered === 0 && item.concept_id === current.concept_id && item.bloom_level === current.bloom_level)
        if (next) await rewriteItem(db, next, action.type === "step_up" ? 1 : -1)
      }
      if (action.type === "change_modality") {
        const next = (await sessionItems(db, sessionId)).find((item) => item.answered === 0 && item.concept_id === current.concept_id && item.bloom_level === current.bloom_level)
        if (next) await db.prepare("UPDATE session_items SET surface = ? WHERE id = ?").run(action.to, next.id)
      }
    }
    if (!scored.correct && modeForRecovery(session) && teachingConcept?.prereqs.length) {
      const prerequisite = teachingConcept.prereqs.find(id => id !== current.concept_id)
      const next = (await sessionItems(db, sessionId)).find(i => i.answered === 0 && i.concept_id === current.concept_id)
      const node = prerequisite ? (await studentGraph(db, String(session.student_id))).nodes.get(prerequisite) : null
      if (next && node && Number(current.position) <= 2) {
        const probe = generateItem(node, 1, randomInt(1, 1_000_000_000), { itemId: String(next.id) })
        await db.prepare("UPDATE session_items SET concept_id = ?, bloom_level = 1, prompt = ?, answer = ?, hints_json = ?, beat = 'warmup', interleaved = 0, partner_concept_id = NULL WHERE id = ?").run(node.conceptId, probe.prompt, probe.answer, JSON.stringify(probe.hintLadder), next.id)
        await recordDecision(db, String(session.student_id), "prerequisite_probe", "An early miss suggests checking one foundation before returning to the chosen topic; the cause is unresolved.", { sessionId, conceptId: node.conceptId, sourceConceptId: current.concept_id }, now)
      }
    }
    await recordTeachingOutcome(db, session, current, scored.correct, scored.correct ? "That matches the answer." : "That is not the answer yet.", now)
    const unfinished = (await sessionItems(db, sessionId)).some((item) => item.answered === 0)
    if (!unfinished) await completeFollowup(db, String(session.student_id), sessionId, today)
    if (!unfinished && (session.mode === "homework" || session.mode === "assessment")) {
      await reviseAgenda(db, String(session.student_id), String(session.subject ?? "Math"), sessionId)
      await storePattern(db, String(session.student_id), String(session.subject ?? "Math"), sessionId, now)
    }
    await recordDecision(db, String(session.student_id), "answer_scored", `Local key check ${scored.correct ? "held" : "missed"}; the rolling ${flags.length} scored answers selected ${action.type}.`, {
      sessionId, itemId: current.id, conceptId: current.concept_id, bloomLevel: current.bloom_level,
      correct: scored.correct, hints: current.hints_used, errorType, errorCertainty: "hypothesis", evidenceCertainty: "confirmed", supportUsed: Number(current.hints_used) > 0 ? "hint" : session.mode === "homework" ? "homework" : "none", action: action.type, recentCorrect: flags,
      learnerState: (await listStates(db, String(session.student_id))).find((state) => state.conceptId === current.concept_id),
    }, now)
    return {
      ended: false as const,
      correct: scored.correct,
      confidence: scored.confidence,
      errorType,
      corrective: recovery,
    }
  })
}

export async function reviewAnswer(
  db: DatabaseSync, ownerUserId: string, sessionId: string,
  input: { itemId: string; correct: boolean; errorType?: ErrorType | null; grader?: string; graderModel?: string; reason?: string }, now = new Date(),
) {
  return withWrite(db, async () => {
    const session = (await getOwnedSession(db, ownerUserId, sessionId))
    const item = (await sessionItems(db, sessionId)).find((row) => row.id === input.itemId)
    if (!item || item.answered !== 1 || item.correct != null) throw new UserError("That answer is not waiting for review.")
    const submitted = item.submitted_at ? new Date(String(item.submitted_at)) : now
    const error = input.correct ? null : input.errorType ?? null
    const latest = (await db.prepare("SELECT correct FROM session_items WHERE id = ?").get(item.id))
    if (latest?.correct != null) {  return }
    await db.prepare("UPDATE session_items SET correct = ?, error_type = ?, grader = ?, grading_reason = ? WHERE id = ?")
      .run(input.correct ? 1 : 0, error, input.grader ?? "parent", input.reason ?? "Parent reviewed the stored key or rubric.", item.id)
    await db.prepare(`INSERT INTO attempts (
      id, student_id, session_id, concept_id, bloom_level, day, correct, hints_used,
      interleaved, time_ms, error_type, modality, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.id, session.student_id, sessionId, item.concept_id, item.bloom_level,
        dayStamp(submitted), input.correct ? 1 : 0, item.hints_used, item.interleaved,
        item.time_ms ?? 0, error, item.surface, submitted.toISOString())
    const items = (await sessionItems(db, sessionId))
    const next = items.find((row) => row.answered === 0)
    let adjustment = "no_unanswered_work"
    if (next && !session.ended_at) {
      const action = nextThermostat({
        recentCorrect: (await rollingSix(db, String(session.student_id), String(item.concept_id), Number(item.bloom_level))),
        consecutiveStepDowns: Number(session.consecutive_step_downs), modality: session.modality as Mode,
        timeOnItemMs: null, medianTimeMs: null, frustrated: false,
        minutesInBlock: (now.getTime() - new Date(String(session.started_at)).getTime()) / 60000,
        attentionBlockMinutes: Number(session.cap_minutes),
      })
      adjustment = action.type
      const consecutive = action.type === "step_down" ? Number(session.consecutive_step_downs) + 1 : 0
      await db.prepare("UPDATE tutor_sessions SET consecutive_step_downs = ?, modality = ? WHERE id = ?")
        .run(consecutive, action.type === "change_modality" ? action.to : session.modality, sessionId)
      if (action.type === "end_session") await endSession(db, sessionId, "attention", now)
      if ((action.type === "step_up" || action.type === "step_down") && next.concept_id === item.concept_id && next.bloom_level === item.bloom_level) await rewriteItem(db, next, action.type === "step_up" ? 1 : -1)
      if (action.type === "change_modality" && next.concept_id === item.concept_id && next.bloom_level === item.bloom_level) await db.prepare("UPDATE session_items SET surface = ? WHERE id = ?").run(action.to, next.id)
    }
    await recordTeachingOutcome(db, session, item, input.correct, input.reason ?? 'Reviewed against the stored key or rubric.', now)
    if (input.correct) await noteChangedMind(db, sessionId, String(item.id), now)
    if (!next) await completeFollowup(db, String(session.student_id), sessionId, dayStamp(now))
    if (!next && (session.mode === "homework" || session.mode === "assessment")) {
      await reviseAgenda(db, String(session.student_id), String(session.subject), sessionId)
    }
    await db.prepare("DELETE FROM learning_patterns WHERE session_id = ?").run(sessionId)
    const opening = (await db.prepare("SELECT id FROM lesson_messages WHERE session_id = ? AND role = 'tutor' ORDER BY created_at LIMIT 1").get(sessionId)) as { id: string } | undefined
    if (opening && !next) {
      const known = (await studentGraph(db, String(session.student_id)))
      const results = items.filter((row) => row.answered === 1 && row.correct != null).map((row) => ({
        title: known.nodes.get(String(row.concept_id))?.title ?? String(row.concept_id),
        prompt: String(row.prompt), answer: String(row.answer), correct: row.correct === 1,
        recall: known.nodes.get(String(row.concept_id))?.recall, example: known.nodes.get(String(row.concept_id))?.example,
      }))
      await db.prepare("UPDATE lesson_messages SET body = ? WHERE id = ?").run(await sealForStudent(db, String(session.student_id), lessonOpening(results)), opening.id)
    }
    await recordDecision(db, String(session.student_id), "answer_judged", input.reason ?? "Parent reviewed the response against the stored key or rubric.", {
      sessionId, itemId: item.id, conceptId: item.concept_id, bloomLevel: item.bloom_level,
      correct: input.correct, hints: item.hints_used, interleaved: item.interleaved === 1,
      grader: input.grader ?? "parent", errorType: error,
      graderModel: input.graderModel ?? "",
      learnerState: (await listStates(db, String(session.student_id))).find((state) => state.conceptId === item.concept_id),
      action: adjustment, recentCorrect: (await rollingSix(db, String(session.student_id), String(item.concept_id), Number(item.bloom_level))),
    }, now)
  })
}

export async function useHint(db: DatabaseSync, ownerUserId: string, sessionId: string, itemId: string) {
  await getOwnedSession(db, ownerUserId, sessionId)
  const item = (await db.prepare("SELECT * FROM session_items WHERE id = ? AND session_id = ?").get(itemId, sessionId)) as
    | Record<string, SQLInputValue>
    | undefined
  if (!item || item.answered === 1) throw new UserError("That item cannot take a hint.")
  const ladder = JSON.parse(String(item.hints_json)) as string[]
  const used = Number(item.hints_used)
  if (used >= ladder.length) return { exhausted: true as const, text: "The ladder is finished. Try a parallel problem." }
  const text = ladder[used]
  await db.prepare("UPDATE session_items SET hints_used = ?, hint_text = ? WHERE id = ?").run(used + 1, text, itemId)
  const session = (await db.prepare("SELECT student_id FROM tutor_sessions WHERE id = ?").get(sessionId))!
  await recordDecision(db, String(session.student_id), "hint_requested", "The student chose the next scaffold in the hint ladder.", { sessionId, itemId, stage: used + 1 })
  return { exhausted: false as const, text, stage: used + 1 }
}

export async function clearBreak(db: DatabaseSync, ownerUserId: string, sessionId: string) {
  await getOwnedSession(db, ownerUserId, sessionId)
  await db.prepare("UPDATE tutor_sessions SET break_until = NULL WHERE id = ?").run(sessionId)
}

export interface StoredPattern {
  overt: string
  subtle: string
  trend: string
  nextMove: string
}

export async function patternForSession(db: DatabaseSync, sessionId: string): Promise<StoredPattern | null> {
  const row = (await db
    .prepare("SELECT overt, subtle, trend, next_move FROM learning_patterns WHERE session_id = ?")
    .get(sessionId)) as { overt: string; subtle: string; trend: string; next_move: string } | undefined
  if (!row) return null
  return { overt: row.overt, subtle: row.subtle, trend: row.trend, nextMove: row.next_move }
}

export async function storePattern(db: DatabaseSync, studentId: string, subject: string, sessionId: string, now = new Date()) {
  if ((await patternForSession(db, sessionId))) return (await patternForSession(db, sessionId))
  const items = (await sessionItems(db, sessionId))
    .filter((item) => item.answered === 1 && item.correct != null)
    .map((item) => ({
      title: String(item.concept_id),
      prompt: String(item.prompt ?? ""),
      given: String(item.given_answer ?? ""),
      correct: item.correct === 1,
      errorType: item.error_type ? String(item.error_type) : null,
    }))
  const known = (await studentGraph(db, studentId))
  for (const item of items) item.title = known.nodes.get(item.title)?.title ?? item.title
  const history = (await db
    .prepare(
      `SELECT overt, subtle FROM learning_patterns
       WHERE student_id = ? AND lower(subject) = lower(?) AND session_id != ?
       ORDER BY created_at DESC LIMIT 6`,
    )
    .all(studentId, subject, sessionId)) as Array<{ overt: string; subtle: string }>
  const note = readPatterns({ subject, items, history })
  await db.prepare(
    `INSERT INTO learning_patterns (id, student_id, subject, session_id, overt, subtle, trend, next_move, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), studentId, subject, sessionId, note.overt, note.subtle, note.trend, note.nextMove, now.toISOString())
  return { overt: note.overt, subtle: note.subtle, trend: note.trend, nextMove: note.nextMove }
}

export async function reviseAgenda(db: DatabaseSync, studentId: string, subject: string, sessionId: string) {
  const items = (await sessionItems(db, sessionId)).filter((item) => item.answered === 1 && item.correct != null)
  if (!items.length || !subject.trim()) return ""
  const known = (await studentGraph(db, studentId))
  const byTopic = new Map<string, { title: string; held: number; missed: number; errors: string[] }>()
  for (const item of items) {
    const id = String(item.concept_id)
    const current = byTopic.get(id) ?? { title: known.nodes.get(id)?.title ?? id, held: 0, missed: 0, errors: [] }
    if (item.correct === 1) current.held += 1
    else {
      current.missed += 1
      const error = String(item.error_type ?? "")
      if (error && !current.errors.includes(error)) current.errors.push(error)
    }
    byTopic.set(id, current)
  }
  const rows = [...byTopic.values()]
  const leading = rows.filter((row) => row.missed >= 1).sort((a, b) => b.missed - a.missed)
  const held = rows.filter((row) => row.missed === 0 && row.held > 0)
  const rate = items.filter((item) => item.correct === 1).length / items.length
  const gap = leading[0]?.errors[0] ? gapLabel(leading[0].errors[0]) : "a repeated miss"
  const names = (leading.length ? leading : held).slice(0, 2).map((row) => row.title)
  const agenda = leading.length
    ? rate < 0.7
      ? `Next ${subject} work narrows to ${names.join(" and ")}. The gap is ${gap}. Homework shows the weak attempt and the solid one. The assessment uses a new setting and must not repeat these questions.`
      : `Next ${subject} work stays on ${names.join(" and ")}. The gap is ${gap}. Homework probes that gap. The assessment checks it in a new setting.`
    : `Next ${subject} work can stretch ${names.join(" and ") || "the topics that held"}. Homework creates a new example. The assessment uses a different setting.`
  await db.prepare(
    `INSERT INTO subject_plans (student_id, subject, about, question_types, syllabus_text, syllabus_name, build_status, build_note, agenda, updated_at)
     VALUES (?, ?, ?, '', '', '', 'ready', '', ?, ?)
     ON CONFLICT(student_id, subject) DO UPDATE SET agenda = excluded.agenda, updated_at = excluded.updated_at`,
  ).run(studentId, subject, subject, agenda, new Date().toISOString())
  return agenda
}

function gapLabel(error: string) {
  if (error.includes("concept") || error.includes("idea")) return "the idea itself"
  if (error.includes("procedur") || error.includes("step")) return "the steps"
  if (error.includes("guess")) return "a guess instead of the idea"
  return "the same kind of miss"
}

export async function saveRecap(
  db: DatabaseSync,
  ownerUserId: string,
  sessionId: string,
  input: { learned: string; hard: string; tellFriend: string; productionSuccess: boolean },
  now = new Date(),
) {
  const session = (await getOwnedSession(db, ownerUserId, sessionId))
  const learned = input.learned.trim()
  const hard = input.hard.trim()
  const tellFriend = input.tellFriend.trim()
  if (!learned || !hard || !tellFriend) throw new UserError("Answer all three recap prompts.")
  await db.prepare(
    `INSERT INTO recaps (session_id, learned, hard, tell_friend, production_success, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET learned = excluded.learned, hard = excluded.hard, tell_friend = excluded.tell_friend, production_success = excluded.production_success`,
  ).run(sessionId, await sealFor(db, ownerUserId, learned), await sealFor(db, ownerUserId, hard), await sealFor(db, ownerUserId, tellFriend), input.productionSuccess ? 1 : 0, now.toISOString())
  await endSession(db, sessionId, "recap", now)
  const sheetId = (await createSheet(db, ownerUserId, String(session.student_id), now))
  return { sheetId }
}

export async function createSheet(db: DatabaseSync, ownerUserId: string, studentId: string, now = new Date()) {
  await assertStudent(db, ownerUserId, studentId)
  const states = (await listStates(db, studentId))
  const due = states.find((state) => state.status === "frontier" || state.status === "stuck") ?? states[0]
  const concept = (await studentGraph(db, studentId)).nodes.get(due.conceptId)
  if (!concept) throw new UserError("No concept is available for a sheet.")
  const items = ([1, 2, 3, 4] as BloomLevel[]).map((bloom) =>
    generateItem(concept, bloom, randomInt(1, 1_000_000_000), { itemId: crypto.randomUUID() }),
  )
  const sheetId = crypto.randomUUID()
  const spec = buildSheet(
    sheetId,
    items.map((item) => item.itemId),
  )
  await db.prepare("INSERT INTO sheets (id, student_id, spec_json, created_at) VALUES (?, ?, ?, ?)").run(
    sheetId,
    studentId,
    JSON.stringify({ spec, items }),
    now.toISOString(),
  )
  return sheetId
}

export async function getSheet(db: DatabaseSync, ownerUserId: string, sheetId: string) {
  const row = (await db
    .prepare(
      `SELECT sheets.*, students.owner_user_id, students.display_name
       FROM sheets JOIN students ON students.id = sheets.student_id
       WHERE sheets.id = ? AND students.owner_user_id = ?`,
    )
    .get(sheetId, ownerUserId)) as Record<string, SQLInputValue> | undefined
  if (!row) throw new UserError("Sheet not found.")
  return row
}

export async function scoreSheet(
  db: DatabaseSync,
  ownerUserId: string,
  sheetId: string,
  boxes: Array<{ boxIndex: number; answer: string }>,
  now = new Date(),
) {
  const sheet = (await getSheet(db, ownerUserId, sheetId))
  if (sheet.score_results) return JSON.parse(String(sheet.score_results)) as Array<{ boxIndex: number; correct: boolean; confidence: number; speak: boolean; pendingReview: boolean; reviewSessionId: string }>
  const payload = JSON.parse(String(sheet.spec_json)) as {
    spec: { boxes: Array<{ boxIndex: number; itemId: string }> }
    items: Array<{ itemId: string; conceptId: string; bloomLevel: BloomLevel; prompt: string; answer: string; hintLadder: string[]; interleaved: boolean }>
  }
  const results = payload.spec.boxes.map((box) => {
    const item = payload.items.find((candidate) => candidate.itemId === box.itemId)
    const given = boxes.find((entry) => entry.boxIndex === box.boxIndex)?.answer ?? ""
    const score = scoreAnswer(item?.answer ?? "", given)
    const pendingReview = requiresJudgment(item?.answer ?? "", item?.bloomLevel ?? 0) || !given.trim() || /^(?:\?|unreadable|unclear|illegible)$/i.test(given.trim()) || score.confidence < 0.8
    return { boxIndex: box.boxIndex, correct: score.correct, confidence: score.confidence, speak: score.confidence < 0.9, pendingReview, reviewSessionId: "" }
  })
  const today = dayStamp(now)
  const sessionId = crypto.randomUUID()
  await db.prepare(
    `INSERT INTO tutor_sessions (id, student_id, started_at, ended_at, end_reason, modality, consecutive_step_downs, cap_minutes, continuity)
     VALUES (?, ?, ?, ?, 'sheet', 'paper', 0, 25, 'Sheet check')`,
  ).run(sessionId, sheet.student_id, now.toISOString(), now.toISOString())
  for (const result of results) {
    const box = payload.spec.boxes.find((entry) => entry.boxIndex === result.boxIndex)!
    const item = payload.items.find((candidate) => candidate.itemId === box.itemId)!
    if (result.pendingReview) {
      result.reviewSessionId = sessionId
      const given = boxes.find((entry) => entry.boxIndex === result.boxIndex)?.answer ?? ""
      await db.prepare(`INSERT INTO session_items (
        id, session_id, position, beat, concept_id, bloom_level, prompt, answer, hints_json, surface,
        interleaved, hints_used, answered, given_answer, time_ms, submitted_at
      ) VALUES (?, ?, ?, 'frontier', ?, ?, ?, ?, ?, 'paper', 0, 0, 1, ?, 0, ?)`)
        .run(crypto.randomUUID(), sessionId, result.boxIndex, item.conceptId, item.bloomLevel,
          item.prompt, item.answer, JSON.stringify(item.hintLadder ?? []), await sealForStudent(db, String(sheet.student_id), given), now.toISOString())
      continue
    }
    const evidenceId = crypto.randomUUID()
    await db.prepare(`INSERT INTO session_items (id, session_id, position, beat, concept_id, bloom_level, prompt, answer, hints_json, surface, interleaved, hints_used, answered, given_answer, time_ms, submitted_at, correct) VALUES (?, ?, ?, 'frontier', ?, ?, ?, ?, ?, 'paper', 0, 0, 1, ?, 0, ?, ?)`).run(evidenceId, sessionId, result.boxIndex, item.conceptId, item.bloomLevel, item.prompt, item.answer, JSON.stringify(item.hintLadder), await sealForStudent(db, String(sheet.student_id), boxes.find(b => b.boxIndex === result.boxIndex)?.answer ?? ""), now.toISOString(), result.correct ? 1 : 0)
    await db.prepare(
      `INSERT INTO attempts (
        id, student_id, session_id, concept_id, bloom_level, day, correct, hints_used, interleaved, time_ms, error_type, modality, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 'paper', ?)`,
    ).run(
      evidenceId,
      sheet.student_id,
      sessionId,
      item.conceptId,
      item.bloomLevel,
      today,
      result.correct ? 1 : 0,
      result.correct ? null : "procedural_slip",
      now.toISOString(),
    )
  }
  await db.prepare("UPDATE sheets SET score_results = ? WHERE id = ?").run(JSON.stringify(results), sheetId)
  return results
}

export async function saveUpload(
  db: DatabaseSync,
  ownerUserId: string,
  studentId: string,
  input: { mime: string; base64: string },
  uploadsDir: string,
  now = new Date(),
) {
  return withWrite(db, async () => {
    await assertStudent(db, ownerUserId, studentId)
    const bytes = Buffer.from(input.base64, "base64")
    validateImage(bytes, input.mime)
    const id = crypto.randomUUID()
    const ext = input.mime === "image/png" ? "png" : "jpg"
    const path = cloudStorage() ? `blob:families/${ownerUserId}/uploads/${id}.${ext}` : join(uploadsDir, ownerUserId, `${id}.${ext}`)
    await reserveUpload(db, ownerUserId, studentId, id, path, input.mime, bytes.length, now)
    const stored = await storePrivateFile(uploadsDir, ownerUserId, `${id}.${ext}`, stripImageMetadata(bytes), input.mime)
    try {
      await db.prepare("INSERT INTO uploads (id, owner_user_id, student_id, stored_path, created_at) VALUES (?, ?, ?, ?, ?)").run(id, ownerUserId, studentId, stored, now.toISOString())
      await db.prepare("DELETE FROM upload_intents WHERE id = ?").run(id)
      onWriteRollback(db, () => deletePrivateFile(stored, uploadsDir))
    } catch (e) { await deletePrivateFile(stored, uploadsDir); throw e }
    return id
  })
}

export async function getUpload(db: DatabaseSync, ownerUserId: string, uploadId: string) {
  return (await db.prepare("SELECT * FROM uploads WHERE id = ? AND owner_user_id = ?").get(uploadId, ownerUserId)) as
    | { stored_path: string }
    | undefined
}

export async function scoreboardFor(db: DatabaseSync, ownerUserId: string, studentId: string, now = new Date()) {
  await assertStudent(db, ownerUserId, studentId)
  const today = dayStamp(now)
  const weekStart = dayStamp(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))
  const attempts = (await loadAttempts(db, studentId))
  const states = (await listStates(db, studentId)).map((state) => projectState(state, attempts.filter((attempt) => attempt.conceptId === state.conceptId), today))
  return { ...weeklyScoreboard({ attempts, states, weekStart, today }), assessmentEvidence: (await assessmentEvidence(db, studentId)) }
}

export function conceptTitle(conceptId: string, titles?: Record<string, string>) {
  return titles?.[conceptId] ?? graph.nodes.get(conceptId)?.title ?? conceptId
}

export async function titleMap(db: DatabaseSync, studentId: string) {
  const titles: Record<string, string> = {}
  for (const concept of (await studentGraph(db, studentId)).nodes.values()) titles[concept.conceptId] = concept.title
  return titles
}

export async function studentConcepts(db: DatabaseSync, ownerUserId: string, studentId: string) {
  await assertStudent(db, ownerUserId, studentId)
  return [...(await studentGraph(db, studentId)).nodes.values()].sort(
    (a, b) => a.subject.localeCompare(b.subject) || a.grade - b.grade || a.title.localeCompare(b.title),
  )
}

export async function updateStudentProfile(
  db: DatabaseSync,
  ownerUserId: string,
  studentId: string,
  input: { birthDate?: string; gradeHold?: boolean; grade?: number },
  now = new Date(),
) {
  const student = (await assertStudent(db, ownerUserId, studentId, now))
  const birthday = input.birthDate !== undefined ? validBirthday(input.birthDate) : student.birth_date
  const hold = input.gradeHold ? 1 : 0
  const grade = hold
    ? boundedGrade(Number(input.grade))
    : birthday
      ? boundedGrade(gradeFromBirthday(birthday, now))
      : student.grade
  await db.prepare("UPDATE students SET birth_date = ?, grade = ?, grade_hold = ? WHERE id = ?").run(await sealForStudent(db, studentId, birthday), grade, hold, studentId)
  await writeProgram(db, studentId, contentGrade(grade, student.math_course || "grade"))
  const before = { birthDate: student.birth_date ?? null, grade: Number(student.grade), gradeHold: Number(student.grade_hold ?? 0) }
  const after = { birthDate: birthday ?? null, grade: Number(grade), gradeHold: hold }
  if (before.birthDate !== after.birthDate || before.grade !== after.grade || before.gradeHold !== after.gradeHold) {
    await recordDecision(db, studentId, "profile_changed", "The parent changed the birthday or the grade the program follows.", { before, after }, now)
  }
  return { before, after }
}

export async function addLearning(
  db: DatabaseSync,
  ownerUserId: string,
  studentId: string,
  input: {
    purpose: "year" | "special" | "practice"
    subject?: string
    title?: string
    recall?: string
    example?: string
    nonExample?: string
    conceptId?: string
    prompt?: string
    answer?: string
    problems?: string
    deadline?: string
  },
  now = new Date(),
) {
  return withWrite(db, async () => {
    await assertStudent(db, ownerUserId, studentId, now)
    const problems = parseProblems(input.prompt, input.answer, input.problems)
    if (input.purpose === "practice") {
      const concept = (await studentGraph(db, studentId)).nodes.get(input.conceptId ?? "")
      if (!concept) throw new UserError("Pick a concept that is already on this student's list.")
      if (!problems.length) throw new UserError("A practice problem needs the question and the answer.")
      for (const problem of problems) await insertPractice(db, studentId, concept.conceptId, problem.prompt, problem.answer, 3, now)
      return concept.conceptId
    }
    const title = (input.title ?? "").trim()
    const subject = (input.subject ?? "").trim()
    if (!title || !subject) throw new UserError("Name the subject and the topic.")
    const conceptId = `custom.${crypto.randomUUID()}`
    const today = dayStamp(now)
    const purpose = input.purpose === "special" ? "special" : "year"
    const node = {
      recall: (input.recall ?? "").trim() || title,
      example: (input.example ?? "").trim() || title,
      nonExample: (input.nonExample ?? "").trim() || `Not an example of ${title}`,
    }
    await db.prepare(
      `INSERT INTO custom_concepts (
        concept_id, student_id, subject, grade, title, recall, example, non_example, purpose, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      conceptId,
      studentId,
      subject,
      (await assertStudent(db, ownerUserId, studentId, now)).grade,
      title,
      node.recall,
      node.example,
      node.nonExample,
      purpose,
      now.toISOString(),
    )
    const fresh = emptyState(conceptId, today)
    await db.prepare(
      `INSERT INTO learner_states (
        student_id, concept_id, bloom_level, mastery, stability_days, next_due, error_signatures, hints_last_10, mastered_in, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(studentId, conceptId, fresh.bloomLevel, fresh.mastery, fresh.stabilityDays, fresh.nextDue, "[]", 0, null, fresh.status)
    if (purpose === "year") {
      const learner = (await assertStudent(db, ownerUserId, studentId, now))
      await writeProgram(db, studentId, contentGrade(learner.grade, learner.math_course || "grade"))
    }
    else {
      const deadline = /^\d{4}-\d{2}-\d{2}$/.test(input.deadline ?? "") ? input.deadline! : addDays(today, 14)
      await db.prepare(
        "INSERT INTO targets (id, student_id, kind, title, deadline, concept_ids, priority, created_at) VALUES (?, ?, 'target', ?, ?, ?, 10, ?)",
      ).run(crypto.randomUUID(), studentId, title, deadline, JSON.stringify([conceptId]), now.toISOString())
    }
    for (const problem of problems) await insertPractice(db, studentId, conceptId, problem.prompt, problem.answer, 3, now)
    return conceptId
  })
}

export interface AddedProblem {
  id: string
  prompt: string
  answer: string
  used: boolean
}

export interface AddedTopic {
  conceptId: string
  subject: string
  title: string
  purpose: "year" | "special"
  problems: AddedProblem[]
}

export async function listAdded(db: DatabaseSync, ownerUserId: string, studentId: string) {
  await assertStudent(db, ownerUserId, studentId)
  const topics = (await db.prepare("SELECT concept_id, subject, title, purpose FROM custom_concepts WHERE student_id = ? ORDER BY created_at").all(studentId)) as Array<{
    concept_id: string
    subject: string
    title: string
    purpose: "year" | "special"
  }>
  const problems = (await db.prepare("SELECT id, concept_id, prompt, answer, used_at FROM practice_items WHERE student_id = ? ORDER BY created_at").all(studentId)) as Array<{
    id: string
    concept_id: string
    prompt: string
    answer: string
    used_at: string | null
  }>
  const topicIds = new Set(topics.map((topic) => topic.concept_id))
  const titles = (await titleMap(db, studentId))
  const grouped = new Map<string, AddedProblem[]>()
  for (const problem of problems) {
    const list = grouped.get(problem.concept_id) ?? []
    list.push({ id: problem.id, prompt: problem.prompt, answer: problem.answer, used: Boolean(problem.used_at) })
    grouped.set(problem.concept_id, list)
  }
  return {
    topics: topics.map((topic) => ({
      conceptId: topic.concept_id,
      subject: topic.subject,
      title: topic.title,
      purpose: topic.purpose,
      problems: grouped.get(topic.concept_id) ?? [],
    })),
    extras: [...grouped.entries()]
      .filter(([conceptId]) => !topicIds.has(conceptId))
      .map(([conceptId, items]) => ({ conceptId, title: titles[conceptId] ?? conceptId, problems: items })),
  }
}

export async function removeTopic(db: DatabaseSync, ownerUserId: string, studentId: string, conceptId: string) {
  return withWrite(db, async () => {
    await assertStudent(db, ownerUserId, studentId)
    const row = (await db.prepare("SELECT concept_id FROM custom_concepts WHERE student_id = ? AND concept_id = ?").get(studentId, conceptId))
    if (!row) throw new UserError("That topic is part of the built-in list.")
    await db.prepare("DELETE FROM practice_items WHERE student_id = ? AND concept_id = ?").run(studentId, conceptId)
    await db.prepare("DELETE FROM learner_states WHERE student_id = ? AND concept_id = ?").run(studentId, conceptId)
    await db.prepare("DELETE FROM custom_concepts WHERE student_id = ? AND concept_id = ?").run(studentId, conceptId)
    const targets = (await db.prepare("SELECT id, concept_ids FROM targets WHERE student_id = ?").all(studentId)) as Array<{
      id: string
      concept_ids: string
    }>
    for (const target of targets) {
      const ids = (JSON.parse(target.concept_ids) as string[]).filter((id) => id !== conceptId)
      if (!ids.length) await db.prepare("DELETE FROM targets WHERE id = ? AND kind != 'program'").run(target.id)
      else await db.prepare("UPDATE targets SET concept_ids = ? WHERE id = ?").run(JSON.stringify(ids), target.id)
    }
  })
}

export async function removeProblem(db: DatabaseSync, ownerUserId: string, studentId: string, problemId: string) {
  await assertStudent(db, ownerUserId, studentId)
  const row = (await db.prepare("DELETE FROM practice_items WHERE student_id = ? AND id = ?").run(studentId, problemId))
  if (!row.changes) throw new UserError("That problem is not on this student.")
}

export function allConcepts() {
  return [...graph.nodes.values()].sort((a, b) => a.grade - b.grade || a.conceptId.localeCompare(b.conceptId))
}

export function bloomLabel(level: number) {
  return BLOOM_NAME[level] ?? "unseen"
}

export async function loadAttempts(db: DatabaseSync, studentId: string): Promise<AttemptRecord[]> {
  const rows = (await db.prepare("SELECT * FROM attempts WHERE student_id = ? ORDER BY created_at").all(studentId)) as Array<
    Record<string, SQLInputValue>
  >
  const customSubjects = new Map(((await db.prepare('SELECT concept_id, subject FROM custom_concepts WHERE student_id = ?').all(studentId)) as Array<{ concept_id: string; subject: string }>).map(row => [String(row.concept_id), String(row.subject)]))
  const items = await db.prepare(`SELECT i.*, s.mode, s.subject FROM session_items i JOIN tutor_sessions s ON s.id = i.session_id WHERE s.student_id = ? ORDER BY coalesce(i.submitted_at, s.started_at), s.rowid, i.position`).all(studentId)
  const firstByPrompt = new Map<string, string>()
  const byItemId = new Map(items.map(i => [String(i.id), i]))
  const bySubmission = new Map<string, typeof items>()
  const submissionKey = (row: Record<string, SQLInputValue>, time: string) => JSON.stringify([row.session_id, row.concept_id, row.bloom_level, time])
  for (const item of items) {
    const key = submissionKey(item, String(item.submitted_at))
    const group = bySubmission.get(key) ?? []
    group.push(item)
    bySubmission.set(key, group)
  }
  for (const item of items) {
    if (item.answered !== 1) continue
    const key = String(item.prompt).trim().toLowerCase().replace(/\s+/g, " ")
    if (!firstByPrompt.has(key)) firstByPrompt.set(key, String(item.id))
  }
  return rows.map((row) => {
    const candidates = bySubmission.get(submissionKey(row, String(row.created_at))) ?? []
    // New attempts use the immutable item ID. Older uniquely linked records can be read,
    // but ambiguous historical timestamps cannot establish independent mastery.
    const linked = byItemId.get(String(row.id))
    const item = (linked?.session_id === row.session_id ? linked : undefined) ?? (candidates.length === 1 ? candidates[0] : undefined)
    return ({
    fresh: item ? firstByPrompt.get(String(item.prompt).trim().toLowerCase().replace(/\s+/g, " ")) === String(item.id) : false,
    promptKey: item ? String(item.prompt).trim().toLowerCase().replace(/\s+/g, " ") : undefined,
    // A grade a parent disputed counts neither way.
    evidenceCertainty: item ? (Number(item.disputed) === 1 || !String(item.given_answer ?? "").trim() || /^(?:\?|unreadable|unclear|illegible)$/i.test(String(item.given_answer).trim()) ? "unresolved" as const : "confirmed" as const) : "legacy" as const,
    supportUsed: item?.mode === "homework" ? "homework" as const : Number(row.hints_used) > 0 ? "hint" as const
      : supportSuppliesSkill(measuredSkill(conceptSubject(item?.concept_id, customSubjects, item?.subject)), item?.access_support ? String(item.access_support).split(",") : undefined) ? "access" as const : "none" as const,
    accessSupport: item?.access_support ? String(item.access_support).split(",").filter(Boolean) : undefined,
    kind: item?.evidence_kind === "transfer" ? "transfer" as const : "practice" as const,
    confidence: ["sure", "think", "guess"].includes(String(item?.confidence)) ? String(item!.confidence) as "sure" | "think" | "guess" : undefined,
    decisionReason: item ? "Stored key or reviewed rubric; support and prompt provenance retained." : "Historical evidence lacks linked prompt provenance; retained without a verified claim.",
    attemptId: String(row.id),
    createdAt: String(row.created_at),
    studentId: String(row.student_id),
    sessionId: String(row.session_id),
    conceptId: String(row.concept_id),
    bloomLevel: Number(row.bloom_level) as BloomLevel,
    day: String(row.day),
    correct: row.correct === 1,
    hintsUsed: Number(row.hints_used),
    interleaved: row.interleaved === 1,
    timeMs: Number(row.time_ms),
    errorType: (row.error_type as ErrorType | null) ?? null,
    modality: row.modality as Mode,
  })})
}

async function loadTargets(db: DatabaseSync, studentId: string) {
  const rows = (await db.prepare("SELECT * FROM targets WHERE student_id = ?").all(studentId)) as Array<Record<string, SQLInputValue>>
  return rows.map((row) => ({
    id: String(row.id),
    kind: row.kind as "program" | "target" | "curiosity",
    title: String(row.title),
    deadline: row.deadline ? String(row.deadline) : null,
    conceptIds: JSON.parse(String(row.concept_ids)) as string[],
    priority: Number(row.priority),
  }))
}

export interface SubjectPlanRow {
  subject: string
  about: string
  question_types: string
  syllabus_text: string
  syllabus_name: string
  build_status: string
  build_note: string
  agenda: string
  updated_at: string
}

export async function uploadedSourceText(db: DatabaseSync, studentId: string, subject: string) {
  const rows = (await db
    .prepare("SELECT name, body FROM subject_sources WHERE student_id = ? AND lower(subject) = lower(?) ORDER BY created_at")
    .all(studentId, subject)) as Array<{ name: string; body: string }>
  const school = await db.prepare(`SELECT m.id, m.title, m.kind, m.test_title, m.test_date, m.learning_purpose, q.number, q.prompt, q.figure
    FROM materials m JOIN material_questions q ON q.material_id = m.id AND q.revision = m.revision
    WHERE m.scope_approved = 1 AND m.student_id = ? AND lower(m.subject) = lower(?) AND q.readable = 1
      AND (m.learning_purpose = 'learning' OR (m.learning_purpose = 'test' AND m.test_date >= ?))
    ORDER BY m.created_at, q.rowid`).all(studentId, subject, dayStamp(new Date()))
  const sources = new Map<string, string[]>()
  for (const q of school) {
    const id = String(q.id)
    if (!sources.has(id)) sources.set(id, [`School source: ${q.title} (${q.kind})${q.learning_purpose === 'test' ? `; test: ${q.test_title}, date: ${q.test_date}` : ''}`])
    sources.get(id)!.push(`Question ${q.number}: ${q.prompt}${q.figure ? `\nFigure: ${q.figure}` : ''}`)
  }
  return [...rows.map((row) => `${row.name}\n${row.body}`), ...[...sources.values()].map(lines => lines.join('\n'))].join("\n\n")
}

export async function listSubjectPlans(db: DatabaseSync, ownerUserId: string, studentId: string) {
  await assertStudent(db, ownerUserId, studentId)
  return (await db
    .prepare(
      "SELECT subject, about, question_types, syllabus_text, syllabus_name, build_status, build_note, agenda, updated_at FROM subject_plans WHERE student_id = ? ORDER BY subject",
    )
    .all(studentId)) as unknown as SubjectPlanRow[]
}

export async function saveSubjectPlan(
  db: DatabaseSync,
  ownerUserId: string,
  studentId: string,
  input: { subject: string; about: string; syllabusText: string; syllabusName: string },
) {
  const student = (await assertStudent(db, ownerUserId, studentId))
  const subject = input.subject.trim()
  if (!subject) throw new UserError("Name the subject.")
  const about = input.about.trim()
  if (!about && !input.syllabusText.trim()) throw new UserError("Say what the subject is, or paste a syllabus.")
  await db.prepare(
    `INSERT INTO subject_plans (student_id, subject, about, question_types, syllabus_text, syllabus_name, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(student_id, subject) DO UPDATE SET
       about = excluded.about,
       question_types = excluded.question_types,
       syllabus_text = CASE WHEN excluded.syllabus_text = '' THEN subject_plans.syllabus_text ELSE excluded.syllabus_text END,
       syllabus_name = CASE WHEN excluded.syllabus_name = '' THEN subject_plans.syllabus_name ELSE excluded.syllabus_name END,
       updated_at = excluded.updated_at`,
  ).run(studentId, subject, about, "", input.syllabusText.trim(), input.syllabusName.trim(), new Date().toISOString())
  await recordDecision(db, studentId, "course_scope_saved", "The parent supplied or revised the standing course scope.", { subject, about, source: input.syllabusName })
  const subjects = parseSubjects(student.subjects)
  if (!subjects.some((item) => item.toLowerCase() === subject.toLowerCase())) {
    subjects.push(subject)
    await db.prepare("UPDATE students SET subjects = ? WHERE id = ?").run(JSON.stringify(subjects), studentId)
  }
}

export async function applyCurriculum(
  db: DatabaseSync,
  ownerUserId: string,
  studentId: string,
  subject: string,
  topics: Array<{ title: string; recall: string; example: string; nonExample: string; questions: Array<{ prompt: string; answer: string; bloomLevel?: BloomLevel; transfer?: boolean; rubric?: Rubric }> }>,
  now = new Date(),
) {
  await assertStudent(db, ownerUserId, studentId, now)
  let created = 0
  let questions = 0
  const conceptIds: string[] = []
  for (const topic of topics) {
    const title = topic.title.trim()
    if (!title) continue
    const existing = (await db
      .prepare("SELECT concept_id FROM custom_concepts WHERE student_id = ? AND lower(subject) = lower(?) AND lower(title) = lower(?)")
      .get(studentId, subject, title)) as { concept_id: string } | undefined
    const backbone = [...graph.nodes.values()].find((node) => sameSubject(node.subject, subject) && node.title.toLowerCase() === title.toLowerCase())
    const conceptId =
      existing?.concept_id ?? backbone?.conceptId ??
      (await addLearning(db, ownerUserId, studentId, {
        purpose: "year",
        subject,
        title,
        recall: topic.recall,
        example: topic.example,
        nonExample: topic.nonExample,
      }, now))
    if (!existing && !backbone) created += 1
    conceptIds.push(conceptId)
    if (existing) {
      await db.prepare("UPDATE custom_concepts SET recall = ?, example = ?, non_example = ? WHERE concept_id = ?")
        .run(topic.recall, topic.example || topic.recall, topic.nonExample || `Not an example of ${title}`, conceptId)
    }
    for (const question of topic.questions) {
      const duplicate = (await db
        .prepare("SELECT id FROM practice_items WHERE student_id = ? AND concept_id = ? AND prompt = ?")
        .get(studentId, conceptId, question.prompt))
      if (duplicate) continue
      await insertPractice(db, studentId, conceptId, question.prompt, question.answer, question.bloomLevel ?? 3, now, question.transfer ? "transfer" : "practice", question.rubric)
      questions += 1
    }
  }
  await recordDecision(db, studentId, "curriculum_updated", "A validated curriculum added the current focus while preserving the standing graph and learner evidence.", {
    subject, created, questions, topics: topics.map((topic) => topic.title),
  }, now)
  return { created, questions, conceptIds: [...new Set(conceptIds)] }
}

export async function retireUnusedQuestions(db: DatabaseSync, studentId: string, subject: string) {
  const ids = [...(await studentGraph(db, studentId)).nodes.values()].filter((node) => sameSubject(node.subject, subject)).map((node) => node.conceptId)
  if (!ids.length) return
  await db.prepare(`DELETE FROM practice_items WHERE student_id = ? AND used_at IS NULL AND pack_id IS NULL AND concept_id IN (${ids.map(() => "?").join(",")})`)
    .run(studentId, ...ids)
}

export async function addDirection(
  db: DatabaseSync,
  ownerUserId: string,
  studentId: string,
  input: { subject: string; kind: "school_test" | "parent_note"; name: string; body: string },
) {
  const student = (await assertStudent(db, ownerUserId, studentId))
  const subject = input.subject.trim()
  const body = input.body.trim()
  if (!subject || !body) throw new UserError("Name the subject and paste the test or the note.")
  const sourceId = crypto.randomUUID()
  await recordDecision(db, studentId, "school_source_added", "New school material or a parent note updates the next focus without erasing previous scores.", {
    sourceId, subject, kind: input.kind, source: input.name, coverage: body.slice(0, 1000),
  })
  await db.prepare(
    "INSERT INTO subject_sources (id, student_id, subject, kind, name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(sourceId, studentId, subject, input.kind, input.name.trim() || input.kind, body.slice(0, 80_000), new Date().toISOString())
  const subjects = parseSubjects(student.subjects)
  if (!subjects.some((item) => item.toLowerCase() === subject.toLowerCase())) {
    subjects.push(subject)
    await db.prepare("UPDATE students SET subjects = ? WHERE id = ?").run(JSON.stringify(subjects), studentId)
  }
  const existing = (await subjectPlan(db, studentId, subject))
  if (!existing) {
    await saveSubjectPlan(db, ownerUserId, studentId, {
      subject,
      about: input.kind === "school_test" ? "Direction set by a school test." : "Direction set by a parent note.",
      syllabusText: "",
      syllabusName: "",
    })
  }
  return sourceId
}

export async function latestDirection(db: DatabaseSync, studentId: string, subject: string) {
  return (await db
    .prepare(
      "SELECT kind, name, body, created_at FROM subject_sources WHERE student_id = ? AND lower(subject) = lower(?) ORDER BY created_at DESC LIMIT 1",
    )
    .get(studentId, subject)) as { kind: string; name: string; body: string; created_at: string } | undefined
}

export async function aiSettings(db: DatabaseSync, userId: string) {
  const row = (await db.prepare("SELECT ai_provider, ai_model, ai_key, photo_model, chatgpt_welcomed_at, ai_health, ai_health_at FROM users WHERE id = ?").get(userId)) as
    | { ai_provider: string; ai_model: string; ai_key: string; photo_model: string; chatgpt_welcomed_at: string | null; ai_health: string | null; ai_health_at: string | null }
    | undefined
  const credential = row?.ai_provider === "chatgpt" ? readCredential(row.ai_key) : null
  return {
    provider: process.env.TUTOR_PUBLIC === "1" && (!row?.ai_key || ["codex", "grok", "claude"].includes(row?.ai_provider || "")) ? "openrouter" : row?.ai_provider || "grok",
    model: row?.ai_model || "",
    hasKey: Boolean(row?.ai_key),
    photoModel: row?.photo_model || "",
    chatgpt: credential ? { email: credential.email, reconnect: Boolean(credential.reconnect), welcomed: Boolean(row?.chatgpt_welcomed_at) } : null,
    /** WF-01: a lasting problem found while working (revoked, used up, not eligible, model gone), or null. */
    health: currentHealth(row?.ai_health, row?.ai_health_at),
  }
}

/** Whether reading a photo can work: a photo model is chosen, or the ChatGPT plan reads photos itself (WF-01 no_photo). */
export function photoReadingReady(settings: { provider: string; photoModel: string }) {
  return settings.provider === "chatgpt" || Boolean(settings.photoModel)
}

/** The child's line for a lasting problem found while working (WF-01). */
export function aiChildLine(settings: { health?: AiHealth | null }) {
  return settings.health ? HEALTH_CHILD[settings.health] : ""
}

/** A plain-language reason the family's AI connection cannot answer yet, or "" when a model call is possible. */
export function aiConnectionProblem(settings: { provider: string; hasKey: boolean; model: string; chatgpt?: { reconnect: boolean } | null; health?: AiHealth | null }) {
  const cli = ["codex", "grok", "claude"].includes(settings.provider)
  if (settings.health) return HEALTH_PARENT[settings.health]
  if (process.env.TUTOR_PUBLIC === "1" && (cli || !settings.hasKey)) return "No AI is connected yet. A parent can connect an account or add an API key in AI settings."
  if (!cli && !settings.hasKey) return "No AI is connected yet. A parent can connect an account or add an API key in AI settings."
  if (settings.provider === "openrouter" && !settings.model) return "Choose a text model in AI settings before starting."
  if (settings.provider === "chatgpt") {
    if (!chatgptConfig()) return "The ChatGPT connection is not available on this site. A parent can connect another way in AI settings."
    if (!settings.chatgpt || settings.chatgpt.reconnect) return "ChatGPT needs to be connected again. A parent can reconnect in AI settings."
    if (!settings.model) return "Choose a ChatGPT model in AI settings before starting."
  }
  return ""
}

/** What works while the AI is missing, said the same way on every screen. Practice on built-in topics checks short
 * answers and gives its stored hints on this site, and keeps written answers for a parent to check. */
export const WITHOUT_AI = {
  child: "You can still practise: I can check short answers and give hints, and I save written answers for a grown-up to check. Talking it through waits until a grown-up connects an AI.",
  parent: "Practice on the built-in topics still runs: short answers are checked and hints work, and written answers are saved for you to check. Talking it through with the tutor, reading homework photos, building new classes and making practice packs wait until it is connected.",
  attention: "Needs you: connect an AI so the tutor can talk things through, check written answers and read homework photos.",
  welcome: "Practice on the built-in topics works without it: short answers are checked, and written answers wait for you.",
}

export function isAiConnectionError(error: unknown) {
  if (error instanceof ChatGptError) return ["reconnect", "config", "not_eligible"].includes(error.kind)
  const text = error instanceof Error ? error.message : String(error)
  return /Add an API key|Host CLI credentials|Choose a text model|Choose a ChatGPT model|rejected the key|Select a photo-capable|ChatGPT needs to be connected again|ChatGPT connection is not set up/i.test(text)
}

export async function aiConfigFor(db: DatabaseSync, userId: string) {
  const row = (await db.prepare("SELECT ai_provider, ai_model, ai_key, photo_model FROM users WHERE id = ?").get(userId)) as
    | { ai_provider: string; ai_model: string; ai_key: string; photo_model: string }
    | undefined
  const provider = (row?.ai_provider || (process.env.TUTOR_PUBLIC === "1" ? "openrouter" : "grok")) as AiProvider
  return {
    provider,
    model: row?.ai_model || "",
    // A ChatGPT connection stores an encrypted token set; requests get a current access token.
    apiKey: provider === "chatgpt" ? (row?.ai_key ? await chatgptAccessToken(db, userId) : "") : decryptSecret(row?.ai_key || ""),
    ...(provider === "chatgpt" ? { onRejected: () => distrustChatGptToken(db, userId) } : {}),
    // Its own database scope, so the write never joins another flow's open transaction (which could roll it back).
    onHealth: (health: AiHealth | null) => withDatabaseScope(db, () => recordAiHealth(db, userId, health)),
  }
}

/** Keeps the family's AI state (WF-01). Clearing is a no-op unless a state is set, so working calls stay cheap. */
export async function recordAiHealth(db: DatabaseSync, userId: string, health: AiHealth | null, now = new Date()) {
  if (health) await db.prepare("UPDATE users SET ai_health = ?, ai_health_at = ? WHERE id = ?").run(health, now.toISOString(), userId)
  else await db.prepare("UPDATE users SET ai_health = NULL, ai_health_at = NULL WHERE id = ? AND ai_health IS NOT NULL").run(userId)
}

/** Save a verified ChatGPT connection, keeping a still-offered model choice. */
export async function saveChatGptConnection(db: DatabaseSync, userId: string, credential: ChatGptCredential, models: ChatGptModel[]) {
  const current = (await db.prepare("SELECT ai_provider, ai_model, photo_model FROM users WHERE id = ?").get(userId)) as { ai_provider: string; ai_model: string; photo_model: string }
  const offered = new Set(models.map((model) => model.slug))
  const keep = (value: string) => current.ai_provider === "chatgpt" && value && (offered.has(value) || !models.length) ? value : ""
  const model = keep(current.ai_model) || models[0]?.slug || ""
  const photoModel = keep(current.photo_model) || model
  await db.prepare("UPDATE users SET ai_provider = 'chatgpt', ai_model = ?, photo_model = ?, ai_key = ?, ai_refresh_lease = NULL, ai_health = NULL, ai_health_at = NULL WHERE id = ?").run(model, photoModel, encryptSecret(JSON.stringify(credential)), userId)
  for (const student of (await listStudents(db, userId))) {
    await recordDecision(db, student.id, "ai_settings_changed", "The parent connected their ChatGPT plan. Learner evidence and previous decisions remain available to the new model.", { provider: "chatgpt", model })
  }
}

export async function saveAiSettings(
  db: DatabaseSync,
  userId: string,
  input: { provider: string; model: string; apiKey: string; photoModel?: string },
) {
  if (!["codex", "grok", "claude", "xai", "openai", "anthropic", "openrouter", "chatgpt"].includes(input.provider)) throw new UserError("Choose a supported provider.")
  const provider = input.provider
  if (provider === "chatgpt" && (!chatgptConfig() || input.apiKey.trim())) throw new UserError("ChatGPT connects with Continue with ChatGPT in AI settings, not a pasted key.")
  if (provider === "codex" && process.env.TUTOR_CODEX_LOCAL !== "1") throw new UserError("Enable the local Codex test tutor first.")
  if (process.env.TUTOR_PUBLIC === "1" && ["codex", "grok", "claude"].includes(provider)) throw new UserError("Host CLI credentials are disabled in public mode.")
  const current = (await db.prepare("SELECT ai_key, ai_provider FROM users WHERE id = ?").get(userId)) as { ai_key: string; ai_provider: string } | undefined
  const key = provider === "codex" ? "" : input.apiKey.trim() ? encryptSecret(input.apiKey.trim()) : current?.ai_provider === provider ? current.ai_key : ""
  if (!["codex", "grok", "claude"].includes(provider) && !key) throw new UserError("Connect or paste an API key for the selected provider.")
  await db.prepare("UPDATE users SET ai_provider = ?, ai_model = ?, ai_key = ?, photo_model = ?, ai_health = NULL, ai_health_at = NULL WHERE id = ?").run(provider, input.model.trim(), key, input.photoModel?.trim() ?? "", userId)
  for (const student of (await listStudents(db, userId))) {
    await recordDecision(db, student.id, "ai_settings_changed", "The parent changed the AI settings. Learner evidence and previous decisions remain available to the new model.", {
      provider, model: input.model.trim(),
    })
  }
}

export interface TalkMessage {
  role: string
  body: string
  proposal: string
}

export async function listTalkSubjects(db: DatabaseSync, ownerUserId: string, studentId: string) {
  await assertStudent(db, ownerUserId, studentId)
  const rows = (await db.prepare("SELECT DISTINCT subject FROM talk_messages WHERE student_id = ? ORDER BY subject").all(studentId)) as Array<{
    subject: string
  }>
  return rows.map((row) => row.subject).filter((subject) => subject.toLowerCase() !== "new")
}

export async function listTalk(db: DatabaseSync, ownerUserId: string, studentId: string, subject: string): Promise<TalkMessage[]> {
  await assertStudent(db, ownerUserId, studentId)
  return (await db
    .prepare("SELECT role, body, proposal FROM talk_messages WHERE student_id = ? AND lower(subject) = lower(?) ORDER BY created_at")
    .all(studentId, subject)) as unknown as TalkMessage[]
}

export async function addTalk(
  db: DatabaseSync,
  ownerUserId: string,
  studentId: string,
  input: { subject: string; role: "parent" | "tutor"; body: string; proposal?: ClassProposal | null; pending?: boolean },
) {
  await assertStudent(db, ownerUserId, studentId)
  const subject = input.subject.trim()
  const body = input.body.trim()
  if (!subject || !body) throw new UserError("Say what you want this class to cover.")
  await db.prepare("INSERT INTO talk_messages (id, student_id, subject, role, body, proposal, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    crypto.randomUUID(),
    studentId,
    subject,
    input.role,
    await sealForStudent(db, studentId, body.slice(0, 8000)),
    input.pending ? JSON.stringify({ pending: true }) : input.proposal ? JSON.stringify(input.proposal) : "",
    new Date().toISOString(),
  )
  if (input.role === "parent") await recordDecision(db, studentId, "planning_choice", "The parent changed or clarified the requested course focus.", { subject, message: body.slice(0, 1000) })
}

export async function finishTalk(
  db: DatabaseSync,
  studentId: string,
  subject: string,
  body: string,
  proposal: ClassProposal | null,
) {
  const row = (await db
    .prepare(
      `SELECT id FROM talk_messages
       WHERE student_id = ? AND lower(subject) = lower(?) AND proposal LIKE '%"pending":true%'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(studentId, subject)) as { id: string } | undefined
  if (!row) return
  await db.prepare("UPDATE talk_messages SET body = ?, proposal = ? WHERE id = ?").run(
    await sealForStudent(db, studentId, body.slice(0, 8000)),
    proposal ? JSON.stringify(proposal) : "",
    row.id,
  )
}

export async function studentProgress(db: DatabaseSync, ownerUserId: string, studentId: string) {
  await assertStudent(db, ownerUserId, studentId)
  const plans = (await listSubjectPlans(db, ownerUserId, studentId)).map((plan) => ({
    subject: plan.subject,
    status: plan.build_status,
    note: plan.build_note,
  }))
  const subjects = new Set([...(await listTalkSubjects(db, ownerUserId, studentId)), "new"])
  const pending: string[] = []
  for (const subject of subjects) {
    const waiting = (await listTalk(db, ownerUserId, studentId, subject)).some((message) => message.proposal.includes('"pending":true'))
    if (waiting) pending.push(subject)
  }
  const stamp = [...plans.map((plan) => `${plan.subject}:${plan.status}:${plan.note.length}`), ...pending.map((subject) => `pending:${subject}`)].join("|")
  return { stamp, plans, pending }
}

export async function moveTalk(db: DatabaseSync, studentId: string, from: string, to: string) {
  await db.prepare("UPDATE talk_messages SET subject = ? WHERE student_id = ? AND lower(subject) = lower(?)").run(to, studentId, from)
}

export async function latestProposal(db: DatabaseSync, studentId: string, subject: string): Promise<ClassProposal | null> {
  const row = (await db
    .prepare(
      "SELECT proposal FROM talk_messages WHERE student_id = ? AND lower(subject) = lower(?) AND proposal != '' ORDER BY created_at DESC LIMIT 1",
    )
    .get(studentId, subject)) as { proposal: string } | undefined
  if (!row?.proposal) return null
  try {
    const plan = JSON.parse(row.proposal) as ClassProposal
    if (!plan?.ready || !plan.subject || !plan.topics?.length) return null
    return plan
  } catch {
    return null
  }
}

export async function acceptPlan(db: DatabaseSync, ownerUserId: string, studentId: string, thread: string) {
  const student = (await assertStudent(db, ownerUserId, studentId))
  const plan = (await latestProposal(db, studentId, thread))
  if (!plan) throw new UserError("Talk through the plan first.")
  const subject = plan.subject.trim()
  const transcript = (await listTalk(db, ownerUserId, studentId, thread))
    .map((message) => message.body)
    .join("\n")
    .slice(0, 80_000)
  await saveSubjectPlan(db, ownerUserId, studentId, {
    subject,
    about: plan.about || subject,
    syllabusText: transcript,
    syllabusName: "Conversation",
  })
  if (plan.mathCourse && plan.mathCourse !== student.math_course && subject.toLowerCase() === "math") {
    await setPlacement(db, ownerUserId, studentId, { mathCourse: plan.mathCourse, subjects: parseSubjects(student.subjects) })
  }
  // A subject with no built-in course and nothing taught yet is researched before topics are posted.
  // The conversation, with its suggested topics, is saved above as the research's source.
  const known = (await db.prepare("SELECT count(*) AS n FROM custom_concepts WHERE student_id = ? AND lower(subject) = lower(?)").get(studentId, subject)) as { n: number }
  const mapped = await db.prepare("SELECT id FROM subject_maps WHERE student_id = ? AND lower(subject) = lower(?) AND status = 'approved'").get(studentId, subject)
  if (!/^maths?$/i.test(subject) && !Number(known.n) && !mapped) {
    await addTalk(db, ownerUserId, studentId, { subject, role: "tutor", body: `${subject} is new, so I will research it first. You will see its subject map to approve before anything is taught.` })
    return { subject, about: plan.about }
  }
  const posted = (await applyCurriculum(
    db,
    ownerUserId,
    studentId,
    subject,
    plan.topics.map((topic) => ({
      title: topic.title,
      recall: topic.recall,
      example: "",
      nonExample: "",
      questions: [],
    })),
  ))
  await markPlanBuild(db, studentId, subject, "building", "Topics are posted. Questions are being written.")
  await addTalk(db, ownerUserId, studentId, {
    subject,
    role: "tutor",
    body: `Posted ${posted.created || plan.topics.length} topics for ${subject}. They are on the Topics tab. Questions are being written.`,
  })
  return { subject, about: plan.about }
}

export async function settleStuckPlans(db: DatabaseSync) {
  const rows = (await db.prepare("SELECT student_id, subject, build_status FROM subject_plans WHERE build_status IN ('building', 'failed')").all()) as Array<{
    student_id: string
    subject: string
    build_status: string
  }>
  const resume: Array<{ ownerId: string; studentId: string; subject: string }> = []
  for (const row of rows) {
    const student = (await db.prepare("SELECT owner_user_id FROM students WHERE id = ?").get(row.student_id)) as { owner_user_id: string } | undefined
    if (!student) continue
    // School-page builds resume through their durable, revision-fenced job only.
    // A generic plan recovery must not bypass its source or claim it is ready.
    const latest = await db.prepare("SELECT payload FROM jobs WHERE student_id = ? AND kind = 'curriculum' AND json_extract(payload, '$.subject') = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(row.student_id, row.subject)
    if (latest && JSON.parse(String(latest.payload)).schoolSource) continue
    // A subject waiting on research, on the parent's approval of its map, or whose map failed or was set aside
    // is not stuck; restarting it here would teach without an approved map.
    const map = await db.prepare("SELECT status FROM subject_maps WHERE student_id = ? AND lower(subject) = lower(?) AND status != 'superseded' ORDER BY version DESC LIMIT 1").get(row.student_id, row.subject) as { status: string } | undefined
    if (map && map.status !== "approved") continue
    const proposal = (await latestProposal(db, row.student_id, row.subject))
    if (proposal) {
      await applyCurriculum(
        db,
        student.owner_user_id,
        row.student_id,
        row.subject,
        proposal.topics.map((topic) => ({
          title: topic.title,
          recall: topic.recall,
          example: "",
          nonExample: "",
          questions: [],
        })),
      )
    }
    const saved = (await db
      .prepare("SELECT count(*) AS n FROM custom_concepts WHERE student_id = ? AND lower(subject) = lower(?)")
      .get(row.student_id, row.subject)) as { n: number }
    if (!saved.n) {
      await markPlanBuild(db, row.student_id, row.subject, "failed", "The build stopped before any topics were saved. Press Build this again.")
      continue
    }
    if (row.build_status === "building") resume.push({ ownerId: student.owner_user_id, studentId: row.student_id, subject: row.subject })
    else await markPlanBuild(db, row.student_id, row.subject, "ready", "Topics are posted.")
  }
  return resume
}

export async function listLesson(db: DatabaseSync, ownerUserId: string, sessionId: string) {
  await getOwnedSession(db, ownerUserId, sessionId)
  return (await db
    .prepare("SELECT role, body FROM lesson_messages WHERE session_id = ? ORDER BY created_at")
    .all(sessionId)) as Array<{ role: string; body: string }>
}

export async function addLesson(db: DatabaseSync, ownerUserId: string, sessionId: string, role: "student" | "tutor", body: string) {
  await getOwnedSession(db, ownerUserId, sessionId)
  const text = body.trim()
  if (!text) throw new UserError("Ask about one of the questions.")
  await db.prepare("INSERT INTO lesson_messages (id, session_id, role, body, created_at) VALUES (?, ?, ?, ?, ?)").run(
    crypto.randomUUID(),
    sessionId,
    role,
    await sealFor(db, ownerUserId, text.slice(0, 4000)),
    new Date().toISOString(),
  )
}

export async function ensureLessonOpening(db: DatabaseSync, ownerUserId: string, sessionId: string, results: ScoreLine[]) {
  const session=await getOwnedSession(db, ownerUserId, sessionId)
  const row = (await db.prepare("SELECT count(*) AS n FROM lesson_messages WHERE session_id = ?").get(sessionId)) as { n: number }
  if (row.n > 0) return
  const known=await studentGraph(db,String(session.student_id)),items=await sessionItems(db,sessionId)
  const explained=results.map(result=>{const item=items.find(i=>i.prompt===result.prompt),concept=item?known.nodes.get(String(item.concept_id)):undefined;return{...result,recall:concept?.recall,example:concept?.example}})
  await addLesson(db, ownerUserId, sessionId, "tutor", lessonOpening(explained))
}

export async function markPlanBuild(db: DatabaseSync, studentId: string, subject: string, status: string, note: string) {
  await db.prepare("UPDATE subject_plans SET build_status = ?, build_note = ? WHERE student_id = ? AND lower(subject) = lower(?)").run(
    status,
    note,
    studentId,
    subject,
  )
}

async function subjectPlan(db: DatabaseSync, studentId: string, subject: string) {
  return (await db
    .prepare(
      "SELECT subject, about, question_types, syllabus_text, syllabus_name, build_status, build_note, updated_at FROM subject_plans WHERE student_id = ? AND lower(subject) = lower(?)",
    )
    .get(studentId, subject)) as SubjectPlanRow | undefined
}

export async function setPlacement(
  db: DatabaseSync,
  ownerUserId: string,
  studentId: string,
  input: { mathCourse: string; subjects: string[] },
) {
  const student = (await assertStudent(db, ownerUserId, studentId))
  const course = input.mathCourse as MathCourse
  if (!COURSE_LADDER_SET.has(course)) throw new UserError("Pick a math class.")
  const subjects = [...new Set(input.subjects.map((subject) => subject.trim()).filter(Boolean))]
  if (!subjects.length) throw new UserError("Keep at least one subject.")
  await db.prepare("UPDATE students SET math_course = ?, subjects = ? WHERE id = ?").run(course, JSON.stringify(subjects), studentId)
  await writeProgram(db, studentId, contentGrade(student.grade, course))
  await recordDecision(db, studentId, "placement_changed", "The parent explicitly chose the math course and active subjects.", {
    mathCourse: course, subjects, before: { mathCourse: student.math_course || "grade", subjects: parseSubjects(student.subjects) }, after: { mathCourse: course, subjects },
  })
}

export async function topicCandidates(db: DatabaseSync, ownerUserId: string, studentId: string, subject: string, useCase: "assessment" | "homework") {
  const student = (await assertStudent(db, ownerUserId, studentId))
  const menu = (await topicMenu(db, ownerUserId, studentId))
  const group = menu.groups.find((entry) => sameSubject(entry.subject, subject))
  const misses = (await missCounts(db, studentId))
  const plan = (await subjectPlan(db, studentId, subject))
  return {
    useCase,
    subject,
    ageGrade: student.grade,
    mathClass: menu.courseLabel,
    plan: plan
      ? {
          about: plan.about,
          syllabusExcerpt: [plan.syllabus_text.slice(0, 800), (await latestDirection(db, studentId, subject))?.body.slice(0, 800)]
            .filter(Boolean)
            .join("\n"),
        }
      : undefined,
    topics: (group?.topics ?? []).map((topic) => ({
      id: topic.conceptId,
      title: topic.title,
      strength: topic.strength,
      misses: misses.get(topic.conceptId)?.misses ?? 0,
      errors: misses.get(topic.conceptId)?.errors ?? [],
    })),
  }
}

export async function topicMenu(db: DatabaseSync, ownerUserId: string, studentId: string) {
  const student = (await assertStudent(db, ownerUserId, studentId))
  const subjects = parseSubjects(student.subjects)
  const course = (student.math_course || "grade") as MathCourse
  const level = contentGrade(student.grade, course)
  const known = (await studentGraph(db, studentId))
  const byId = Object.fromEntries((await listStates(db, studentId)).map((state) => [state.conceptId, state]))
  const weak = new Set((await weakConceptIds(db, studentId)))
  const groups = subjects.map((subject) => {
    const topics = [...known.nodes.values()].filter((concept) => {
      if (!sameSubject(concept.subject, subject)) return false
      if (sameSubject(subject, "Math")) {
        return concept.grade === level || concept.conceptId.startsWith("custom.") || weak.has(concept.conceptId)
      }
      return concept.conceptId.startsWith("custom.")
    })
    return {
      subject,
      topics: topics.map((concept) => {
        const state = byId[concept.conceptId]
        return {
          conceptId: concept.conceptId,
          title: concept.title,
          strength: strengthLabel(state?.status ?? "unseen", state?.mastery ?? 0),
        }
      }),
    }
  })
  return {
    ageGrade: student.grade,
    mathCourse: course,
    courseLabel: COURSE_LABEL[course],
    contentGrade: level,
    subjects,
    nextFocus: (await weakConceptIds(db, studentId))
      .map((id) => known.nodes.get(id)?.title)
      .filter((title): title is string => Boolean(title)),
    groups,
  }
}

const COURSE_LADDER_SET = new Set<MathCourse>(["remedial", "grade", "prealgebra", "algebra"])

function sameSubject(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

export function parseSubjects(raw: string | null) {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown
    if (Array.isArray(parsed) && parsed.length) return parsed.map((subject) => String(subject))
  } catch {
    return ["Math"]
  }
  return ["Math"]
}

async function maybeAdvanceCourse(db: DatabaseSync, student: StudentRow): Promise<StudentRow> {
  const course = student.math_course || "grade"
  const level = contentGrade(student.grade, course)
  const ids = [...(await studentGraph(db, student.id)).nodes.values()]
    .filter((concept) => sameSubject(concept.subject, "Math") && concept.grade === level && !concept.conceptId.startsWith("custom."))
    .map((concept) => concept.conceptId)
  const next = nextCourse(course)
  if (!ids.length || !next) return student
  const states = (await listStates(db, student.id))
  const solid = ids.every((id) => {
    const state = states.find((state) => state.conceptId === id)
    return state?.status === "mastered" && state.bloomLevel >= 3
  })
  if (!solid) return student
  await db.prepare("UPDATE students SET math_course = ? WHERE id = ?").run(next, student.id)
  await writeProgram(db, student.id, contentGrade(student.grade, next))
  return { ...student, math_course: next }
}

function rootsForSubject(known: ConceptGraph, student: StudentRow, subject: string) {
  if (sameSubject(subject, "Math")) {
    const level = contentGrade(student.grade, student.math_course || "grade")
    return [...known.nodes.values()]
      .filter((concept) => sameSubject(concept.subject, "Math") && concept.grade === level)
      .map((concept) => concept.conceptId)
  }
  return [...known.nodes.values()]
    .filter((concept) => concept.conceptId.startsWith("custom.") && sameSubject(concept.subject, subject))
    .map((concept) => concept.conceptId)
}

async function missCounts(db: DatabaseSync, studentId: string) {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const rows = (await db
    .prepare(
      `SELECT concept_id, error_type FROM attempts
       WHERE student_id = ? AND created_at >= ? AND correct = 0`,
    )
    .all(studentId, since)) as Array<{ concept_id: string; error_type: string | null }>
  const map = new Map<string, { misses: number; errors: string[] }>()
  for (const row of rows) {
    const current = map.get(row.concept_id) ?? { misses: 0, errors: [] }
    current.misses += 1
    if (row.error_type && !current.errors.includes(row.error_type)) current.errors.push(row.error_type)
    map.set(row.concept_id, current)
  }
  return map
}

async function weakConceptIds(db: DatabaseSync, studentId: string, now = new Date()) {
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString()
  const rows = (await db
    .prepare(
      `SELECT concept_id, SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) AS misses
       FROM attempts WHERE student_id = ? AND created_at >= ?
       GROUP BY concept_id HAVING SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) > 0
       ORDER BY misses DESC LIMIT 3`,
    )
    .all(studentId, since)) as Array<{ concept_id: string }>
  return rows.map((row) => row.concept_id)
}

async function recentRate(db: DatabaseSync, studentId: string) {
  const rows = (await db.prepare("SELECT correct FROM attempts WHERE student_id = ? ORDER BY created_at DESC LIMIT 8").all(studentId)) as Array<{
    correct: number
  }>
  if (rows.length < 4) return null
  return rows.filter((row) => row.correct === 1).length / rows.length
}

function conceptsForGrade(known: ConceptGraph, grade: number) {
  return [...known.nodes.values()]
    .filter((concept) => concept.subject === "math" && concept.grade === grade)
    .map((concept) => concept.conceptId)
}

async function studentGraph(db: DatabaseSync, studentId: string) {
  const rows = (await db.prepare("SELECT * FROM custom_concepts WHERE student_id = ?").all(studentId)) as Array<Record<string, SQLInputValue>>
  const custom: ConceptNode[] = rows.map((row) => ({
    conceptId: String(row.concept_id),
    subject: String(row.subject),
    grade: Number(row.grade),
    title: String(row.title),
    prereqs: (() => { try { const list = JSON.parse(String(row.prereqs ?? "[]")); return Array.isArray(list) ? list.map(String) : [] } catch { return [] } })(),
    recall: String(row.recall),
    example: String(row.example),
    nonExample: String(row.non_example),
  }))
  return buildGraph([...graph.nodes.values(), ...custom])
}

async function refreshGrade(db: DatabaseSync, row: StudentRow, now: Date): Promise<StudentRow> {
  if (!row.birth_date || row.grade_hold) return row
  const next = boundedGrade(gradeFromBirthday(row.birth_date, now))
  if (next === row.grade) return row
  await db.prepare("UPDATE students SET grade = ? WHERE id = ?").run(next, row.id)
  await writeProgram(db, row.id, contentGrade(next, row.math_course || "grade"))
  return { ...row, grade: next }
}

export async function writeProgram(db: DatabaseSync, studentId: string, grade: number) {
  const math = [...(await studentGraph(db, studentId)).nodes.values()]
    .filter((concept) => concept.subject === "math" && concept.grade === grade)
    .map((concept) => concept.conceptId)
  const extra = (await db.prepare("SELECT concept_id FROM custom_concepts WHERE student_id = ? AND purpose = 'year'").all(studentId)) as Array<{
    concept_id: string
  }>
  const ids = [...new Set([...math, ...extra.map((entry) => entry.concept_id)])]
  await db.prepare("UPDATE targets SET concept_ids = ?, title = ? WHERE student_id = ? AND kind = 'program'").run(
    JSON.stringify(ids),
    `${gradeLabel(grade)} math`,
    studentId,
  )
}

export async function seenPrompts(db: DatabaseSync, studentId: string) {
  const rows = (await db
    .prepare(
      `SELECT session_items.prompt AS prompt
       FROM session_items JOIN tutor_sessions ON tutor_sessions.id = session_items.session_id
       WHERE tutor_sessions.student_id = ?`,
    )
    .all(studentId)) as Array<{ prompt: string }>
  return new Set(rows.map((row) => promptIdentity(row.prompt)))
}

function isGenericDrill(prompt: string) {
  return (
    /^In your own words, what does /i.test(prompt) ||
    /^Why does "/i.test(prompt) ||
    /^Write two or three sentences that use "/i.test(prompt) ||
    /^A short test asks: how would you show/i.test(prompt) ||
    /^Application, on the /i.test(prompt) ||
    /^Creation, on the /i.test(prompt) ||
    /^Homework\. /i.test(prompt) ||
    /^Assessment\. /i.test(prompt) ||
    /Look at setting \d+/.test(prompt)
  )
}

async function insertPractice(
  db: DatabaseSync,
  studentId: string,
  conceptId: string,
  prompt: string,
  answer: string,
  bloom: number,
  now: Date,
  kind: "practice" | "transfer" = "practice",
  rubric?: Rubric,
) {
  await db.prepare(
    "INSERT INTO practice_items (id, student_id, concept_id, prompt, answer, bloom_level, created_at, evidence_kind, rubric_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(crypto.randomUUID(), studentId, conceptId, prompt, answer, bloom, now.toISOString(), kind, rubric ? JSON.stringify(rubric) : null)
}

/** A session item as the marker sees it: its key, its format and, for multiple choice, its options. */
export function itemGradable(item: Record<string, SQLInputValue>): Gradable {
  let choices: string[] | null = null
  try { const parsed = item.choices_json ? JSON.parse(String(item.choices_json)) : null; choices = Array.isArray(parsed) ? parsed.map(String) : null } catch { choices = null }
  return { answer: String(item.answer ?? ""), format: String(item.format ?? "text"), choices }
}

const sentence = (text?: unknown) => { const t = String(text ?? "").trim(); return !t ? "" : /[.!?]$/.test(t) ? t : `${t}.` }

/**
 * What a child sees after a miss: one nudge question first (the item's first hint), then, only when they ask,
 * the explanation and the answer. `move` keeps the whole explanation for older readers of the feedback.
 */
export function childCorrection(label: string, item: Record<string, SQLInputValue>, concept: { recall?: string; example?: string } | undefined, reset = false, why = "") {
  let hints: string[] = []
  try { const parsed = item.hints_json ? JSON.parse(String(item.hints_json)) : []; hints = Array.isArray(parsed) ? parsed.map(String) : [] } catch { hints = [] }
  const ask = hints.find((hint) => hint && !hint.toLowerCase().includes(String(item.answer ?? "").toLowerCase()) && !/key or rubric/i.test(hint)) ?? "What is the question asking you to do?"
  const explain = item.explanation ? sentence(item.explanation) : [sentence(concept?.recall), concept?.example ? `Worked example: ${sentence(concept.example)}` : ""].filter(Boolean).join(" ")
  const answer = childAnswer(String(item.answer ?? ""))
  const next = reset ? "We’ll leave this topic for now. Ask about a step, or take a break." : "Then try a fresh question on your own."
  const reason = /^(That is not the answer yet|That matches the answer)\.?$/.test(why.trim()) ? "" : sentence(childReasonText(why))
  return { label, why: reason, ask, explain, answer, reset, move: `${reason ? `${reason} ` : ""}${explain} The answer: ${sentence(answer)} ${next}`.trim() }
}

export interface ClaimedPractice { prompt: string; answer: string; bloom: BloomLevel; format: string; choices: string[] | null; hints: string[] | null; explanation: string; packId: string | null; kind?: "practice" | "transfer"; rubric?: string | null }

/** Takes the best unused stored question: learning-pack questions first, then the closest demand, then the oldest. Seen prompts are spent and skipped. */
async function claimPractice(db: DatabaseSync, studentId: string, conceptId: string, now: Date, bloom: number, seen: Set<string>, packOnly = false): Promise<ClaimedPractice | null> {
  const rows = (await db
    .prepare(
      `SELECT id, prompt, answer, bloom_level, pack_id, format, choices_json, hints_json, explanation, evidence_kind, rubric_json FROM practice_items
       WHERE student_id = ? AND concept_id = ? AND used_at IS NULL ${packOnly ? "AND pack_id IS NOT NULL" : ""}
       ORDER BY CASE WHEN pack_id IS NULL THEN 1 ELSE 0 END, abs(bloom_level - ?), created_at LIMIT 12`,
    )
    .all(studentId, conceptId, bloom)) as Array<Record<string, SQLInputValue>>
  for (const row of rows) {
    await db.prepare("UPDATE practice_items SET used_at = ? WHERE id = ?").run(now.toISOString(), row.id)
    if (seen.has(promptIdentity(String(row.prompt)))) continue
    const list = (value: SQLInputValue) => { try { const parsed = value ? JSON.parse(String(value)) : null; return Array.isArray(parsed) ? parsed.map(String) : null } catch { return null } }
    return {
      prompt: String(row.prompt), answer: String(row.answer), bloom: Number(row.bloom_level) as BloomLevel,
      format: String(row.format ?? "text"), choices: list(row.choices_json), hints: list(row.hints_json), explanation: String(row.explanation ?? ""),
      packId: row.pack_id ? String(row.pack_id) : null,
      kind: row.evidence_kind === "transfer" ? "transfer" as const : "practice" as const,
      rubric: row.rubric_json ? String(row.rubric_json) : null,
    }
  }
  return null
}

function parseProblems(prompt?: string, answer?: string, batch?: string) {
  const items: Array<{ prompt: string; answer: string }> = []
  if ((prompt ?? "").trim() || (answer ?? "").trim()) {
    if (!(prompt ?? "").trim() || !(answer ?? "").trim()) {
      throw new UserError("A problem needs both the question and the answer.")
    }
    items.push({ prompt: prompt!.trim(), answer: answer!.trim() })
  }
  for (const line of (batch ?? "").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const bar = trimmed.indexOf("|")
    if (bar < 1) throw new UserError("Each extra line needs a question, a | bar, and an answer.")
    const question = trimmed.slice(0, bar).trim()
    const key = trimmed.slice(bar + 1).trim()
    if (!question || !key) throw new UserError("Each extra line needs a question, a | bar, and an answer.")
    items.push({ prompt: question, answer: key })
  }
  return items
}

export function validBirthday(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  if (!trimmed) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) throw new UserError("Birthday must be a real date.")
  return trimmed
}

export function boundedGrade(grade: number): number {
  if (!Number.isInteger(grade) || grade < 0 || grade > 12) {
    throw new UserError("Grade must be from kindergarten through 12. Hold a grade by hand if the birthday falls outside that.")
  }
  return grade
}

async function continuityLine(db: DatabaseSync, studentId: string, today: string) {
  const row = (await db
    .prepare("SELECT concept_id, bloom_level, day FROM attempts WHERE student_id = ? AND day < ? ORDER BY created_at DESC LIMIT 1")
    .get(studentId, today)) as { concept_id: string; bloom_level: number; day: string } | undefined
  if (!row) return "This is session zero. We'll find the edge of what is already solid."
  const title = (await studentGraph(db, studentId)).nodes.get(row.concept_id)?.title ?? row.concept_id
  return `Last time, ${title} was at ${bloomLabel(row.bloom_level)}. Ready?`
}

async function endSession(db: DatabaseSync, sessionId: string, reason: string, now: Date) {
  const updated = (await db.prepare("UPDATE tutor_sessions SET ended_at = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL").run(
    now.toISOString(),
    reason,
    sessionId,
  ))
  if (updated.changes) {
    const session = (await db.prepare("SELECT student_id FROM tutor_sessions WHERE id = ?").get(sessionId))!
    await recordDecision(db, String(session.student_id), "session_ended", reason === "attention" ? "The attention cap ended the session even though work may remain." : "The session ended after the student's recap.", { sessionId, reason }, now)
  }
}

async function rewriteItem(db: DatabaseSync, item: Record<string, SQLInputValue>, delta: number) {
  const nextBloom = Math.min(6, Math.max(1, Number(item.bloom_level) + delta)) as BloomLevel
  const owner = (await db.prepare("SELECT student_id FROM tutor_sessions WHERE id = ?").get(String(item.session_id))) as
    | { student_id: string }
    | undefined
  if (!owner) return
  const known = (await studentGraph(db, owner.student_id))
  const concept = known.nodes.get(String(item.concept_id))
  if (!concept) return
  const pack = await claimPractice(db, owner.student_id, concept.conceptId, new Date(), nextBloom, await seenPrompts(db, owner.student_id), true)
  if (pack) {
    await db.prepare(
      "UPDATE session_items SET bloom_level = ?, prompt = ?, answer = ?, hints_json = ?, format = ?, choices_json = ?, explanation = ?, hints_used = 0, hint_text = NULL WHERE id = ?",
    ).run(pack.bloom, pack.prompt, pack.answer, JSON.stringify(pack.hints ?? []), pack.format, pack.choices ? JSON.stringify(pack.choices) : null, pack.explanation, item.id)
    await recordDecision(db, owner.student_id, "difficulty_adjusted", delta > 0 ? "The rolling scored answers support a harder task." : "The rolling scored answers call for an easier task or corrective.", {
      sessionId: item.session_id, itemId: item.id, conceptId: item.concept_id, previousBloom: item.bloom_level, nextBloom: pack.bloom, packId: pack.packId,
    })
    return
  }
  const partner = item.partner_concept_id ? known.nodes.get(String(item.partner_concept_id)) ?? null : null
  const generated = generateItem(concept, nextBloom, randomInt(1, 1_000_000_000), {
    interleaved: item.interleaved === 1,
    partner,
    itemId: String(item.id),
  })
  await db.prepare(
    "UPDATE session_items SET bloom_level = ?, prompt = ?, answer = ?, hints_json = ?, surface = ?, format = 'text', choices_json = NULL, explanation = '', hints_used = 0, hint_text = NULL WHERE id = ?",
  ).run(nextBloom, generated.prompt, generated.answer, JSON.stringify(generated.hintLadder), generated.surface, item.id)
  await recordDecision(db, owner.student_id, "difficulty_adjusted", delta > 0 ? "The rolling scored answers support a harder task." : "The rolling scored answers call for an easier task or corrective.", {
    sessionId: item.session_id, itemId: item.id, conceptId: item.concept_id,
    previousBloom: item.bloom_level, nextBloom, surface: generated.surface,
  })
}

function rowToState(row: Record<string, SQLInputValue>): LearnerConceptState {
  return {
    conceptId: String(row.concept_id),
    bloomLevel: Number(row.bloom_level) as BloomLevel,
    mastery: Number(row.mastery),
    stabilityDays: Number(row.stability_days),
    nextDue: String(row.next_due),
    errorSignatures: JSON.parse(String(row.error_signatures)) as string[],
    hintsLast10: Number(row.hints_last_10),
    masteredIn: (row.mastered_in as Mode | null) ?? null,
    status: row.status as LearnerConceptState["status"],
  }
}

function medianOf(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function normalizeLoose(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "")
}

export function newId() {
  return randomBytes(8).toString("hex")
}

export async function rollingSix(db: DatabaseSync, studentId: string, conceptId?: string, bloomLevel?: number): Promise<boolean[]> {
  const evidence = freshEvidence(await loadAttempts(db, studentId))
  const latest = evidence.at(-1)
  return evidence.filter(a => a.conceptId === (conceptId ?? latest?.conceptId) && a.bloomLevel === (bloomLevel ?? latest?.bloomLevel)).slice(-6).map(a => a.correct)
}

export async function enforceSessionTime(db: DatabaseSync, owner: string, sessionId: string, now = new Date()) {
  const session = (await getOwnedSession(db, owner, sessionId))
  // Time spent paused does not count against the mission.
  const until = session.paused_at ? Math.min(now.getTime(), Date.parse(String(session.paused_at))) : now.getTime()
  if (!session.ended_at && until >= Date.parse(String(session.started_at)) + Number(session.cap_minutes) * 60000) await endSession(db, sessionId, "attention", now)
  return (await getOwnedSession(db, owner, sessionId))
}
export async function pauseSession(db: DatabaseSync, owner: string, sessionId: string) {
  await getOwnedSession(db, owner, sessionId)
  await db.prepare("UPDATE tutor_sessions SET paused_at = ? WHERE id = ?").run(new Date().toISOString(), sessionId)
}
export async function resumeSession(db: DatabaseSync, owner: string, sessionId: string, duration?: number): Promise<string> {
  return withWrite(db, async (): Promise<string> => {
    const old = (await getOwnedSession(db, owner, sessionId))
    const first = (await sessionItems(db, sessionId)).find(i => i.answered === 0)
    if (!first) return sessionId
    if (old.paused_at && !old.ended_at) {
      // Move the start forward by the pause, so the clock picks up where it stopped.
      const paused = Math.max(0, Date.now() - Date.parse(String(old.paused_at)))
      await db.prepare("UPDATE tutor_sessions SET started_at = ?, paused_at = NULL, paused_ms = coalesce(paused_ms, 0) + ? WHERE id = ?").run(new Date(Date.parse(String(old.started_at)) + paused).toISOString(), Math.round(paused), sessionId)
    }
    await enforceSessionTime(db, owner, sessionId)
    if (!(await getOwnedSession(db, owner, sessionId)).ended_at) {
      await db.prepare("UPDATE tutor_sessions SET paused_at = NULL WHERE id = ?").run(sessionId)
      return sessionId
    }
    const id = (await startTutorSession(db, owner, String(old.student_id), new Date(), { durationMinutes: duration, subject: String(old.subject), mode: old.mode as any, goal: "resume", materialId: old.material_id ? String(old.material_id) : undefined, questionId: old.question_id ? String(old.question_id) : undefined }))
    await db.prepare("DELETE FROM session_items WHERE session_id = ?").run(id)
    for (const [index, item] of ((await sessionItems(db, sessionId)).filter(i => i.answered === 0)).entries()) {
      await db.prepare(`INSERT INTO session_items (id, session_id, position, beat, concept_id, bloom_level, prompt, answer, hints_json, surface, interleaved, partner_concept_id, hints_used, hint_text, draft_answer, answered, format, choices_json, explanation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`).run(crypto.randomUUID(), id, index + 1, item.beat, item.concept_id, item.bloom_level, item.prompt, item.answer, item.hints_json, item.surface, item.interleaved, item.partner_concept_id, item.hints_used, item.hint_text, await sealFor(db, owner, item.draft_answer), item.format ?? "text", item.choices_json ?? null, item.explanation ?? "")
    }
    // A carried-on first check stays a first check, so a second interruption carries on again.
    if (["probe", "harder_probe"].includes(String(old.goal))) await db.prepare("UPDATE tutor_sessions SET goal = ? WHERE id = ?").run(String(old.goal), id)
    await db.prepare("UPDATE tutor_sessions SET carried_from = ? WHERE id = ?").run(sessionId, id)
    await db.prepare("UPDATE tutor_sessions SET paused_at = NULL, end_reason = 'continued' WHERE id = ?").run(sessionId)

    return id
  })
}

async function completeFollowup(db: DatabaseSync, student: string, session: string, today: string) {
  const concepts = (await sessionItems(db, session)).filter(i => i.correct != null && i.answered === 1).map(i => String(i.concept_id))
  for (const concept of new Set(concepts)) await db.prepare("UPDATE followup_missions SET completed_session = ? WHERE student_id = ? AND concept_id = ? AND due <= ? AND completed_session IS NULL").run(session, student, concept, today)
}

function modeForRecovery(session: Record<string, any>) { return session.mode === "session" }

export async function adventureFor(db: DatabaseSync, ownerId: string, studentId: string) {
  await assertStudent(db, ownerId, studentId)
  return learningMilestones(await loadAttempts(db, studentId))
}

export async function missionSummary(db: DatabaseSync, ownerId: string, sessionId: string) {
  const session = await getOwnedSession(db, ownerId, sessionId)
  const rows = await sessionItems(db, sessionId)
  const attempts = freshEvidence(await loadAttempts(db, String(session.student_id)))
  const independent = attempts.filter(a => a.sessionId === sessionId && a.correct).length
  const supported = rows.filter(i => i.correct === 1 && (Number(i.hints_used) > 0 || session.mode === "homework")).length
  const unresolved = rows.filter(i => i.answered === 1 && i.correct == null).length
  const studentId = String(session.student_id)
  const next = await nextLearningAction(db, ownerId, studentId)
  const today = dayStamp(new Date())
  const concepts = await studentConcepts(db, ownerId, studentId)
  const due = (await listStates(db, studentId))
    .filter(s => s.nextDue <= today && s.independentChecks && s.conceptId !== next?.conceptId && concepts.some(c => c.conceptId === s.conceptId))
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue))[0]
  const dueConcept = due ? concepts.find(c => c.conceptId === due.conceptId) : undefined
  const review = dueConcept ? { conceptId: dueConcept.conceptId, title: dueConcept.title, subject: dueConcept.subject } : null
  return { independent, supported, unresolved, next, review, subject: String(session.subject ?? ''), studentId }
}

export async function learningOverview(db: DatabaseSync, owner: string, studentId: string) {
  const student = await assertStudent(db, owner, studentId)
  const states = await listStates(db, studentId)
  const attempts = await loadAttempts(db, studentId)
  const evidence = freshEvidence(attempts)
  const next = await nextLearningAction(db, owner, studentId)
  const titles = await titleMap(db, studentId)
  const focusState = states.find(s => s.conceptId === next?.conceptId)
  const demand = workingBloom(focusState)
  const comparable = next ? evidence.filter(a => a.conceptId === next.conceptId && a.bloomLevel === demand).slice(-6) : []
  const rate = comparable.length ? comparable.filter(a => a.correct).length / comparable.length : null
  const challenge = comparable.length < 6 ? 'Finding the right starting point' : rate! >= .9 ? 'Ready for a stretch' : rate! >= .7 ? 'A productive challenge' : 'More support before a harder step'
  const pending = Number((await db.prepare('SELECT count(*) n FROM session_items i JOIN tutor_sessions s ON s.id = i.session_id WHERE s.student_id = ? AND i.answered = 1 AND i.correct IS NULL').get(studentId))?.n ?? 0)
  const scores = await db.prepare('SELECT title, earned, possible, date FROM school_results WHERE student_id = ? ORDER BY date DESC LIMIT 1').all(studentId)
  const known = states.filter(s => s.independentChecks)
  const due = known.filter(s => s.nextDue <= dayStamp(new Date()))
  const gaps = known.filter(s => s.status === 'stuck' || evidence.filter(a => a.conceptId === s.conceptId).at(-1)?.correct === false)
  const strong = known.filter(s => s.bloomLevel >= 2)
  return { student, next, titles, independent: evidence.length, supported: attempts.filter(a => a.correct && (a.hintsUsed > 0 || a.supportUsed === 'homework' || a.supportUsed === 'access')).length, days: new Set(evidence.map(a => a.day)).size, pending, due, gaps, strong, challenge, comparableCount: comparable.length, demand, successPercent: comparable.length >= 6 ? Math.round(rate! * 100) : null, lastScore: scores[0] ?? null }
}


export async function avoidRepeatedQuestions(db: DatabaseSync, owner: string, sessionId: string) {
  return withWrite(db, async () => {
    const session=await getOwnedSession(db,owner,sessionId)
    const history=await db.prepare('SELECT i.prompt FROM session_items i JOIN tutor_sessions s ON s.id = i.session_id WHERE s.student_id = ? AND i.answered = 1').all(session.student_id)
    const seen=new Set(history.map(i=>promptIdentity(String(i.prompt))))
    const original=await sessionItems(db,sessionId)
    if(session.mode!=='assessment') for(const id of new Set(original.filter(i=>i.answered===1 && i.correct===0).map(i=>i.concept_id))) {
      const misses=original.filter(i=>i.answered===1 && i.correct===0 && i.concept_id===id)
      if(misses.length>=2 && original.filter(i=>i.answered===1 && i.concept_id===id).at(-1)?.correct===0 && original.some(i=>i.answered===0 && i.concept_id===id)) await recordTeachingOutcome(db,session,misses.at(-1)!,false,String(misses.at(-1)!.grading_reason ?? 'These tries need a different teaching approach.'),new Date())
    }
    const active = await sessionItems(db,sessionId)
    const recallChecks = new Set(active.filter(i=>i.answered===1 && i.bloom_level===1).map(i=>`${i.concept_id}:${i.answer}`))
    for(const item of active) {
      if(item.answered===1) continue
      const key=promptIdentity(String(item.prompt))
      const recallKey=`${item.concept_id}:${item.answer}`
      if(seen.has(key) || (session.mode!=="assessment" && item.bloom_level===1 && recallChecks.has(recallKey))) await db.prepare("UPDATE session_items SET skipped = 1, skip_reason = 'repeated_prompt' WHERE id = ?").run(item.id)
      else { seen.add(key); if(item.bloom_level===1) recallChecks.add(recallKey) }
    }
  })
}

export async function acknowledgeFeedback(db: DatabaseSync, owner: string, sessionId: string) {
  await withWrite(db, async()=>{
    const session=await getOwnedSession(db,owner,sessionId)
    const count=(await sessionItems(db,sessionId)).filter(i=>i.answered===1).length
    await db.prepare('UPDATE tutor_sessions SET feedback_cursor = ?, pending_feedback = NULL WHERE id = ?').run(count,sessionId)
  })
}

async function recordTeachingOutcome(db: DatabaseSync, session: Record<string, SQLInputValue>, item: Record<string, SQLInputValue>, correct: boolean, reason: string, now: Date) {
  const items=await sessionItems(db,String(session.id))
  const misses=items.filter(i=>i.answered===1 && i.correct===0 && i.concept_id===item.concept_id)
  const concept=(await studentGraph(db,String(session.student_id))).nodes.get(String(item.concept_id))
  const reset=!correct && session.mode!=='assessment' && misses.length>=2
  if(reset) {
    await db.prepare("UPDATE session_items SET skipped = 1, skip_reason = 'teaching_reset' WHERE session_id = ? AND concept_id = ? AND answered = 0").run(session.id,item.concept_id)
    await recordDecision(db,String(session.student_id),'teaching_reset','Two different tries show that another drill is not the next step. Pause this topic, explain a worked example, and use the lesson conversation to clarify the gap.',{sessionId:session.id,conceptId:item.concept_id,misses:misses.length,errorCertainty:'hypothesis'},now)
  }
  const correction=correct ? null : childCorrection(reset?'Let’s change the approach':'Let’s learn from that try',item,concept,reset,reason)
  await db.prepare('UPDATE tutor_sessions SET pending_feedback = ? WHERE id = ?').run(JSON.stringify({correct,errorType:items.find(i=>i.id===item.id)?.error_type ?? null,itemId:item.id,prompt:item.prompt,givenAnswer:item.given_answer,corrective:correction,reason,action:reset?'teach':'feedback'}),session.id)
  const count=items.filter(i=>i.answered===1).length
  if(correct && session.mode==='session' && count<=2) await db.prepare('UPDATE tutor_sessions SET feedback_cursor = ? WHERE id = ?').run(count,session.id)
}

export async function practiceRefreshContext(db: DatabaseSync, owner:string, student:string, conceptId:string):Promise<FreshContext> {
  await assertStudent(db,owner,student)
  const concept=(await studentGraph(db,student)).nodes.get(conceptId)
  if(!concept) throw new UserError('Concept not found.')
  const state=(await listStates(db,student)).find(s=>s.conceptId===conceptId)
  const asked=await db.prepare('SELECT i.prompt FROM session_items i JOIN tutor_sessions s ON s.id = i.session_id WHERE s.student_id = ? AND i.concept_id = ? ORDER BY i.rowid DESC LIMIT 200').all(student,conceptId)
  return {concept,demand:workingBloom(state),asked:asked.map(i=>String(i.prompt)),evidence:await decisionContext(db,owner,student)}
}
