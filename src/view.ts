import { REVIEW_LABELS } from './turn-state.ts'
import { BAND_LABEL, OWNERSHIP, bandOf, OWNERSHIP_LABEL, ladderSummary, type Band, type ConceptLadder } from "./engine/ladder.ts"
import { measuredSkill } from "./engine/access.ts"
import type { Gain } from "./engine/gain.ts"
import { siteFooter } from "./legal.ts"
import { manipulative } from "./manipulatives.ts"
import { mathPicture } from "./visuals.ts"
import { childAnswer, childReasonText } from "./child-words.ts"
import type { feedbackState } from './session-feedback.ts'
import { microphoneControls } from './media-view.ts'
import { plannerHref } from './planner-href.ts'
import { gradeLabel, nextGradeChange } from "./engine/grade.ts"
import { bloomLabel, conceptTitle } from "./services.ts"
import { BLOOM_NAME } from "./engine/types.ts"
import type { Scoreboard } from "./engine/scoreboard.ts"
import { TEACHING_ROUTE, type ApprovedTeaching } from './engine/teaching.ts'
import type { Scaffold } from './engine/scaffolds.ts'

export function page(title: string, body: string, csrf: string, extras = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(title)} · Tutor</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <!-- THESIS: every mission is an instruction booklet; refuses the soft pastel learning-app card stack.
  OWN-WORLD: white pages, 2px ink outlines, primary bricks (yellow together, blue on your own, green go and look back), grey parts boxes, Lexend with Archivo Black numerals.
  STORY: the child sees one numbered build, does two steps together and the rest alone; the parent sees what was built alone and what needs them.
  FIRST VIEWPORT: greeting, the mission box with its title, the numbered brick plan and one green Let's go brick; tabs at the bottom on phones.
  FORM: building-instruction booklet, first on the ordered list, seed 943765c2.
  FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance -->
  <a class="skip" href="#main">Skip to work</a>
  <header class="top">
    <a class="mark" href="/students"><span class="mark-brick" aria-hidden="true"></span>bubble</a>
  </header>
  <main id="main">${body}</main>
  ${siteFooter()}
  ${extras}
  <input type="hidden" id="csrf-store" value="${esc(csrf)}">
  <script src="/job-watch.js"></script>
  <script src="/session.js"></script>
  <script src="/journey.js"></script>
  <script src="/pack-ask.js"></script>
  <script src="/manipulatives.js"></script>${extras ? '\n  <script src="/planner-drawer.js"></script>' : ""}
</body>
</html>`
}

/** Bloop, drawn in the current world's style; the pose follows the moment (wave, think, cheer, oops). */
export function companion(pose: "wave" | "think" | "cheer" | "oops" = "wave") {
  return `<span class="companion" data-pose="${pose}" aria-hidden="true"></span>`
}

export function homePage(error = ""): string {
  return `
  <div class="auth">
    <section class="auth-intro">
      <h1>Small missions, built one step at a time.</h1>
      <p class="lede">Practice that follows your child’s real classes. A topic only counts as learned when they solve it on their own.</p>
      <ol class="auth-steps">
        <li><b>1</b><span>Add your child and their classes.</span></li>
        <li><b>2</b><span>They do a short mission: one step together, then on their own.</span></li>
        <li><b>3</b><span>You see what they built alone, and what needs you.</span></li>
      </ol>
    </section>
    <section class="auth-forms">
      <p class="student-door">Are you the learner? <a class="button ghost" href="/student-login">Student sign-in</a></p>
      ${error ? `<p class="banner" role="alert">${esc(error)}</p>` : ""}
      <form method="post" action="/login" class="panel">
        <h2>Parent sign-in</h2>
        ${csrfField()}
        <label>Email <input name="email" type="email" autocomplete="username" required></label>
        <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
        <button type="submit">Enter</button><p><a href="/account/recover">Forgot your password?</a></p>
      </form>
      <details class="setup">
        <summary>Create an account</summary>
        <form method="post" action="/register" class="panel">
          <h2>Create the parent account</h2>
          ${csrfField()}
          <label>Email <input name="email" type="email" autocomplete="username" required></label>
          <label>Password <input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
          <p class="fine">At least 10 characters. Students do not get their own passwords.</p>
          <p class="fine">By creating an account you confirm you are the child’s parent or guardian and agree to the <a href="/privacy">privacy notice</a> and <a href="/terms">terms</a>.</p>
          <button type="submit">Create account</button>
        </form>
      </details>
    </section>
  </div>`
}

export function studentsPage(
  students: Array<{ id: string; display_name: string; grade: number; session_cap_minutes: number; birth_date: string | null }>,
  error = "",
): string {
  const rows = students.length
    ? students
        .map(
          (student) => `<tr>
            <td><a href="/students/${esc(student.id)}">${esc(student.display_name)}</a><form action="/parent/lock" method="post">${csrfField()}<input type="hidden" name="studentId" value="${esc(student.id)}"><button type="submit" class="ghost">Enter student mode</button></form></td>
            <td>${esc(gradeLabel(student.grade))}</td>
            <td>${student.birth_date ? esc(student.birth_date) : "Not set"}</td>
            <td>${student.session_cap_minutes} min</td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="4">No students yet. Add the first one.</td></tr>`
  return `
  <div class="section-head">
    <h1>Family</h1>
    <div class="links">
      <a href="/family/progress">Family progress</a><a href="/settings">AI connection</a>
      <form method="post" action="/logout">${csrfField()}<button class="ghost" type="submit">Sign out</button></form>
    </div>
  </div>
  <p>Choose a student to continue, or add your first student below. Use AI connection for photo help, written responses and class planning.</p>
  ${error ? `<p class="banner" role="alert">${esc(error)}</p>` : ""}
  <table class="gradebook">
    <thead><tr><th>Name</th><th>Grade</th><th>Birthday</th><th>Practice limit</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <form method="post" action="/students" class="panel">
    <h2>Add a student</h2>
    <p class="fine">The grade follows the birthday using a September 1 cutoff, the Georgia rule. It moves up on the next September 1.</p>
    ${csrfField()}
    <label>Name <input name="displayName" required maxlength="80"></label>
    <label>Birthday <input name="birthDate" type="date" required></label>
    <label class="check"><input type="checkbox" name="gradeHold" value="1"> Hold a different grade (a skip or a repeat)</label>
    <label>Grade to hold
      <select name="grade">${gradeOptions(6)}</select>
    </label>
    <label>Session cap in minutes <input name="sessionCapMinutes" type="number" min="3" max="25" value="25"></label>
    <button type="submit">Add student</button>
  </form>`
}

export function studentPage(input: {
  student: {
    id: string
    display_name: string
    grade: number
    session_cap_minutes: number
    birth_date: string | null
    grade_hold: number
  }
  today: Date
  states: Array<{ conceptId: string; status: string; bloomLevel: number; mastery: number; nextDue: string }>
  concepts: Array<{ conceptId: string; title: string; grade: number; subject: string }>
  menu: {
    ageGrade: number
    courseLabel: string
    mathCourse: string
    subjects: string[]
    nextFocus: string[]
    groups: Array<{ subject: string; topics: Array<{ title: string; strength: string }> }>
  }
  added: {
    topics: Array<{
      conceptId: string
      subject: string
      title: string
      purpose: string
      problems: Array<{ id: string; prompt: string; answer: string; used: boolean }>
    }>
    extras: Array<{ conceptId: string; title: string; problems: Array<{ id: string; prompt: string; answer: string; used: boolean }> }>
  }
  error?: string
  notice?: string
  plans?: Array<{ subject: string; about: string; syllabus_name: string; build_status?: string; build_note?: string; agenda?: string }>
  live?: string
  nextAction?: { conceptId: string; title: string; subject: string; reason: string; retentionEstimate: number | null } | null
  talk?: {
    subject: string
    open?: boolean
    speak?: boolean
    messages: Array<{ role: string; body: string; proposal: string }>
    threads?: string[]
    say?: string
  }
}): string {
  const byId = new Map(input.concepts.map((concept) => [concept.conceptId, concept]))
  const live = input.states.filter((state) => state.status !== "mastered")
  const mastered = input.states.filter((state) => state.status === "mastered")
  const options = input.concepts
    .map(
      (concept) =>
        `<option value="${esc(concept.conceptId)}">${esc(concept.subject)} · ${esc(concept.title)}</option>`,
    )
    .join("")
  const checks = input.concepts
    .map(
      (concept) =>
        `<label class="check"><input type="checkbox" name="conceptIds" value="${esc(concept.conceptId)}"> ${esc(concept.subject)} · ${esc(concept.title)}</label>`,
    )
    .join("")
  const gradeNote = input.student.birth_date
    ? input.student.grade_hold
      ? `${gradeLabel(input.student.grade)} is held. The birthday would move it on its own.`
      : `${gradeLabel(input.student.grade)} comes from the birthday. Next automatic change: ${nextGradeChange(input.today)}.`
    : `${gradeLabel(input.student.grade)} is set by hand. Add a birthday to let it move on September 1.`
  return `
  <section id="learning-plan" class="learning-plan">
  <div class="section-head">
    <h2>Learning plan for ${esc(input.student.display_name)}</h2>
    <p class="fine">${esc(gradeLabel(input.student.grade))} · ${esc(input.menu.courseLabel)}</p>
  </div>
  ${input.menu.nextFocus.length ? `<p class="banner">Next set leans on ${esc(input.menu.nextFocus.join(", "))}.</p>` : ""}
  ${input.error ? `<p class="banner" role="alert">${esc(input.error)}</p>` : ""}
  ${input.notice ? `<p class="ok">${esc(input.notice)}</p>` : ""}
  ${input.nextAction ? `<section class="panel">
    <h2>${esc(input.nextAction.title)}</h2>
    <p>${esc(input.nextAction.reason)}</p>
    <form method="post" action="/students/${esc(input.student.id)}/session">
      ${csrfField()}<input type="hidden" name="subject" value="${esc(input.nextAction.subject)}">
      <input type="hidden" name="focusConceptId" value="${esc(input.nextAction.conceptId)}">
      <input type="hidden" name="intent" value="practice">
      <button name="mode" value="session" type="submit">Practice</button>
      <button name="mode" value="assessment" type="submit" class="ghost">Skip the lesson · take a check</button>
    </form>
    <p><a href="${esc(plannerHref(input.student.id, `Something else instead of ${input.nextAction.title}: `))}" data-planner-prefill="Something else instead of ${esc(input.nextAction.title)}: ">Choose something else</a></p>
    <details><summary>A test coming up?</summary>
      <form method="post" action="/students/${esc(input.student.id)}/targets">
        ${csrfField()}<label>Test topic <input name="title" required></label>
        <label>Test date <input name="deadline" type="date" required></label>
        <label>What it covers <select name="conceptIds">${input.concepts.map((node) => `<option value="${esc(node.conceptId)}" ${node.conceptId === input.nextAction!.conceptId ? "selected" : ""}>${esc(node.title)}</option>`).join("")}</select></label>
        <button type="submit">Focus on this test</button>
      </form>
    </details>
  </section>` : ""}
  <div class="tabs" data-progress-url="/students/${esc(input.student.id)}/progress"${input.live ? ` data-live="${esc(input.live)}"` : ""}>
    <input type="radio" name="student-tab" id="tab-topics" checked>
    <input type="radio" name="student-tab" id="tab-record">
    <div class="tabbar">
      <label for="tab-topics">Classes</label>
      <label for="tab-record">Student details</label>
    </div>
    <section class="tab" id="panel-topics">
      <p class="fine">Each class is one subject with its own topics. Its <strong>next focus</strong> is what the coming homework and check will work on, written from the latest results.</p>
      ${subjectMenu(input.student.id, input.menu, input.plans ?? [])}
    </section>
    <section class="tab" id="panel-record">
    <p class="links">
      <a href="/students/${esc(input.student.id)}/scoreboard">This week</a>
      <a href="/students/${esc(input.student.id)}/history">Decisions and history</a>
      <form method="post" action="/students/${esc(input.student.id)}/sheet">${csrfField()}<button class="ghost" type="submit">Print</button></form>
    </p>
  <form method="post" action="/students/${esc(input.student.id)}/profile" class="panel">
    <h2>Birthday and grade</h2>
    ${csrfField()}
    <label>Birthday <input name="birthDate" type="date" value="${esc(input.student.birth_date ?? "")}"></label>
    <label class="check"><input type="checkbox" name="gradeHold" value="1" ${input.student.grade_hold ? "checked" : ""}> Hold a different grade</label>
    <label>Grade to hold <select name="grade">${gradeOptions(input.student.grade)}</select></label>
    <button type="submit">Save</button>
  </form>
  <details>
    <summary>Math list for this grade (${live.length} still open, ${mastered.length} mastered)</summary>
    <h2>Still open</h2>
    ${conceptTable(live, byId)}
    <h2>Mastered</h2>
    ${conceptTable(mastered, byId)}
  </details>
  <form method="post" action="/students/${esc(input.student.id)}/targets" class="panel">
    <h2>A test coming up</h2>
    <p class="fine">A test date outranks the year plan until that date. Curiosity stays in the background.</p>
    ${csrfField()}
    <label>Test name <input name="title" required placeholder="Friday quiz"></label>
    <label>Deadline <input name="deadline" type="date"></label>
    <label class="check"><input type="checkbox" name="curiosity" value="1"> Curiosity, no deadline</label>
    <div class="checks">${checks}</div>
    <button type="submit">Focus on this test</button>
  </form>
  <p class="fine">${esc(gradeNote)}</p>
    </section>
  </div></section>`
}

export function schoolScoreHref(studentId: string, subject = '') {
  const selected = subject.trim().slice(0, 100)
  return `/students/${encodeURIComponent(studentId)}/school${selected && selected.toLowerCase() !== 'new' ? `?subject=${encodeURIComponent(selected)}` : ''}#school-results`
}

function classSchoolLinks(studentId: string, subject: string) {
  const selected = subject.trim().slice(0, 100)
  const query = selected && selected.toLowerCase() !== 'new' ? `?subject=${encodeURIComponent(selected)}` : ''
  return `<a class="button ghost" href="/students/${esc(studentId)}/materials/new${query}">Add homework</a><a class="button ghost" href="${esc(schoolScoreHref(studentId, selected))}">Record school score</a>`
}


const MANAGE_USAGE = "https://chatgpt.com/settings/usage"

function chatgptSection(input: { provider: string; model: string; photoModel?: string; chatgpt?: { email: string; reconnect: boolean; welcomed: boolean } | null; chatgptModels?: Array<{ slug: string; name: string }> }) {
  const start = `<form method="post" action="/connections/chatgpt">${csrfField()}<button type="submit" class="chatgpt-button">Continue with ChatGPT</button></form>`
  const connected = input.provider === "chatgpt" && input.chatgpt
  if (!connected) return `<section class="connection-options chatgpt-plan"><h2>Use your ChatGPT plan</h2><p>Complete AI requests in bubble with usage included in your ChatGPT Plus or Pro plan or credits balance. This is separate from API-key billing, and bubble never sees your ChatGPT conversations.</p>${start}</section>`
  if (input.chatgpt!.reconnect) return `<section class="connection-options chatgpt-plan"><h2>Use your ChatGPT plan</h2><p class="banner" role="alert">ChatGPT needs to be connected again before AI help can run.</p>${start}</section>`
  const models = input.chatgptModels ?? []
  const choose = (name: string, label: string, value: string) => `<label>${label}<select name="${name}">${models.map((model) => `<option value="${esc(model.slug)}" ${value === model.slug ? "selected" : ""}>${esc(model.name)}</option>`).join("")}</select></label>`
  const picker = models.length
    ? `<form method="post" action="/connections/chatgpt/models" class="panel">${csrfField()}${choose("model", "Text model", input.model)}${choose("photoModel", "Photo model", input.photoModel || input.model)}<p class="fine">These are the models your ChatGPT account offers. Photos need a model that reads images.</p><button type="submit">Save ChatGPT models</button></form>`
    : `<p class="fine">ChatGPT models could not load right now${input.model ? `; bubble keeps using ${esc(input.model)}` : ""}. Refresh this page to try again.</p>`
  const welcome = input.chatgpt!.welcomed ? "" : `<section class="chatgpt-welcome" role="dialog" aria-labelledby="chatgpt-welcome-title"><h2 id="chatgpt-welcome-title">You're using your ChatGPT plan</h2><p>Eligible AI requests in bubble now use your ChatGPT plan. You can review usage and set limits in ChatGPT settings.</p><form method="post" action="/connections/chatgpt/welcome">${csrfField()}<button type="submit">Got it</button></form></section>`
  return `${welcome}<section class="connection-options chatgpt-plan"><h2>Using ChatGPT plan</h2><p>Connected${input.chatgpt!.email ? ` as ${esc(input.chatgpt!.email)}` : ""}. Checks, hints, planning and photo reading use your ChatGPT plan. <a href="${MANAGE_USAGE}" target="_blank" rel="noopener noreferrer">Manage usage</a></p>${picker}<p class="fine">To use another ChatGPT account, choose Continue with ChatGPT again.</p>${start}</section>`
}

export function settingsPage(input: { provider: string; model: string; photoModel?: string; hasKey: boolean; studentId?: string | null; notice?: string; error?: string; chatgptAvailable?: boolean; chatgpt?: { email: string; reconnect: boolean; welcomed: boolean } | null; chatgptModels?: Array<{ slug: string; name: string }> }): string {
  const usingChatgpt = input.chatgptAvailable && input.provider === "chatgpt" && input.hasKey && Boolean(input.chatgpt) && !input.chatgpt?.reconnect
  const options = [
    ...(usingChatgpt ? [["chatgpt", "ChatGPT plan"]] : []),
    ...(process.env.TUTOR_PUBLIC !== "1" && process.env.TUTOR_CODEX_LOCAL === "1" ? [["codex", "Codex · ChatGPT subscription on this computer"]] : []),
    ...(process.env.TUTOR_PUBLIC === "1" ? [] : [["grok", "Grok signed in on this computer"], ["claude", "Claude signed in on this computer"]]),
    ["openrouter", "OpenRouter"],
    ["xai", "An xAI API key"],
    ["openai", "An OpenAI API key"],
    ["anthropic", "An Anthropic API key"],
  ]
  return `
  <p class="links"><a href="/students">Family</a>${input.studentId ? `<a href="/students/${esc(input.studentId)}/parent">Back to parent area</a>` : ''}</p>
    <h1>AI connection</h1><p><a class="button" href="/welcome/ai?next=%2Fsettings">Quick connect</a> <span class="fine">Paste any key or connect in one tap.</span></p>
  <p class="lede">Connect AI for photo help, written responses and class planning. Short practice missions can start without it. Your chosen AI receives the relevant questions, learning history and pages when you ask for help. Saved keys are encrypted.</p>
  <p class="connection-status" role="status">${input.provider === "chatgpt" && input.chatgpt?.reconnect ? "ChatGPT needs to be connected again." : usingChatgpt ? `Using ChatGPT plan. <a href="${MANAGE_USAGE}" target="_blank" rel="noopener noreferrer">Manage usage</a>` : input.hasKey ? `A credential is saved for ${esc(input.provider)}. ${input.provider === 'openrouter' && !input.model ? 'Choose a text model below before using AI.' : 'Saving a connection does not check whether it works.'}` : input.provider === 'codex' ? 'Using this computer’s Codex ChatGPT sign-in for local text testing. No API key is needed.' : 'No API connection saved. Connect an account or add your own API key below.'}</p>
  ${input.error ? `<p class="banner" role="alert">${esc(input.error)}</p>` : ""}
  ${input.notice ? `<p class="ok">${esc(input.notice)}</p>` : ""}
  ${input.chatgptAvailable ? chatgptSection(input) : ""}
  <section class="connection-options"><h2>Connect an account</h2><p>OpenRouter lets you sign in and approve access in your browser. It has its own balance and model choices.</p><form method="post" action="/connections/openrouter">${csrfField()}<button type="submit">Connect OpenRouter</button></form><p class="fine">${input.chatgptAvailable ? "" : "Hosted ChatGPT subscription connection awaits approval."}${process.env.TUTOR_CODEX_LOCAL === '1' && process.env.TUTOR_PUBLIC !== '1' ? ' For local text testing, choose Codex below to use this computer’s existing ChatGPT sign-in. Photos need a transcription with this connection.' : ''} An OpenAI API key uses separate API billing. Claude and Grok API connections also use their provider’s API billing.</p></section>
  <form method="post" action="/settings" class="panel">
    <h2>Choose models or use an API key</h2>
    ${csrfField()}
    <label>Which AI
      <select name="provider">
        ${options.map(([value, label]) => `<option value="${value}" ${input.provider === value ? "selected" : ""}>${esc(label)}</option>`).join("")}
      </select>
    </label>
    <label>Text model <input name="model" value="${esc(input.model)}" placeholder="Exact model identifier"></label><p class="fine">OpenRouter needs the full model identifier from its catalog. Direct API providers and local Codex can use their default when this is blank.</p>
    <label>Photo-capable model from this provider<input name="photoModel" value="${esc(input.photoModel ?? "")}" placeholder="Enter the exact model identifier"></label><p class="fine">If photos are unsupported or unavailable, type a transcription. The tutor never silently switches providers.</p>
    <label>API key ${usingChatgpt ? "<span class=\"fine\">ChatGPT needs no key. Paste a key only when switching to another AI above.</span>" : input.hasKey ? "<span class=\"fine\">A key is already saved. Leave this blank to keep it.</span>" : ""}
      <input name="apiKey" type="password" autocomplete="off" placeholder="${usingChatgpt ? "Not needed for ChatGPT" : input.hasKey ? "•••• saved" : "Paste your provider’s API key"}">
    </label>
    <button type="submit">Save AI</button>
  </form><form method="post" action="/connections/disconnect">${csrfField()}<button type="submit" class="ghost">Disconnect AI</button></form>`
}

function strengthLevel(word: string) {
  if (word === "Solid") return "4"
  if (word === "Getting there") return "3"
  if (word === "Shaky") return "2"
  if (word === "Needs more work") return "1"
  return "0"
}

function nextStepChooser(summary: { studentId: string; subject?: string; next: { conceptId: string; subject: string; title: string; reason?: string; checkGoal?: string | null; checkLabel?: string | null } | null; review?: { conceptId: string; subject: string; title: string } | null }) {
  const start = (label: string, subject: string, conceptId: string, goal: string, primary: boolean, note: string, assessment = false) =>
    `<form method="post" action="/students/${esc(summary.studentId)}/session" class="next-step">${csrfField()}<input type="hidden" name="subject" value="${esc(subject)}"><input type="hidden" name="focusConceptId" value="${esc(conceptId)}"><input type="hidden" name="intent" value="practice">${goal ? `<input type="hidden" name="goal" value="${esc(goal)}">` : ""}${assessment ? '<input type="hidden" name="mode" value="assessment">' : ''}<button type="submit" ${primary ? "" : 'class="ghost"'}>${label}</button><small>${esc(note)}</small></form>`
  // A planned finish is a good place to stop: Done comes first, with one optional next step; other paths wait behind a tap.
  const more: string[] = []
  if (summary.next) more.push(start(summary.next.checkLabel ? esc(summary.next.checkLabel) : `Next mission: ${esc(summary.next.title)}`, summary.next.subject, summary.next.conceptId, summary.next.checkGoal ?? "", false, summary.next.reason || "Recommended from your work so far.", Boolean(summary.next.checkGoal)))
  if (summary.review) more.push(start(`Quick review: ${esc(summary.review.title)}`, summary.review.subject, summary.review.conceptId, "delayed_review", false, "A short recall check that is due today."))
  if (summary.subject) more.push(start(`One more round of ${esc(summary.subject)}`, summary.subject, "", "", false, "Fresh questions on this class."))
  more.push(`<div class="next-step"><a class="button ghost" href="/students/${esc(summary.studentId)}/map">Explore a different topic</a><small>Pick any bubble on your map.</small></div>`)
  const [optional, ...rest] = more
  const done = `<div class="next-step done-today"><a class="button" href="/students/${esc(summary.studentId)}?notice=${encodeURIComponent("All done for today. Your work is saved.")}">Done for today</a><small>Your work is saved.</small></div>`
  return `<section class="next-steps" aria-labelledby="next-steps-title"><h2 id="next-steps-title">Mission complete</h2><div class="next-step-grid">${done}${optional}</div>${rest.length ? `<details class="more-paths"><summary>Other things to do</summary><div class="next-step-grid">${rest.join("")}</div></details>` : ""}</section>`
}

function classStatus(plan: { build_status?: string } | undefined, topicCount: number) {
  if (plan?.build_status === "building") return ["building", "Building"]
  if (plan?.build_status === "failed") return ["failed", "Needs attention"]
  if (!topicCount) return ["empty", "No topics yet"]
  return ["ready", "Ready"]
}

function addClassCard(studentId: string) {
  return `<section class="class-card add-class" aria-labelledby="add-class-title">
    <div class="class-head"><h2 id="add-class-title">Add a class</h2><span class="class-status" data-status="new">3 steps</span></div>
    <ol class="steps"><li><strong>Describe it.</strong> Name the class and say what it should cover.</li><li><strong>Check the plan.</strong> The planner writes a short topic list back to you.</li><li><strong>Build it.</strong> Press Build, and lessons and questions are written.</li></ol>
    <form method="post" action="/students/${esc(studentId)}/planner/message" class="add-class-form" data-planner-compose data-fetch>
      ${csrfField()}
      <input type="hidden" name="source" value="add_class">
      <label>Class name <input name="title" maxlength="80" placeholder="Biology" required></label>
      <label>What should it cover? <textarea name="message" required placeholder="Cells, energy, and reading one graph."></textarea></label>
      <button type="submit">Start the plan</button>
    </form>
    <p class="fine">Nothing is built until you approve the plan.</p>
  </section>`
}

function subjectMenu(
  studentId: string,
  menu: { groups: Array<{ subject: string; topics: Array<{ title: string; strength: string }> }> },
  plans: Array<{ subject: string; build_status?: string; build_note?: string; agenda?: string }>,
) {
  return menu.groups
    .map((group) => {
      const plan = plans.find((item) => item.subject.toLowerCase() === group.subject.toLowerCase())
      const building = plan?.build_status === "building"
      const failed = plan?.build_status === "failed"
      const status = building
        ? `<p class="working"><i></i> ${group.topics.length ? "Writing the questions. The topics and mastery are already here." : "Building the curriculum. Topics and mastery will show here when it is ready."}</p>`
        : failed
          ? `<p class="banner">${esc(plan?.build_note || "The curriculum did not build. Tell the planner what to change.")}</p>`
          : ""
      const rows = group.topics.length
        ? `<table class="gradebook"><thead><tr><th>Topic</th><th>Mastery</th></tr></thead><tbody>${group.topics
            .map((topic) => `<tr><td>${esc(topic.title)}</td><td class="strength" data-strength="${strengthLevel(topic.strength)}" aria-label="${esc(topic.strength)}">${esc(topic.strength)}</td></tr>`)
            .join("")}</tbody></table>`
        : building
          ? ""
          : `<p class="fine">No topics yet. Tell the planner what this class should cover.</p>`
      const [statusKey, statusLabel] = classStatus(plan, group.topics.length)
      const solid = group.topics.filter((topic) => topic.strength === "Solid").length
      const summary = group.topics.length ? `${solid} of ${group.topics.length} topics solid` : ""
      const focus = plan?.agenda
        ? `<div class="next-focus"><h3>Next focus for this class</h3><p>${esc(plan.agenda)}</p><p class="fine">Written from the latest results. Homework and the next check follow it.</p></div>`
        : group.topics.length ? `<div class="next-focus muted"><h3>Next focus for this class</h3><p>Appears after the first check or homework. Until then the next mission follows the topic order.</p></div>` : ""
      return `<section class="class-card subject" aria-labelledby="class-${esc(group.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}">
        <div class="class-head">
          <h2 id="class-${esc(group.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}">${esc(group.subject)}</h2>
          <span class="class-status" data-status="${statusKey}">${statusLabel}${summary ? ` · ${summary}` : ""}</span>
        </div>
        ${status}
        ${focus}
        <div class="class-actions">
          <form method="post" action="/students/${esc(studentId)}/session">${csrfField()}<input type="hidden" name="mode" value="assessment"><input type="hidden" name="subject" value="${esc(group.subject)}"><button type="submit">Start a check</button></form>
          <form method="post" action="/students/${esc(studentId)}/session">${csrfField()}<input type="hidden" name="mode" value="homework"><input type="hidden" name="subject" value="${esc(group.subject)}"><button class="ghost" type="submit">Homework</button></form>
          ${classSchoolLinks(studentId, group.subject)}
          <a class="button ghost" href="${esc(plannerHref(studentId, `Change the ${group.subject} class: `))}" data-planner-prefill="Change the ${esc(group.subject)} class: ">Change this class</a>
        </div>
        ${rows ? `<details class="class-topics" ${group.topics.length <= 6 ? "open" : ""}><summary>Topics and mastery</summary>${rows}</details>` : ""}
      </section>`
    })
    .join("") + addClassCard(studentId)
}

function addedLibrary(
  studentId: string,
  added: {
    topics: Array<{
      conceptId: string
      subject: string
      title: string
      purpose: string
      problems: Array<{ id: string; prompt: string; answer: string; used: boolean }>
    }>
    extras: Array<{ conceptId: string; title: string; problems: Array<{ id: string; prompt: string; answer: string; used: boolean }> }>
  },
) {
  const topicCards = added.topics.map((topic) => topicCard(studentId, topic)).join("")
  const extraCards = added.extras
    .map((topic) => topicCard(studentId, { ...topic, subject: "Added problems", purpose: "practice" }, false))
    .join("")
  if (!topicCards && !extraCards) return `<p class="fine">No topics yet. Plan a subject and the model will write them.</p>`
  return topicCards + extraCards
}

function topicCard(
  studentId: string,
  topic: {
    conceptId: string
    subject: string
    title: string
    purpose: string
    problems: Array<{ id: string; prompt: string; answer: string; used: boolean }>
  },
  removable = true,
) {
  const problems = `<p class="fine">${topic.problems.length ? `${topic.problems.length} generated ${topic.problems.length === 1 ? "question" : "questions"}, hidden until the work.` : "Questions are written when the plan or a new test comes in."}</p>`
  const remove = removable
    ? `<form method="post" action="/students/${esc(studentId)}/remove-topic">${csrfField()}
        <input type="hidden" name="conceptId" value="${esc(topic.conceptId)}">
        <button class="ghost" type="submit">Remove topic</button>
      </form>`
    : ""
  const place = topic.purpose === "special" ? "Learn this next" : topic.purpose === "year" ? "In this year's plan" : "Extra problems"
  return `<article class="panel">
    <div class="section-head"><h2>${esc(topic.subject)} · ${esc(topic.title)}</h2>${remove}</div>
    <p class="fine">${place}</p>
    ${problems}
  </article>`
}

function conceptTable(
  states: Array<{ conceptId: string; status: string; bloomLevel: number; mastery: number; nextDue: string }>,
  byId: Map<string, { title: string; subject: string }>,
) {
  if (!states.length) return "<p class='fine'>Nothing in this group.</p>"
  const rows = states
    .map((state) => {
      const concept = byId.get(state.conceptId)
      return `<tr>
        <td>${esc(concept?.subject ?? "math")}</td>
        <td>${esc(concept?.title ?? state.conceptId)}</td>
        <td><span class="status status-${esc(state.status)}">${esc(state.status.replace("_", " "))}</span></td>
        <td>${esc(bloomLabel(state.bloomLevel))}</td>
        <td class="num">${state.mastery.toFixed(2)}</td>
        <td class="num">${esc(state.nextDue)}</td>
      </tr>`
    })
    .join("")
  return `<div class="table-scroll"><table class="gradebook">
    <thead><tr><th>Subject</th><th>Concept</th><th>Status</th><th>Mastered through</th><th>Mastery</th><th>Next due</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`
}

function gradeOptions(selected: number) {
  return Array.from({ length: 13 }, (_, grade) => {
    const label = gradeLabel(grade)
    return `<option value="${grade}" ${grade === selected ? "selected" : ""}>${esc(label)}</option>`
  }).join("")
}

/** A child who thinks a check got it wrong can say so; a grown-up decides. */
function concernControl(sessionId: string, item: Record<string, unknown>) {
  if (item.disputed || item.concern === 'upheld') return `<p class="fine" data-concern="upheld">A grown-up agreed this check was wrong, so it doesn’t count.</p>`
  if (item.concern === 'open') return `<p class="fine" data-concern="open">Thanks for telling me. A grown-up will look at this one.</p>`
  if (item.concern === 'kept') return ''
  return `<form method="post" action="/session/${esc(sessionId)}/concern" class="concern">${csrfField()}<input type="hidden" name="itemId" value="${esc(String(item.id ?? ''))}"><button type="submit" class="linklike">I think there’s a mistake<span class="visually-hidden"> about ${esc(String(item.prompt ?? 'this answer'))}</span></button></form>`
}

export function sessionPage(input: {
  reviewStates?: Map<string, { state: import('./turn-state.ts').ReviewState; jobId?: string }>
  assessment?: { open: boolean; paused: boolean; unanswered: number }
  summary?: { independent: number; supported: number; unresolved: number; studentId: string; subject?: string; next: { conceptId: string; subject: string; title: string; reason?: string; checkGoal?: string | null; checkLabel?: string | null } | null; review?: { conceptId: string; subject: string; title: string } | null; mixedStatus?: { message: string; conceptId: string; subject: string; minutes: number | null } | null }
  sessionId: string
  continuity: string
  item: Record<string, unknown> | null
  position: number
  total: number
  beats?: string[]
  feedbackReview?: ReturnType<typeof feedbackState>
  feedback: { correct?: boolean; prompt?: string; corrective?: { label: string; move: string; why?: string; ask?: string; explain?: string; answer?: string } | null; action?: string; itemId?: string; count?: number; confidence?: string | null } | null
  onBreak: boolean
  ended: boolean
  capMinutes: number
  subject?: string
  titles?: Record<string, string>
  showHint?: boolean
  speak?: boolean
  lesson?: Array<{ role: string; body: string }>
  teacher?: { overt: string; subtle: string; trend: string; nextMove: string } | null
  results?: Array<{ title: string; prompt: string; answer: string; correct: boolean }>
  pendingReviews?: Array<Record<string, unknown>>
  band?: string
  /** The current question's own subject, when it differs from the mission's (reviews from other subjects). */
  itemSubject?: string
  /** No AI is connected: talking it through cannot work, so it is not offered. */
  /** WF-01: the child line for a lasting connection problem, shown where talk-through would be. */
  aiChildLine?: string
  aiMissing?: boolean
  /** Off in the weeks a parent's comparison turns the confidence choice off. */
  askSure?: boolean
  feedbackConceptId?: string
}): string {
  const junior=input.band==="5-7"
  const assessment = input.assessment
  if (assessment?.open) input = { ...input, feedback: null, feedbackReview: undefined, pendingReviews: [], results: [], lesson: [] }
  const finishCheck = assessment?.open ? `<details class="panel"><summary>Finish assessment early</summary><p>Submit the answers you have saved. Questions left blank will be marked unanswered. After feedback opens, this assessment cannot be resumed.</p><form method="post" action="/session/${esc(input.sessionId)}/finish">${csrfField()}<button type="submit" class="ghost">Finish assessment now</button></form></details>` : ''
  if (assessment?.open && assessment.paused) return `<h1>Assessment saved</h1><p>Your answers stay saved. Take a break, then continue the same questions. Help and results open when you finish the assessment.</p><form method="post" action="/session/${esc(input.sessionId)}/resume">${csrfField()}<button type="submit">Resume assessment</button></form>${finishCheck}`
  const feedbackReview=input.feedbackReview
  // The correction card below explains the item it belongs to, so that item's card does not repeat it.
  const fixFor=(i: Record<string, unknown>)=>Boolean(input.feedback?.corrective?.ask && input.feedback?.prompt && input.feedback.prompt===i.prompt)
  const entries=feedbackReview?.entries ?? []
  const pendingLine = (id: string) => {
    const review = input.reviewStates?.get(id)
    const label = review ? REVIEW_LABELS[review.state] : input.aiMissing ? REVIEW_LABELS.parent : REVIEW_LABELS.waiting
    return `${esc(label)}${review?.state === 'retry' && review.jobId ? ` <a href="/jobs/${esc(review.jobId)}">Try checking again</a>` : ''}`
  }
  const feedbackCards=entries.length ? `<section class="feedback-review" aria-label="Feedback on your work"><h2${feedbackReview?.checkpoint ? ' class="visually-hidden"' : ''}>${feedbackReview?.timing==='batch' ? 'Let’s look for a pattern' : 'Feedback on your last try'}</h2>${feedbackReview?.timing==='batch' ? `<p>${entries.filter(i=>i.correct===1).length} answers held; ${entries.filter(i=>i.correct===0).length} need another look. A shared miss is a clue to check, not a diagnosis.</p><p>The shared ideas: ${[...new Set(entries.map(i=>conceptTitle(String(i.concept_id),input.titles)))].map(esc).join(", ")}. Compare your approaches: what stayed the same, and what changed?</p>` : ''}${entries.map(i=>`<article class="${i.correct==null ? 'is-pending' : i.correct===1 ? 'is-right' : 'is-miss'}" data-item="${esc(String(i.id ?? ''))}">${i.correct===1 ? companion("cheer") : i.correct===0 ? companion("oops") : ''}<p class="verdict">${i.correct==null ? 'Awaiting review' : i.correct===1 ? 'Yes! That holds.' : 'Needs another look'}</p>${junior && i.correct===0 ? `<div class="say-this"><p>${esc(childReasonText(String(i.grading_reason ?? '')) || 'Not quite. Let’s look at it again.')}</p><button type="button" class="ghost" data-hear>Hear this</button></div>` : ''}<p>${esc(String(i.prompt))} <span class="fine">· ${esc(conceptTitle(String(i.concept_id),input.titles))}</span></p><p><strong>You answered:</strong> ${esc(String(i.given_answer ?? ''))}</p>${i.correct==null ? `<p>${pendingLine(String(i.id))} It will count only after it has been checked.</p>` : i.correct===1 ? '' : `${!junior && childReasonText(String(i.grading_reason ?? '')) ? `<p>${esc(childReasonText(String(i.grading_reason)))}</p>` : ''}${fixFor(i) ? '' : `<details class="show-how"><summary>Show me how</summary>${mathPicture(String(i.prompt))}<p><strong>The answer:</strong> ${esc(childAnswer(String(i.answer)))}</p></details>`}${concernControl(input.sessionId, i)}`}</article>`).join('')}</section>` : ''
  const fix=input.feedback?.corrective
  const correction=fix ? (fix.ask
    ? `<aside class="miss" role="status">${companion("oops")}<strong>${esc(fix.label)}</strong>${fix.why ? `<p>${esc(fix.why)}</p>` : ''}<div class="say-this"><p class="nudge">${esc(fix.ask)}</p>${junior ? '<button type="button" class="ghost" data-hear>Hear this</button>' : ''}</div><details class="show-how"><summary>Show me how</summary>${mathPicture(String(input.feedback?.prompt ?? ''))}${input.feedbackConceptId ? manipulative(input.feedbackConceptId, String(input.feedback?.prompt ?? '')) : ''}${fix.explain ? `<p>${esc(fix.explain)}</p>` : ''}<p><strong>The answer:</strong> ${esc(String(fix.answer ?? ''))}</p></details></aside>`
    : `<aside class="miss" role="status"><strong>${esc(fix.label)}</strong><p>${esc(fix.move)}</p></aside>`) : ''
  if(feedbackReview?.checkpoint && !input.ended) return `<h1>${feedbackReview.timing==='batch' ? 'Look back at these tries' : 'Let’s try a different approach'}</h1>${feedbackCards}${correction}${input.lesson?.length ? `<ol class="thread">${input.lesson.map(m=>`<li class="bubble ${m.role==='student'?'mine':''}"><p${input.speak && m===input.lesson?.filter(t=>t.role==='tutor').at(-1) ? ' data-say' : ''}>${esc(m.body)}</p>${m.role==='tutor' ? '<button type="button" class="ghost" data-hear>Hear that</button>' : ''}</li>`).join('')}</ol>` : ''}${input.aiMissing ? `<p class="fine" data-ai-talk-off>${esc(input.aiChildLine || 'Talking it through needs an AI connection. A grown-up can connect one.')}</p>` : `<details class="panel"><summary>Talk through this step</summary><p>${junior ? 'Stuck? Ask me. We’ll go one small step at a time.' : 'We’ll start with one small question, then give a hint or show the steps if you’re stuck. You can ask for an explanation or take a break.'}</p><form method="post" action="/session/${esc(input.sessionId)}/ask" class="talk">${csrfField()}<input type="hidden" name="voice" value="0"><label>Ask about this step<textarea name="message" required placeholder="Which part should I try first?"></textarea></label><button type="submit" class="ghost">Ask the tutor</button>${microphoneControls()}</form></details>`}<form method="post" action="/session/${esc(input.sessionId)}/feedback">${csrfField()}<button type="submit">Ready for a fresh question</button></form><p>Take a break whenever you need. Your answers stay saved.</p>`
  const review = (input.pendingReviews ?? []).map((item) => `
    <details class="panel"><summary>Parent review · ${esc(BLOOM_NAME[Number(item.bloom_level)] ?? "Written work")}</summary>
      <p>${pendingLine(String(item.id))} You can check the saved response yourself.</p>
      <p>${esc(String(item.prompt))}</p>
      <p><strong>Student response:</strong> ${esc(String(item.given_answer ?? ""))}</p>
      <p><strong>Key or rubric:</strong> ${esc(String(item.answer))}</p>
      <form method="post" action="/session/${esc(input.sessionId)}/review">
        ${csrfField()}<input type="hidden" name="itemId" value="${esc(String(item.id))}">
        <button name="verdict" value="success" type="submit">Meets the rubric</button>
        <button name="verdict" value="retry" class="ghost" type="submit">Needs more work</button>
      </form>
    </details>`).join("")
  const reviewNote = review ? `<p>${input.aiMissing ? 'These answers are saved for a grown-up to check.' : 'These answers are waiting for review.'} They will count only after they have been checked.</p>${review}` : ""
  if (input.ended || !input.item) {
    const results = breakdownList(input.results ?? [])
    const lesson = input.lesson ?? []
    const lastTutor = [...lesson].reverse().find((message) => message.role === "tutor")
    const thread = lesson
      .map((message, index) => {
        const mine = message.role === "student"
        const hear = !mine && message === lastTutor ? `<button type="button" class="ghost" data-hear>Hear that</button>` : ""
        const say = input.speak && message === lastTutor ? " data-say" : ""
        return `<li class="bubble ${mine ? "mine" : ""}"><p${say}>${esc(message.body)}</p>${hear}</li>`
      })
      .join("")
    const teacher = input.teacher
      ? `<details class="panel grown-ups"><summary>For grown-ups</summary>
      <p><strong>Overt.</strong> ${esc(input.teacher.overt)}</p>
      <p><strong>Quieter.</strong> ${esc(input.teacher.subtle)}</p>
      <p><strong>Over time.</strong> ${esc(input.teacher.trend)}</p>
      <p><strong>So they learn faster.</strong> ${esc(input.teacher.nextMove)}</p>
    </details>`
      : ""
    const nextSteps = input.summary ? nextStepChooser(input.summary) : ""
    return `
    <h1>${assessment ? 'Assessment complete' : 'Look what you did'}</h1>
    ${!assessment && input.summary?.mixedStatus ? `<p class="fine" data-mixed-pending>${esc(input.summary.mixedStatus.message)}</p>${input.summary.mixedStatus.minutes ? `<form method="post" action="/students/${esc(input.summary.studentId)}/session">${csrfField()}<input type="hidden" name="intent" value="practice"><input type="hidden" name="subject" value="${esc(input.summary.mixedStatus.subject)}"><input type="hidden" name="focusConceptId" value="${esc(input.summary.mixedStatus.conceptId)}"><input type="hidden" name="durationMinutes" value="${input.summary.mixedStatus.minutes}"><button type="submit" class="ghost">Five-minute practice</button></form>` : ''}` : ''}
    ${assessment?.unanswered ? `<p>${assessment.unanswered} ${assessment.unanswered === 1 ? 'question was' : 'questions were'} left unanswered. These are not graded as incorrect.</p>` : ''}
    ${input.summary ? `<p class="done-line">${missionLine(input.summary)}</p>` : ''}
    ${nextSteps}
    ${feedbackCards}${correction}
    ${assessment && entries.some(i => i.correct == null) ? `<p><a href="/session/${esc(input.sessionId)}">Refresh results</a> · You can leave this page; your answers are saved.</p>` : ''}
    ${input.aiMissing ? `<p class="fine" data-ai-talk-off>${esc(input.aiChildLine || 'Talking it through needs an AI connection. A grown-up can connect one.')}</p>` : `<h2>Want to talk it through?</h2>
    ${results ? `<ul class="breakdown">${results}</ul>` : ""}
    <ol class="thread">${thread}</ol>
    <form method="post" action="/session/${esc(input.sessionId)}/ask" class="talk">
      ${csrfField()}
      <input type="hidden" name="voice" value="0">
      <label>Ask about this
        <textarea name="message" required placeholder="Why does that step work?"></textarea>
      </label>
      <div class="links">
        <button type="submit" class="ghost">Send</button>
        ${microphoneControls()}
      </div>
    </form>
    <p class="fine">Only the words you send go to the AI connection on this account.</p>`}
    <details>
      <summary>Say it back, if you want</summary>
      <form method="post" action="/session/${esc(input.sessionId)}/recap" class="panel">
        ${csrfField()}
        <label>What did you learn? <textarea name="learned" required></textarea></label>
        <label>What was hard? <textarea name="hard" required></textarea></label>
        <label>What would you tell a friend who is stuck? <textarea name="tellFriend" required></textarea></label>
        <label class="check"><input type="checkbox" name="productionSuccess" value="1"> This recap explains the idea. Save it as reflection.</label>
        <button type="submit" class="ghost">Save recap and print tomorrow's sheet</button>
      </form>
    </details>
    ${teacher}${reviewNote}`
  }
  const beat = beatOf(String(input.item.beat ?? ""))
  const skill = measuredSkill(input.itemSubject ?? input.subject)
  const canRead = !assessment?.open || skill !== 'reading'
  const canSpeak = !assessment?.open || skill !== 'spelling'
  const helpLabel = input.item.beat === "guided" && Number(input.item.hints_used) === 1 ? "Let’s do this one together" : input.item.beat === "faded" && Number(input.item.hints_used) === 1 ? "A small clue" : `Hint ${esc(String(input.item.hints_used))}`
  const hint = !assessment?.open && input.item.hint_text ? `<aside class="hint"><p class="step-tag" data-beat="clue">${helpLabel}</p><div class="say-this"><p>${esc(String(input.item.hint_text))}</p>${input.band === "5-7" ? '<button type="button" class="ghost" data-hear>Hear this</button>' : ''}</div><p class="fine">This is practice with help. A fresh question later will show what you can do on your own.</p></aside>` : ""
  // A reply that was not a try is asked again kindly; a second one points to the hint, never the answer.
  const reask = input.feedback?.action === "reask" && input.feedback.itemId === String(input.item.id)
  const stuck = reask && Number(input.feedback?.count) >= 2 && !Number(input.item.hints_used)
  const reaskLine = reask
    ? `<aside class="reask" role="status"><p>${stuck ? "Stuck? Tap Hint for a clue, then have a go." : "Have a go. A guess is fine, and you can ask for a hint."}</p></aside>`
    : ""
  const feedback = input.feedback && !reask && input.feedback.action !== "reask"
    ? `<aside class="${input.feedback.correct ? "ok" : "miss"}" role="status">${
        input.feedback.correct
          ? `${companion("cheer")}<span class="yes-spark" aria-hidden="true"></span> Yes! That holds.`
          : `${esc(input.feedback.corrective?.label ?? "Look again")}. ${esc(input.feedback.corrective?.move ?? "")}`
      }${calibrationLine(input.feedback.correct === true, input.feedback.confidence)}</aside>`
    : ""
  const breakBlock = input.onBreak
    ? `<form method="post" action="/session/${esc(input.sessionId)}/continue" class="panel">${csrfField()}<h2>Take two minutes.</h2><p>Stand up, then come back to the same idea on a new surface.</p><button type="submit">Continue</button></form>`
    : ""
  return `
  ${assessment?.open ? '<p class="assessment-instructions">Try these questions on your own. Save each answer, or leave a question unanswered. Help and results open after you finish the whole assessment.</p>' : ''}
  <div class="stones-row"><ol class="stones" aria-label="Step ${input.position} of ${input.total}">${Array.from({ length: Math.max(1, input.total) }, (_, i) => `<li data-beat="${beatOf(input.beats?.[i]).key}" data-state="${i + 1 < input.position ? "done" : i + 1 === input.position ? "now" : "next"}"></li>`).join("")}</ol><p class="progress">${input.subject ? `${esc(input.subject)} · ` : ""}${input.position} of ${input.total}</p></div>
  ${feedbackCards || feedback}
  ${correction}
  ${reaskLine}
  ${feedbackReview?.timing === "waiting" ? '<p class="fine">Try this small batch independently. We will pause after three questions to look for patterns.</p>' : ""}
  ${breakBlock}
  <article class="prompt" ${input.band === "5-7" && canRead && skill !== "reading" ? "data-autoread" : ""}>
    <div class="step-head"><span class="step-number" aria-hidden="true">${input.position}</span><div><p class="step-tag" data-beat="${beat.key}">${beat.label}</p><h1>${esc(conceptTitle(String(input.item.concept_id), input.titles))}</h1></div></div>
    <p class="question-text">${esc(String(input.item.prompt))}</p>${canRead ? '<button type="button" class="ghost" data-hear>Read aloud</button>' : ''}${input.band === "5-7" && canRead && skill !== "reading" ? `<label class="check autoread-toggle"><input type="checkbox" data-autoread-toggle checked> Read questions to me</label>` : ""}
  </article>
  ${hint}
  <form method="post" action="/session/${esc(input.sessionId)}/answer" class="answer" data-started="${Date.now()}">
    ${csrfField()}
    <input type="hidden" name="itemId" value="${esc(String(input.item.id))}">
    <input type="hidden" name="revision" value="${esc(String(input.item.revision_id ?? ''))}">
    <input type="hidden" name="timeMs" value="0">
    <input type="hidden" name="activeMs" value="">
    ${answerField(input.item, Boolean(input.onBreak), canSpeak)}${beat.key === "own" && !input.onBreak && input.askSure !== false ? sureField() : ""}<button type="submit" ${stuck ? 'class="ghost"' : ""} ${input.onBreak ? "disabled" : ""}>${assessment?.open ? input.position === input.total ? 'Save and finish assessment' : 'Save and continue' : 'Check'}</button>
    ${assessment?.open ? '<button type="submit" name="skip" value="1" formnovalidate class="ghost">Leave unanswered</button>' : ''}
    <p class="fine" role="status" data-draft-status>${input.item.draft_answer ? 'Draft saved.' : ''}</p>
    <button type="button" class="ghost" data-retry-draft hidden>Try saving again</button>
    <details data-format-help><summary>How to enter an answer</summary><p>${input.item.format === 'choice' ? 'Select one option, then use the button to save it.' : input.item.format === 'steps' ? 'Write your steps in the box. You can use a new line for each step, then use the button to save.' : /^(?:number|fraction)$/.test(String(input.item.format)) ? 'Type your number in the box. Use / to type a fraction. Then use the button to save.' : 'Write your response in the box, then use the button to save.'}</p></details>
  </form>
  ${input.showHint === false || assessment?.open ? "" : `<form method="post" action="/session/${esc(input.sessionId)}/hint">
    ${csrfField()}
    <input type="hidden" name="itemId" value="${esc(String(input.item.id))}">
    <button class="${stuck ? "" : "ghost"}" type="submit">${Number(input.item.hints_used) > 0 ? 'Another hint' : 'Hint'}</button><p class="fine">Try your idea, or ask for a clue. Getting help is part of learning.</p>
  </form>`}
  ${reviewNote}
  ${finishCheck}
  `
}

/** One step's kind, shared by the step tag and its brick: together and clue steps are yellow, the child's own are blue, a look back is green. */
export function beatOf(beat: string | undefined) {
  return beat === "guided" ? { key: "together", label: "Together" } : beat === "faded" ? { key: "clue", label: "With a clue" } : beat === "review" ? { key: "review", label: "Look back" } : { key: "own", label: "On your own" }
}

/** The first step of a practice arc: the idea and one example, then a question done together. */
export function lessonCard(sessionId: string, concept: { conceptId?: string; title: string; recall?: string; example?: string; teaching?: ApprovedTeaching }, scaffold?: Scaffold | null) {
  const example = String(concept.example ?? "").trim()
  const teaching = concept.teaching
  const route = teaching ? TEACHING_ROUTE[teaching.dimension] : null
  return `<article class="lesson-card prompt" aria-labelledby="lesson-title" ${teaching ? `data-teaching-route="${teaching.dimension}"` : ''}>
    <h1 id="lesson-title">${esc(concept.title)}</h1><p class="step-tag" data-beat="together">${esc(route?.label ?? 'First, the idea')}</p>
    <p class="question-text">${esc(String(concept.recall ?? "").trim())}</p><button type="button" class="ghost" data-hear>Read aloud</button>
    ${route ? `<p>${esc(route.cue)}</p>` : ''}
    ${scaffold ? `<section class="worked-example" aria-label="Worked example"><h2>A worked example</h2><p>${esc(scaffold.worked.problem)}</p><ol>${scaffold.worked.steps.map(step => `<li><strong>${esc(step.work)}</strong><p>${esc(step.reason)}</p></li>`).join('')}</ol><p><strong>Check:</strong> ${esc(scaffold.worked.check)}</p><p>Next, finish a different example with some of the work started.</p></section>` : ''}
    ${teaching ? `<div class="teaching-contrast"><p><strong>Fits the idea:</strong> ${esc(teaching.contrast.example)}</p><p><strong>Does not fit:</strong> ${esc(teaching.contrast.nonExample)}</p></div>
      ${teaching.misconceptions.slice(0, 1).map(m => `<details><summary>${esc(m.probe)}</summary><p>A tempting idea: ${esc(m.belief)}</p><p>${esc(m.fix)}</p></details>`).join('')}`
      : example && !scaffold ? `<p><strong>For example:</strong> ${esc(example)}</p>${mathPicture(example)}` : ""}
    ${concept.conceptId ? manipulative(concept.conceptId, scaffold?.worked.problem ?? (example || concept.title)) : ""}
  </article>
  <form method="post" action="/session/${esc(sessionId)}/lesson" class="lesson-start">${csrfField()}<button type="submit">Let’s try one together</button></form>`
}

/** Multiple-choice questions from a learning pack get one large option per choice; everything else keeps the typed answer and voice typing. */
function answerField(item: Record<string, unknown>, onBreak: boolean, canSpeak = true) {
  const draft = String(item.draft_answer ?? "")
  // In a spelling assessment, browser writing assistance can supply the measured skill too.
  const spellingAttrs = canSpeak ? '' : ' spellcheck="false" autocorrect="off" autocapitalize="off"'
  let choices: string[] = []
  try { const parsed = item.format === "choice" && item.choices_json ? JSON.parse(String(item.choices_json)) : []; choices = Array.isArray(parsed) ? parsed.map(String) : [] } catch { choices = [] }
  if (choices.length) {
    return `<fieldset class="choices"><legend>Answer: choose one</legend>${choices.map((choice, i) => `<label class="choice"><input type="radio" name="answer" value="${esc(choice)}" required ${draft === choice ? "checked" : ""} ${onBreak ? "disabled" : ""}><span class="choice-letter" aria-hidden="true">${"ABCDEF"[i]}</span><span>${esc(choice)}</span></label>`).join("")}</fieldset>`
  }
  const written = item.format === 'written' || item.format === 'steps' || /^rubric:/i.test(String(item.answer ?? '')) || Number(item.bloom_level) >= 4
  return written
    ? `<label for="written-answer">${item.format === 'steps' ? 'Your steps' : 'Answer'}</label><textarea id="written-answer" name="answer" rows="4" maxlength="4000" autocomplete="off"${spellingAttrs} required ${onBreak ? 'disabled' : ''}>${esc(draft)}</textarea><p class="fine">${canSpeak ? 'Type or say your response in your own words.' : 'Type your response in your own words.'}</p>${onBreak || !canSpeak ? '' : microphoneControls()}`
    : `<label>Answer <input name="answer" autocomplete="off"${spellingAttrs} value="${esc(draft)}" required ${onBreak ? "disabled" : ""}></label>${onBreak || !canSpeak ? "" : microphoneControls()}`
}

/** Optional: how sure the child is before checking. Compared later with the result, never graded. */
function sureField() {
  return `<fieldset class="sure"><legend>How sure are you? <span class="fine">(you can skip this)</span></legend>${[["sure", "Sure"], ["think", "I think so"], ["guess", "Guessing"]].map(([value, label]) => `<label class="sure-chip"><input type="radio" name="confidence" value="${value}"><span>${label}</span></label>`).join("")}</fieldset>`
}

/** A sure miss is worth a closer look; a lucky guess is worth trusting next time. Said once, kindly. */
function calibrationLine(correct: boolean, confidence?: string | null) {
  if (confidence === "sure" && !correct) return `<span class="calibration"> You felt sure, so this one is worth a closer look.</span>`
  if (confidence === "guess" && correct) return `<span class="calibration"> You guessed and got it. You know more than you think.</span>`
  return ""
}

/** One plain sentence about the mission, without counts of zero or grading vocabulary. */
function missionLine(summary: { independent: number; supported: number; unresolved: number }) {
  const parts = [
    summary.independent ? `You solved ${summary.independent} on your own` : "",
    summary.supported ? `${summary.independent ? "and " : "You solved "}${summary.supported} with a little help` : "",
  ].filter(Boolean).join(" ")
  const lead = parts ? `${parts}.` : "You showed up and tried. That counts."
  return `${lead}${summary.unresolved ? ` ${summary.unresolved === 1 ? "One answer is" : `${summary.unresolved} answers are`} saved and awaiting review.` : ""} Take a break whenever you like; your work is saved.`
}

export function historyPage(
  studentId: string, records: Array<Record<string, unknown>>,
  undo: { states?: Map<string, { ok: boolean; reason?: string; done?: boolean }>; undone?: Set<string>; notice?: string; error?: string } = {},
): string {
  const control = (record: Record<string, unknown>) => {
    const id = String(record.id)
    if (undo.undone?.has(id)) return '<p><span class="class-status" data-status="empty">Undone</span></p>'
    const state = undo.states?.get(id)
    if (!state) return ""
    if (state.ok) return `<form method="post" action="/students/${esc(studentId)}/undo" class="undo-form">${csrfField()}<input type="hidden" name="decisionId" value="${esc(id)}"><button type="submit" class="ghost">Undo this change</button></form>`
    return state.done ? "" : `<p class="fine">Cannot undo: ${esc(state.reason ?? "")}</p>`
  }
  const summary = (record: Record<string, unknown>) => {
    try { const d = JSON.parse(String(record.details)); return typeof d.summary === "string" ? `<p><strong>${esc(d.summary)}</strong></p>` : typeof d.message === "string" && record.kind === "change_undone" ? `<p><strong>${esc(d.message)}</strong></p>` : "" } catch { return "" }
  }
  return `<p><a href="/students/${esc(studentId)}/parent">Back to parent area</a></p><h1>Decisions and history</h1>
    <p>What changed, why it changed, and which model was active. Recent changes you made can be undone here while nothing newer depends on them.</p>
    ${undo.notice ? `<p class="ok" role="status">${esc(undo.notice)}</p>` : ""}${undo.error ? `<p class="banner" role="alert">${esc(undo.error)}</p>` : ""}
    ${records.length ? records.map((record) => `<article class="panel">
      <p class="fine">${esc(String(record.kind).replaceAll("_", " "))} · ${esc(String(record.created_at))}</p>
      ${summary(record)}<p>${esc(String(record.reason))}</p>${control(record)}
      <p class="fine">${esc(String(record.provider))}${record.model ? ` · ${esc(String(record.model))}` : ""}</p>
      <details><summary>Recorded details</summary><pre>${esc(JSON.stringify(JSON.parse(String(record.details)), null, 2))}</pre>
      <p class="fine">Spec revision ${esc(String(record.spec_revision).slice(0, 12))}</p></details>
    </article>`).join("") : "<p>No decisions have been recorded yet. Start a practice or add school material.</p>"}`
}

/** How learning is going: each measure with its definition, for parents only. */
function measuresSection(measures: Array<{ label: string; value: string; detail: string; definition: string; enough: boolean }>) {
  if (!measures.length) return ""
  return `<section class="panel learning-measures" aria-labelledby="measures-title"><h2 id="measures-title">How learning is going</h2><p class="fine">Worked out on this site from your child's missions; nothing is sent elsewhere.</p><dl>${measures.map((m) => `<div class="measure${m.enough ? "" : " is-waiting"}"><dt>${esc(m.label)}</dt><dd><strong>${esc(m.value)}</strong>${m.detail ? `<span class="fine">${esc(m.detail)}</span>` : ""}<small>${esc(m.definition)}</small></dd></div>`).join("")}</dl></section>`
}

const pct = (value: number) => `${Math.round(value * 100)}%`

/** The two-scale ladder and the before/after gain. Parents only. */
function progressSection(progress: { ladders: ConceptLadder[]; gain: Gain; audit?: { checked: number; agreed: number; waiting: number; unsure?: number } } | undefined, titles: Record<string, string>, studentId = "") {
  if (!progress) return ""
  const { ladders: rows, gain, audit } = progress
  const summary = ladderSummary(rows)
  const order: Band[] = ["judge", "use", "foundations", "none"]
  const sorted = [...rows].sort((a, b) => order.indexOf(a.band) - order.indexOf(b.band) || b.reached.length - a.reached.length)
  const ladderTable = rows.length ? `<div class="table-scroll"><table class="ladder"><caption class="fine">One row per topic. Thinking is the highest level solved on their own; the steps show how much of it they own.</caption><thead><tr><th scope="col">Topic</th><th scope="col">Thinking</th><th scope="col">Owns it</th><th scope="col">Next</th></tr></thead><tbody>${sorted.map(row => `<tr${row.goalMet ? ' class="goal-met"' : ""}><th scope="row">${esc(conceptTitle(row.conceptId, titles))}</th><td>${esc(BAND_LABEL[row.band])}${row.highestLevel ? ` <span class="fine">(${esc(BLOOM_NAME[row.highestLevel])})</span>` : ""}</td><td><ol class="steps">${OWNERSHIP.map(step => { const kept = (step === "retained7" || step === "retained28") ? row.memoryLevel?.[step] : undefined; const lower = kept && bandOf(kept) !== row.band ? ` (at the ${({ none: "", foundations: "basics", use: "using-it", judge: "judging-and-creating" } as Record<Band, string>)[bandOf(kept)]} level)` : ""; return `<li data-done="${row.reached.includes(step)}">${row.reached.includes(step) ? "" : '<span class="visually-hidden">Not yet: </span>'}${esc(OWNERSHIP_LABEL[step] + lower)}</li>` }).join("")}</ol></td><td>${esc(row.next)}</td></tr>`).join("")}</tbody></table></div>` : "<p>No topics practised yet.</p>"
  const before = gain.before, after = gain.after
  const gainBody = gain.enough && before && after
    ? `<p class="metric">${pct(before.accuracy)} → ${pct(after.accuracy)}</p>
       <p>First ${before.checks} fair checks (${esc(before.from)} to ${esc(before.to)}, average thinking level ${before.demand.toFixed(1)}) against the latest ${after.checks} (${esc(after.from)} to ${esc(after.to)}, average thinking level ${after.demand.toFixed(1)}).${gain.demandChange && gain.demandChange > 0 ? ` The later questions asked for more kinds of thinking (up ${gain.demandChange} of a level). That is a different kind of question, not proof of a harder one.` : ""}</p>
       <p>Size of the change: <strong>${gain.effect}</strong> (${esc(gain.size ?? "")}). ${esc(gain.note)}</p>`
    : `<p>${esc(gain.note || "Not enough fair checks yet.")}</p>`
  return `<section class="panel progress-ladder" aria-labelledby="ladder-title"><h2 id="ladder-title">How far the thinking has climbed</h2>
    <p>${summary.concepts} topic${summary.concepts === 1 ? "" : "s"}: ${summary.bands.judge} judging and creating, ${summary.bands.use} using it, ${summary.bands.foundations} on the basics. ${summary.goalMet} meet the full goal: solved on their own, checked again after a month and used somewhere new at the same thinking level.</p>
    <p class="fine">Later checks match topic, thinking demand and task role. Without a validated parallel form they are historical proxies. These steps alone cannot prove an interval without refresher practice.</p>
    ${ladderTable}
  </section>
  <section class="panel gain" aria-labelledby="gain-title"><h2 id="gain-title">Progress on fair checks</h2>
    ${gainBody}
    ${audit ? `<p><a href="/students/${esc(studentId)}/grading">Check the tutor’s grading</a>${audit.unsure ? ` · <strong>${audit.unsure} the tutor isn’t sure about</strong>` : ""}${audit.waiting ? ` · ${audit.waiting} to spot-check` : ""}${audit.checked ? ` · you agreed with ${audit.agreed} of ${audit.checked}` : ""}</p>` : ""}
    <p class="fine">A fair check is a question your child had not seen, answered without a hint and graded with confidence. This describes your child against their own start; it does not show what caused the change, and only matched topic, demand, task-role and response-form conditions are compared. The size is Cohen's h, a measure for the change between two percentages (0.2 small, 0.5 medium, 0.8 large). It is not on the same scale as Bloom's “2 sigma” finding, which compared tutored students with a classroom group, so the two numbers cannot be compared.</p>
  </section>`
}

function experimentsSection(studentId: string, rows: Array<{ key: string; label: string; detail: string; on: boolean; report: { verdict: string; note: string; on: { weeks: number; perWeek: number; accuracy: number | null; fairChecks: number }; off: { weeks: number; perWeek: number; accuracy: number | null; fairChecks: number } } | null }>) {
  if (!rows.length) return ""
  const side = (arm: { weeks: number; perWeek: number; accuracy: number | null; fairChecks: number }) => `${arm.weeks} week${arm.weeks === 1 ? "" : "s"}, ${arm.perWeek.toFixed(1)} missions a week, ${arm.accuracy == null ? "no fair checks" : `${Math.round(arm.accuracy * 100)}% of ${arm.fairChecks} fair checks`}`
  return `<section class="panel experiments" aria-labelledby="experiments-title"><h2 id="experiments-title">Is it helping?</h2>
    <p class="fine">Turn on a comparison and the feature switches on and off each week, so your child is compared with themselves. A feature stays only if they come back as often and learn as well. The rule is set in advance: missions a week may fall by no more than 10%, and accuracy on fair checks by no more than 5 points. Compare one feature at a time. This is a rough guide, not proof: school, topics and the time of year also change from week to week.</p>
    ${rows.map(row => `<div class="experiment"><h3>${esc(row.label)}</h3><p class="fine">${esc(row.detail)}</p>
      ${row.report ? `<p><strong>${esc(row.report.verdict === "not enough yet" ? "Not enough yet" : row.report.verdict === "keep" ? "Keep it" : row.report.verdict === "promising" ? "Looks helpful" : "Needs a rethink")}.</strong> ${esc(row.report.note)}${rows.filter(other => other.on).length > 1 ? " Both features switch together, so this shows their combined effect." : ""}</p><p class="fine">With it: ${esc(side(row.report.on))}. Without it: ${esc(side(row.report.off))}.</p>` : ""}
      ${!row.on && rows.some(other => other.on) ? `<p class="fine">Another comparison is running. Stop it first, so each result belongs to one feature.</p>` : `<form method="post" action="/students/${esc(studentId)}/experiments">${csrfField()}<input type="hidden" name="key" value="${esc(row.key)}"><input type="hidden" name="on" value="${row.on ? "0" : "1"}"><button type="submit" class="ghost">${row.on ? "Stop comparing" : "Compare week on, week off"}</button></form>`}</div>`).join("")}
  </section>`
}

export function scoreboardPage(name: string, studentId: string, board: Scoreboard, titles: Record<string, string> = {}, measures: Array<{ label: string; value: string; detail: string; definition: string; enough: boolean }> = [], progress?: { ladders: ConceptLadder[]; gain: Gain; audit?: { checked: number; agreed: number; waiting: number; unsure?: number }; experiments?: Parameters<typeof experimentsSection>[1] }): string {
  const mastered = board.conceptsMasteredThisWeek.length
    ? board.conceptsMasteredThisWeek
        .map((row) => `<li>${esc(conceptTitle(row.conceptId, titles))} · ${esc(BLOOM_NAME[row.bloomLevel])}</li>`)
        .join("")
    : "<li>None this week yet.</li>"
  const frontier = board.frontier.length
    ? board.frontier.map((row) => `<li>${esc(conceptTitle(row.conceptId, titles))} · next ${esc(BLOOM_NAME[row.bloomLevel])} · ${esc(row.status)}</li>`).join("")
    : "<li>No open frontier.</li>"
  const stuck = board.stuck.length
    ? `<ul class="stuck">${board.stuck
        .map((row) => `<li>${esc(conceptTitle(row.conceptId, titles))} · ${esc(row.errorType ?? "unspecified")}</li>`)
        .join("")}</ul>`
    : "<p>No concept is stuck.</p>"
  const errors = board.errorTrend.length
    ? board.errorTrend.map((row) => `<li>${esc(row.errorType)} · ${row.count}</li>`).join("")
    : "<li>No errors logged this week.</li>"
  const ratio = board.justRightRatio == null ? "Not enough items yet" : `${Math.round(board.justRightRatio * 100)}%`
  const retention = (bucket: { checked: number; held: number }) =>
    bucket.checked ? `${bucket.held} of ${bucket.checked} held` : "No retest yet"
  const evidenceNote = (days: 7 | 30) => {
    const quality = board.retentionEvidence?.[days]
    return quality ? `${quality.validated} validated form matches; ${quality.proxies} historical proxies. ${quality.unrefreshed} have a recorded gap without in-app refresher practice.` : 'Comparable later checks; exposure history is incomplete.'
  }
  return `
  <p class="links"><a href="/students/${esc(studentId)}/parent">${esc(name)}’s overview</a></p>
  <h1>This week</h1>
  <div class="metrics">
    <section><h2>Just-right ratio</h2><p class="metric">${esc(ratio)}</p><p class="fine">Share of items whose last six landed from 70% to under 90%.</p></section>
    <section><h2>Comparable checks, 7 days</h2><p class="metric">${esc(retention(board.retention7))}</p><p class="fine">${esc(evidenceNote(7))}</p></section>
    <section><h2>Comparable checks, 30 days</h2><p class="metric">${esc(retention(board.retention30))}</p><p class="fine">${esc(evidenceNote(30))}</p></section>
  </div>
  ${measuresSection(measures)}
  ${progressSection(progress, titles, studentId)}
  ${experimentsSection(studentId, progress?.experiments ?? [])}
  <section><h2>Mastered this week</h2><ul>${mastered}</ul></section>
  <section><h2>Frontier</h2><ul>${frontier}</ul></section>
  <section><h2>Stuck, last three sessions under 70%</h2>${stuck}</section>
  <section><h2>Error types</h2><ul>${errors}</ul></section>`
    + `<section><h2>Assessment evidence over time</h2>
      <p>Compare the same concept and Bloom level across dates. Repeated questions and hinted responses are excluded from these scores; uncertain grading stays pending.</p>
      ${board.assessmentEvidence?.length ? `<table><thead><tr><th>Date</th><th>Concept</th><th>Bloom</th><th>Held / checked</th><th>Excluded</th><th>Pending</th></tr></thead><tbody>${board.assessmentEvidence.map((row) => `<tr>
        <td>${esc(row.day)}</td><td>${esc(conceptTitle(row.conceptId, titles))}</td><td>${esc(BLOOM_NAME[row.bloomLevel])}</td>
        <td>${row.held} / ${row.checked}</td><td>${row.excluded}</td><td>${row.pending}</td></tr>`).join("")}</tbody></table>` : "<p>No assessment evidence yet.</p>"}
    </section>`
}

export function sheetPage(input: {
  sheetId: string
  studentId?: string
  studentName: string
  spec: {
    boxes: Array<{ boxIndex: number; x: number; y: number; w: number; h: number }>
    cornerMarks: Array<{ x: number; y: number; size: number }>
  }
  items: Array<{ itemId: string; prompt: string; conceptId: string; choices?: string[] }>
  qrSvg: string
  titles?: Record<string, string>
  photoIds?: string[]
  results?: Array<{ boxIndex: number; correct: boolean; confidence: number; speak: boolean; pendingReview?: boolean; reviewSessionId?: string; unanswered?: boolean; disputed?: boolean }> | null
  paperConditions?: import('./paper-work.ts').PaperConditions
}): string {
  const marks = `<i class="corner c1"></i><i class="corner c2"></i><i class="corner c3"></i><i class="corner c4"></i>`
  const rows = input.items
    .map((item, index) => {
      const box = input.spec.boxes[index]
      const inlineChoices = item.choices?.every((choice, index) => choice === String.fromCharCode(65 + index) && item.prompt.includes(choice + ')'))
      return `<section class="sheet-item">
        <p class="num">${index + 1}</p>
        <div><p class="fine">${esc(conceptTitle(item.conceptId, input.titles))}</p><pre>${esc(item.prompt)}</pre>${item.choices?.length && !inlineChoices ? `<ol type="A">${item.choices.map(choice => `<li>${esc(choice)}</li>`).join('')}</ol>` : ''}</div>
        <div class="box" data-box="${box.boxIndex}" style="width:${box.w}px;height:${box.h}px">Box ${box.boxIndex}</div>
      </section>`
    })
    .join("")
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sheet ${esc(input.sheetId)}</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body class="sheet-body" data-paper-sheet="${esc(input.sheetId)}" data-paper-submitted="${input.results ? '1' : '0'}">
  <main id="main">
  <section class="panel no-print"><h1>Paper practice</h1><p>Print the questions and work offline. Keep your paper. When connected, save a photo or copy your answers below. Checking starts after you submit the whole sheet.</p>${input.studentId ? `<a href="/students/${esc(input.studentId)}">Back to practice</a>` : ''}</section>
  <article class="sheet">
    ${marks}
    <header class="sheet-head">
      <div>${input.qrSvg}<p class="mono">${esc(input.sheetId)}</p></div>
      <div><h1 class="sheet-title">Work the boxes. Leave the rest blank.</h1><p>${esc(input.studentName)}</p></div>
    </header>
    ${rows}
  </article>
  <form class="no-print" method="post" action="/sheet/${esc(input.sheetId)}/pdf">${csrfField()}<button type="submit">Download a PDF</button></form>
  ${input.results ? `<section class="panel no-print">${scoreResultPage(input.results)}<p>Paper conditions are self-reported. ${input.paperConditions?.help === 'none' && input.paperConditions.confirmed ? 'You reported working without content help.' : input.paperConditions?.help === 'content' ? 'You reported content help; these answers count as supported work.' : 'Help conditions are unknown, so this work cannot establish new independent success.'}</p>${input.studentId ? `<a class="button" href="/students/${esc(input.studentId)}">Continue with fresh practice</a>` : ''}</section>` : `<form method="post" action="/sheet/${esc(input.sheetId)}/score" class="panel no-print" data-paper-score>
    <h2>Confirm your paper answers</h2><p>Copy what you wrote. Check each entry against your paper or saved photo. Leave an unanswered box empty. Correct an unreadable entry or retake the photo before submitting.</p>
    ${csrfField()}
    ${input.spec.boxes
      .map(
        (box) =>
          `<label>Box ${box.boxIndex} <textarea name="box-${box.boxIndex}" rows="2" autocomplete="off"></textarea></label>`,
      )
      .join("")}
    <label>Help while doing this paper<select name="paperHelp" required><option value="">Choose one</option><option value="none">I worked without content help</option><option value="content">Someone or something helped me with the work</option><option value="unknown">I am not sure</option></select></label>
    <label><input type="checkbox" name="completed" value="1" required> I have finished this paper check, including any boxes I left unanswered.</label>
    <label><input type="checkbox" name="confirmed" value="1" required> These entries match what I wrote.</label>
    <p data-paper-draft-status role="status">Not submitted yet.</p><p data-paper-submit-status role="status"></p>
    <button type="submit">Submit paper check</button>
  </form>`}
  ${input.photoIds?.length ? `<section class="panel no-print"><h2>Saved paper photos</h2><p role="status">Your photos are saved in your private family account.</p>${input.photoIds.map((id, index) => `<a href="/uploads/${esc(id)}"><img src="/uploads/${esc(id)}" alt="Saved paper photo ${index + 1}" style="max-width:100%;height:auto"></a>`).join('')}</section>` : ''}
  <form method="post" action="/sheet/${esc(input.sheetId)}/upload" class="panel no-print" id="upload-form">
    <h2>Or keep a photo</h2>
    <p class="fine">Save a photo to your private family account when connected. Selecting a photo does not save it here. To keep a photo for later, use your device’s camera or photos app, then choose it below. ${input.results ? 'Your submitted answers remain attached to this sheet.' : 'Type the answers above to submit the work for checking.'}</p>
    ${csrfField()}
    <label>Choose a paper photo<input type="file" accept="image/png,image/jpeg" capture="environment" id="photo" required></label>
    <input type="hidden" name="mime">
    <input type="hidden" name="base64">
    <div data-paper-photo-preview></div><p data-paper-photo-status role="status">No photo selected.</p>
    <button type="submit">Save photo</button>
  </form>
  </main>
  <script src="/session.js"></script>
</body>
</html>`
}

export function scoreResultPage(results: Array<{ boxIndex: number; correct: boolean; confidence: number; speak: boolean; pendingReview?: boolean; reviewSessionId?: string; unanswered?: boolean; disputed?: boolean }>): string {
  const rows = results
    .map(
      (result) =>
        result.unanswered ? `<li>Box ${result.boxIndex}: left unanswered; not scored</li>` : result.disputed ? `<li>Box ${result.boxIndex}: grade questioned; not counted toward progress</li>` : result.pendingReview
          ? `<li>Box ${result.boxIndex}: answer saved, awaiting a check. <a href="/session/${esc(result.reviewSessionId ?? "")}">Open checking status</a></li>`
          : `<li>Box ${result.boxIndex}: ${result.correct ? "holds" : "not yet"}</li>`,
    )
    .join("")
  return `<h2>Paper submitted</h2><ul>${rows}</ul>`
}

function breakdownList(results: Array<{ title: string; correct: boolean }>) {
  const rows = new Map<string, { holds: number; misses: number }>()
  for (const result of results) {
    const row = rows.get(result.title) ?? { holds: 0, misses: 0 }
    if (result.correct) row.holds += 1
    else row.misses += 1
    rows.set(result.title, row)
  }
  return [...rows]
    .map(([title, row]) => {
      const note = row.misses ? `${row.misses} ${row.misses === 1 ? "miss" : "misses"}` : "holds"
      return `<li>${esc(title)} · ${note}</li>`
    })
    .join("")
}

export function csrfField() {
  return `<input type="hidden" name="csrf" class="csrf-field" value="">`
}

export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!)
}
