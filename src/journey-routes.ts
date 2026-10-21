import { learningNow } from './learning-clock.ts'
import { recordExposure } from './learning-exposure.ts'
import { acknowledgeSaveVisible } from './turn-state.ts'
import { captureConfidence, saveAnswerDraft } from './services.ts'
import { sealFor } from './family-crypto.ts'
import { assessmentOpen, openAssessment } from './assessment.ts'
import { conceptSubject, measuredSkill, supportSuppliesSkill } from './engine/access.ts'
import { privacyPage, termsPage } from './legal.ts'
import { ARROW, BACK } from './icons.ts'
import { quickConnect, safeNext, welcomeAiPage, QUICK_MODELS } from './ai-connect.ts'
import { UserError, userMessage } from "./errors.ts"
import { configureStudentAccess, studentLogin } from './student-access.ts'
import { createUploadIntent, completeUpload } from "./direct-uploads.ts"
import { readPrivateFile } from "./storage.ts"
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database as DatabaseSync } from "./database.ts"
import { createHash, randomBytes } from 'node:crypto'
import { setWorld, nextLearningAction, studentConcepts, assertStudent, getOwnedSession, getSheet, enforceSessionTime, pauseSession, resumeSession, finishAssessment, sessionItems, startTutorSession, saveAiSettings, aiSettings } from './services.ts'
import { networkSource } from './auth-throttle.ts'
import { hashToken, loginUser } from './auth.ts'
import { encryptSecret, decryptSecret } from './secrets.ts'
import { createJob, jobForKey, sendKey, ownedJob, jobStatus, changeJob } from './jobs.ts'
export const ACCESS_SUPPORT = ['read_aloud', 'voice_entry', 'format_help']
import { createMaterial, ownedMaterial, ownedQuestion, correctMaterial, startGuidance, confirmQuestion, needsConfirm, saveSchoolResult, configureMaterialLearning } from './schoolwork.ts'
import { familyProgressPage, digestsPage, nav, cameraPage, worldPage, materialPage, materialsPage, mapPage, insightsPage, guidancePage, confirmPage, jobPage, parentUnlock, testPreparationPage } from './journey-view.ts'
import { exportFamily, deleteFamily, consumeAccountToken, requestRecovery } from './accounts.ts'
import { esc } from './view.ts'
import { liveAvailability, liveTutorPage, connectLiveTutor } from './live-tutor.ts'
import { aiConfigFor, setPresentation, saveChatGptConnection } from './services.ts'
import { answerWaitingReview, waitingReview } from './waiting-review.ts'
import { ageBand } from './engine/age.ts'
import { ChatGptError, chatgptAccessToken, chatgptConfig, finishChatGpt, listChatGptModels, revokeChatGpt, startChatGpt } from './chatgpt.ts'
import { plannerFragment } from './planner-view.ts'
import { acceptPlannerMessage, acceptPlannerPhotos, applyProposal, PlannerConflict, pendingPlanner, plannerRow, setPlannerStatus } from './planner.ts'
import { leaveNote, dismissNote } from './notes.ts'
import { undoDecision } from './undo.ts'
import { listDigests, markDigestsRead } from './digest.ts'
import { discardPack, makePlannedPack, ownedPack, packStartConcept, publishPack, requestPack, setPackSettings, PackLimit, PackNeedsAi, PackScope, type PackChecked } from './pack.ts'
import { packLessonPage, packPage } from './pack-view.ts'

export type Auth = { id: string; userId: string; csrf: string; selectedStudent: string | null; parentUnlocked: boolean; studentOnly?: boolean }
export function parentReturn(auth: Auth, target: string): string {
  // Only known parent destinations for this session, never an external redirect.
  if (/[\\\r\n]/.test(target)) return ''
  const path = target.split(/[?#]/)[0]
  if (['/settings', '/students', '/family/progress', '/family/digests'].includes(path) || (auth.selectedStudent && ['parent', 'classes', 'school', 'controls', 'note', 'history', 'live'].map(page => `/students/${auth.selectedStudent}/${page}`).includes(path))) {
    const query = new URLSearchParams(target.split('?')[1]?.split('#')[0] ?? '')
    // Vercel may add the matched rewrite parameter; it is not a user destination.
    let destination = target
    if (query.get('path') === path.slice(1)) {
      query.delete('path')
      const fragment = target.includes('#') ? target.slice(target.indexOf('#')) : ''
      destination = `${path}${query.size ? `?${query}` : ''}${fragment}`
    }
    if (path === `/students/${auth.selectedStudent}/parent` && query.get('section') === 'school-results' && !destination.includes('#')) return `${destination}#school-results`
    // The browser never sends the anchor, so the school page keeps its form in view after unlocking.
    if (path === `/students/${auth.selectedStudent}/school` && !destination.includes('#')) return `${destination}#school-results`
    return destination
  }
  return ''
}
interface Options { db: DatabaseSync; uploadsDir: string; onRecoveryMail?: (owner: string) => void }
export async function authorizeStudentPath(db: DatabaseSync, auth: Auth, path: string, method: string) {
  if (auth.studentOnly && ['/parent/unlock', '/parent/lock'].includes(path)) return false
  if (auth.parentUnlocked) return true
  if (['/logout', '/parent/unlock', '/parent/lock', '/account/recover', '/account/reset', '/account/verify'].includes(path)) return true
  const selected = auth.selectedStudent
  if (!selected) return false
  if ((auth.studentOnly && ['/', '/students'].includes(path)) || path === '/student-login' || /^\/learn\/[A-Za-z0-9_-]{32}$/.test(path)) return true
  const student = path.match(/^\/students\/([0-9a-f-]{36})(.*)$/i)
  if (student) return student[1] === selected && (method === 'GET' ? ['', '/map', '/insights', '/materials', '/materials/new', '/progress', '/test', '/world'].includes(student[2]) : ['/session', '/world', '/materials', '/targets', '/upload-token', '/upload-complete', '/note/read', '/packs'].includes(student[2]))
  const object = path.match(/^\/(session|sheet|uploads|jobs|materials|questions|packs)\/([0-9a-f-]{36})(.*)$/i)
  if (!object) return false
  const [, kind, id, suffix] = object
  let studentId: unknown
  try {
    if (kind === 'session') studentId = (await getOwnedSession(db, auth.userId, id)).student_id
    if (kind === 'sheet') studentId = (await db.prepare('SELECT student_id FROM sheets WHERE id = ?').get(id))?.student_id
    if (kind === 'uploads') studentId = (await db.prepare('SELECT student_id FROM uploads WHERE id = ? AND owner_user_id = ?').get(id, auth.userId))?.student_id
    if (kind === 'jobs') studentId = (await ownedJob(db, auth.userId, id)).student_id
    if (kind === 'materials') studentId = (await ownedMaterial(db, auth.userId, id)).student_id
    if (kind === 'questions') studentId = (await ownedQuestion(db, auth.userId, id)).m.student_id
    if (kind === 'packs') studentId = (await ownedPack(db, auth.userId, id)).student_id
  } catch { return false }
  if (studentId !== selected) return false
  const read: Record<string, string[]> = { session: [''], sheet: [''], uploads: [''], jobs: ['', '/status', '/events', '/file'], materials: [''], questions: ['/help'], packs: ['', '/lesson'] }
  const write: Record<string, string[]> = { session: ['/draft', '/answer', '/hint', '/feedback', '/continue', '/recap', '/ask', '/pause', '/resume', '/finish', '/lesson', '/concern', '/access', '/seen', '/save-seen', '/confidence'], sheet: ['/score', '/upload', '/pdf'], uploads: [], jobs: ['/retry', '/cancel', '/review'], materials: ['/extract', '/review'], questions: ['/help', '/confirm'], packs: ['/make', '/start', '/discard'] }
  const allowed = (method === 'GET' ? read : write)[kind] ?? []
  return allowed.includes(suffix)
}

/** Gate learner content across tabs/routes while a check is open. Parent administration remains available. */
export async function assessmentRestriction(db: DatabaseSync, auth: Auth, path: string, method: string) {
  const studentPath = path.match(/^\/students\/([0-9a-f-]{36})(.*)$/i)
  const object = path.match(/^\/(session|sheet|uploads|jobs|materials|questions|packs)\/([0-9a-f-]{36})(.*)$/i)
  let student: string | null = null
  if (studentPath) {
    if (['/parent', '/classes', '/controls', '/note', '/history', '/school', '/audit', '/access', '/world'].some(suffix => studentPath[2] === suffix || studentPath[2].startsWith(`${suffix}/`))) return null
    student = studentPath[1]
  } else if (object) {
    const [, kind, id] = object
    if (kind === 'session') student = String((await getOwnedSession(db, auth.userId, id)).student_id)
    else if (kind === 'jobs') student = (await ownedJob(db, auth.userId, id)).student_id
    else if (kind === 'questions') student = String((await ownedQuestion(db, auth.userId, id)).m.student_id)
    else if (kind === 'materials') student = String((await ownedMaterial(db, auth.userId, id)).student_id)
    else if (kind === 'packs') student = (await ownedPack(db, auth.userId, id)).student_id
    else if (kind === 'sheet') student = String((await getSheet(db, auth.userId, id)).student_id)
    else student = (await db.prepare('SELECT student_id FROM uploads WHERE id = ? AND owner_user_id = ?').get(id, auth.userId))?.student_id as string | null
  }
  if (!student) return null
  const check = await openAssessment(db, auth.userId, student)
  if (!check) return null
  if (object?.[1] === 'session' && object[2] === check.id) {
    if (method === 'GET' && object[3] === '') return null
    if (method === 'POST' && ['/answer', '/draft', '/pause', '/resume', '/finish', '/access', '/seen', '/save-seen', '/confidence', '/continue', '/review'].includes(object[3])) return null
  }
  return check
}
export async function journeyRoute(req: IncomingMessage, res: ServerResponse, url: URL, auth: Auth | null, options: Options, data: any,
  html: (res: ServerResponse, title: string, body: string, csrf: string) => void, send: (res: ServerResponse, status: number, type: string, body: any) => void, redirect: (res: ServerResponse, url: string) => void) {
  const method = req.method ?? 'GET', db = options.db, path = url.pathname
  const json = (status: number, value: any) => send(res, status, 'application/json', JSON.stringify(value))
  const csrf = auth?.csrf ?? data.csrf ?? ''
  if (path === '/account/recover' && method === 'GET' && url.searchParams.has('token')) {
    html(res, 'Reset password', `<h1>Choose a new password</h1><form method="post" action="/account/reset"><input type="hidden" name="csrf" class="csrf-field" value=""><input type="hidden" name="token" value="${esc(url.searchParams.get('token') ?? '')}"><label>New parent password<input name="password" type="password" minlength="10" required></label><button type="submit">Save password</button></form>`, csrf); return true
  }
  if (path === '/account/recover' && method === 'GET') {
    html(res, 'Password recovery', `<h1>Reset your password</h1><form action="/account/recover" method="post"><input name="csrf" class="csrf-field" value="" type="hidden"><label>Parent email<input type="email" name="email" required></label><button type="submit">Email a recovery link</button></form>`, csrf); return true
  }
  if (path === '/account/recover' && method === 'POST' && !data.token) {
    const recipient = await requestRecovery(db, String(data.email ?? ''), networkSource(req))
    if (recipient) options.onRecoveryMail?.(recipient)
    html(res, 'Check your email', '<h1>Check your email</h1><p>If that account exists, a recovery link has been queued for delivery.</p>', csrf); return true
  }
  if (path === '/account/verify' && method === 'GET') {
    html(res, 'Verify email', `<h1>Verify your email</h1><form method="post" action="/account/verify"><input type="hidden" name="csrf" class="csrf-field" value=""><input type="hidden" name="token" value="${esc(url.searchParams.get('token') ?? '')}"><button type="submit">Verify family email</button></form>`, csrf); return true
  }
  if (path === '/account/verify' && method === 'POST') { await consumeAccountToken(db, data.token, 'verify'); redirect(res, '/students'); return true }
  if (path === '/account/reset' && method === 'GET' || path === '/account/recover' && method === 'GET' && url.searchParams.has('token')) return false
  if (path === '/account/reset' && method === 'POST') { await consumeAccountToken(db, data.token, 'recover', data.password); redirect(res, '/'); return true }
  if ((path === '/privacy' || path === '/terms') && method === 'GET') { html(res, path === '/privacy' ? 'Privacy notice' : 'Terms', path === '/privacy' ? privacyPage() : termsPage(), csrf); return true }
  if (path === '/student-login' || /^\/learn\/[A-Za-z0-9_-]{32}$/.test(path)) {
    if (method === 'GET') {
      const code = path.startsWith('/learn/') ? path.split('/')[2] : ''
      html(res, 'Student sign-in', `<section class="student-entry"><h1>Ready for your next discovery?</h1><p>Use the student link and PIN your parent gave you.</p><form action="/student-login" method="post">${'<input type="hidden" name="csrf" class="csrf-field" value="">'}<label>Student code<input name="code" value="${esc(code)}" autocomplete="username" required ${code ? 'readonly' : ''}></label><label>Student PIN<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="current-password" required></label><button type="submit">Enter my learning space</button></form><p><a href="/">Parent sign-in</a></p></section>`, csrf)
    } else if (method === 'POST') {
      const session = await studentLogin(db, String(data.code ?? ''), String(data.pin ?? ''), new Date(), networkSource(req))
      if (!session) { html(res, 'Student sign-in', '<h1>Let’s try that again</h1><p role="alert">The link or PIN did not match, or there have been too many tries. Ask your parent to check the link and PIN.</p><a href="/student-login">Try student sign-in</a>', csrf); return true }
      const secure = process.env.TUTOR_SECURE === '1' ? '; Secure' : ''
      res.setHeader('Set-Cookie', [`tutor_session=${session.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=43200${secure}`, 'tutor_csrf=; HttpOnly; Path=/; Max-Age=0'])
      redirect(res, `/students/${session.studentId}`)
    }
    return true
  }
  if (!auth) return false
  const check = await assessmentRestriction(db, auth, path, method)
  if (check) {
    const location = `/session/${check.id}`
    if (method === 'GET' || !(req.headers.accept ?? '').includes('application/json')) redirect(res, location)
    else json(409, { error: 'Your assessment is still open. Resume it or finish it before opening help and feedback.', location })
    return true
  }
  if (path === '/family/progress' && method === 'GET') { if (!auth.parentUnlocked || auth.studentOnly) { json(403, { error: 'Parent access required.' }); return true }; html(res, 'Family progress', await familyProgressPage(db, auth.userId), csrf); return true }
  if (path === '/family/digests' && method === 'GET') {
    if (!auth.parentUnlocked || auth.studentOnly) { json(403, { error: 'Parent access required.' }); return true }
    const rows = await listDigests(db, auth.userId)
    html(res, 'Weekly digests', digestsPage(rows, auth.selectedStudent), csrf)
    await markDigestsRead(db, auth.userId)
    return true
  }
  const access = path.match(/^\/students\/([0-9a-f-]{36})\/access$/i)
  if (access && method === 'POST') {
    if (!auth.parentUnlocked || auth.studentOnly) { json(403, { error: 'A parent must manage student access.' }); return true }
    await configureStudentAccess(db, auth.userId, access[1], String(data.pin ?? ''), data.disable === '1')
    redirect(res, `/students/${access[1]}/controls#student-access`); return true
  }
  const planner = path.match(/^\/students\/([0-9a-f-]{36})\/planner(?:\/(message|apply|decline|photos)(?:\/([0-9a-f-]{36}))?)?$/i)
  if (planner) {
    if (!auth.parentUnlocked || auth.studentOnly) { json(403, { error: 'Parent access required.' }); return true }
    const id = planner[1]; await assertStudent(db, auth.userId, id)
    const wantsJson = (req.headers.accept ?? '').includes('application/json')
    if (!planner[2] && method === 'GET') {
      const fragment = (await plannerFragment(db, auth.userId, id, url.searchParams.get('say')?.slice(0, 400) ?? '')).replaceAll('name="csrf" class="csrf-field" value=""', `name="csrf" value="${esc(csrf)}"`)
      send(res, 200, 'text/html; charset=utf-8', fragment); return true
    }
    if (planner[2] === 'message' && method === 'POST') {
      try {
        const title = String(data.title ?? '').trim().slice(0, 80), detail = String(data.message ?? '').trim()
        const composed = title ? `Add a class called ${title}. ${detail}`.trim() : detail
        const result = await acceptPlannerMessage(db, auth.userId, id, composed, String(data.source ?? '').slice(0, 40), data.mode === 'review' ? 'review' : 'now')
        if (result.jobId) { if (wantsJson) json(202, { jobId: result.jobId, location: `/jobs/${result.jobId}`, messageId: result.messageId }); else redirect(res, `/jobs/${result.jobId}`) }
        else if (wantsJson) json(200, { messageId: result.messageId, reply: result.reply, proposal: result.proposal ?? null, ai: { connected: false, problem: result.aiProblem } })
        else redirect(res, `/students/${id}/parent#planner`)
      } catch (error) {
        if (!(error instanceof PlannerConflict)) throw error
        const pending = await pendingPlanner(db, id)
        json(409, { error: error.message, pending: pending?.job_id ? { jobId: pending.job_id } : null })
      }
      return true
    }
    if (planner[2] === 'photos' && method === 'POST') {
      const result = await acceptPlannerPhotos(db, auth.userId, id, { message: data.message, pages: data.pages, requestId: data.requestId }, options.uploadsDir)
      json(200, result); return true
    }
    if ((planner[2] === 'apply' || planner[2] === 'decline') && planner[3] && method === 'POST') {
      const row = await plannerRow(db, id, planner[3])
      if (!row) { json(404, { error: 'That suggestion is no longer here.' }); return true }
      if (planner[2] === 'decline') { if (row.status === 'proposed') await setPlannerStatus(db, id, planner[3], 'declined'); json(200, { declined: true }); return true }
      try { json(200, await applyProposal(db, auth.userId, id, planner[3])) }
      catch (error) { if (error instanceof PlannerConflict) json(409, { error: error.message }); else throw error }
      return true
    }
  }
  const packAsk = path.match(/^\/students\/([0-9a-f-]{36})\/packs$/i)
  if (packAsk && method === 'POST') {
    const id = packAsk[1], wantsJson = (req.headers.accept ?? '').includes('application/json')
    const by = auth.parentUnlocked && !auth.studentOnly ? 'parent' : 'child'
    const preview = data.preview === '1' || data.preview === true
    const mode = preview ? (by === 'child' ? 'plan' : 'review') : ['now', 'review', 'plan'].includes(String(data.mode)) ? data.mode : 'now'
    try {
      const result = await requestPack(db, auth.userId, id, { text: String(data.message ?? data.text ?? ''), by, mode, requestId: String(data.requestId ?? ''), subject: String(data.subject ?? '').slice(0, 60) || undefined })
      if (result.kind === 'pack') {
        const pack = result.pack, body = { kind: 'pack', packId: pack.id, status: pack.status, jobId: pack.job_id, existing: result.existing, title: pack.title, location: `/packs/${pack.id}` }
        if (wantsJson) json(pack.job_id && !result.existing ? 202 : 200, body); else redirect(res, `/packs/${pack.id}`)
      } else if (wantsJson) json(200, result)
      else html(res, 'Practice', `<p><a href="/students/${esc(id)}">${BACK}Back</a></p><h1>One more thing</h1><p>${esc(result.reply)}</p>`, csrf)
    } catch (error) {
      const status = error instanceof PackLimit ? 429 : error instanceof PackScope ? 403 : error instanceof PackNeedsAi ? 409 : 400
      const message = userMessage(error)
      if (wantsJson) json(status, { error: message }); else html(res, 'Practice', `<p><a href="/students/${esc(id)}">${BACK}Back</a></p><h1>Not right now</h1><p role="alert">${esc(message)}</p>`, csrf)
    }
    return true
  }
  const packSettingsMatch = path.match(/^\/students\/([0-9a-f-]{36})\/pack-settings$/i)
  if (packSettingsMatch && method === 'POST') {
    if (!auth.parentUnlocked || auth.studentOnly) { json(403, { error: 'Parent access required.' }); return true }
    await setPackSettings(db, auth.userId, packSettingsMatch[1], { requests: data.requests, approval: data.approval, dailyLimit: data.dailyLimit === undefined ? undefined : Number(data.dailyLimit) })
    redirect(res, `/students/${packSettingsMatch[1]}/controls#child-requests`); return true
  }
  const packMatch = path.match(/^\/packs\/([0-9a-f-]{36})(?:\/(lesson|make|start|discard|publish|undo))?$/i)
  if (packMatch) {
    const pack = await ownedPack(db, auth.userId, packMatch[1]), action = packMatch[2] ?? ''
    const parent = auth.parentUnlocked && !auth.studentOnly
    const student: any = await assertStudent(db, auth.userId, pack.student_id)
    const junior = ageBand(student) !== '11-14'
    const viewer = { parent, junior: !parent && junior, studentId: pack.student_id, name: String(student.display_name) }
    if (method === 'GET' && !action) {
      if ((req.headers.accept ?? '').includes('application/json')) {
        let interpretation = ''
        try { interpretation = pack.check_json ? (JSON.parse(pack.check_json) as PackChecked).final.interpretation : '' } catch { interpretation = '' }
        json(200, { packId: pack.id, status: pack.status, title: pack.title, interpretation, note: pack.note, jobId: pack.job_id, location: `/packs/${pack.id}`, lesson: pack.status === 'published' ? `/packs/${pack.id}/lesson` : null })
      } else html(res, pack.title || 'Practice', packPage(pack, viewer), csrf)
      return true
    }
    if (method === 'GET' && action === 'lesson') {
      if (pack.status !== 'published') { redirect(res, `/packs/${pack.id}`); return true }
      html(res, `${pack.title} lesson`, packLessonPage(pack, viewer), csrf); return true
    }
    if (method !== 'POST') return false
    if (action === 'make') { await makePlannedPack(db, auth.userId, pack.id, { count: data.count ? Number(data.count) : undefined }); redirect(res, `/packs/${pack.id}`); return true }
    if (action === 'discard') {
      if (!parent && pack.status !== 'brief') { json(403, { error: 'Ask a grown-up to set this practice aside.' }); return true }
      await discardPack(db, auth.userId, pack.id); redirect(res, parent ? `/students/${pack.student_id}/classes#practice` : `/students/${pack.student_id}`); return true
    }
    if (action === 'start') {
      if (pack.status !== 'published') { redirect(res, `/packs/${pack.id}`); return true }
      const conceptId = await packStartConcept(db, pack)
      const session = await startTutorSession(db, auth.userId, pack.student_id, learningNow(), { mode: 'session', subject: pack.subject, focusConceptId: conceptId ?? undefined, intent: 'practice', arc: false })
      await db.prepare('UPDATE packs SET first_session_id = coalesce(first_session_id, ?) WHERE id = ?').run(session, pack.id)
      redirect(res, `/session/${session}`); return true
    }
    if (!parent) { json(403, { error: 'Parent access required.' }); return true }
    if (action === 'publish') { await publishPack(db, auth.userId, pack.id); redirect(res, `/packs/${pack.id}`); return true }
    if (action === 'undo') {
      try { const message = pack.decision_id ? await undoDecision(db, auth.userId, pack.student_id, pack.decision_id) : 'Nothing to undo.'; redirect(res, `/students/${pack.student_id}/history?notice=${encodeURIComponent(message)}`) }
      catch (error) { redirect(res, `/students/${pack.student_id}/history?error=${encodeURIComponent(userMessage(error))}`) }
      return true
    }
  }
  const undo = path.match(/^\/students\/([0-9a-f-]{36})\/undo$/i)
  if (undo && method === 'POST') {
    if (!auth.parentUnlocked || auth.studentOnly) { json(403, { error: 'A parent must undo changes.' }); return true }
    const id = undo[1], wantsJson = (req.headers.accept ?? '').includes('application/json')
    try {
      const message = await undoDecision(db, auth.userId, id, String(data.decisionId ?? ''))
      if (wantsJson) json(200, { undone: true, message }); else redirect(res, `/students/${id}/history?notice=${encodeURIComponent(message)}`)
    } catch (error) {
      const message = userMessage(error)
      if (wantsJson) json(409, { error: message }); else redirect(res, `/students/${id}/history?error=${encodeURIComponent(message)}`)
    }
    return true
  }
  const note = path.match(/^\/students\/([0-9a-f-]{36})\/note(\/read)?$/i)
  if (note && method === 'POST') {
    const id = note[1]
    if (note[2]) { await assertStudent(db, auth.userId, id); await dismissNote(db, id, String(data.id ?? '')); redirect(res, `/students/${id}`); return true }
    if (!auth.parentUnlocked || auth.studentOnly) { json(403, { error: 'A parent must leave notes.' }); return true }
    const noteId = await leaveNote(db, auth.userId, id, String(data.text ?? ''))
    if ((req.headers.accept ?? '').includes('application/json')) json(201, { id: noteId, message: 'Saved. It appears when your child next opens Practice.' })
    else redirect(res, `/students/${id}/note?notice=${encodeURIComponent('Note saved. It appears when your child next opens Practice.')}`)
    return true
  }
  const live = path.match(/^\/students\/([0-9a-f-]{36})\/live$/i)
  if (live) {
    await assertStudent(db, auth.userId, live[1])
    if (!auth.parentUnlocked) { json(403, { error: 'A parent must unlock to start a live conversation.' }); return true }
    if (method === 'GET') html(res, 'Live tutor', liveTutorPage(live[1], liveAvailability(await aiSettings(db, auth.userId))), csrf)
    else if (method === 'POST') {
      const cancel = new AbortController(), disconnected = () => { if (!res.writableEnded) cancel.abort() }
      res.once('close', disconnected)
      try { const sdp = await connectLiveTutor(await aiConfigFor(db, auth.userId), auth.userId, live[1], data.sdp, fetch, cancel.signal); if (!res.destroyed) json(200, { sdp }) }
      finally { res.off('close', disconnected) }
    }
    else json(405, { error: 'Use GET or POST.' })
    return true
  }
  if (path === '/parent/unlock') {
    const destination = parentReturn(auth, String(method === 'GET' ? url.searchParams.get('returnTo') ?? '' : data.returnTo ?? ''))
    if (method === 'GET') html(res, 'Parent unlock', parentUnlock(url.searchParams.get('error') ?? '', destination), csrf)
    else {
      const user = (await db.prepare('SELECT email FROM users WHERE id = ?').get(auth.userId))!
      const login = (await loginUser(db, String(user.email), String(data.password ?? ''), new Date(), 5, networkSource(req)))
      if (!login.ok) redirect(res, `/parent/unlock?error=${encodeURIComponent(login.error)}&returnTo=${encodeURIComponent(destination)}`)
      else { await db.prepare('UPDATE auth_sessions SET parent_unlocked_until = ? WHERE id = ?').run(new Date(Date.now() + 15 * 60000).toISOString(), auth.id); redirect(res, destination || (auth.selectedStudent ? `/students/${auth.selectedStudent}/parent` : '/students')) }
    }
    return true
  }
  if (path === '/parent/lock' && method === 'POST') {
    const student = data.studentId || auth.selectedStudent
    if (student) await assertStudent(db, auth.userId, student)
    await db.prepare('UPDATE auth_sessions SET selected_student = ?, parent_unlocked_until = NULL WHERE id = ?').run(student, auth.id)
    redirect(res, student ? `/students/${student}` : '/parent/unlock'); return true
  }
  if (path === '/family/export' && method === 'GET') { res.setHeader('Content-Disposition', 'attachment; filename="tutor-family.json"'); json(200, (await exportFamily(db, auth.userId, options.uploadsDir))); return true }
  if (path === '/family/delete' && method === 'POST') {
    const user = (await db.prepare('SELECT email FROM users WHERE id = ?').get(auth.userId))!
    if (!(await loginUser(db, String(user.email), String(data.password ?? ''), new Date(), 5, networkSource(req))).ok) throw new UserError('Parent password does not match.')
    const connection = await db.prepare('SELECT ai_provider, ai_key FROM users WHERE id = ?').get(auth.userId)
    if (connection?.ai_provider === 'chatgpt' && connection.ai_key) await revokeChatGpt(String(connection.ai_key))
    await deleteFamily(db, auth.userId, options.uploadsDir); res.setHeader('Set-Cookie', 'tutor_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax'); redirect(res, '/'); return true
  }
  if (path === '/welcome/ai' && method === 'GET') {
    const next = safeNext(url.searchParams.get('next'))
    html(res, 'Connect an AI', welcomeAiPage({ next, chatgpt: Boolean(chatgptConfig()), error: url.searchParams.get('error') ?? undefined }), csrf); return true
  }
  if (path === '/welcome/ai/key' && method === 'POST') {
    const next = safeNext(data.next)
    try {
      await quickConnect(db, auth.userId, String(data.apiKey ?? ''))
      redirect(res, next)
    } catch (error) {
      redirect(res, `/welcome/ai?next=${encodeURIComponent(next)}&error=${encodeURIComponent(userMessage(error))}`)
    }
    return true
  }
  if (path === '/connections/openrouter' && method === 'POST') {
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url')
    // A connection started from the welcome screen returns the parent to where they were.
    const next = data.next ? safeNext(data.next) : '/settings'
    await db.prepare('INSERT INTO oauth_states (state_hash, user_id, auth_session_id, verifier, expires_at, redirect_uri) VALUES (?, ?, ?, ?, ?, ?)').run(hashToken(state), auth.userId, auth.id, encryptSecret(verifier), new Date(Date.now() + 10 * 60000).toISOString(), next)
    const callback = new URL('/connections/openrouter/callback', process.env.TUTOR_ORIGIN || 'http://127.0.0.1:8787')
    callback.searchParams.set('state', state)
    const target = new URL('https://openrouter.ai/auth')
    target.search = new URLSearchParams({ callback_url: callback.toString(), code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString()
    redirect(res, target.toString()); return true
  }
  if (path === '/connections/openrouter/callback' && method === 'GET') {
    const state = (await db.prepare("DELETE FROM oauth_states WHERE state_hash = ? AND user_id = ? AND auth_session_id = ? AND provider = 'openrouter' AND expires_at > ? RETURNING *").get(hashToken(url.searchParams.get('state') ?? ''), auth.userId, auth.id, new Date().toISOString()))
    if (!state || !url.searchParams.get('code')) { json(400, { error: 'Connection request expired or does not match this parent session.' }); return true }
    const response = await fetch('https://openrouter.ai/api/v1/auth/keys', { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: url.searchParams.get('code'), code_verifier: decryptSecret(String(state.verifier)), code_challenge_method: 'S256' }) })
    if (!response.ok) throw new UserError('OpenRouter connection failed. Try connecting again.')
    const result = await response.json() as { key?: string }
    if (!result.key) throw new UserError('OpenRouter did not return a credential.')
    const current = await aiSettings(db, auth.userId)
    const keep = current.provider === 'openrouter'
    await saveAiSettings(db, auth.userId, { provider: 'openrouter', model: keep && current.model ? current.model : QUICK_MODELS.openrouter.model, photoModel: keep && current.photoModel ? current.photoModel : QUICK_MODELS.openrouter.photoModel, apiKey: result.key })
    const next = safeNext(state.redirect_uri)
    redirect(res, next === '/students' || next === '/settings' ? `/settings?notice=${encodeURIComponent('OpenRouter connected. Bloop is ready; you can change models any time.')}` : next); return true
  }
  const chatgpt = chatgptConfig()
  if (chatgpt && path === '/connections/chatgpt' && method === 'POST') {
    // OpenAI returns a local sign-in to 127.0.0.1; starting from another address would lose the parent session.
    const loopback = new URL(chatgpt.redirectUri)
    if (chatgpt.mode === 'local' && req.headers.host !== loopback.host) { redirect(res, `/settings?error=${encodeURIComponent(`To connect ChatGPT, open ${loopback.origin}/settings in a browser on the computer running bubble and press Continue with ChatGPT there. Once connected, ChatGPT works from any of your devices.`)}`); return true }
    try { redirect(res, await startChatGpt(db, auth)) } catch (error) { redirect(res, `/settings?error=${encodeURIComponent(error instanceof ChatGptError ? error.message : 'ChatGPT sign-in could not start. Try again.')}`) }
    return true
  }
  if (chatgpt && method === 'GET' && (path === '/connections/chatgpt/callback' || (chatgpt.mode === 'local' && path === '/auth/callback'))) {
    let result: Awaited<ReturnType<typeof finishChatGpt>>
    try { result = await finishChatGpt(db, auth, url) } catch (error) {
      const message = error instanceof ChatGptError ? error.message : 'ChatGPT sign-in did not finish. Nothing changed; try Continue with ChatGPT again.'
      if (/expired or does not match/.test(message)) json(400, { error: message }); else redirect(res, `/settings?error=${encodeURIComponent(message)}`)
      return true
    }
    const previous = await db.prepare('SELECT ai_provider, ai_key FROM users WHERE id = ?').get(auth.userId)
    await saveChatGptConnection(db, auth.userId, result.credential, result.models)
    if (previous?.ai_provider === 'chatgpt' && previous.ai_key) await revokeChatGpt(String(previous.ai_key))
    redirect(res, `/settings?notice=${encodeURIComponent(result.models.length ? 'ChatGPT connected. Kids Tutor now uses your ChatGPT plan.' : 'ChatGPT connected. Choose a model below before using AI.')}`); return true
  }
  if (chatgpt && path === '/connections/chatgpt/models' && method === 'POST') {
    let models: Awaited<ReturnType<typeof listChatGptModels>>
    try { models = await listChatGptModels(await chatgptAccessToken(db, auth.userId)) } catch (error) { redirect(res, `/settings?error=${encodeURIComponent(error instanceof ChatGptError ? error.message : 'ChatGPT models could not load. Try again.')}`); return true }
    const pick = (value: unknown) => models.find(model => model.slug === String(value ?? ''))?.slug
    const model = pick(data.model)
    if (!model) { redirect(res, '/settings?error=Choose a model from your ChatGPT account.'); return true }
    const photoModel = pick(data.photoModel) ?? model
    await db.prepare("UPDATE users SET ai_model = ?, photo_model = ?, ai_health = NULL, ai_health_at = NULL WHERE id = ? AND ai_provider = 'chatgpt'").run(model, photoModel, auth.userId)
    redirect(res, '/settings?notice=Saved. New work uses this ChatGPT model.'); return true
  }
  if (chatgpt && path === '/connections/chatgpt/welcome' && method === 'POST') { await db.prepare('UPDATE users SET chatgpt_welcomed_at = ? WHERE id = ?').run(new Date().toISOString(), auth.userId); redirect(res, '/settings'); return true }
  if (path === '/connections/disconnect' && method === 'POST') {
    const current = await db.prepare('SELECT ai_provider, ai_key FROM users WHERE id = ?').get(auth.userId)
    const revoked = current?.ai_provider === 'chatgpt' && current.ai_key ? await revokeChatGpt(String(current.ai_key)) : null
    await db.prepare("UPDATE users SET ai_key = '', ai_model = '', photo_model = '', ai_refresh_lease = NULL, ai_health = NULL, ai_health_at = NULL WHERE id = ?").run(auth.userId)
    redirect(res, `/settings?notice=${encodeURIComponent(revoked === false ? 'Disconnected here. OpenAI did not confirm the sign-out, so you can also remove Kids Tutor in ChatGPT settings.' : 'Disconnected')}`); return true
  }
  let match = path.match(/^\/students\/([0-9a-f-]{36})\/world$/i)
  if (match && method === 'POST') { await setWorld(db, auth.userId, match[1], String(data.world ?? '')); redirect(res, `/students/${match[1]}`); return true }
  match = path.match(/^\/students\/([0-9a-f-]{36})\/(map|insights|materials(?:\/new)?|test|world)$/i)
  if (match && method === 'GET') {
    const id = match[1]; await assertStudent(db, auth.userId, id)
    let body = ''
    if (match[2] === 'map') body = (await mapPage(db, auth.userId, id, url.searchParams, auth.parentUnlocked && !auth.studentOnly))
    if (match[2] === 'insights') body = (await insightsPage(db, auth.userId, id, url.searchParams.get('concept') ?? undefined))
    if (match[2] === 'materials') body = (await materialsPage(db, auth.userId, id))
    if (match[2] === 'materials/new') body = (await cameraPage(db, auth.userId, id, url.searchParams.get('for') === 'test', url.searchParams.get('subject')?.trim().slice(0, 100) || 'Math'))
    if (match[2] === 'test') body = await testPreparationPage(db, auth.userId, id)
    if (match[2] === 'world') body = await worldPage(db, auth.userId, id)
    html(res, match[2], body, csrf); return true
  }
  match = path.match(/^\/students\/([0-9a-f-]{36})\/(upload-token|upload-complete)$/i)
  if (match && method === 'POST') {
    const result = match[2] === 'upload-token'
      ? await createUploadIntent(db, auth.userId, match[1], String(data.mime))
      : { id: await completeUpload(db, auth.userId, match[1], String(data.id), options.uploadsDir) }
    json(200, result); return true
  }
  match = path.match(/^\/students\/([0-9a-f-]{36})\/(presentation|materials|school-results)$/i)
  if (match && method === 'POST') {
    const id = match[1]; await assertStudent(db, auth.userId, id)
    if (match[2] === 'presentation') {
      await setPresentation(db, auth.userId, id, { presentation: String(data.presentation ?? ''), cap: Number(data.cap) }); redirect(res, `/students/${id}/controls#student-settings`)
    } else if (match[2] === 'school-results') {
      const resultId = await saveSchoolResult(db, auth.userId, id, data, options.uploadsDir)
      if ((req.headers.accept ?? '').includes('application/json')) json(201, { resultId, location: `/students/${id}/insights#school-results` })
      else redirect(res, `/students/${id}/insights#school-results`)
    }
    else {
      const material = (await createMaterial(db, auth.userId, id, data, options.uploadsDir, auth.parentUnlocked && !auth.studentOnly))
      json(201, { materialId: material, location: `/materials/${material}${data.prepareForTest === true ? '?for=test#learning-source' : ''}` })
    }
    return true
  }
  match = path.match(/^\/session\/([0-9a-f-]{36})\/draft$/i)
  if (match && method === 'POST') {
    const sessionId = match[1]
    const saved = await saveAnswerDraft(db, auth.userId, sessionId, { itemId: String(data.itemId ?? ''), revision: data.revision === undefined ? undefined : String(data.revision), answer: String(data.answer ?? '') })
    json(200, saved); return true
  }
  match = path.match(/^\/session\/([0-9a-f-]{36})\/save-seen$/i)
  if (match && method === 'POST') {
    await getOwnedSession(db, auth.userId, match[1])
    await acknowledgeSaveVisible(db, match[1], String(data.itemId ?? ''), String(data.revision ?? ''), data.elapsedMs)
    json(200, { saved: true }); return true
  }
  // Access support (the question read aloud, an answer spoken instead of typed) is recorded beside the
  // attempt, apart from teaching help. It does not change scoring; whether it changes what a task measures
  // depends on the skill being checked, which is a separate, explicit decision.
  match = path.match(/^\/session\/([0-9a-f-]{36})\/access$/i)
  if (match && method === 'POST') {
    const session = await getOwnedSession(db, auth.userId, match[1])
    const kind = String(data.kind ?? '')
    if (!ACCESS_SUPPORT.includes(kind)) throw new UserError('Unknown support.')
    const item = (await db.prepare('SELECT id, concept_id, access_support FROM session_items WHERE session_id = ? AND answered = 0 AND skipped = 0 ORDER BY position LIMIT 1').get(match[1])) as { id: string; concept_id: string; access_support: string | null } | undefined
    if (!item || item.id !== data.itemId) throw new UserError('This is not the current question.')
    if (session.mode === 'assessment') {
      if (!assessmentOpen(session, await sessionItems(db, match[1]))) throw new UserError('This assessment has been submitted.')
      const custom = await db.prepare('SELECT subject FROM custom_concepts WHERE student_id = ? AND concept_id = ?').get(session.student_id, item.concept_id)
      const subject = conceptSubject(item.concept_id, new Map(custom ? [[item.concept_id, String(custom.subject)]] : []), session.subject)
      if (supportSuppliesSkill(measuredSkill(subject), [kind])) throw new UserError('That support would supply the skill this assessment is checking.')
    }
    const kinds = new Set(String(item.access_support ?? '').split(',').filter(Boolean)); kinds.add(kind)
    await db.prepare('UPDATE session_items SET access_support = ? WHERE id = ? AND answered = 0').run([...kinds].sort().join(','), item.id)
    json(200, { saved: true }); return true
  }
  match = path.match(/^\/session\/([0-9a-f-]{36})\/confidence$/i)
  if (match && method === 'POST') {
    await captureConfidence(db, auth.userId, match[1], String(data.itemId ?? ''), String(data.confidence ?? ''), String(data.revision ?? ''))
    json(200, { saved: true }); return true
  }
  // The moment a question or its feedback was actually on screen in the browser, first time only. Server render
  // time (shown_at) stays as it was; this adds what the learner saw.
  match = path.match(/^\/session\/([0-9a-f-]{36})\/seen$/i)
  if (match && method === 'POST') {
    const session = await getOwnedSession(db, auth.userId, match[1])
    const column = data.what === 'feedback' ? 'feedback_visible_at' : data.what === 'question' ? 'visible_at' : ''
    if (!column) throw new UserError('Unknown view.')
    if (column === 'feedback_visible_at' && assessmentOpen(session, await sessionItems(db, match[1]))) throw new UserError('Assessment feedback opens after submission.')
    const items = await sessionItems(db, match[1])
    const item = items.find(i => i.id === String(data.itemId ?? ''))
    if (!item || (column === 'visible_at' && (items.find(i => !i.answered)?.id !== item.id || !item.shown_at || session.ended_at || session.paused_at))) throw new UserError('That question is not currently displayed.')
    if (column === 'feedback_visible_at' && item.answered !== 1) throw new UserError('There is no submitted answer to review.')
    const now = learningNow()
    await db.prepare(`UPDATE session_items SET ${column} = ? WHERE id = ? AND session_id = ? AND ${column} IS NULL${column === 'visible_at' ? ' AND answered = 0' : ' AND answered = 1 AND correct IS NOT NULL'}`).run(now.toISOString(), String(data.itemId ?? ''), match[1])
    await recordExposure(db, String(session.student_id), match[1], item, column === 'visible_at' ? 'question' : 'feedback', now, true)
    json(200, { saved: true }); return true
  }
  match = path.match(/^\/session\/([0-9a-f-]{36})\/(pause|resume|finish|lesson)$/i)
  if (match && method === 'POST') {
    const session = (await getOwnedSession(db, auth.userId, match[1]))
    if (match[2] === 'finish') { await finishAssessment(db, auth.userId, match[1]); redirect(res, `/session/${match[1]}`) }
    else if (match[2] === 'lesson') {
      const first = (await sessionItems(db, match[1])).find(i => !i.answered)
      if (session.mode === 'assessment' || first?.beat !== 'guided' || session.ended_at) throw new UserError('That lesson is not currently open.')
      await recordExposure(db, String(session.student_id), match[1], first, 'lesson', learningNow(), true)
      await db.prepare('UPDATE tutor_sessions SET lesson_done = 1 WHERE id = ?').run(match[1]); redirect(res, `/session/${match[1]}`)
    }
    else if (match[2] === 'pause') {
      await pauseSession(db, auth.userId, match[1], data.itemId === undefined ? undefined : { itemId: String(data.itemId), revision: data.revision === undefined ? undefined : String(data.revision), answer: String(data.answer ?? '') })
      redirect(res, `/students/${session.student_id}`)
    }
    else redirect(res, `/session/${(await resumeSession(db, auth.userId, match[1]))}`)
    return true
  }
  match = path.match(/^\/sheet\/([0-9a-f-]{36})\/pdf$/i)
  if (match && method === 'POST') {
    const sheet = (await getSheet(db, auth.userId, match[1]))
    const job = (await createJob(db, auth.userId, String(sheet.student_id), 'pdf', { sheetId: match[1] }, `pdf:${match[1]}`))
    redirect(res, `/jobs/${job}`); return true
  }
  match = path.match(/^\/materials\/([0-9a-f-]{36})(?:\/(extract|review|correct|learning))?$/i)
  if (match) {
    const m = (await ownedMaterial(db, auth.userId, match[1]))
    if (method === 'GET' && !match[2]) html(res, 'Schoolwork', (m.scope_approved === 0 && ['syllabus', 'agenda', 'textbook'].includes(String(m.kind)) ? '<p>Saved. A parent must approve these pages before they change your learning plan.</p>' : '') + (await materialPage(db, auth.userId, match[1], auth.parentUnlocked, url.searchParams.get('for') === 'test')), csrf)
    else if (method === 'POST' && match[2]) {
      if ((!auth.parentUnlocked || auth.studentOnly) && ['syllabus', 'agenda', 'textbook'].includes(String(m.kind))) await db.prepare('UPDATE materials SET scope_approved = 0 WHERE id = ?').run(m.id)
      if (match[2] === 'learning') {
        if (!auth.parentUnlocked) throw new UserError('Unlock the parent area to change the learning plan.')
        const source = await configureMaterialLearning(db, auth.userId, match[1], data)
        const current = await ownedMaterial(db, auth.userId, match[1])
        if (!current.learning_purpose) { redirect(res, `/materials/${match[1]}`); return true }
        const job = await createJob(db, auth.userId, String(m.student_id), 'school_path', source, `school-path:${source.materialId}:${source.revision}:${source.learningVersion}`)
        redirect(res, `/jobs/${job}`); return true
      }
      if (match[2] === 'correct') await correctMaterial(db, auth.userId, match[1], data.pages)
      const current = await ownedMaterial(db, auth.userId, match[1]), revision = Number(current.revision)
      const planning = match[2] === 'correct' && Boolean(current.learning_purpose)
      const kind = planning ? 'school_path' : match[2] === 'review' ? 'homework_review' : 'extract'
      const payload = { materialId: match[1], revision, ...(planning ? { learningVersion: Number(current.learning_version) } : {}) }
      const job = (await createJob(db, auth.userId, String(m.student_id), kind, payload, planning ? `school-path:${match[1]}:${revision}:${current.learning_version}` : `${kind}:${match[1]}:${revision}`))
      if ((req.headers['accept'] ?? '').includes('application/json')) json(202, { jobId: job, location: `/jobs/${job}` })
      else redirect(res, `/jobs/${job}`)
    } else return false
    return true
  }
  match = path.match(/^\/questions\/([0-9a-f-]{36})\/(help|override|confirm)$/i)
  if (match) {
    const { q, m } = (await ownedQuestion(db, auth.userId, match[1]))
    if (match[2] === 'confirm' && method === 'POST') {
      await confirmQuestion(db, auth.userId, match[1], String(data.choice ?? ''), data.prompt, auth.parentUnlocked && !auth.studentOnly)
      redirect(res, `/questions/${match[1]}/help`)
    } else if (match[2] === 'confirm') return false
    else if (match[2] === 'override' && method === 'POST') {
      if (!['correct', 'needs_work', 'unresolved'].includes(data.verdict) || !String(data.explanation ?? '').trim()) throw new UserError('Choose a verdict and explain the review.')
      await db.prepare(`INSERT INTO homework_reviews (id, question_id, revision, verdict, explanation, provider, model, created_at) VALUES (?, ?, ?, ?, ?, 'parent', '', ?) ON CONFLICT(question_id, revision) DO UPDATE SET verdict = excluded.verdict, explanation = excluded.explanation, provider = 'parent', model = '', created_at = excluded.created_at`).run(crypto.randomUUID(), q.id, q.revision, data.verdict, String(data.explanation).slice(0, 10000), learningNow().toISOString())
      redirect(res, `/materials/${m.id}`)
    } else if (method === 'GET' && needsConfirm(q)) html(res, 'Is this the question?', (await confirmPage(db, auth.userId, match[1], url.searchParams.get('fix') === '1')), csrf)
    else if (method === 'GET') { await startGuidance(db, auth.userId, match[1]); html(res, 'Thinking together', (await guidancePage(db, auth.userId, match[1])), csrf) }
    else if (method === 'POST') {
      await startGuidance(db, auth.userId, match[1])
      if (!String(data.message ?? '').trim()) throw new UserError('Share your thinking first.')
      const sendId = sendKey(data.sendId)
      const sent = sendId ? await jobForKey(db, auth.userId, `guide:${q.id}:${sendId}`) : undefined
      if (sent) { redirect(res, `/jobs/${sent}`); return true }
      const attempt = crypto.randomUUID()
      await db.prepare('INSERT INTO guided_attempts (id, question_id, role, body, created_at) VALUES (?, ?, ?, ?, ?)').run(attempt, q.id, 'student', await sealFor(db, auth.userId, String(data.message).slice(0, 4000)), learningNow().toISOString())
      const job = (await createJob(db, auth.userId, String(m.student_id), 'guide', { questionId: q.id, attemptId: attempt }, sendId ? `guide:${q.id}:${sendId}` : `guide:${attempt}`))
      redirect(res, `/jobs/${job}`)
    } else return false
    return true
  }
  match = path.match(/^\/jobs\/([0-9a-f-]{36})(?:\/(status|events|cancel|retry|file|review))?$/i)
  if (match) {
    const job = (await ownedJob(db, auth.userId, match[1]))
    if (method === 'POST' && ['cancel', 'retry'].includes(match[2])) { await changeJob(db, auth.userId, job.id, match[2]); redirect(res, `/jobs/${job.id}`) }
    else if (method === 'POST' && match[2] === 'review') {
      // Only a child at the device answers; a parent-unlocked page never records learner evidence here.
      if (auth.parentUnlocked) { json(403, { error: 'Review questions are answered by the learner.' }); return true }
      const outcome = await answerWaitingReview(db, auth.userId, job, String(data.answer ?? ''), String(data.ref ?? ''))
      redirect(res, `/jobs/${job.id}${outcome === 'reask' ? '?review=reask' : ''}#review`)
    }
    else if (method === 'GET' && match[2] === 'file') {
      if (job.kind !== 'pdf' || job.status !== 'succeeded') throw new UserError('PDF is not ready.')
      const { readFileSync } = await import('node:fs'), { join } = await import('node:path')
      res.setHeader('Content-Disposition', 'attachment; filename="practice.pdf"')
      const result = JSON.parse(job.result || '{}')
      const path = result.storedPath || join(options.uploadsDir, auth.userId, `${job.id}.pdf`)
      send(res, 200, 'application/pdf', await readPrivateFile(path, options.uploadsDir))
    }
    else if (method === 'GET' && match[2] === 'status') json(200, jobStatus(job))
    else if (method === 'GET' && match[2] === 'events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })
      const emit = async () => {
        const fresh = ((await awaitlessAuth(db, auth.id)))
        if (!fresh || !(await authorizeStudentPath(db, fresh, path, 'GET')) || await assessmentRestriction(db, fresh, path, 'GET')) { res.end(); return }
        try { res.write(`event: status\ndata: ${JSON.stringify(jobStatus((await ownedJob(db, auth.userId, job.id))))}\n\n: heartbeat\n\n`) } catch { res.end() }
      }
      await emit()
      // Serverless PostgreSQL status responses release their pool connection
      // immediately. EventSource reconnects; the existing polling also recovers.
      if ('dialect' in db) { res.end(); return true }
      let busy = false
      const timer = setInterval(() => {
        if (busy) return
        busy = true
        void emit().catch(() => res.end()).finally(() => { busy = false })
      }, 2000)
      const expiry = setTimeout(() => res.end(), 25000)
      const cleanup = () => { clearInterval(timer); clearTimeout(expiry) }
      res.once('close', cleanup); res.once('finish', cleanup)
    } else if (method === 'GET' && !match[2]) {
      let nugget: {title:string;recall:string}|undefined
      if(job.student_id && ['talk','curriculum','planner','school_path','lesson','fresh_practice','pack'].includes(job.kind)) {
        const source=JSON.parse(job.payload)
        const independent=source.options?.mode==='assessment' || (source.sessionId ? (await getOwnedSession(db,auth.userId,source.sessionId)).mode==='assessment' && (await sessionItems(db,source.sessionId)).some(i=>i.answered===0) : false)
        if(!independent) {
          const next=await nextLearningAction(db,auth.userId,job.student_id)
          const concept=(await studentConcepts(db,auth.userId,job.student_id)).find(c=>c.conceptId===(source.input?.concept?.conceptId ?? next?.conceptId))
          if(concept) nugget={title:concept.title,recall:concept.recall}
        }
      }
      // A child at the device may answer one due review while new work is prepared.
      const childAtDevice = !auth.parentUnlocked
      const review = await waitingReview(db, auth.userId, job, childAtDevice, url.searchParams.get('review') === 'reask').catch(() => null)
      html(res,'Mission progress',jobPage(job,nugget,review),csrf)
    }
    else return false
    return true
  }
  return false
}
async function awaitlessAuth(db: DatabaseSync, id: string): Promise<Auth | null> {
  const row = (await db.prepare('SELECT * FROM auth_sessions WHERE id = ? AND expires_at > ?').get(id, new Date().toISOString()))
  return row ? { studentOnly:row.student_only===1, id, userId: String(row.user_id), csrf: String(row.csrf_token), selectedStudent: row.selected_student as string | null, parentUnlocked: row.student_only!==1 && Boolean(row.parent_unlocked_until && String(row.parent_unlocked_until) > new Date().toISOString()) } : null
}
