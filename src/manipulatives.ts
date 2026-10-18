/**
 * Hands-on models for "Show me how" and lesson cards (panel round 2, item 1): a fraction bar to split and
 * shade, equal groups to build, and a number line to step along. Every control is a native button, so it
 * works by touch, mouse and keyboard, and a live sentence states the current value for screen readers.
 * They appear only beside teaching, never on an independent question, so a model never turns a check
 * into supported work. public/manipulatives.js makes the buttons work; without it the starting state
 * still reads correctly.
 */

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n))
let counter = 0

export type ManipulativeKind = "fraction" | "groups" | "line"

/** Which model fits a concept. Chosen by concept id, never by guessing from symbols in the text. */
export function manipulativeFor(conceptId: string): ManipulativeKind | null {
  if (/^math\.primary\.3\.fraction$|^math\.[45]\.nf\./.test(conceptId)) return "fraction"
  if (/^math\.primary\.3\.(multiply|divide)$/.test(conceptId)) return "groups"
  if (/^math\.primary\.[12]\.(add|subtract|count)$|^math\.7\.ns\.a\.1$/.test(conceptId)) return "line"
  return null
}

export function fractionBar(parts: number, shaded = 0) {
  const id = `manip-${++counter}`
  parts = clamp(Math.round(parts) || 4, 2, 12); shaded = clamp(shaded, 0, parts)
  const cells = Array.from({ length: parts }, (_, i) => `<button type="button" class="manip-part" data-part aria-pressed="${i < shaded}" aria-label="Part ${i + 1} of ${parts}"></button>`).join("")
  return `<div class="manip" data-manip="fraction" data-parts="${parts}" role="group" aria-labelledby="${id}">
    <p class="manip-title" id="${id}">Try it: split the bar, then tap parts to shade them</p>
    <div class="manip-bar" data-bar>${cells}</div>
    <div class="manip-controls"><button type="button" class="ghost" data-step="parts" data-by="-1">Fewer parts</button><button type="button" class="ghost" data-step="parts" data-by="1">More parts</button></div>
    <p class="manip-value" aria-live="polite" data-value>${shaded} of ${parts} equal parts shaded: ${shaded}/${parts}</p>
  </div>`
}

export function equalGroups(groups: number, each: number) {
  const id = `manip-${++counter}`
  groups = clamp(Math.round(groups) || 3, 1, 10); each = clamp(Math.round(each) || 4, 1, 12)
  const boxes = Array.from({ length: groups }, () => `<span class="manip-group">${'<span class="manip-dot"></span>'.repeat(each)}</span>`).join("")
  return `<div class="manip" data-manip="groups" data-groups="${groups}" data-each="${each}" role="group" aria-labelledby="${id}">
    <p class="manip-title" id="${id}">Try it: build equal groups</p>
    <div class="manip-groups" data-groups-view aria-hidden="true">${boxes}</div>
    <div class="manip-controls"><button type="button" class="ghost" data-step="groups" data-by="-1">Fewer groups</button><button type="button" class="ghost" data-step="groups" data-by="1">More groups</button><button type="button" class="ghost" data-step="each" data-by="-1">Fewer in each</button><button type="button" class="ghost" data-step="each" data-by="1">More in each</button></div>
    <p class="manip-value" aria-live="polite" data-value>${groups} groups of ${each} make ${groups * each}</p>
  </div>`
}

export function numberLine(start: number, low = 0, high = 20) {
  const id = `manip-${++counter}`
  start = clamp(Math.round(start), low, high)
  const ticks = Array.from({ length: high - low + 1 }, (_, i) => low + i)
  const marks = ticks.map((n) => `<span class="manip-tick${n === start ? " is-here" : ""}" data-tick="${n}">${n % 5 === 0 || n === start ? n : ""}</span>`).join("")
  return `<div class="manip" data-manip="line" data-at="${start}" data-low="${low}" data-high="${high}" role="group" aria-labelledby="${id}">
    <p class="manip-title" id="${id}">Try it: step along the number line</p>
    <div class="manip-line" data-line aria-hidden="true">${marks}</div>
    <div class="manip-controls"><button type="button" class="ghost" data-step="at" data-by="-1">Back 1</button><button type="button" class="ghost" data-step="at" data-by="1">Forward 1</button>${high - low > 20 ? '<button type="button" class="ghost" data-step="at" data-by="-10">Back 10</button><button type="button" class="ghost" data-step="at" data-by="10">Forward 10</button>' : ""}</div>
    <p class="manip-value" aria-live="polite" data-value>At ${start}</p>
  </div>`
}

/** The model for a concept, started from the numbers in the question or example. */
export function manipulative(conceptId: string, text: string) {
  const kind = manipulativeFor(conceptId)
  if (!kind) return ""
  const numbers = (text.match(/-?\d+/g) ?? []).map(Number)
  if (kind === "fraction") {
    const fraction = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})/)
    const parts = fraction ? Number(fraction[2]) : Number(text.match(/(\d{1,2})\s+equal parts/)?.[1] ?? 4)
    return fractionBar(parts, fraction ? Number(fraction[1]) : 0)
  }
  if (kind === "groups") return equalGroups(numbers[0] ?? 3, numbers[1] ?? 4)
  const negative = conceptId === "math.7.ns.a.1"
  // Long enough to step all the way to the answer of an addition, not just to the biggest number.
  const reach = Math.max(20, numbers.reduce((sum, n) => sum + Math.abs(n), 0) + 5)
  const high = Math.min(100, Math.ceil(reach / 10) * 10)
  return numberLine(numbers[0] ?? 0, negative ? -Math.min(20, high) : 0, negative ? Math.min(20, high) : high)
}
