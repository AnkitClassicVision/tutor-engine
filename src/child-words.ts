/**
 * Grader-facing text turned into words a child can use. Rubrics are written for the marker
 * ("accept an equivalent description … No calculation … are required"); a child needs only the idea.
 */
export function childAnswer(answer: string) {
  const raw = String(answer ?? "").trim()
  if (!/^rubric:/i.test(raw)) return raw
  let idea = raw.replace(/^rubric:\s*/i, "")
  const named = idea.match(/(?:this idea(?: or procedure)?|this procedure|idea that must be in it|must (?:include|contain|say)|should (?:include|contain|say))\s*:\s*([\s\S]+)$/i)
  if (named) idea = named[1]
  idea = idea.replace(/\s*\b(?:No (?:calculation|final answer|extra)|Do not (?:require|mark|penali[sz]e)|Don['’]t (?:require|mark)|Accept (?:any|an equivalent)|Exact wording)[\s\S]*$/i, "").trim()
  return idea ? `A good answer says: ${idea}` : "A good answer explains the idea in your own words."
}

/** A grader's reason is shown to a child only when it reads like feedback, not like marking notes. */
export function childReasonText(reason: string) {
  const text = String(reason ?? "").trim()
  if (!text || /\b(stored (?:key|rubric)|the rubric|the key|confidence|verdict|bloom|grader|model)\b/i.test(text)) return ""
  return childWords(text)
}

/** Research words in any text a child reads (reasons, notes, model sentences) become plain ones, articles included. */
export function childWords(text: string) {
  return String(text ?? "")
    .replace(/\bBloom (?:demand|level)s? (?:is|was) [A-Za-z]+\.?\s*/gi, "")
    .replace(/\bTry a fresh independent check\b/gi, "Try one on your own")
    .replace(/\b(at|level:?) (Remember|Understand|Apply|Analy[sz]e|Evaluate|Create)\b/g, (_, lead: string, level: string) => `${lead} the “${({ Remember: "remember it", Understand: "explain it", Apply: "use it", Analyze: "spot patterns", Analyse: "spot patterns", Evaluate: "judge it", Create: "make something new" } as Record<string, string>)[level]}” level`)
    .replace(/\b(?:a|an) fresh independent check\b/gi, "a fresh try on your own")
    .replace(/\bfresh independent checks\b/gi, "fresh tries on your own")
    .replace(/\b(?:a|an) independent check\b/gi, "a try on your own")
    .replace(/\bindependent checks\b/gi, "tries on your own")
    .replace(/\bindependent check\b/gi, "try on your own")
    .replace(/\b(?:two|three|a few) brief probes\b/gi, "a few quick checks")
    .replace(/\b(?:a|an) (?:brief )?probe\b/gi, "a quick check")
    .replace(/\bprobes\b/gi, "quick checks")
    .replace(/\bprobe\b/gi, "quick check")
    .replace(/\bBloom (?:demand|level)s?\b/gi, "level")
    .replace(/\bdemand\b/gi, "level")
    .replace(/Placement remains provisional\.?/gi, "We will keep adjusting.")
    .replace(/\s{2,}/g, " ").trim()
    .replace(/(^|[.!?]\s+)([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase())
}
