import { ARROW, BACK } from './icons.ts'
import { esc, csrfField } from "./view.ts"
import { microphoneControls } from "./media-view.ts"
import { mathPicture } from "./visuals.ts"
import type { PackBrief, PackChecked, PackQa, PackRow, PackSettings } from "./pack.ts"
import type { PackDraft, PackItem } from "./pack-qa.ts"

/**
 * Pages for learning packs. A child sees a plan, progress, a short lesson and a Start button, never answer keys;
 * a parent also sees every question with its answer, what the checks found, and Undo.
 */

const parse = <T>(value: string | null, fallback: T): T => { try { return value ? (JSON.parse(value) as T) : fallback } catch { return fallback } }
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const day = (iso: string) => { const [, m, d] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${d}` }

export interface PackViewer { parent: boolean; junior: boolean; studentId: string; name: string }

/** The child's home card and the parent's quick ask: one box, voice typing, and the choice between now and a plan first. */
export function packAskCard(studentId: string, input: { junior: boolean; parent: boolean; settings: PackSettings; requestId: string }) {
  if (!input.parent && input.settings.requests === "off") return ""
  const approval = !input.parent && input.settings.approval === "parent"
  const plan = !input.parent && input.settings.approval === "plan"
  const choice = approval
    ? `<p class="fine">A grown-up checks new practice before it starts.</p>`
    : `<label class="pack-preview"><input type="checkbox" name="preview" value="1" ${plan ? "checked" : ""}> ${input.parent ? "Show me first" : "Show me the plan first"}</label>`
  return `<section class="pack-ask" data-pack-ask aria-labelledby="pack-ask-${esc(studentId)}">
    <h2 id="pack-ask-${esc(studentId)}">${input.parent ? "Make practice for anything" : input.junior ? "What do you want to practise?" : "What do you want to work on?"}</h2>
    <p class="fine">${input.junior ? "Say it your way, like “times tables for my quiz on Friday”." : "Say it your way: “fractions with unlike denominators for Friday’s quiz” or “words that start with un-”."}</p>
    <form method="post" action="/students/${esc(studentId)}/packs" class="pack-form" data-fetch data-pack-form ${input.parent ? "data-pack-parent" : ""}>
      ${csrfField()}<input type="hidden" name="requestId" value="${esc(input.requestId)}"><input type="hidden" name="subject" value="">
      <label for="pack-message-${esc(studentId)}" class="visually-hidden">What do you want to practise?</label>
      <textarea id="pack-message-${esc(studentId)}" name="message" rows="2" maxlength="${input.parent ? 600 : 300}" required placeholder="${input.junior ? "I want to practise…" : "Practise…"}"></textarea>
      <div class="pack-send"><button type="submit">${input.junior ? "Make my practice" : "Make it"}</button>${choice}</div>
      ${microphoneControls()}
    </form>
    <div class="pack-live" data-pack-live aria-live="polite"></div>
  </section>`
}

const STAGES = [["queued", "Reading your request"], ["writing", "Writing the lesson and questions"], ["checking", "Checking every answer"], ["ready", "Ready"]] as const

function progress(pack: PackRow) {
  const at = pack.status === "queued" ? 0 : pack.status === "writing" ? 1 : 2
  return `<ol class="pack-steps" data-pack-job="${esc(pack.job_id ?? "")}">${STAGES.map(([key, label], i) => `<li data-state="${i < at ? "done" : i === at ? "now" : "next"}" data-step="${key}">${esc(label)}</li>`).join("")}</ol>
    <p class="fine" data-pack-stage role="status" aria-live="polite">This takes about a minute. You can leave this page; it keeps going.</p>
    <p><a href="/packs/${esc(pack.id)}">Check again</a></p>`
}

/** What the checks did, in plain words. "Checked twice" only when the independent check actually ran. */
export function qaLine(qa: PackQa | null) {
  if (!qa) return ""
  const parts = [
    `${plural(qa.published, "question")} ${qa.modelChecked ? "checked twice" : "checked by the app’s rules"}`,
    qa.recomputed ? `${qa.recomputed} math answer${qa.recomputed === 1 ? "" : "s"} recalculated` : "",
    qa.repaired ? `${plural(qa.repaired, "question")} rewritten after a check` : "",
    qa.dropped ? `${qa.dropped} left out` : "",
  ].filter(Boolean)
  return `<p class="fine pack-qa">${esc(parts.join(" · "))}.</p>`
}

function choiceList(item: PackItem, showKey: boolean) {
  if (!item.choices?.length) return ""
  return `<ol class="pack-choices" type="A">${item.choices.map((choice) => `<li${showKey && choice === item.answer ? ' class="is-key"' : ""}>${esc(choice)}</li>`).join("")}</ol>`
}

/** The whole pack with keys, for a parent only. */
export function packQuestions(draft: PackDraft) {
  return draft.skills.map((skill) => `<section class="pack-skill"><h3>${esc(skill.title)}</h3><p class="fine">${esc(skill.recall)}</p>
    <ol class="pack-items">${skill.items.map((item) => `<li><p>${esc(item.prompt)}</p>${choiceList(item, true)}
      <p class="fine"><strong>Answer:</strong> ${esc(item.answer.replace(/^rubric:\s*/i, "Marking guide: "))}</p>
      <details><summary>Hints and explanation</summary><ol>${item.hints.map((hint) => `<li>${esc(hint)}</li>`).join("")}</ol><p>${esc(item.explanation)}</p></details></li>`).join("")}</ol></section>`).join("")
}

function planSummary(brief: PackBrief) {
  return [
    `${plural(brief.count, "question")} on ${brief.topic}`,
    brief.subject,
    "a one-minute lesson first",
    brief.testDate ? `ready for ${day(brief.testDate)}` : "",
  ].filter(Boolean).join(" · ")
}

export function packPage(pack: PackRow, viewer: PackViewer) {
  const brief = parse<PackBrief | null>(pack.brief_json, null)
  const checked = parse<PackChecked | null>(pack.check_json, null)
  const qa = parse<PackQa | null>(pack.qa_json, null)
  const back = viewer.parent && !viewer.junior ? `/students/${esc(pack.student_id)}/classes#practice` : `/students/${esc(pack.student_id)}`
  const head = `<p><a href="${back}">${BACK}Back</a></p><h1>${esc(pack.title)}</h1><p class="step-tag">${esc(pack.subject)} practice</p>`
  const asked = `<p class="pack-request">“${esc(pack.request)}”</p>`
  let body = ""
  switch (pack.status) {
    case "brief":
      body = `<section class="pack-card" data-state="plan"><h2>Here’s the plan</h2>${brief ? `<p>${esc(planSummary(brief))}</p>` : ""}
        <form method="post" action="/packs/${esc(pack.id)}/make" class="pack-plan">${csrfField()}
          <fieldset class="pack-count"><legend>How many questions?</legend>${[6, 12, 18].map((n) => `<label><input type="radio" name="count" value="${n}" ${brief && Math.abs(brief.count - n) < 3 ? "checked" : ""}><span>${n}</span></label>`).join("")}</fieldset>
          <button type="submit">Make it</button></form>
        <form method="post" action="/packs/${esc(pack.id)}/discard">${csrfField()}<button type="submit" class="ghost">Not now</button></form></section>`
      break
    case "queued": case "writing": case "checking":
      body = `<section class="pack-card" data-state="making"><h2>Making your practice</h2>${progress(pack)}</section>`
      break
    case "review":
      body = viewer.parent
        ? `<section class="pack-card" data-state="review"><h2>Check it, then use it</h2>${checked?.final.interpretation ? `<p>${esc(checked.final.interpretation)}</p>` : ""}${qaLine(qa)}
            <div class="pack-actions"><form method="post" action="/packs/${esc(pack.id)}/publish">${csrfField()}<button type="submit">Use this practice</button></form>
            <form method="post" action="/packs/${esc(pack.id)}/discard">${csrfField()}<button type="submit" class="ghost">Set it aside</button></form></div></section>
            ${checked ? packQuestions(checked.final) : ""}`
        : `<section class="pack-card" data-state="waiting"><h2>Almost ready</h2><p>A grown-up checks new practice before it starts. It will appear on your home screen.</p></section>`
      break
    case "published": {
      const interpretation = checked?.final.interpretation
      body = `<section class="pack-card" data-state="ready"><h2>${viewer.junior ? "Your practice is ready!" : "Ready"}</h2>${interpretation ? `<p>${esc(interpretation)}</p>` : ""}${qaLine(qa)}
        <div class="pack-actions"><a class="button" href="/packs/${esc(pack.id)}/lesson">Start with the one-minute lesson</a>
        <form method="post" action="/packs/${esc(pack.id)}/start">${csrfField()}<button type="submit" class="ghost">Skip to the questions</button></form></div></section>
        ${viewer.parent ? `<details class="pack-parent"><summary>See every question and answer</summary>${checked ? packQuestions(checked.final) : ""}</details>
          ${pack.decision_id ? `<form method="post" action="/packs/${esc(pack.id)}/undo" class="undo-form">${csrfField()}<button type="submit" class="ghost">Undo this practice</button></form>` : ""}` : ""}`
      break
    }
    case "failed":
      body = `<section class="pack-card" data-state="failed"><h2>That didn’t work this time</h2><p>${esc(pack.note || "The practice could not be finished.")}</p>
        ${pack.job_id ? `<form method="post" action="/jobs/${esc(pack.job_id)}/retry">${csrfField()}<button type="submit">Try again</button></form>` : ""}
        <p><a href="${back}">Ask in a different way</a></p></section>`
      break
    default:
      body = `<section class="pack-card" data-state="gone"><h2>This practice was removed</h2><p><a href="${back}">Ask for something new</a></p></section>`
  }
  return `<div class="pack-page" data-presentation="${viewer.junior ? "junior" : "explorer"}">${head}${asked}${body}</div>`
}

export function packLessonPage(pack: PackRow, viewer: PackViewer) {
  const checked = parse<PackChecked | null>(pack.check_json, null)
  const lesson = checked?.final.lesson
  const has = Boolean(lesson?.hook && lesson.steps.length)
  return `<div class="pack-page pack-lesson" data-presentation="${viewer.junior ? "junior" : "explorer"}">
    <p><a href="/packs/${esc(pack.id)}">${BACK}Back</a></p><h1>${esc(pack.title)}</h1><p class="step-tag" data-beat="together">One-minute lesson</p>
    ${has ? `<article class="lesson-card"><p class="lesson-hook">${esc(lesson!.hook)}</p><button type="button" class="ghost" data-hear>Read it to me</button>
      <ol class="lesson-steps">${lesson!.steps.map((step, i) => `<li style="--i:${i}">${esc(step)}</li>`).join("")}</ol>
      <aside class="lesson-example"><h2>Worked example</h2>${mathPicture(lesson!.workedExample)}<p>${esc(lesson!.workedExample)}</p></aside>
      <div class="lesson-check"><h2>Quick check</h2><p>${esc(lesson!.quickCheck.question)}</p>
        <details><summary>Show the answer</summary><p>${esc(lesson!.quickCheck.answer)}</p></details></div></article>`
      : `<p>No lesson this time. The questions start gently.</p>`}
    <form method="post" action="/packs/${esc(pack.id)}/start" class="lesson-start">${csrfField()}<button type="submit">${viewer.junior ? "I’m ready, let’s go!" : "Start practising"}</button></form>
  </div>`
}

/** The parent's controls for what a child can ask for. */
export function packControls(studentId: string, name: string, settings: PackSettings) {
  const option = (value: string, current: string, label: string) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`
  return `<form method="post" action="/students/${esc(studentId)}/pack-settings" class="pack-settings">${csrfField()}
    <h3>What ${esc(name)} can ask for</h3>
    <label>New practice in ${esc(name)}’s own words<select name="requests">${option("classes", settings.requests, "Only for their classes")}${option("any", settings.requests, "Any school subject")}${option("off", settings.requests, "Turned off")}</select></label>
    <label>When ${esc(name)} asks<select name="approval">${option("now", settings.approval, "Make it at once")}${option("plan", settings.approval, "Show the plan first")}${option("parent", settings.approval, "Wait for my OK")}</select></label>
    <label>New practice packs a day<input name="dailyLimit" type="number" min="0" max="10" value="${settings.dailyLimit}"></label>
    <button type="submit">Save</button></form>`
}

/** Recent packs on the parent page, with where each one stands. */
export function packList(packs: PackRow[]) {
  if (!packs.length) return ""
  const label: Record<string, string> = { brief: "Plan waiting", queued: "Being made", writing: "Being made", checking: "Being checked", review: "Waiting for your OK", published: "Ready", failed: "Did not finish", undone: "Removed" }
  return `<ul class="pack-list">${packs.map((pack) => `<li><a href="/packs/${esc(pack.id)}">${esc(pack.title)}</a> <span class="class-status" data-status="${pack.status === "published" ? "ready" : pack.status === "review" ? "waiting" : "empty"}">${esc(label[pack.status] ?? pack.status)}</span>${pack.requested_by === "child" ? ' <span class="fine">asked by your child</span>' : ""}</li>`).join("")}</ul>`
}
