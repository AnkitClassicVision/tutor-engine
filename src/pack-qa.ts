import { safetyReply } from "./child-safety.ts"
import { childSafe } from "./runbook/gates.ts"
import { promptIdentity } from "./session-feedback.ts"
import { parseNumber, plain } from "./engine/score.ts"

/**
 * The code half of the learning-pack quality gate. Every rule here holds whichever model wrote the pack,
 * so a weaker model produces fewer published questions, never wrong ones.
 */

export const PACK_FORMATS = ["number", "choice", "word", "written"] as const
export type PackFormat = (typeof PACK_FORMATS)[number]
export interface PackItem { prompt: string; answer: string; format: PackFormat; choices: string[] | null; work: string | null; hints: string[]; explanation: string; bloom: number }
export interface PackSkill { title: string; recall: string; example: string; nonExample: string; items: PackItem[] }
export interface PackLesson { hook: string; steps: string[]; workedExample: string; quickCheck: { question: string; answer: string } }
export interface PackDraft { interpretation: string; lesson: PackLesson; skills: PackSkill[] }
export interface QaRules { formats: string[]; bloomMin: number; bloomMax: number; requireWork: boolean; grade: number; seen?: Iterable<string>; sources?: string[] }
export interface Issue { rule: string; message: string; block: boolean }
export interface ItemReport { skill: number; item: number; issues: Issue[] }

// ---- Safe arithmetic --------------------------------------------------------------------------

type Q = { n: bigint; d: bigint }
const gcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n }
const q = (n: bigint, d: bigint = 1n): Q => { if (d === 0n) throw new Error("division by zero"); if (d < 0n) { n = -n; d = -d } const g = gcd(n, d); return { n: n / g, d: d / g } }
const add = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d)
const sub = (a: Q, b: Q) => q(a.n * b.d - b.n * a.d, a.d * b.d)
const mul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d)
const div = (a: Q, b: Q) => q(a.n * b.d, a.d * b.n)

/** Evaluates + − × ÷ ^ ( ) %, decimals and fractions exactly. Anything else is rejected; nothing is ever executed. */
export function evaluate(expression: string): { n: number; d: number } | null {
  const source = expression.replace(/[×x·∙*]/g, "*").replace(/[÷:]/g, "/").replace(/[−–—]/g, "-").replace(/,(?=\d{3}\b)/g, "").replace(/\s+/g, "")
  if (!source || source.length > 200 || !/^[\d.+\-*/^()%]+$/.test(source)) return null
  let at = 0
  const peek = () => source[at]
  const number = (): Q => {
    const match = source.slice(at).match(/^\d+(?:\.\d+)?/)
    if (!match) throw new Error("number expected")
    at += match[0].length
    const [whole, frac = ""] = match[0].split(".")
    let value = q(BigInt(whole + frac), 10n ** BigInt(frac.length))
    if (peek() === "%") { at++; value = div(value, q(100n)) }
    return value
  }
  const primary = (): Q => {
    if (peek() === "-") { at++; const v = primary(); return q(-v.n, v.d) }
    if (peek() === "(") { at++; const v = sum(); if (peek() !== ")") throw new Error(") expected"); at++; return v }
    return number()
  }
  const power = (): Q => {
    const base = primary()
    if (peek() !== "^") return base
    at++
    const exponent = power()
    if (exponent.d !== 1n || exponent.n < 0n || exponent.n > 12n) throw new Error("exponent")
    let result = q(1n)
    for (let i = 0n; i < exponent.n; i++) result = mul(result, base)
    return result
  }
  const product = (): Q => {
    let value = power()
    while (peek() === "*" || peek() === "/" || peek() === "(") {
      const op = peek() === "(" ? "*" : source[at++]
      const right = power()
      value = op === "*" ? mul(value, right) : div(value, right)
    }
    return value
  }
  const sum = (): Q => {
    let value = product()
    while (peek() === "+" || peek() === "-") { const op = source[at++]; const right = product(); value = op === "+" ? add(value, right) : sub(value, right) }
    return value
  }
  try {
    const value = sum()
    if (at !== source.length) return null
    if (value.n > BigInt(Number.MAX_SAFE_INTEGER) || value.n < -BigInt(Number.MAX_SAFE_INTEGER) || value.d > BigInt(Number.MAX_SAFE_INTEGER)) return null
    return { n: Number(value.n), d: Number(value.d) }
  } catch { return null }
}

/** The worked expression before any trailing "= answer", so a model may write "3/4 + 1/6 = 11/12". */
export function workValue(work: string) {
  const left = work.split("=")[0]
  return evaluate(left)
}

// ---- Readability --------------------------------------------------------------------------------

function syllables(word: string) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "")
  if (!w) return 0
  if (w.length <= 3) return 1
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g)
  return Math.max(1, groups?.length ?? 1)
}

/** Flesch–Kincaid grade of a passage, or null when it is too short to judge. */
export function readingGrade(text: string): number | null {
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) ?? []
  if (words.length < 15) return null
  const sentences = Math.max(1, (text.match(/[.!?]+(?=\s|$)/g) ?? []).length)
  const total = words.reduce((sum, word) => sum + syllables(word), 0)
  return 0.39 * (words.length / sentences) + 11.8 * (total / words.length) - 15.59
}

// ---- Copy check -----------------------------------------------------------------------------------

function grams(text: string, n: number) {
  const words = plain(text).split(" ").filter(Boolean)
  const out = new Set<string>()
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "))
  return out
}

/** True when the text repeats eight consecutive words from any source. */
export function copiesSource(text: string, sources: string[], n = 8) {
  const mine = grams(text, n)
  if (!mine.size) return false
  return sources.some((source) => [...grams(source, n)].some((gram) => mine.has(gram)))
}

// ---- Rules -------------------------------------------------------------------------------------------

/** The learner tripwire plus phrasing a model might use when writing for a child. */
export const unsafeForChild = (text: string) => Boolean(safetyReply(text)) || childSafe([text]).length > 0 || /\b(?:hurt|harm|kill|injure)\s+(?:yourself|themselves|himself|herself|someone|others|people)\b|\b(?:drugs?|alcohol|vaping|gambling)\s+(?:to|for)\s+(?:fun|kids)\b/i.test(text)

const block = (rule: string, message: string): Issue => ({ rule, message, block: true })
const warn = (rule: string, message: string): Issue => ({ rule, message, block: false })
const wordIn = (text: string, needle: string) => {
  const hay = ` ${plain(text).replace(/[^a-z0-9/.%-]+/g, " ")} `, pin = plain(needle).replace(/[^a-z0-9/.%-]+/g, " ").trim()
  return Boolean(pin) && hay.includes(` ${pin} `)
}

export function checkItem(item: PackItem, rules: QaRules): Issue[] {
  const issues: Issue[] = []
  const strings = [item.prompt, item.answer, item.explanation, ...(item.hints ?? []), ...(item.choices ?? []), item.work ?? ""]
  if (!(PACK_FORMATS as readonly string[]).includes(item.format)) return [block("format", `Unknown format ${item.format}.`)]
  if (!rules.formats.includes(item.format)) issues.push(block("format", `This kind of practice does not use ${item.format} questions.`))
  if (!Number.isInteger(item.bloom) || item.bloom < rules.bloomMin || item.bloom > rules.bloomMax) issues.push(block("bloom", `Demand ${item.bloom} is outside ${rules.bloomMin}–${rules.bloomMax}.`))
  if (item.prompt.trim().length < 8 || item.prompt.length > 700) issues.push(block("length", "The question is too short or too long."))
  if (!item.answer.trim() || item.answer.length > (item.format === "written" ? 700 : 160)) issues.push(block("length", "The answer key is missing or too long."))
  if (item.explanation.trim().length < 8 || item.explanation.length > 600) issues.push(block("explanation", "The explanation is missing or too long."))
  if (!Array.isArray(item.hints) || item.hints.length !== 3 || item.hints.some((hint) => !hint.trim() || hint.length > 260)) issues.push(block("hints", "Each question needs three short hints."))
  else if (new Set(item.hints.map(plain)).size !== 3) issues.push(block("hints", "The hints repeat each other."))
  for (const text of strings) if (text && unsafeForChild(text)) { issues.push(block("safety", "The text is not safe for a child.")); break }
  switch (item.format) {
    case "number": {
      if (!parseNumber(item.answer)) issues.push(block("key", "The answer is not a number this app can mark."))
      if (rules.requireWork && !item.work) issues.push(block("work", "Math answers need the calculation that proves them."))
      if (item.work && parseNumber(item.answer)) {
        const value = workValue(item.work), key = parseNumber(item.answer)!
        if (!value) issues.push(block("work", "The calculation could not be checked."))
        else if (value.n * key.d !== key.n * value.d) issues.push(block("key", `The calculation gives ${value.d === 1 ? value.n : `${value.n}/${value.d}`}, not ${item.answer}.`))
      }
      if (item.answer.trim().length >= 2 && item.hints?.some((hint) => wordIn(hint, item.answer))) issues.push(block("hint_reveals", "A hint gives the answer away."))
      break
    }
    case "choice": {
      const choices = item.choices ?? []
      if (choices.length < 3 || choices.length > 4) issues.push(block("choices", "Multiple choice needs three or four options."))
      if (new Set(choices.map(plain)).size !== choices.length) issues.push(block("choices", "Two options are the same."))
      if (choices.filter((choice) => plain(choice) === plain(item.answer)).length !== 1) issues.push(block("key", "The answer must be exactly one of the options."))
      if (choices.some((choice) => /\b(all|none) of the above\b/i.test(choice))) issues.push(block("choices", "Avoid all/none of the above."))
      if (item.bloom > 3) issues.push(block("bloom", "Multiple choice is for remembering, understanding and applying."))
      if (item.hints?.some((hint) => wordIn(hint, item.answer))) issues.push(block("hint_reveals", "A hint gives the answer away."))
      break
    }
    case "word": {
      if (item.answer.trim().split(/\s+/).length > 3) issues.push(block("key", "A one-word answer must be one to three words."))
      if (wordIn(item.prompt, item.answer)) issues.push(block("prompt_reveals", "The question contains its own answer."))
      if (item.hints?.some((hint) => wordIn(hint, item.answer))) issues.push(block("hint_reveals", "A hint gives the answer away."))
      if (item.bloom > 3) issues.push(block("bloom", "One-word answers are for remembering, understanding and applying."))
      break
    }
    case "written": {
      if (!/^rubric:/i.test(item.answer.trim())) issues.push(block("key", "Written answers need a rubric that starts with Rubric:."))
      if (item.bloom < 2) issues.push(block("bloom", "Written answers ask for understanding or more."))
      break
    }
  }
  if (rules.sources?.length && copiesSource(item.prompt, rules.sources)) issues.push(block("copy", "The question copies the source; write a new one on the same idea."))
  const level = readingGrade(item.prompt)
  if (level !== null && level > rules.grade + 5) issues.push(block("reading", "The question reads far above the learner's grade."))
  else if (level !== null && level > rules.grade + 3) issues.push(warn("reading", "The question may read above the learner's grade."))
  return issues
}

export function checkLesson(lesson: PackLesson): Issue[] {
  const issues: Issue[] = []
  if (!lesson.hook?.trim() || lesson.hook.length > 400) issues.push(block("lesson", "The lesson needs a short opening."))
  if (!Array.isArray(lesson.steps) || lesson.steps.length < 1 || lesson.steps.length > 4 || lesson.steps.some((step) => !step.trim() || step.length > 400)) issues.push(block("lesson", "The lesson needs one to four short steps."))
  if (!lesson.workedExample?.trim() || lesson.workedExample.length > 900) issues.push(block("lesson", "The lesson needs one worked example."))
  if (!lesson.quickCheck?.question?.trim() || !lesson.quickCheck?.answer?.trim()) issues.push(block("lesson", "The lesson needs a quick check with its answer."))
  for (const text of [lesson.hook, ...(lesson.steps ?? []), lesson.workedExample, lesson.quickCheck?.question, lesson.quickCheck?.answer]) if (text && unsafeForChild(text)) { issues.push(block("safety", "The lesson is not safe for a child.")); break }
  return issues
}

/** Runs every code rule over a draft. Duplicates are judged across the whole pack and against prompts the learner has seen. */
export function checkDraft(draft: PackDraft, rules: QaRules) {
  const seen = new Set([...(rules.seen ?? [])].map(promptIdentity))
  const reports: ItemReport[] = []
  draft.skills.forEach((skill, s) => skill.items.forEach((item, i) => {
    const issues = checkItem(item, rules)
    const identity = promptIdentity(item.prompt)
    if (seen.has(identity)) issues.push(block("repeat", "This question was already used."))
    seen.add(identity)
    reports.push({ skill: s, item: i, issues })
  }))
  const titles = draft.skills.map((skill) => plain(skill.title))
  const skillIssues = draft.skills.map((skill, s) => [
    ...(!skill.title.trim() || skill.title.length > 90 ? [block("skill", "Each skill needs a short title.")] : []),
    ...(titles.indexOf(plain(skill.title)) !== s ? [block("skill", "Two skills share a title.")] : []),
    ...(!skill.recall.trim() ? [block("skill", "Each skill needs the one idea to remember.")] : []),
  ])
  return { items: reports, skills: skillIssues, lesson: checkLesson(draft.lesson) }
}

export const blocked = (issues: Issue[]) => issues.some((issue) => issue.block)
