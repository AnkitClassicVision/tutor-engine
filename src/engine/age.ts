// Age bands (panel round 2, item 2). One rule decides how a learner's screens look;
// scoring and evidence are the same in every band.
export type AgeBand = "5-7" | "8-10" | "11-14"
export const BANDS: readonly AgeBand[] = ["5-7", "8-10", "11-14"]
/** Stored values: "auto" follows age; the older "junior" and "explorer" settings still work. */
export const PRESENTATIONS = ["auto", "5-7", "8-10", "11-14", "junior", "explorer"] as const

export function ageBand(student: { presentation?: unknown; birth_date?: unknown; grade?: unknown }, now = Date.now()): AgeBand {
  const chosen = String(student.presentation ?? "auto")
  if ((BANDS as readonly string[]).includes(chosen)) return chosen as AgeBand
  if (chosen === "junior") return "8-10"
  if (chosen === "explorer") return "11-14"
  const age = student.birth_date ? (now - Date.parse(String(student.birth_date))) / (365.25 * 86400000) : Number(student.grade) + 5.5
  return age < 8 ? "5-7" : age < 11 ? "8-10" : "11-14"
}

/** The two existing presentations: the younger bands share the junior look. */
export function presentationFor(band: AgeBand): "junior" | "explorer" {
  return band === "11-14" ? "explorer" : "junior"
}

export const BAND_LABEL: Record<AgeBand, string> = { "5-7": "Ages 5–7", "8-10": "Ages 8–10", "11-14": "Ages 11–14" }

/**
 * Four tiles for a whole-number answer: the answer and three near misses a young
 * learner might really choose (off by one or ten, or adding instead of multiplying).
 * Returns null when the answer is not a small whole number.
 */
export function numberChoices(answer: string, prompt: string, seed: number): string[] | null {
  if (!/^\d{1,4}$/.test(answer.trim())) return null
  const value = Number(answer)
  const operands = (prompt.match(/\d+/g) ?? []).map(Number)
  const candidates: number[] = []
  if (operands.length >= 2) {
    const [a, b] = operands
    if (a * b === value) candidates.push(a + b, a * (b + 1), a * (b - 1))
    if (a + b === value) candidates.push(Math.abs(a - b), a + b + 1)
    if (a - b === value) candidates.push(a + b)
    if (b && a / b === value) candidates.push(a - b, a * b)
  }
  candidates.push(value + 1, value - 1, value + 10, value - 10, value + 2)
  const distractors = [...new Set(candidates.filter((n) => Number.isInteger(n) && n >= 0 && n !== value))].slice(0, 3)
  if (distractors.length < 3) return null
  const tiles = [String(value), ...distractors.map(String)]
  // A stable shuffle, so the same item always shows its tiles in the same order.
  let state = seed >>> 0 || 1
  for (let i = tiles.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) >>> 0
    const j = state % (i + 1);
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]]
  }
  return tiles
}
