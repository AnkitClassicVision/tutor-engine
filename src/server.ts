import { sealFor, sealForStudent } from "./family-crypto.ts"
import { conceptSubject } from "./engine/access.ts"
import { sweepPrivateFiles } from "./file-erasures.ts"
import { UserError, userMessage } from "./errors.ts"
import { learningMeasures, type Measure } from "./learning-metrics.ts"
import { ageBand } from "./engine/age.ts"
import { FreshPracticeRequired, freshPractice } from './fresh-practice.ts'
import { recordRun } from './runbook/record.ts'
import { ladders } from "./engine/ladder.ts"
import { approveMap, approvedMap, concepts, isBuiltIn, mapRow, runResearchJob, startResearchJob, decideMap, subjectMaps } from "./subject-map.ts"
import { mapsSection, subjectMapPage } from "./subject-map-view.ts"
import { auditPage, auditSample, auditSummary, escalatedItems, recordAudit, raiseConcern, concernItems, resolveConcern, waitingItems } from "./grading-audit.ts"
import { EXPERIMENTS, armFor, enrolled, experimentReport, setExperiment, type ExperimentKey } from "./experiments.ts"
import { gainOnFairChecks } from "./engine/gain.ts"
import { feedbackState, promptIdentity } from './session-feedback.ts'
import { withDatabaseScope } from "./transaction.ts"
import { readPrivateFile } from "./storage.ts"
import { renderSheetPdf } from "./pdf.ts"
import { createHash } from "node:crypto"
import { journeyRoute, authorizeStudentPath, parentReturn, type Auth } from "./journey-routes.ts"
import { runPack } from "./pack.ts"
import { studentHome, parentTools, nav, presentation, learnerAttrs, type ParentView } from "./journey-view.ts"
import { lessonCard } from "./view.ts"
import { createJob, jobForKey, sendKey, startWorker, runNextJob, type JobContext, type JobHandler } from "./jobs.ts"
import { enqueueWeeklyDigests, weeklyDigestJob } from "./digest.ts"
import { queueTalk, processTalk, talkFor, startCurriculumJob } from "./class-planning.ts"
import { processPlanner } from "./planner.ts"
import { undoStates } from "./undo.ts"
import { parentSurface, plannerDrawer, plannerStudentFor } from "./planner-view.ts"
import { extractMaterial, reviewMaterial, guideQuestion, ownedMaterial, ownedQuestion, currentSchoolSource, schoolLearningText, applySchoolLearning, type SchoolSource } from "./schoolwork.ts"
import { issueAccountToken, flushMail } from "./accounts.ts"
import { enforceSessionTime, loadAttempts } from "./services.ts"
import { readFileSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import type { Database as DatabaseSync } from "./database.ts"
import { chatgptAccessToken, chatgptConfig, listChatGptModels } from "./chatgpt.ts"
import { networkSource } from "./auth-throttle.ts"
import { destroyAuthSession, loginUser, openAuthSession, readAuthSession, registerUser } from "./auth.ts"
import { planCurriculum, readSyllabusUpload } from "./plan-subject.ts"
import { judgeAnswer, type Grounding } from "./grade-response.ts"
import { readRubric } from "./rubric.ts"
import { decisionContext, decisionHistory, recordDecision } from "./decisions.ts"
import { contentGrade } from "./engine/course.ts"
import { gradeLabel } from "./engine/grade.ts"
import type { BloomLevel, ErrorType } from "./engine/types.ts"
import { answerLesson, parentAgrees, planTalk } from "./talk.ts"
import { questionSignal } from "./coaching.ts"
import { safetyReply } from "./child-safety.ts"
import {
  applyCurriculum,
  practiceRefreshContext,
  acknowledgeFeedback,
  avoidRepeatedQuestions,
  assertStudent,
  clearBreak,
  createSheet,
  addLearning,
  createStudent,
  createTarget,
  getOwnedSession,
  getSheet,
  getUpload,
  acceptPlan,
  addLesson,
  addTalk,
  ensureLessonOpening,
  latestProposal,
  listLesson,
  listTalk,
  listTalkSubjects,
  finishTalk,
  moveTalk,
  studentProgress,
  listAdded,
  listSubjectPlans,
  uploadedSourceText,
  saveSubjectPlan,
  addDirection,
  aiConfigFor,
  aiSettings,
  aiConnectionProblem,
  aiChildLine,
  saveAiSettings,
  latestDirection,
  markPlanBuild,
  settleStuckPlans,
  retireUnusedQuestions,
  listStates,
  listStudents,
  removeProblem,
  removeTopic,
  patternForSession,
  saveRecap,
  storePattern,
  saveUpload,
  scoreboardFor,
  scoreSheet,
  sessionItems,
  startTutorSession,
  setPlacement,
  topicCandidates,
  studentConcepts,
  topicMenu,
  nextLearningAction,
  missionSummary,
  submitAnswer,
  reviewAnswer,
  titleMap,
  updateStudentProfile,
  useHint,
} from "./services.ts"
import {
  esc,
  homePage,
  page,
  scoreboardPage,
  scoreResultPage,
  sessionPage,
  settingsPage,
  sheetPage,
  studentPage,
  historyPage,
  studentsPage,
} from "./view.ts"

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = join(here, "../public")
const ERRORS = new Set([
  "retrieval_gap",
  "procedural_slip",
  "misconception",
  "decoding",
  "attention",
  "transfer_failure",
])

export interface AppOptions {
  db: DatabaseSync
  uploadsDir: string
  runWorker?: boolean
  onAuthenticated?: (owner: string) => void
  onRecoveryMail?: (owner: string) => void
  judgeResponse?: typeof judgeAnswer
}

export async function startServer(options: AppOptions & { host: string; port: number }) {
  if (process.env.TUTOR_CODEX_LOCAL === "1" && (process.env.TUTOR_PUBLIC === "1" || !["127.0.0.1", "::1", "localhost"].includes(options.host))) throw new Error("The Codex test tutor must listen only on loopback.")
  const server = createServer(async (req, res) => {
    handle(req, res, options).catch((error) => {
      userMessage(error)
      if (!res.headersSent) send(res, 500, "text/plain", "Could not finish. Your saved work is still here. Please try again.")
    })
  })
  const stopWorker = process.env.TUTOR_PUBLIC === "1" || options.runWorker === false ? () => {} : (await startWorker(options.db, jobHandlers(options)))
  const digestTimer = process.env.TUTOR_PUBLIC === "1" || options.runWorker === false ? undefined : setInterval(() => { sweepPrivateFiles(options.db, options.uploadsDir).then(() => enqueueWeeklyDigests(options.db)).catch(() => console.error("Weekly digest scheduling paused; it retries next minute.")) }, 60_000)
  digestTimer?.unref()
  server.on("close", () => { if (digestTimer) clearInterval(digestTimer); stopWorker() })
  server.listen(options.port, options.host)
  return server
}

export async function handle(req: IncomingMessage, res: ServerResponse, options: AppOptions) {
  if (!(await acceptBody(req, res))) return
  if (req.url?.split('?')[0].endsWith('/events')) return handleRequest(req, res, options)
  return withDatabaseScope(options.db, () => handleRequest(req, res, options))
}
async function handleRequest(req: IncomingMessage, res: ServerResponse, options: AppOptions) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1")
  const method = req.method ?? "GET"
  if (method === "GET" && url.pathname === "/app.css") return sendFile(res, join(publicDir, "app.css"), "text/css")
  if (method === "GET" && url.pathname === "/session.js") return sendFile(res, join(publicDir, "session.js"), "text/javascript")
  const font = url.pathname.match(/^\/fonts\/([a-z0-9-]+\.woff2)$/)
  if (method === "GET" && font) return sendFile(res, join(publicDir, "fonts", font[1]), "font/woff2")
  const art = url.pathname.match(/^\/worlds\/(cartoon|8bit|toybox|sticker|princess|booklet)\/([a-z0-9-]+\.webp)$/)
  if (method === "GET" && art) return sendFile(res, join(publicDir, "worlds", art[1], art[2]), "image/webp")
  if (method === "GET" && url.pathname === "/blob-client.js") return sendFile(res, join(publicDir, "blob-client.js"), "text/javascript")
  if (method === "GET" && url.pathname === "/journey.js") return sendFile(res, join(publicDir, "journey.js"), "text/javascript")
  if (method === "GET" && url.pathname === "/job-watch.js") return sendFile(res, join(publicDir, "job-watch.js"), "text/javascript")
  if (method === "GET" && url.pathname === "/planner-drawer.js") return sendFile(res, join(publicDir, "planner-drawer.js"), "text/javascript")
  if (method === "GET" && url.pathname === "/pack-ask.js") return sendFile(res, join(publicDir, "pack-ask.js"), "text/javascript")
  if (method === "GET" && url.pathname === "/manipulatives.js") return sendFile(res, join(publicDir, "manipulatives.js"), "text/javascript")
  if (method === "GET" && url.pathname === "/live-tutor.js") return sendFile(res, join(publicDir, "live-tutor.js"), "text/javascript")
  if (method === "GET" && url.pathname === "/favicon.ico") return send(res, 204, "image/x-icon", "")
  if (method === "GET" && url.pathname === "/cron/weekly-digest") {
    // Vercel Cron sends the project secret as a bearer token; without a configured secret the route does not exist.
    const secret = process.env.CRON_SECRET
    if (!secret) return send(res, 404, "text/plain", "Not found.")
    if (req.headers.authorization !== `Bearer ${secret}`) return send(res, 401, "text/plain", "Unauthorized.")
    await sweepPrivateFiles(options.db, options.uploadsDir)
    const queued = await enqueueWeeklyDigests(options.db)
    let ran = 0
    for (; ran < 10; ran++) if (!(await runNextJob(options.db, jobHandlers(options)))) break
    await flushMail(options.db, 10)
    return send(res, 200, "application/json", JSON.stringify({ queued, ran }))
  }
  if (method === "GET" && url.pathname === "/health") {
    return send(res, 200, "application/json", JSON.stringify({ ok: true }))
  }

  const cookies = parseCookies(req)
  const formCsrf = cookies.tutor_csrf ?? newCsrf()
  if (!cookies.tutor_csrf) {
    res.setHeader("Set-Cookie", cookieHeader("tutor_csrf", formCsrf, 60 * 60 * 12))
  }
  const auth = cookies.tutor_session ? (await readAuthSession(options.db, cookies.tutor_session)) : null
  if (auth) options.onAuthenticated?.(auth.userId)
  const csrf = auth?.csrf ?? formCsrf

  if (auth?.studentOnly && method === 'GET' && ['/', '/students'].includes(url.pathname)) return redirect(res, `/students/${auth.selectedStudent}`)
  if (auth && !(await authorizeStudentPath(options.db, auth, url.pathname, method))) {
    if (auth.studentOnly && method === 'GET') return html(res, 'Student space', '<h1>This is your student space</h1><p>Parent settings and other students stay private. Sign out to use a parent account.</p><form action="/logout" method="post"><input type="hidden" name="csrf" class="csrf-field" value=""><button type="submit">Parent sign-in</button></form>', csrf)
    if (method === "GET") {
      const destination = parentReturn(auth, url.pathname + url.search)
      return redirect(res, destination ? `/parent/unlock?returnTo=${encodeURIComponent(destination)}` : "/parent/unlock")
    }
    return send(res, 403, "text/plain", "Unlock the parent area to do this.")
  }
  if (auth && process.env.TUTOR_PUBLIC === "1" && !url.pathname.startsWith("/account/") && !["/logout", "/parent/unlock", "/parent/lock"].includes(url.pathname) && !(await options.db.prepare("SELECT id FROM users WHERE id = ? AND email_verified_at IS NOT NULL").get(auth.userId))) return html(res, "Verify your email", "<h1>Check your email</h1><p>Use the verification email before setting up your family.</p>", csrf)
  if (method === "GET" && auth?.parentUnlocked && !auth.studentOnly && parentSurface(url.pathname)) {
    const plannerStudent = plannerStudentFor(auth, url.pathname)
    if (plannerStudent) {
      // ?talk= links from older pages, emails and job results open the planner with the class named.
      const talk = url.searchParams.get("talk"), say = url.searchParams.get("say")?.slice(0, 400) ?? ""
      const open = url.searchParams.get("planner") === "open" || talk !== null
      const prefill = say || (talk === null ? "" : talk.toLowerCase() === "new" || !talk ? "Add a class called " : `Change the ${talk.slice(0, 80)} class: `)
      try { pageExtras.set(res, await plannerDrawer(options.db, auth.userId, plannerStudent, prefill, open)) } catch { /* The page still renders without the drawer. */ }
    }
  }
  if (method === "POST") {
    const body = requestBodies.get(req)!
    const fields = body.fields
    const posted = fields.csrf ?? body.json.csrf ?? ""
    const expected = auth?.csrf ?? cookies.tutor_csrf ?? ""
    if (!posted || posted !== expected) {
      return send(res, 403, "text/plain", "The form expired. Go back and try again.")
    }
    try {
      if (await journeyRoute(req, res, url, auth, options, { ...body.json, ...fields }, html, send, redirect)) return
    } catch (error) {
      return send(res, 400, "application/json", JSON.stringify({ error: userMessage(error) }))
    }
    return (await post(url, fields, body.json, auth, cookies, res, options, (req.headers.accept ?? "").includes("application/json"), networkSource(req)))
  }

  try {
    if (await journeyRoute(req, res, url, auth, options, { csrf }, html, send, redirect)) return
  } catch (error) { if (!(error instanceof UserError)) userMessage(error); return send(res, 404, "text/plain", "That page was not found or the link expired.") }
  if (!auth && url.pathname !== "/") {
    res.writeHead(303, { Location: "/" })
    return res.end()
  }
  if (auth && url.pathname === "/") {
    res.writeHead(303, { Location: "/students" })
    return res.end()
  }
  if (url.pathname === "/") return html(res, "Sign in", homePage(url.searchParams.get("error") ?? ""), csrf)
  if (auth && process.env.TUTOR_PUBLIC === "1" && !(await options.db.prepare("SELECT id FROM users WHERE id = ? AND email_verified_at IS NOT NULL").get(auth.userId))) {
    return html(res, "Verify your email", "<h1>Check your email</h1><p>Verify the family email using the link we sent before adding a learner.</p>", csrf)
  }
  if (url.pathname === "/settings") {
    const settings = (await aiSettings(options.db, auth!.userId))
    let chatgptModels: Array<{ slug: string; name: string }> = []
    if (chatgptConfig() && settings.provider === "chatgpt" && settings.chatgpt && !settings.chatgpt.reconnect) {
      try { chatgptModels = await listChatGptModels(await chatgptAccessToken(options.db, auth!.userId)) } catch {}
    }
    return html(
      res,
      "AI",
      settingsPage({
        ...settings,
        chatgptAvailable: Boolean(chatgptConfig()),
        chatgptModels,
        studentId: auth!.selectedStudent,
        notice: url.searchParams.get("notice") ?? "",
        error: url.searchParams.get("error") ?? "",
      }),
      csrf,
    )
  }
  if (url.pathname === "/students") {
    return html(res, "Students", studentsPage((await listStudents(options.db, auth!.userId)), url.searchParams.get("error") ?? ""), csrf)
  }

  const progressMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/progress$/i)
  if (progressMatch && method === "GET") {
    try {
      const progress = (await studentProgress(options.db, auth!.userId, progressMatch[1]))
      return send(res, 200, "application/json", JSON.stringify(progress))
    } catch {
      return send(res, 404, "application/json", JSON.stringify({ stamp: "" }))
    }
  }

  const historyMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/history$/i)
  if (historyMatch && method === "GET") {
    try {
      const records = (await decisionHistory(options.db, auth!.userId, historyMatch[1]))
      const undo = await undoStates(options.db, historyMatch[1], records)
      return html(res, "Learning history", historyPage(historyMatch[1], records, { ...undo, notice: url.searchParams.get("notice") ?? "", error: url.searchParams.get("error") ?? "" }), csrf)
    } catch { return send(res, 404, "text/plain", "Student not found.") }
  }
  const gradingMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/grading$/i)
  if (gradingMatch && method === "GET") {
    try {
      const student = await assertStudent(options.db, auth!.userId, gradingMatch[1])
      return html(res, "Check the grading", auditPage(student.id, student.display_name, await auditSample(options.db, student.id), await auditSummary(options.db, student.id), await titleMap(options.db, student.id), await escalatedItems(options.db, student.id), await concernItems(options.db, student.id), await waitingItems(options.db, student.id)), csrf)
    } catch { return send(res, 404, "text/plain", "Student not found.") }
  }
  const mapMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/maps\/([0-9a-f-]{36})$/i)
  if (mapMatch && method === "GET") {
    try {
      const student = await assertStudent(options.db, auth!.userId, mapMatch[1])
      const row = await mapRow(options.db, student.id, mapMatch[2])
      if (!row) return send(res, 404, "text/plain", "Subject map not found.")
      return html(res, `${row.subject} map`, subjectMapPage(student.id, student.display_name, row, row.job_id), csrf)
    } catch { return send(res, 404, "text/plain", "Student not found.") }
  }
  const studentMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})(\/scoreboard|\/parent|\/classes|\/school|\/controls|\/note)?$/i)
  if (studentMatch && method === "GET") {
    try {
      const student = (await assertStudent(options.db, auth!.userId, studentMatch[1]))
      if (studentMatch[2] === "/scoreboard") {
        const board = (await scoreboardFor(options.db, auth!.userId, student.id))
        return html(
          res,
          "Scoreboard",
          scoreboardPage(student.display_name, student.id, board, (await titleMap(options.db, student.id)), auth!.parentUnlocked && !auth!.studentOnly ? await learningMeasures(options.db, student.id) : [],
            auth!.parentUnlocked && !auth!.studentOnly ? await progressFor(options.db, student.id) : undefined),
          csrf,
        )
      }
      if (!studentMatch[2]) {
        if (auth!.selectedStudent !== student.id) await options.db.prepare("UPDATE auth_sessions SET selected_student = ?, parent_unlocked_until = ? WHERE id = ?").run(student.id, new Date(Date.now() + 15 * 60000).toISOString(), auth!.id)
        // Opening a child from the unlocked roster does not lock the parent until the parent chooses student mode.

        const notice = url.searchParams.get("error") || url.searchParams.get("notice")
        return html(res, student.display_name, `${notice ? `<p class="banner" role="status">${esc(notice)}</p>` : ""}${(await studentHome(options.db, auth!.userId, student.id, auth!.parentUnlocked, auth!.studentOnly))}`, csrf)
      }
      // Old section links now open the page that holds the section.
      const section = url.searchParams.get("section") ?? ""
      if (studentMatch[2] === "/parent" && section) {
        const subject = url.searchParams.get("subject"), notice = url.searchParams.get("notice")
        const query = new URLSearchParams({ ...(subject ? { subject } : {}), ...(notice ? { notice } : {}) }).toString()
        const target = ["student-access", "student-settings", "controls", "child-requests"].includes(section) ? `controls${query ? `?${query}` : ""}#${section}`
          : section === "school-results" ? `school${query ? `?${query}` : ""}#school-results`
          : section === "note" ? `note${query ? `?${query}` : ""}#note` : ""
        if (target) return redirect(res, `/students/${student.id}/${target}`)
      }
      const views: Record<string, ParentView> = { "/classes": "classes", "/school": "school", "/controls": "controls", "/note": "note" }
      const view: ParentView = views[studentMatch[2] ?? ""] ?? "overview"
      // Only the classes page carries the full learning plan; the overview stays light.
      const live = view === "classes" ? (await studentProgress(options.db, auth!.userId, student.id)).stamp : ""
      return html(
        res,
        student.display_name,
        (await parentTools(options.db, auth!.userId, student.id, view !== "classes" ? "" : studentPage({
          student,
          today: new Date(),
          states: (await listStates(options.db, student.id)),
          concepts: (await studentConcepts(options.db, auth!.userId, student.id)),
          menu: (await topicMenu(options.db, auth!.userId, student.id)),
          added: (await listAdded(options.db, auth!.userId, student.id)),
          error: url.searchParams.get("error") ?? "",
          notice: url.searchParams.get("notice") ?? "",
          plans: (await listSubjectPlans(options.db, auth!.userId, student.id)).map((plan) => ({
            subject: plan.subject,
            about: plan.about,
            syllabus_name: plan.syllabus_name,
            build_status: plan.build_status,
            build_note: plan.build_note,
            agenda: plan.agenda,
          })),
          live: /building|pending:/.test(live) ? live : "",
          nextAction: (await nextLearningAction(options.db, auth!.userId, student.id)),
        }) + mapsSection(student.id, [...new Set([...(await topicMenu(options.db, auth!.userId, student.id)).subjects, ...(await listSubjectPlans(options.db, auth!.userId, student.id)).map(plan => plan.subject)])], await subjectMaps(options.db, student.id)), url.searchParams.get("subject")?.trim().slice(0, 100) || "Math", { view, notice: view === "overview" || view === "note" ? url.searchParams.get("notice") ?? "" : "" })),
        csrf,
      )
    } catch {
      return send(res, 404, "text/plain", "Student not found.")
    }
  }

  const sessionMatch = url.pathname.match(/^\/session\/([0-9a-f-]{36})$/i)
  if (sessionMatch && method === "GET") {
    try {
      await avoidRepeatedQuestions(options.db, auth!.userId, sessionMatch[1])
      const session = (await enforceSessionTime(options.db, auth!.userId, sessionMatch[1]))
      const items = (await sessionItems(options.db, sessionMatch[1]))
      const current = items.find((item) => item.answered === 0) ?? null
      const feedback = session.pending_feedback ? JSON.parse(String(session.pending_feedback)) : null
      const onBreak = Boolean(session.break_until && String(session.break_until) > new Date().toISOString())
      const workMode = String(session.mode ?? "session")
      const withhold = workMode === "assessment" && Boolean(current)
      const titles = (await titleMap(options.db, String(session.student_id)))
      const ended = Boolean(session.ended_at) || !current
      const learner = (await assertStudent(options.db, auth!.userId, String(session.student_id)))
      // A practice arc opens with a short lesson on the idea before the guided item.
      const lessonConcept = !ended && Number(session.lesson_done ?? 1) === 0 && current && !items.some((item) => item.answered === 1)
        ? (await studentConcepts(options.db, auth!.userId, String(session.student_id))).find((concept) => concept.conceptId === String(current.concept_id))
        : undefined
      const results = current
        ? []
        : items
            .filter((item) => item.answered === 1 && item.correct != null)
            .map((item) => ({
              title: titles[String(item.concept_id)] ?? String(item.concept_id),
              prompt: String(item.prompt),
              answer: String(item.answer),
              correct: item.correct === 1,
            }))
      if (ended) await ensureLessonOpening(options.db, auth!.userId, sessionMatch[1], results)
      const mode = String(session.mode ?? "")
      const teacher =
        ended && (mode === "homework" || mode === "assessment")
          ? (await patternForSession(options.db, sessionMatch[1])) ??
            (await storePattern(options.db, String(session.student_id), String(session.subject ?? "Math"), sessionMatch[1]))
          : null
      // The first time a question is on screen, for the time-to-first-question measure.
      if (!lessonConcept && current && !onBreak && !feedbackState(workMode, items, Number(session.feedback_cursor ?? 0)).checkpoint) await options.db.prepare("UPDATE session_items SET shown_at = ? WHERE id = ? AND shown_at IS NULL").run(new Date().toISOString(), String(current.id))
      if (lessonConcept) return html(res, "Session", `<div ${learnerAttrs(learner)}>${nav(String(session.student_id))}${lessonCard(sessionMatch[1], lessonConcept)}</div>`, csrf)
      return html(
        res,
        "Session",
        `<div ${learnerAttrs(learner)}>${nav(String(session.student_id))}<div class="mission-toolbar"><p data-session-deadline="${new Date(Date.parse(String(session.started_at)) + Number(session.cap_minutes) * 60000).toISOString()}">Your ${session.cap_minutes}-minute mission</p><form action="/session/${sessionMatch[1]}/pause" method="post"><input type="hidden" name="csrf" class="csrf-field" value=""><button class="ghost" type="submit">Save & stop</button></form></div>${ended ? `<p class="celebration" role="status">A little more discovered. Your work is saved.</p>` : url.searchParams.get("saved") === "waiting" ? `<p class="ok" role="status" data-saved-waiting>Saved. A grown-up will check that one.</p>` : ""}` + sessionPage({
          summary: ended ? await missionSummary(options.db, auth!.userId, sessionMatch[1]) : undefined,
          sessionId: sessionMatch[1],
          continuity: String(session.continuity),
          item: session.ended_at ? null : current,
          position: current ? items.indexOf(current) + 1 : items.length,
          feedbackReview: feedbackState(workMode, items, Number(session.feedback_cursor ?? 0)),
          total: items.length,
          beats: items.map((item) => String(item.beat ?? '')),
          feedback: withhold || feedbackState(workMode, items, Number(session.feedback_cursor ?? 0)).timing === "waiting" ? null : feedback,
          onBreak,
          ended,
          capMinutes: Number(session.cap_minutes),
          subject: String(session.subject ?? ""),
          titles,
          showHint: !withhold,
          speak: url.searchParams.get("voice") === "1",
          lesson: ended || feedbackState(workMode, items, Number(session.feedback_cursor ?? 0)).checkpoint ? (await listLesson(options.db, auth!.userId, sessionMatch[1])) : [],
          teacher: auth!.parentUnlocked ? teacher : null,
          results,
          pendingReviews: auth!.parentUnlocked ? items.filter((item) => item.answered === 1 && item.correct == null) : [],
          band: ageBand(learner),
          aiMissing: Boolean(aiConnectionProblem(await aiSettings(options.db, auth!.userId))),
          aiChildLine: aiChildLine(await aiSettings(options.db, auth!.userId)) || undefined,
          itemSubject: current ? conceptSubject(current.concept_id, new Map(((await options.db.prepare('SELECT concept_id, subject FROM custom_concepts WHERE student_id = ?').all(String(session.student_id))) as Array<{ concept_id: string; subject: string }>).map(row => [String(row.concept_id), String(row.subject)])), session.subject) : undefined,
          askSure: armFor(learner.experiments, "confidence-check") === "on",
          feedbackConceptId: feedback?.itemId ? String(items.find((item) => item.id === feedback.itemId)?.concept_id ?? "") || undefined : undefined,
        }) + "</div>",
        csrf,
      )
    } catch {
      return send(res, 404, "text/plain", "Session not found.")
    }
  }

  const sheetMatch = url.pathname.match(/^\/sheet\/([0-9a-f-]{36})$/i)
  if (sheetMatch && method === "GET") {
    try {
      const row = (await getSheet(options.db, auth!.userId, sheetMatch[1]))
      const payload = JSON.parse(String(row.spec_json))
      const qrSvg = await qrSvgFor(String(row.id))
      const htmlDoc = sheetPage({
        sheetId: String(row.id),
        studentName: String(row.display_name),
        spec: payload.spec,
        items: payload.items,
        qrSvg,
        titles: (await titleMap(options.db, String(row.student_id))),
      }).replaceAll('name="csrf" class="csrf-field" value=""', `name="csrf" value="${esc(csrf)}"`)
      return send(res, 200, "text/html; charset=utf-8", htmlDoc)
    } catch {
      return send(res, 404, "text/plain", "Sheet not found.")
    }
  }

  const uploadMatch = url.pathname.match(/^\/uploads\/([0-9a-f-]{36})$/i)
  if (uploadMatch && method === "GET") {
    const row = (await getUpload(options.db, auth!.userId, uploadMatch[1]))
    if (!row) return send(res, 404, "text/plain", "Photo not found.")
    const bytes = await readPrivateFile(row.stored_path, options.uploadsDir)
    const type = row.stored_path.endsWith(".png") ? "image/png" : "image/jpeg"
    return send(res, 200, type, bytes)
  }

  return send(res, 404, "text/plain", "Not found.")
}

async function post(
  url: URL,
  fields: Record<string, string>,
  json: Record<string, string>,
  auth: Auth | null,
  cookies: Record<string, string>,
  res: ServerResponse,
  options: AppOptions,
  wantsJson = false,
  source = "unknown",
) {
  const data = { ...json, ...fields }
  try {
    if (url.pathname === "/register") {
      const result = (await registerUser(options.db, data.email ?? "", data.password ?? ""))
      if (!result.ok) return redirect(res, `/?error=${encodeURIComponent(result.error)}`)
      if (process.env.TUTOR_PUBLIC === "1") await issueAccountToken(options.db, result.userId, "verify")
      options.onAuthenticated?.(result.userId)
      return (await loginRedirect(res, options.db, result.userId))
    }
    if (url.pathname === "/login") {
      const result = (await loginUser(options.db, data.email ?? "", data.password ?? "", new Date(), 5, source))
      if (!result.ok) return redirect(res, `/?error=${encodeURIComponent(result.error)}`)
      if (process.env.TUTOR_PUBLIC === '1' && !(await options.db.prepare('SELECT id FROM users WHERE id = ? AND email_verified_at IS NOT NULL').get(result.userId))) await issueAccountToken(options.db, result.userId, 'verify')
      options.onAuthenticated?.(result.userId)
      return (await loginRedirect(res, options.db, result.userId))
    }
    if (!auth) return redirect(res, "/")
    if (url.pathname !== "/logout" && process.env.TUTOR_PUBLIC === "1" && !(await options.db.prepare("SELECT id FROM users WHERE id = ? AND email_verified_at IS NOT NULL").get(auth.userId))) return send(res, 403, "text/plain", "Verify the family email first.")
    if (url.pathname === "/settings") {
      await saveAiSettings(options.db, auth.userId, {
        provider: data.provider ?? "grok",
        model: data.model ?? "",
        apiKey: data.apiKey ?? "",
        photoModel: data.photoModel ?? "",
      })
      return redirect(res, "/settings?notice=Saved. New curricula use this AI.")
    }
    if (url.pathname === "/logout") {
      if (cookies.tutor_session) await destroyAuthSession(options.db, cookies.tutor_session)
      res.writeHead(303, {
        Location: "/",
        "Set-Cookie": "tutor_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax",
        ...securityHeaders(),
      })
      return res.end()
    }
    if (url.pathname === "/students") {
      const id = (await createStudent(options.db, auth.userId, {
        displayName: data.displayName ?? "",
        birthDate: data.birthDate ?? "",
        grade: data.grade ? Number(data.grade) : undefined,
        gradeHold: data.gradeHold === "1",
        sessionCapMinutes: Number(data.sessionCapMinutes || 25),
      }))
      // A new family's first child leads straight into connecting an AI; it can be skipped.
      const first = (await listStudents(options.db, auth.userId)).length === 1
      if (first && !(await aiSettings(options.db, auth.userId)).hasKey) return redirect(res, `/welcome/ai?next=${encodeURIComponent(`/students/${id}`)}`)
      return redirect(res, `/students/${id}`)
    }
    const targetMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/targets$/i)
    if (targetMatch) {
      const conceptIds = data.conceptIds ? data.conceptIds.split("\n").filter(Boolean) : []
      await createTarget(options.db, auth.userId, targetMatch[1], {
        title: data.title ?? "",
        deadline: data.deadline ?? "",
        conceptIds,
        kind: !auth.parentUnlocked || auth.studentOnly || data.curiosity === "1" ? "curiosity" : "target",
      })
      return redirect(res, `/students/${targetMatch[1]}`)
    }
    const profileMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/profile$/i)
    if (profileMatch) {
      await updateStudentProfile(options.db, auth.userId, profileMatch[1], {
        birthDate: data.birthDate ?? "",
        gradeHold: data.gradeHold === "1",
        grade: Number(data.grade),
      })
      return redirect(res, `/students/${profileMatch[1]}/classes`)
    }
    const topicMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/topics$/i)
    if (topicMatch) {
      await addLearning(options.db, auth.userId, topicMatch[1], {
        purpose: data.purpose === "special" ? "special" : "year",
        subject: data.subject,
        title: data.title,
        recall: data.recall,
        example: data.example,
        nonExample: data.nonExample,
        prompt: data.prompt,
        answer: data.answer,
        problems: data.problems,
        deadline: data.deadline,
      })
      return redirect(res, `/students/${topicMatch[1]}/classes`)
    }
    const practiceMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/practice$/i)
    if (practiceMatch) {
      await addLearning(options.db, auth.userId, practiceMatch[1], {
        purpose: "practice",
        conceptId: data.conceptId,
        prompt: data.prompt,
        answer: data.answer,
        problems: data.problems,
      })
      return redirect(res, `/students/${practiceMatch[1]}/classes`)
    }
    const removeTopicMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/remove-topic$/i)
    if (removeTopicMatch) {
      await removeTopic(options.db, auth.userId, removeTopicMatch[1], data.conceptId ?? "")
      return redirect(res, `/students/${removeTopicMatch[1]}/classes`)
    }
    const removeProblemMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/remove-problem$/i)
    if (removeProblemMatch) {
      await removeProblem(options.db, auth.userId, removeProblemMatch[1], data.problemId ?? "")
      return redirect(res, `/students/${removeProblemMatch[1]}/classes`)
    }
    const directionMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/direction$/i)
    if (directionMatch) {
      const subject = (data.newPlanSubject || data.subject || "").trim()
      const uploaded = readSyllabusUpload({
        text: data.syllabusText,
        base64: data.syllabusBase64,
        mime: data.syllabusMime,
        name: data.syllabusName,
      })
      const kind = data.kind === "parent_note" ? "parent_note" : "school_test"
      await addDirection(options.db, auth.userId, directionMatch[1], {
        subject,
        kind,
        name: uploaded.name || (kind === "school_test" ? "School test" : "Parent note"),
        body: uploaded.text,
      })
      const jobId = (await startCurriculumJob(options.db, auth.userId, directionMatch[1], subject, uploaded.text))
      return wantsJson ? send(res, 202, "application/json", JSON.stringify({ jobId, location: `/jobs/${jobId}` })) : redirect(res, `/jobs/${jobId}`)
    }
    const talkMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/talk$/i)
    if (talkMatch) {
      const thread = (data.subject || "new").trim() || "new"
      const title = (data.title ?? "").trim().slice(0, 80)
      const detail = (data.message ?? "").trim()
      const message = thread.toLowerCase() === "new" && title ? `Add ${title}. ${detail}`.trim() : detail
      if (!message) throw new UserError("Say what you want this class to cover.")
      const alreadyThinking = (await listTalk(options.db, auth.userId, talkMatch[1], thread)).some((line) => line.proposal.includes('"pending":true'))
      if (alreadyThinking) return redirect(res, `/students/${talkMatch[1]}/classes?talk=${encodeURIComponent(thread)}`)
      if (parentAgrees(message) && (await latestProposal(options.db, talkMatch[1], thread))) {
        await addTalk(options.db, auth.userId, talkMatch[1], { subject: thread, role: "parent", body: message })
        const plan = (await latestProposal(options.db, talkMatch[1], thread))
        const stored = plan && thread.toLowerCase() !== plan.subject.toLowerCase() ? plan.subject : thread
        if (stored !== thread) await moveTalk(options.db, talkMatch[1], thread, stored)
        const accepted = (await acceptPlan(options.db, auth.userId, talkMatch[1], stored))
        const jobId = (await startCurriculumJob(options.db, auth.userId, talkMatch[1], accepted.subject))
        return wantsJson ? send(res, 202, "application/json", JSON.stringify({ jobId, location: `/jobs/${jobId}` })) : redirect(res, `/jobs/${jobId}`)
      }
      await addTalk(options.db, auth.userId, talkMatch[1], { subject: thread, role: "parent", body: message })
      await addTalk(options.db, auth.userId, talkMatch[1], { subject: thread, role: "tutor", body: "Thinking about this class.", pending: true })
      const prior = (await listTalk(options.db, auth.userId, talkMatch[1], thread)).slice(0, -2).slice(-8)
      const jobId = (await queueTalk(options, auth.userId, talkMatch[1], thread, message, prior))
      return wantsJson ? send(res, 202, "application/json", JSON.stringify({ jobId, location: `/jobs/${jobId}` })) : redirect(res, `/jobs/${jobId}`)
    }
    const experimentMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/experiments$/i)
    if (experimentMatch) {
      await assertStudent(options.db, auth.userId, experimentMatch[1])
      await setExperiment(options.db, experimentMatch[1], String(data.key ?? ""), data.on === "1")
      return redirect(res, `/students/${experimentMatch[1]}/scoreboard#experiments-title`)
    }
    const decideMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/grading\/([0-9a-f-]{36})\/decide$/i)
    if (decideMatch) {
      await assertStudent(options.db, auth.userId, decideMatch[1])
      const unsure = (await escalatedItems(options.db, decideMatch[1])).find(row => row.id === decideMatch[2])
      const item = unsure ?? (await waitingItems(options.db, decideMatch[1])).find(row => row.id === decideMatch[2])
      if (!item) throw new UserError("That answer is no longer waiting for you.")
      const why = unsure ? "after the tutor was unsure" : "while no AI was checking written answers"
      await reviewAnswer(options.db, auth.userId, item.session_id, { itemId: item.id, correct: data.correct === "1", grader: "parent", reason: data.correct === "1" ? `A parent decided this answer meets the question ${why}.` : `A parent decided this answer does not meet the question yet ${why}.` })
      return redirect(res, `/students/${decideMatch[1]}/grading`)
    }
    const concernMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/grading\/([0-9a-f-]{36})\/concern$/i)
    if (concernMatch) {
      await assertStudent(options.db, auth.userId, concernMatch[1])
      await resolveConcern(options.db, concernMatch[1], concernMatch[2], data.wrong === "1")
      return redirect(res, `/students/${concernMatch[1]}/grading`)
    }
    const childConcern = url.pathname.match(/^\/session\/([0-9a-f-]{36})\/concern$/i)
    if (childConcern) {
      const session = await getOwnedSession(options.db, auth.userId, childConcern[1])
      await raiseConcern(options.db, String(session.student_id), childConcern[1], String(data.itemId ?? ""))
      return redirect(res, `/session/${childConcern[1]}#feedback`)
    }
    const auditMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/grading\/([0-9a-f-]{36})$/i)
    if (auditMatch) {
      await assertStudent(options.db, auth.userId, auditMatch[1])
      await recordAudit(options.db, auditMatch[1], auditMatch[2], data.agree === "1")
      return redirect(res, `/students/${auditMatch[1]}/grading`)
    }
    const researchMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/maps$/i)
    if (researchMatch) {
      const subject = (data.subject ?? "").trim().slice(0, 80)
      if (!subject || isBuiltIn(subject)) throw new UserError("Name a subject other than math to research.")
      await assertStudent(options.db, auth.userId, researchMatch[1])
      const jobId = await startResearchJob(options.db, auth.userId, researchMatch[1], subject)
      return wantsJson ? send(res, 202, "application/json", JSON.stringify({ jobId, location: `/jobs/${jobId}` })) : redirect(res, `/jobs/${jobId}`)
    }
    const mapDecision = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/maps\/([0-9a-f-]{36})\/(approve|changes|reject)$/i)
    if (mapDecision) {
      const [, studentId, mapId, decision] = mapDecision
      await assertStudent(options.db, auth.userId, studentId)
      if (decision === "approve") {
        const approved = await approveMap(options.db, auth.userId, studentId, mapId)
        const jobId = await startCurriculumJob(options.db, auth.userId, studentId, approved.subject)
        return redirect(res, `/jobs/${jobId}`)
      }
      if (decision === "changes") {
        const note = (data.note ?? "").trim()
        if (!note) throw new UserError("Say what to change.")
        const row = await mapRow(options.db, studentId, mapId)
        if (!row || row.status !== "draft") throw new UserError("Only a draft map can be changed.")
        return redirect(res, `/jobs/${await startResearchJob(options.db, auth.userId, studentId, row.subject, note)}`)
      }
      await decideMap(options.db, studentId, mapId, "rejected")
      return redirect(res, `/students/${studentId}/classes?notice=${encodeURIComponent("The map was set aside. Nothing will be taught from it.")}`)
    }
    const buildMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/build$/i)
    if (buildMatch) {
      const thread = (data.subject || "").trim()
      const accepted = (await acceptPlan(options.db, auth.userId, buildMatch[1], thread))
      const jobId = (await startCurriculumJob(options.db, auth.userId, buildMatch[1], accepted.subject))
      return wantsJson ? send(res, 202, "application/json", JSON.stringify({ jobId, location: `/jobs/${jobId}` })) : redirect(res, `/jobs/${jobId}`)
    }
    const askMatch = url.pathname.match(/^\/session\/([0-9a-f-]{36})\/ask$/i)
    if (askMatch) {
      const message = (data.message ?? "").trim()
      if (!message) throw new UserError("Ask about one of the questions.")
      const check = await getOwnedSession(options.db, auth.userId, askMatch[1])
      const sendId = sendKey(data.sendId), jobKey = sendId ? `lesson:${askMatch[1]}:${sendId}` : `lesson:${crypto.randomUUID()}`
      const sent = sendId ? await jobForKey(options.db, auth.userId, jobKey) : undefined
      if (sent) return wantsJson ? send(res, 202, "application/json", JSON.stringify({ jobId: sent, location: `/jobs/${sent}` })) : redirect(res, `/jobs/${sent}`)
      const items = (await sessionItems(options.db, askMatch[1]))
      if (check.mode === "assessment" && items.some(i=>i.answered===0)) throw new UserError("Finish these questions on your own first, then ask for help.")
      const titles = (await titleMap(options.db, String((await getOwnedSession(options.db, auth.userId, askMatch[1])).student_id)))
      const lessonConcepts=new Map((await studentConcepts(options.db,auth.userId,String(check.student_id))).map(c=>[c.conceptId,c]))
      const results = items
        .filter((item) => item.answered === 1 && item.correct != null)
        .map((item) => ({
          title: titles[String(item.concept_id)] ?? String(item.concept_id),
          prompt: String(item.prompt),
          answer: String(item.answer),
          correct: item.correct === 1,
          recall:lessonConcepts.get(String(item.concept_id))?.recall,example:lessonConcepts.get(String(item.concept_id))?.example,
        }))
      await addLesson(options.db, auth.userId, askMatch[1], "student", message)
      const prior = (await listLesson(options.db, auth.userId, askMatch[1])).slice(0, -1).slice(-8)
      const session = (await getOwnedSession(options.db, auth.userId, askMatch[1]))
      const checkedConcepts = [...new Set(items.filter(i=>i.answered === 1).map(i=>String(i.concept_id)))].map(id=>({conceptId:id,title:titles[id] ?? id}))
      const signal = safetyReply(message) ? null : questionSignal(message, checkedConcepts)
      const jobId = (await createJob(options.db, auth.userId, String(session.student_id), "lesson", { sessionId: askMatch[1], results, prior, message, signal, voice:data.voice === "1" }, jobKey))
      return wantsJson ? send(res, 202, "application/json", JSON.stringify({ jobId, location: `/jobs/${jobId}` })) : redirect(res, `/jobs/${jobId}`)
    }
    const planMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/plan$/i)
    if (planMatch) {
      const subject = (data.newPlanSubject || data.subject || "").trim()
      const uploaded = readSyllabusUpload({
        text: data.syllabusText,
        base64: data.syllabusBase64,
        mime: data.syllabusMime,
        name: data.syllabusName,
      })
      await saveSubjectPlan(options.db, auth.userId, planMatch[1], {
        subject,
        about: data.about ?? "",
        syllabusText: uploaded.text,
        syllabusName: uploaded.name,
      })
      if (data.build === "1") {
        const jobId = (await startCurriculumJob(options.db, auth.userId, planMatch[1], subject))
        return wantsJson ? send(res, 202, "application/json", JSON.stringify({ jobId, location: `/jobs/${jobId}` })) : redirect(res, `/jobs/${jobId}`)
      }
      return redirect(res, `/students/${planMatch[1]}/classes?notice=${encodeURIComponent(`${subject} plan saved.`)}`)
    }
    const placementMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/placement$/i)
    if (placementMatch) {
      const chosen = data.subjects ? data.subjects.split("\n").filter(Boolean) : []
      if (data.newSubject) chosen.push(data.newSubject)
      await setPlacement(options.db, auth.userId, placementMatch[1], {
        mathCourse: data.mathCourse ?? "grade",
        subjects: chosen,
      })
      return redirect(res, `/students/${placementMatch[1]}/classes`)
    }
    const startMatch = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/session$/i)
    if (startMatch) {
      const mode = data.mode === "assessment" || data.mode === "homework" ? data.mode : "session"
      const subject = data.subject || "Math"
      if (data.materialId && (await ownedMaterial(options.db, auth.userId, data.materialId)).student_id !== startMatch[1]) throw new UserError("Material belongs to another learner.")
      if (data.questionId && (await ownedQuestion(options.db, auth.userId, data.questionId)).m.student_id !== startMatch[1]) throw new UserError("Question belongs to another learner.")
      let id:string
      try { id = (await startTutorSession(options.db, auth.userId, startMatch[1], new Date(), {
        mode, subject, durationMinutes: data.durationMinutes ? Number(data.durationMinutes) : undefined, goal: data.goal, materialId: data.materialId, questionId: data.questionId, focusConceptId: data.focusConceptId, targetId: data.targetId, intent: data.intent === "practice" && mode === "assessment" ? "skip_lesson_check" : data.intent,
      }))
      } catch(error) {
        if(!(error instanceof FreshPracticeRequired)) throw error
        // New questions are written by the AI; without one, say so plainly instead of starting a job that cannot finish.
        if (aiConnectionProblem(await aiSettings(options.db, auth.userId))) throw new UserError("This topic needs new questions, and writing them needs an AI connection. Pick another topic, or ask a grown-up to connect an AI.")
        const input=await practiceRefreshContext(options.db,auth.userId,startMatch[1],error.conceptId)
        const requested={mode,subject,durationMinutes:data.durationMinutes ? Number(data.durationMinutes) : undefined,focusConceptId:error.conceptId,targetId:data.targetId,goal:data.goal,intent:data.intent}
        const revision=createHash('sha256').update(JSON.stringify({input,requested})).digest('hex')
        const job=await createJob(options.db,auth.userId,startMatch[1],'fresh_practice',{input,options:requested},`fresh:${startMatch[1]}:${revision}`)
        return wantsJson ? send(res,202,'application/json',JSON.stringify({jobId:job,location:`/jobs/${job}`})) : redirect(res,`/jobs/${job}`)
      }
      return redirect(res, `/session/${id}`)
    }
    const sheetNew = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/sheet$/i)
    if (sheetNew) {
      const id = (await createSheet(options.db, auth.userId, sheetNew[1]))
      return redirect(res, `/sheet/${id}`)
    }
    const answerMatch = url.pathname.match(/^\/session\/([0-9a-f-]{36})\/answer$/i)
    if (answerMatch) {
      const submitted = (await submitAnswer(options.db, auth.userId, answerMatch[1], {
        itemId: data.itemId ?? "",
        answer: data.answer ?? "",
        timeMs: Number(data.timeMs || 0),
        frustrated: data.frustrated === "1",
        errorType: ERRORS.has(data.errorType) ? (data.errorType as ErrorType) : undefined,
        confidence: data.confidence,
      }))
      if ("pendingReview" in submitted && submitted.pendingReview) {
        // With no AI connected, a written answer is kept for a grown-up to check and the child carries on;
        // a grading job here could only fail.
        if (aiConnectionProblem(await aiSettings(options.db, auth.userId))) return redirect(res, `/session/${answerMatch[1]}?saved=waiting`)
        const session = (await getOwnedSession(options.db, auth.userId, answerMatch[1]))
        const jobId = (await createJob(options.db, auth.userId, String(session.student_id), "grade", { sessionId: answerMatch[1], itemIds: [data.itemId] }, `grade:${data.itemId}`))
        return wantsJson ? send(res, 202, "application/json", JSON.stringify({ jobId, location: `/jobs/${jobId}` })) : redirect(res, `/jobs/${jobId}`)
      }
      return redirect(res, `/session/${answerMatch[1]}`)
    }
    const reviewMatch = url.pathname.match(/^\/session\/([0-9a-f-]{36})\/review$/i)
    if (reviewMatch) {
      if (data.verdict !== "success" && data.verdict !== "retry") throw new UserError("Choose whether the response meets the rubric.")
      await reviewAnswer(options.db, auth.userId, reviewMatch[1], {
        itemId: data.itemId ?? "", correct: data.verdict === "success",
        errorType: ERRORS.has(data.errorType) ? data.errorType as ErrorType : undefined,
      })
      return redirect(res, `/session/${reviewMatch[1]}`)
    }
    const hintMatch = url.pathname.match(/^\/session\/([0-9a-f-]{36})\/hint$/i)
    if (hintMatch) {
      await useHint(options.db, auth.userId, hintMatch[1], data.itemId ?? "")
      return redirect(res, `/session/${hintMatch[1]}`)
    }
    const feedbackMatch = url.pathname.match(/^\/session\/([0-9a-f-]{36})\/feedback$/i)
    if (feedbackMatch) {
      await acknowledgeFeedback(options.db, auth.userId, feedbackMatch[1])
      return redirect(res, `/session/${feedbackMatch[1]}`)
    }
    const continueMatch = url.pathname.match(/^\/session\/([0-9a-f-]{36})\/continue$/i)
    if (continueMatch) {
      await clearBreak(options.db, auth.userId, continueMatch[1])
      return redirect(res, `/session/${continueMatch[1]}`)
    }
    const recapMatch = url.pathname.match(/^\/session\/([0-9a-f-]{36})\/recap$/i)
    if (recapMatch) {
      const saved = (await saveRecap(options.db, auth.userId, recapMatch[1], {
        learned: data.learned ?? "",
        hard: data.hard ?? "",
        tellFriend: data.tellFriend ?? "",
        productionSuccess: data.productionSuccess === "1",
      }))
      return redirect(res, `/sheet/${saved.sheetId}`)
    }
    const scoreMatch = url.pathname.match(/^\/sheet\/([0-9a-f-]{36})\/score$/i)
    if (scoreMatch) {
      const boxes = Object.entries(data)
        .filter(([key]) => key.startsWith("box-"))
        .map(([key, value]) => ({ boxIndex: Number(key.slice(4)), answer: value }))
      const results = (await scoreSheet(options.db, auth.userId, scoreMatch[1], boxes))
      const gradingSession = results.find((result) => result.reviewSessionId)?.reviewSessionId
      if (gradingSession) {
        const session = (await getOwnedSession(options.db, auth.userId, gradingSession))
        const jobId = (await createJob(options.db, auth.userId, String(session.student_id), "grade", { sessionId: gradingSession }, `grade-sheet:${gradingSession}`))
        return wantsJson ? send(res, 202, "application/json", JSON.stringify({ jobId, location: `/jobs/${jobId}` })) : redirect(res, `/jobs/${jobId}`)
      }
      return html(res, "Sheet score", scoreResultPage(results), auth.csrf)
    }
    const uploadMatch = url.pathname.match(/^\/sheet\/([0-9a-f-]{36})\/upload$/i)
    if (uploadMatch) {
      const sheet = (await getSheet(options.db, auth.userId, uploadMatch[1]))
      const id = (await saveUpload(
        options.db,
        auth.userId,
        String(sheet.student_id),
        { mime: data.mime ?? "", base64: data.base64 ?? "" },
        options.uploadsDir,
      ))
      return redirect(res, `/uploads/${id}`)
    }
    return send(res, 404, "text/plain", "Not found.")
  } catch (error) {
    const message = userMessage(error)
    const ask = url.pathname.match(/^\/session\/([0-9a-f-]{36})\/ask$/i)
    if (ask) return redirect(res, `/session/${ask[1]}?error=${encodeURIComponent(message)}`)
    const talk = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/(?:talk|build)$/i)
    if (talk) {
      const subject = encodeURIComponent((data.subject || "new").trim() || "new")
      return redirect(res, `/students/${talk[1]}/classes?talk=${subject}&error=${encodeURIComponent(message)}`)
    }
    const parentMutation = url.pathname.match(/^\/students\/([0-9a-f-]{36})\/(profile|placement|plan|topics|practice|remove-topic|remove-problem)$/i)
    const schoolMutation = url.pathname.match(/^\/materials\/([0-9a-f-]{36})\/(learning|correct)$/i)
    const back = schoolMutation ? `/materials/${schoolMutation[1]}` : parentMutation ? `/students/${parentMutation[1]}/classes` : url.pathname.startsWith("/students/")
      ? url.pathname.replace(/\/(targets|session|sheet|topics|practice|profile|placement|plan|direction|remove-topic|remove-problem)$/, "")
      : "/students"
    return redirect(res, `${back}?error=${encodeURIComponent(message)}`)
  }
}

/** The evidence ladder and before/after gain for one child, from their recorded attempts. */
async function progressFor(db: AppOptions["db"], studentId: string) {
  const attempts = await loadAttempts(db, studentId)
  const student = (await db.prepare("SELECT experiments FROM students WHERE id = ?").get(studentId)) as { experiments: string } | undefined
  const experiments = await Promise.all((Object.keys(EXPERIMENTS) as ExperimentKey[]).map(async key => ({ key, label: EXPERIMENTS[key].label, detail: EXPERIMENTS[key].detail, on: Boolean(enrolled(student?.experiments)[key]), report: await experimentReport(db, studentId, key) })))
  return { ladders: ladders(attempts), gain: gainOnFairChecks(attempts), audit: await auditSummary(db, studentId), experiments }
}

/** The topic's own material for a grounding pass: its idea and examples, and the approved subject map's success levels and misconceptions. */
async function groundingFor(db: AppOptions["db"], ownerId: string, studentId: string, conceptId: string): Promise<Grounding> {
  const concept = (await studentConcepts(db, ownerId, studentId)).find((c) => c.conceptId === conceptId)
  if (!concept) return {}
  const grounding: Grounding = { idea: concept.recall, example: concept.example, nonExample: concept.nonExample }
  const key = (await db.prepare("SELECT map_key FROM custom_concepts WHERE concept_id = ? AND student_id = ?").get(conceptId, studentId)) as { map_key: string } | undefined
  const map = key?.map_key ? await approvedMap(db, studentId, concept.subject) : null
  const mapped = map ? concepts(map).find((c) => c.key === key!.map_key) : undefined
  if (mapped) { grounding.success = mapped.success; grounding.misconceptions = mapped.misconceptions.map((m) => ({ belief: m.belief, fix: m.fix })) }
  return grounding
}

export async function gradePendingResponses(
  db: AppOptions["db"], ownerId: string, sessionId: string,
  judge: typeof judgeAnswer = judgeAnswer, itemIds?: string[], ctx?: JobContext,
) {
  const session = (await getOwnedSession(db, ownerId, sessionId))
  const studentId = String(session.student_id)
  const ai = (await aiConfigFor(db, ownerId))
  const titles = (await titleMap(db, studentId))
  const pending = (await sessionItems(db, sessionId)).filter((item) => item.answered === 1 && item.correct == null && !item.grading_doubt && !Number(item.disputed)
    && (!itemIds || itemIds.includes(String(item.id))))
  const judged = await Promise.all(pending.map(async (item) => ({
    item,
    judgment: !String(item.given_answer ?? "").trim() || /^(?:\?|unreadable|unclear|illegible)$/i.test(String(item.given_answer).trim()) ? { kind: "failed" as const } : await judge({
      concept: titles[String(item.concept_id)] ?? String(item.concept_id),
      bloomLevel: Number(item.bloom_level) as BloomLevel,
      prompt: String(item.prompt), key: String(item.answer), response: String(item.given_answer ?? ""), rubric: readRubric(item.rubric_json),
    }, ai, { grounding: await groundingFor(db, ownerId, studentId, String(item.concept_id)), record: report => recordRun(db, ownerId, studentId, report) }).catch(() => ({ kind: "failed" as const })),
  })))
  for (const { item, judgment } of judged) {
    const saveVerdict = async () => {
      const current = (await sessionItems(db, sessionId)).find((row) => row.id === item.id)
      if (!current || current.correct != null) return
      if (judgment.kind === "failed") {
        await recordDecision(db, studentId, "grading_pending", "The selected AI did not return a usable grade. The response remains pending and has not been counted as a success or failure.", {
          sessionId, itemId: item.id, conceptId: item.concept_id, graderProvider: ai.provider, graderModel: ai.model,
        })
        return
      }
      if (judgment.kind === "question_problem") {
        // The question, not the child's answer, is the problem: retire it quietly, count it neither way, keep it for quality checks.
        await db.prepare("UPDATE session_items SET disputed = 1, grader = 'retired', grading_reason = ? WHERE id = ?").run("The question could not be graded fairly as written.", item.id)
        await recordDecision(db, studentId, "question_retired", "Grading found a problem with the question itself, so the answer counts neither way and the question is retired without asking a parent.", {
          sessionId, itemId: item.id, conceptId: item.concept_id, graderProvider: ai.provider, graderModel: ai.model,
        })
        return
      }
      if (judgment.kind === "escalated") {
        // Still unsure after grounding: a parent decides, and is told why the tutor is not confident.
        await db.prepare("UPDATE session_items SET grading_doubt = ? WHERE id = ?").run(await sealForStudent(db, studentId, judgment.doubt.slice(0, 1200)), item.id)
        await recordDecision(db, studentId, "grading_escalated", "After a grounding pass the tutor was still not fully confident, so a parent will decide. The answer counts neither way until then.", {
          sessionId, itemId: item.id, conceptId: item.concept_id, graderProvider: ai.provider, graderModel: ai.model,
        })
        return
      }
      await reviewAnswer(db, ownerId, sessionId, {
        itemId: String(item.id), correct: judgment.verdict.correct, errorType: judgment.verdict.errorType ?? undefined,
        grader: `model:${ai.provider}`, graderModel: ai.model, reason: judgment.verdict.reason,
      })
      if (judgment.path === "grounded") await recordDecision(db, studentId, "grading_grounded", "The first grade was uncertain or disputed; a grounding pass settled it from the topic's own material.", { sessionId, itemId: item.id, conceptId: item.concept_id })
    }
    if (ctx) { if (!(await ctx.commit(saveVerdict))) return }
    else await saveVerdict()
  }
}

export function jobHandlers(options: AppOptions): Record<string, JobHandler> {
  const db = options.db
  return {
    pdf: async (ctx, payload) => (await renderSheetPdf(db, options.uploadsDir, ctx, payload)),
    planner: async (ctx, payload) => (await processPlanner({ db }, ctx, payload)),
    pack: async (ctx, payload) => (await runPack({ db }, ctx, payload)),
    weekly_digest: weeklyDigestJob(db),
    school_path: async (ctx, payload: SchoolSource) => {
      let material = await currentSchoolSource(db, ctx.job.owner_user_id, payload)
      if (!material) return { materialId: payload.materialId, superseded: true }
      if (material.status !== 'interpreted') await extractMaterial(db, ctx, payload, options.uploadsDir)
      let curriculumJob: string | undefined
      await ctx.commit(async () => {
        material = await currentSchoolSource(db, ctx.job.owner_user_id, payload)
        if (!material) return
        const text = await schoolLearningText(db, ctx.job.owner_user_id, payload)
        if (!text) return
        const plans = await listSubjectPlans(db, ctx.job.owner_user_id, String(material.student_id))
        if (!plans.some(p => p.subject.toLowerCase() === String(material!.subject).toLowerCase())) await saveSubjectPlan(db, ctx.job.owner_user_id, String(material.student_id), { subject: String(material.subject), about: 'Learning from parent-selected school pages.', syllabusText: '', syllabusName: '' })
        curriculumJob = await startCurriculumJob(db, ctx.job.owner_user_id, String(material.student_id), String(material.subject), text, payload)
      })
      return { materialId: payload.materialId, ...(curriculumJob ? { nextJobId: curriculumJob } : { superseded: true }) }
    },
    extract: async (ctx, payload) => {
      const result = await extractMaterial(db, ctx, payload, options.uploadsDir)
      await ctx.commit(async () => {
        const material = (await ownedMaterial(db, ctx.job.owner_user_id, payload.materialId))
        if (material.revision !== payload.revision || material.status !== "interpreted" || material.scope_approved !== 1 || material.learning_purpose || !["syllabus", "agenda", "textbook"].includes(String(material.kind))) return
        const questions = (await db.prepare("SELECT prompt, figure FROM material_questions WHERE material_id = ? AND revision = ? AND readable = 1").all(payload.materialId, payload.revision))
        const text = questions.map(q => `${q.prompt} ${q.figure}`).join("\n")
        if (!text) return
        await addDirection(db, ctx.job.owner_user_id, String(material.student_id), { subject: String(material.subject), kind: "parent_note", name: String(material.title), body: text })
        await startCurriculumJob(db, ctx.job.owner_user_id, String(material.student_id), String(material.subject), text)
      })
      return result
    },
    homework_review: async (ctx, payload) => (await reviewMaterial(db, ctx, payload)),
    guide: async (ctx, payload) => (await guideQuestion(db, ctx, payload)),
    talk: async (ctx, payload) => (await processTalk(options, ctx, payload)),
    grade: async (ctx, payload) => {
      await ctx.stage("Checking your reasoning")
      await gradePendingResponses(db, ctx.job.owner_user_id, payload.sessionId, options.judgeResponse, payload.itemIds, ctx)
      const mine = (await sessionItems(db, payload.sessionId)).filter(i => i.answered === 1 && i.correct == null && (!payload.itemIds || payload.itemIds.includes(i.id)))
      // Escalated answers wait for a parent; the child carries on. Only answers the AI could not grade at all retry.
      if (mine.some(i => !i.grading_doubt && !Number(i.disputed))) throw new Error("Review needed")
      return { sessionId: payload.sessionId, ...(mine.some(i => i.grading_doubt) ? { escalated: mine.filter(i => i.grading_doubt).length } : {}) }
    },
    lesson: async (ctx, payload) => {
      await ctx.stage("Explaining the next step")
      const learner = await assertStudent(db, ctx.job.owner_user_id, ctx.job.student_id!)
      const reply = await answerLesson({ results: payload.results, transcript: payload.prior, question: payload.message, schoolLevel:gradeLabel(Number(learner.grade)) }, (await aiConfigFor(db, ctx.job.owner_user_id)), 25000, { record: report => recordRun(db, ctx.job.owner_user_id, ctx.job.student_id ?? null, report) })
      await ctx.commit(async () => {
        if (!(await db.prepare("SELECT id FROM lesson_messages WHERE id = ?").get(ctx.job.id))) {
          await db.prepare("INSERT INTO lesson_messages (id, session_id, role, body, created_at) VALUES (?, ?, 'tutor', ?, ?)").run(ctx.job.id, payload.sessionId, await sealFor(db, ctx.job.owner_user_id, reply), new Date().toISOString())
          if (payload.signal) await recordDecision(db, ctx.job.student_id!, "learner_question", "Use this learner-requested clarification when designing relevant upcoming practice. Preserve parent scope, strengths and scheduled reviews; this is not a failed check or mastery evidence.", { ...payload.signal, sessionId:payload.sessionId, jobId:ctx.job.id })
        }
      })
      return { sessionId: payload.sessionId, voice:payload.voice === true }
    },
    research_subject: async (ctx, payload) => runResearchJob(db, ctx, payload),
    fresh_practice: async(ctx,payload)=>{
      await ctx.stage('Preparing different questions for your next try')
      const questions=await freshPractice(payload.input,await aiConfigFor(db,ctx.job.owner_user_id),{record:report=>recordRun(db,ctx.job.owner_user_id,ctx.job.student_id??null,report)})
      let sessionId:string|undefined
      await ctx.commit(async()=>{
        const concept=payload.input.concept
        const previous=await db.prepare('SELECT i.prompt FROM session_items i JOIN tutor_sessions s ON s.id = i.session_id WHERE s.student_id = ? AND i.concept_id = ? UNION ALL SELECT prompt FROM practice_items WHERE student_id = ? AND concept_id = ?').all(ctx.job.student_id,concept.conceptId,ctx.job.student_id,concept.conceptId)
        const used=new Set(previous.map(i=>promptIdentity(String(i.prompt))))
        if(questions.some(q=>used.has(promptIdentity(q.prompt))))throw new Error('Question generation repeated earlier work. Retry for genuinely fresh questions.')
        const added=await applyCurriculum(db,ctx.job.owner_user_id,ctx.job.student_id!,concept.subject,[{title:concept.title,recall:concept.recall,example:concept.example,nonExample:concept.nonExample,questions}])
        if(added.questions!==4)throw new Error('Fresh questions were already used. Retry for a different set.')
        sessionId=await startTutorSession(db,ctx.job.owner_user_id,ctx.job.student_id!,new Date(),payload.options)
      })
      return{sessionId,freshQuestions:questions.length}
    },
    curriculum: async (ctx, payload) => {
      const isNewest = async () => (await db.prepare("SELECT id FROM jobs WHERE student_id = ? AND kind = 'curriculum' AND json_extract(payload, '$.subject') = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(ctx.job.student_id, payload.subject))?.id === ctx.job.id
      const failCurrentPlan = async (message: string) => ctx.commit(async () => {
        if (await isNewest()) await markPlanBuild(db, ctx.job.student_id!, payload.subject, 'failed', message)
      })
      if (payload.schoolSource && !await currentSchoolSource(db, ctx.job.owner_user_id, payload.schoolSource)) {
        await failCurrentPlan('School pages changed. Use the current pages to rebuild the learning plan.')
        return { materialId: payload.materialId, superseded: true }
      }
      await ctx.stage("Writing questions from your school sources")
      let curriculum: Awaited<ReturnType<typeof planCurriculum>>
      try { curriculum = await planCurriculum(payload.input, (await aiConfigFor(db, ctx.job.owner_user_id)), 150000, { record: report => recordRun(db, ctx.job.owner_user_id, ctx.job.student_id ?? null, report) }) }
      catch {
        await failCurrentPlan('The source is saved. Check the AI connection and retry the curriculum job.')
        throw new Error('Question generation failed')
      }
      if (!curriculum) {
        await failCurrentPlan("The source is saved. Retry the curriculum job.")
        throw new Error("Question generation failed")
      }
      if (payload.schoolSource) {
        const original = await db.prepare('SELECT prompt FROM material_questions WHERE material_id = ? AND revision = ? AND readable = 1').all(payload.materialId, payload.schoolSource.revision)
        const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')
        const prompts = new Set(original.map(q => normalize(String(q.prompt))))
        if (curriculum.topics.some(t => t.questions.some(q => prompts.has(normalize(q.prompt))))) {
          await failCurrentPlan('Practice repeated a source question. Retry to make fresh questions.')
          throw new Error('Practice must use fresh questions rather than copy the uploaded page.')
        }
      }
      await ctx.commit(async () => {
        if (!await isNewest()) return
        if (payload.schoolSource && !await currentSchoolSource(db, ctx.job.owner_user_id, payload.schoolSource)) {
          await markPlanBuild(db, ctx.job.student_id!, payload.subject, 'failed', 'School pages changed. Use the current pages to rebuild the learning plan.')
          return
        }
        await retireUnusedQuestions(db, ctx.job.student_id!, payload.subject)
        const saved = (await applyCurriculum(db, ctx.job.owner_user_id, ctx.job.student_id!, payload.subject, curriculum.topics))
        if (payload.schoolSource) await applySchoolLearning(db, ctx.job.owner_user_id, payload.schoolSource, saved.conceptIds)
        await recordDecision(db, ctx.job.student_id!, "learning_path_selected", curriculum.reason, { subject: payload.subject, jobId: ctx.job.id, sourceRevision: payload.revision, topics: curriculum.topics.map(topic => topic.title) })
        await markPlanBuild(db, ctx.job.student_id!, payload.subject, "ready", `${curriculum.reason} Added ${saved.created} topics and ${saved.questions} questions.`)
      })
      return { studentId: ctx.job.student_id, ...(payload.materialId ? { materialId: payload.materialId } : {}) }
    },
  }
}

async function topicCount(db: DatabaseSync, studentId: string, subject: string) {
  const row = (await db.prepare("SELECT count(*) AS n FROM custom_concepts WHERE student_id = ? AND lower(subject) = lower(?)").get(studentId, subject)) as {
    n: number
  }
  return row.n
}

export async function resumeBuilds(db: DatabaseSync) {
  for (const job of (await settleStuckPlans(db))) {
    if ((await db.prepare("SELECT id FROM jobs WHERE student_id = ? AND kind = 'curriculum' AND status IN ('queued', 'running') AND json_extract(payload, '$.subject') = ?").get(job.studentId, job.subject))) continue
    await startCurriculumJob(db, job.ownerId, job.studentId, job.subject)
  }
}

async function loginRedirect(res: ServerResponse, db: DatabaseSync, userId: string) {
  const session = (await openAuthSession(db, userId))
  const secure = process.env.TUTOR_SECURE === "1" ? "; Secure" : ""
  res.writeHead(303, {
    Location: "/students",
    "Set-Cookie": [
      `tutor_session=${session.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=1209600${secure}`,
      `tutor_csrf=; HttpOnly; Path=/; Max-Age=0`,
    ],
  })
  res.end()
}

function redirect(res: ServerResponse, location: string) {
  res.writeHead(303, { Location: location, ...securityHeaders() })
  res.end()
}

const pageExtras = new WeakMap<ServerResponse, string>()
function html(res: ServerResponse, title: string, body: string, csrf: string) {
  const fill = (text: string) => text.replaceAll('name="csrf" class="csrf-field" value=""', `name="csrf" value="${esc(csrf)}"`)
  send(res, 200, "text/html; charset=utf-8", page(title, fill(body), csrf, fill(pageExtras.get(res) ?? "")))
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...securityHeaders() })
  res.end(body)
}

function sendFile(res: ServerResponse, path: string, type: string) {
  try {
    const body = readFileSync(path)
    send(res, 200, type, body)
  } catch {
    send(res, 404, "text/plain", "Not found.")
  }
}

// Account connections finish with a redirect from a parent's form post to the provider's sign-in page.
function formTargets() {
  const issuer = process.env.TUTOR_CHATGPT_ISSUER ? ` ${new URL(process.env.TUTOR_CHATGPT_ISSUER).origin}` : ""
  return `'self' https://openrouter.ai https://auth.openai.com${issuer}`
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(self), microphone=(self)",
    "Content-Security-Policy":
      `default-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; media-src 'self' blob:; img-src 'self' data: blob:; connect-src 'self' https://vercel.com https://blob.vercel-storage.com https://*.blob.vercel-storage.com; script-src 'self'; form-action ${formTargets()}; frame-ancestors 'none'; base-uri 'self'`,
  }
}

function cookieHeader(name: string, value: string, maxAge: number) {
  const secure = process.env.TUTOR_SECURE === "1" ? "; Secure" : ""
  return `${name}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

function newCsrf() {
  return crypto.randomUUID().replaceAll("-", "")
}

function parseCookies(req: IncomingMessage) {
  const out: Record<string, string> = {}
  const header = req.headers.cookie ?? ""
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (!key) continue
    out[key] = decodeURIComponent(rest.join("="))
  }
  return out
}

const requestBodies = new WeakMap<IncomingMessage, { fields: Record<string, string>; json: Record<string, string> }>()
class BodyLimit extends Error {}
export function bodyLimit(path: string) {
  return /^\/students\/[0-9a-f-]{36}\/(?:materials|school-results|plan|direction|planner\/photos)$/i.test(path) || /^\/sheet\/[0-9a-f-]{36}\/upload$/i.test(path) || /^\/materials\/[0-9a-f-]{36}\/correct$/i.test(path) ? 64_000_000 : 65_536
}
export async function acceptBody(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST' || requestBodies.has(req)) return true
  try {
    requestBodies.set(req, await readBody(req, bodyLimit(new URL(req.url ?? '/', 'http://tutor.invalid').pathname)))
    return true
  } catch (error) {
    req.resume()
    send(res, error instanceof BodyLimit ? 413 : 400, 'text/plain', error instanceof BodyLimit ? 'This request is too large.' : 'The form could not be read. Please try again.')
    return false
  }
}
async function readBody(req: IncomingMessage, limit: number) {
  if (Number(req.headers['content-length']) > limit) throw new BodyLimit()
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > limit) throw new BodyLimit()
    chunks.push(Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString("utf8")
  const type = req.headers["content-type"] ?? ""
  if (type.includes("application/json")) {
    const json = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    if (!json || typeof json !== "object" || Array.isArray(json)) throw new UserError("Use a form object.")
    return { fields: {} as Record<string, string>, json }
  }
  const params = new URLSearchParams(raw)
  const fields: Record<string, string> = {}
  for (const [key, value] of params.entries()) {
    if (fields[key]) fields[key] += `\n${value}`
    else fields[key] = value
  }
  return { fields, json: {} as Record<string, string> }
}

async function qrSvgFor(sheetId: string) {
  try {
    const { createRequire } = await import("node:module")
    const require = createRequire(import.meta.url)
    const QRCode = require("qrcode") as { toString: (text: string, opts: object) => Promise<string> }
    return await QRCode.toString(sheetId, { type: "svg", margin: 0, width: 96 })
  } catch {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" fill="none" stroke="#241c16"/><text x="8" y="52" font-size="10">${sheetId.slice(0, 8)}</text></svg>`
  }
}
