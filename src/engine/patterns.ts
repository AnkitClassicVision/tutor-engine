export interface PatternItem {
  title: string
  prompt: string
  given: string
  correct: boolean
  errorType: string | null
}

export interface PatternHistory {
  overt: string
  subtle: string
}

export interface PatternNote {
  overt: string
  subtle: string
  trend: string
  nextMove: string
}

export function readPatterns(input: { subject: string; items: PatternItem[]; history: PatternHistory[] }): PatternNote {
  const items = input.items
  const held = items.filter((item) => item.correct).length
  const misses = items.filter((item) => !item.correct)
  const byTitle = new Map<string, number>()
  for (const miss of misses) byTitle.set(miss.title, (byTitle.get(miss.title) ?? 0) + 1)
  const leading = [...byTitle.entries()].sort((a, b) => b[1] - a[1])[0]
  const overt = leading
    ? `They held ${held} of ${items.length} in ${input.subject}. ${leading[0]} took ${leading[1]} ${leading[1] === 1 ? "miss" : "misses"}. That is the overt gap.`
    : `They held ${held} of ${items.length} in ${input.subject}. Nothing overt slipped. The work can stretch.`

  const subtle = quieter(misses, items)
  const trend = overTime(input.history, subtle, leading?.[0] ?? "")
  const nextMove = faster(subtle, leading?.[0] ?? input.subject)
  return { overt, subtle, trend, nextMove }
}

function quieter(misses: PatternItem[], items: PatternItem[]) {
  const said = misses.map((item) => item.given.trim()).filter(Boolean)
  const short = said.filter((text) => text.split(/\s+/).length < 5)
  if (misses.length && short.length >= Math.ceil(misses.length * 0.6)) {
    return "The quieter pattern is length. Most misses are only a few words. Length alone does not explain the error. Ask what the student meant before choosing support."
  }
  const repeated = repeatedPhrase(said)
  if (repeated) {
    return `The quieter pattern is a repeated phrase: "${repeated}". That phrase is standing in for the idea.`
  }
  const createMiss = misses.some((item) => /write two or three|write a test/i.test(item.prompt))
  const applyHeld = items.some((item) => item.correct && /map of|looking at|source about/i.test(item.prompt))
  if (createMiss && applyHeld) {
    return "The case is landing. Making a new example is where the work falls apart. That split is easy to miss if you only count total misses."
  }
  const kinds = misses.map((item) => item.errorType).filter(Boolean)
  const sameKind = kinds.length >= 2 && kinds.every((kind) => kind === kinds[0])
  if (sameKind) return `The misses are the same kind: ${plainKind(String(kinds[0]))}. One label is hiding several items.`
  if (!misses.length) return "No quieter miss showed up. Watch whether the next stretch still uses the idea, or only the label."
  return "The misses are not one repeated phrase. They scatter, so the next check should stay on the leading topic instead of adding a new one."
}

function overTime(history: PatternHistory[], subtle: string, title: string) {
  if (!history.length) return "This is the first stored read for this class. The next checks will show whether it holds."
  const shortAgain = /few words/.test(subtle) && history.some((note) => /few words/.test(note.subtle))
  if (shortAgain) return "Short answers showed up again. That pattern is lasting across checks, not a one-time slip."
  const sameTopic = title && history.some((note) => note.overt.includes(title))
  if (sameTopic) return `${title} is leading again. That is the larger trend, not just this check.`
  const phraseAgain = /repeated phrase/.test(subtle) && history.some((note) => /repeated phrase/.test(note.subtle))
  if (phraseAgain) return "The same stand-in phrase is back. The trend is the phrase, not the topic title."
  return "The last stored check pointed somewhere else. This one moved. Keep both notes. A trend needs one more check before it is firm."
}

function faster(subtle: string, title: string) {
  if (/few words/.test(subtle)) return `Ask a clarifying question on ${title}, then offer a hint or worked example. Score the idea against the rubric; do not require extra sentences merely because an answer is short.`
  if (/repeated phrase/.test(subtle)) return `Put that repeated phrase next to a case where it breaks. Ask which one fits ${title}, and why.`
  if (/new example/.test(subtle)) return `Keep the case they can already do. The next item should make them create an example of ${title}, not recognize one.`
  if (/No quieter/.test(subtle)) return `Stretch ${title} in a new place. Do not drill the same case again.`
  return `Stay on ${title} for the next homework and the next test. Change the place. Do not add a new topic yet.`
}

function repeatedPhrase(answers: string[]) {
  const counts = new Map<string, number>()
  for (const answer of answers) {
    const key = answer.toLowerCase().replace(/\s+/g, " ").trim()
    if (key.length < 2) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const found = [...counts.entries()].find((entry) => entry[1] >= 2)
  return found ? found[0] : ""
}

function plainKind(error: string) {
  if (error === "retrieval_gap") return "the idea does not come back from memory"
  if (error === "procedural_slip") return "a step slips"
  if (error === "misconception") return "a wrong rule used twice"
  if (error === "decoding") return "the wording of the question"
  if (error === "attention") return "the work fading late in the set"
  if (error === "transfer_failure") return "the idea not moving to a new case"
  return "one repeated kind of miss"
}
