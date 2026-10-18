import { ARROW, BACK } from './icons.ts'
import type { Database as DatabaseSync } from "./database.ts"
import { esc, companion } from "./view.ts"
import { microphoneControls } from "./media-view.ts"
export { plannerHref } from "./planner-href.ts"
import { assertStudent, aiSettings, aiConnectionProblem } from "./services.ts"
import { listPlanner, rowProposal, type PlannerRow } from "./planner.ts"
import type { Auth } from "./journey-routes.ts"

const csrf = () => '<input type="hidden" name="csrf" class="csrf-field" value="">'

/** Parent pages that carry the planner drawer. Learner, job and print surfaces never do. */
export function parentSurface(path: string) {
  if (/^\/students\/[0-9a-f-]{36}\/(parent|classes|school|controls|note|history|scoreboard|materials\/new|materials|live|map|insights|test)$/i.test(path)) return true
  return /^\/materials\/[0-9a-f-]{36}$/i.test(path) || ["/family/progress", "/family/digests", "/settings", "/students"].includes(path)
}

export function plannerStudentFor(auth: Auth, path: string) {
  const match = path.match(/^\/students\/([0-9a-f-]{36})/i)
  return match ? match[1] : auth.selectedStudent
}

const CHIPS = [
  ["Make practice", "Make 12 practice questions on "],
  ["Add a class", "Add a class called "],
  ["Change a class", "Change the "],
  ["A test is coming", "There is a test on "],
  ["Practice minutes", "Make missions "],
  ["Leave a note", "Tell my child: "],
  ["How is it going?", "How is this week going?"],
]

export function plannerBubble(row: PlannerRow, name: string) {
  const mine = row.role === "parent"
  if (row.status === "pending") {
    return `<li class="planner-bubble working" data-message="${esc(row.id)}" ${row.job_id ? `data-planner-job="${esc(row.job_id)}"` : ""}><span class="mini-think" aria-hidden="true">${companion("think")}<i></i><i></i><i></i></span><p>Thinking about it.</p></li>`
  }
  const proposal = rowProposal(row)
  let extra: { uploads?: string[]; materialId?: string; packId?: string } = {}
  try { extra = row.params ? JSON.parse(row.params) : {} } catch { extra = {} }
  const materialId = typeof extra.materialId === "string" ? extra.materialId : typeof (proposal?.params as any)?.materialId === "string" ? String((proposal!.params as any).materialId) : ""
  const pages = mine && Array.isArray(extra.uploads) && extra.uploads.length
    ? `<div class="planner-pages">${extra.uploads.slice(0, 4).map((id, i) => `<img src="/uploads/${esc(String(id))}" alt="Page ${i + 1}" loading="lazy">`).join("")}${extra.uploads.length > 4 ? `<span class="planner-more">+${extra.uploads.length - 4}</span>` : ""}</div>`
    : ""
  const link = !mine && materialId ? `<p class="planner-link"><a href="/materials/${esc(materialId)}">Open the pages${ARROW}</a></p>`
    : !mine && typeof extra.packId === "string" ? `<p class="planner-link"><a href="/packs/${esc(extra.packId)}">Open the practice${ARROW}</a></p>` : ""
  return `<li class="planner-bubble${mine ? " mine" : ""}" data-message="${esc(row.id)}">${pages}<p>${esc(row.body)}</p>${link}${proposal ? plannerProposalCard(row, proposal, name) : ""}${!mine && !proposal ? '<button type="button" class="ghost planner-hear" data-hear>Hear that</button>' : ""}</li>`
}

export function plannerProposalCard(row: PlannerRow, proposal: NonNullable<ReturnType<typeof rowProposal>>, name: string) {
  const actions = row.status === "proposed"
    ? `<div class="planner-proposal-actions"><button type="button" data-planner-apply="${esc(row.id)}">${esc(proposal.applyLabel)}</button><button type="button" class="ghost" data-planner-decline="${esc(row.id)}">Not now</button></div>`
    : row.status === "applied"
      ? `<p class="applied-note"><span class="keepsake-art" style="--keepsake:#ffcf00" aria-hidden="true">✦</span><span>Applied. ${esc(name)}'s next mission follows it.</span></p>${proposal.undoable && row.decision_id ? `<div class="planner-proposal-actions"><button type="button" class="ghost" data-planner-undo="${esc(row.decision_id)}">Undo</button></div>` : ""}`
      : row.status === "undone" ? '<p class="fine">Undone. Everything is back to how it was before.</p>'
      : row.status === "superseded" ? '<p class="fine">Replaced by a newer suggestion.</p>' : '<p class="fine">Not applied.</p>'
  return `<div class="planner-proposal" data-status="${esc(row.status)}"><p class="step-tag">${row.status === "applied" ? "Applied" : row.status === "undone" ? "Undone" : "Would change"}</p><p>${esc(proposal.summary)}</p>${actions}</div>`
}

export async function plannerFragment(db: DatabaseSync, owner: string, studentId: string, prefill = "") {
  const student: any = await assertStudent(db, owner, studentId)
  const name = String(student.display_name)
  const rows = await listPlanner(db, owner, studentId, 30)
  const settings = await aiSettings(db, owner), problem = aiConnectionProblem(settings)
  const plan = !problem && settings.provider === "chatgpt" ? ' <span class="chatgpt-in-use">Using ChatGPT plan · <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">Manage usage</a></span>' : ""
  const thread = rows.length
    ? rows.map((row) => plannerBubble(row, name)).join("")
    : `<li class="planner-bubble"><p>Tell me what to change or what you want to know about ${esc(name)}'s learning. I describe the change first; nothing happens until you press Apply.</p></li>`
  return `<p class="fine planner-intro">${problem ? `${esc(problem)} Until then I can only do simple changes and answer from the numbers.` : "Say it in your own words. I describe the change, you press Apply."}${plan}</p>
<ol class="planner-thread" data-planner-thread>${thread}</ol>
<nav class="planner-chips" aria-label="Things you can ask">${CHIPS.map(([label, text]) => `<button type="button" class="chip" data-planner-prefill="${esc(text)}">${esc(label)}</button>`).join("")}</nav>
<form class="planner-form" method="post" action="/students/${esc(studentId)}/planner/message" data-fetch data-planner-form>${csrf()}<input type="hidden" name="voice" value="0"><label for="planner-message">Ask or change something</label><textarea id="planner-message" name="message" rows="2" placeholder="Make math a little easier this week.">${esc(prefill)}</textarea><ul class="planner-previews" data-planner-previews aria-label="Photos to send" hidden></ul><div class="planner-send"><button type="submit">Send to planner</button><label class="button ghost planner-photo-button">Add photos<input type="file" accept="image/jpeg,image/png" multiple data-planner-photos class="visually-hidden"></label>${microphoneControls()}</div><p class="fine planner-photo-hint">Send homework, a practice test or marked work. Add a word like “test Friday” or “marked” and I will file it the right way.</p><p data-planner-status role="status" aria-live="polite"></p></form>`
}

export async function plannerDrawer(db: DatabaseSync, owner: string, studentId: string, prefill = "", open = false) {
  const student: any = await assertStudent(db, owner, studentId)
  const name = String(student.display_name)
  return `<button type="button" class="planner-fab" data-planner-open aria-controls="planner-drawer" aria-expanded="${open ? "true" : "false"}"><span aria-hidden="true"></span> Planner</button>
<aside id="planner-drawer" class="planner-drawer${open ? " is-open" : ""}" data-planner-drawer data-student="${esc(studentId)}" data-fragment-url="/students/${esc(studentId)}/planner"${process.env.TUTOR_STORAGE === "blob" ? ' data-cloud-uploads="1"' : ""}${open ? ' data-open="1"' : " hidden"}>
  <div class="planner-scrim" data-planner-close></div>
  <section class="planner-panel" role="dialog" aria-labelledby="planner-title" tabindex="-1">
    <header class="planner-head"><div><h2 id="planner-title">Change ${esc(name)}’s plan</h2></div><button type="button" class="ghost planner-close" data-planner-close aria-label="Close planner">Close</button></header>
    <div class="planner-body" data-planner-body>${await plannerFragment(db, owner, studentId, prefill)}</div>
  </section>
</aside>`
}
