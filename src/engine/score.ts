export interface Score {
  correct: boolean
  confidence: number
}

/** Reasoning and production require a rubric verdict rather than local text matching. */
export function requiresJudgment(expected: string, bloom: number): boolean {
  if (bloom >= 4 || /^rubric:/i.test(expected.trim())) return true
  const key = normalize(expected)
  return !/^(?:[ab]|-?\d+(?:\.\d+)?(?:\/-?\d+)?|-?\d+:-?\d+|-?\d+,-?\d+|[\d+x\-^*.()]+)$/.test(key)
}

export function scoreAnswer(expected: string, raw: string): Score {
  const given = raw.trim()
  if (!given) return { correct: false, confidence: 0 }
  const left = normalize(expected)
  const right = normalize(given)
  if (left === right) return { correct: true, confidence: 1 }
  if (left.startsWith("rubric:")) return scoreRubric(expected, given)
  const a = rational(left)
  const b = rational(right)
  if (a && b && a.n * b.d === b.n * a.d) return { correct: true, confidence: 0.85 }
  return { correct: false, confidence: 1 }
}

function scoreRubric(expected: string, given: string): Score {
  const idea = expected.split(/this idea:|idea that must be in it:/i)[1] ?? expected
  const wanted = contentWords(idea)
  const said = new Set(contentWords(given))
  const hits = wanted.filter((word) => said.has(word)).length
  const longEnough = given.trim().split(/\s+/).length >= 8
  const correct = longEnough && hits >= Math.min(3, Math.max(1, Math.ceil(wanted.length * 0.34)))
  return { correct, confidence: 0.7 }
}

function contentWords(value: string) {
  const stop = new Set(["this", "that", "with", "from", "they", "them", "have", "what", "when", "where", "your", "about", "into", "would", "could", "should", "their", "there", "which", "while"])
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !stop.has(word))
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "").replace(/^a\)/, "a").replace(/^b\)/, "b")
}

function rational(value: string): { n: number; d: number } | null {
  const fraction = value.match(/^(-?\d+)\/(-?\d+)$/)
  if (fraction) {
    const n = Number(fraction[1])
    const d = Number(fraction[2])
    if (d === 0) return null
    return { n, d }
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const negative = value.startsWith("-")
    const digits = value.replace("-", "")
    const [whole, frac = ""] = digits.split(".")
    const d = 10 ** frac.length
    const n = Number(whole + frac) * (negative ? -1 : 1)
    return { n, d }
  }
  return null
}

export function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) {
    const next = x % y
    x = y
    y = next
  }
  return x || 1
}

export function fractionString(numerator: number, denominator: number): string {
  if (denominator < 0) {
    numerator *= -1
    denominator *= -1
  }
  const divisor = gcd(numerator, denominator)
  return `${numerator / divisor}/${denominator / divisor}`
}

/** How an item's answer is checked. `text` keeps the original key rules; the rest come from learning packs. */
export type ItemFormat = "text" | "number" | "choice" | "word" | "written"

export interface Gradable {
  answer: string
  format?: string | null
  choices?: string[] | null
}

const LETTERS = "abcdefgh"

/** Pack formats that code can mark exactly; everything else follows the original key rules. */
export function needsJudgment(item: Gradable, bloom: number): boolean {
  if (item.format === "choice" || item.format === "word" || item.format === "number") return false
  if (item.format === "written") return true
  return requiresJudgment(item.answer, bloom)
}

export function scoreItem(item: Gradable, raw: string): Score {
  const given = raw.trim()
  if (!given) return { correct: false, confidence: 0 }
  if (item.format === "choice") {
    const choices = item.choices ?? []
    const letter = given.match(/^\(?([a-h])[).:]?$/i)
    const picked = letter ? choices[LETTERS.indexOf(letter[1].toLowerCase())] ?? "" : given
    return { correct: plain(picked) === plain(item.answer), confidence: 1 }
  }
  if (item.format === "word") return { correct: plain(given) === plain(item.answer), confidence: 1 }
  if (item.format === "number") {
    const a = parseNumber(item.answer), b = parseNumber(given)
    if (a && b) return { correct: a.n * b.d === b.n * a.d, confidence: 1 }
    return scoreAnswer(item.answer, given)
  }
  return scoreAnswer(item.answer, given)
}

/** Lower case, single spaces, no surrounding punctuation or quotes. */
export function plain(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[“”"'‘’`]/g, "").replace(/\s+/g, " ").replace(/^[\s.,;:!?]+|[\s.,;:!?]+$/g, "").trim()
}

/** Whole numbers, decimals, fractions, mixed numbers ("1 1/2"), percentages and thousands separators, with an optional unit after. */
export function parseNumber(value: string): { n: number; d: number } | null {
  let text = value.trim().toLowerCase().replace(/^\$/, "").replace(/(\d),(?=\d{3}\b)/g, "$1")
  text = text.replace(/\s*[a-z°%]+[a-z.²³]*$/i, (unit) => (unit.trim() === "%" ? "%" : ""))
  const percent = text.endsWith("%")
  if (percent) text = text.slice(0, -1).trim()
  let result: { n: number; d: number } | null = null
  const mixed = text.match(/^(-?)(\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) {
    const d = Number(mixed[4])
    if (d) result = { n: (Number(mixed[2]) * d + Number(mixed[3])) * (mixed[1] ? -1 : 1), d }
  } else result = rational(text.replace(/\s+/g, ""))
  if (!result) return null
  return percent ? { n: result.n, d: result.d * 100 } : result
}

export type NonAttempt = "blank" | "dont_know" | "mash"

const DONT_KNOW = /^(?:i\s*)?(?:idk|dunno|don'?t\s*know|do\s*not\s*know|dont\s*no|no\s*idea|not\s*sure|forgot|i\s*forgot|skip|pass|blank|unreadable|unclear|illegible|\?+)$/i
const NUMBER_WORDS = new Set(("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million and a an half halves quarter quarters third thirds fourth fourths fifth fifths sixth sixths seventh sevenths eighth eighths ninth ninths tenth tenths twelfth twelfths point minus negative over out of").split(" "))

// Words that join number words ("a half", "three out of four") but are not a number on their own.
const CONNECTORS = new Set(["a", "an", "and", "out", "of", "over", "point", "minus", "negative"])

/**
 * A reply that is not a try at the question: nothing, "I don't know", or a keyboard mash.
 * A plausible wrong answer (say 11 for 5 × 6) is real evidence and is never classed here.
 */
export function nonAttempt(item: Gradable, raw: string): NonAttempt | null {
  const given = raw.trim()
  if (!given || /^[\p{P}\p{S}\s]+$/u.test(given)) return "blank"
  if (scoreItem(item, given).correct) return null
  const words = given.toLowerCase().replace(/[.!]+$/, "").replace(/\s+/g, " ")
  if (DONT_KNOW.test(words)) return "dont_know"
  if (/^(\D)\1{2,}$/u.test(given)) return "mash"
  // A run along a keyboard row ("asdf", "qwerty") or a long word with no vowels is a mash on any question.
  const letters = words.replace(/[^a-z]/g, "")
  if (!/\s/.test(words) && letters.length >= 4 && letters === words && (["qwertyuiop", "asdfghjkl", "zxcvbnm"].some((row) => row.includes(letters) || [...row].reverse().join("").includes(letters)) || !/[aeiouy]/.test(letters))) return "mash"
  // Three or more of one digit far from the key ("111" for 56) is a mash; "111" for 110 is a near miss and stays a try.
  if (/^(\d)\1{2,}$/.test(given) && numericKey(item.answer) !== null && Math.abs(Number(given) - numericKey(item.answer)!) > Math.abs(numericKey(item.answer)!) / 2) return "mash"
  // Letters on a number question are a mash unless they are number words ("fifty six", "three quarters").
  if (item.format !== "choice" && numericKey(item.answer) !== null && /^[a-z\s'-]+$/i.test(given)
    && !(words.split(/[\s-]+/).every((word) => NUMBER_WORDS.has(word)) && words.split(/[\s-]+/).some((word) => !CONNECTORS.has(word)))) return "mash"
  return null
}

function numericKey(expected: string): number | null {
  const key = normalize(expected)
  const value = rational(key)
  return value ? value.n / value.d : null
}
