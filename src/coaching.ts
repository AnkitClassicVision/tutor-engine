export function coachingStage(transcript: Array<{ role: string; body: string }>, question: string): "ask" | "hint" | "explain" {
  const turns = transcript.filter(t => t.role === "student").length
  if (turns >= 2 || /\b(explain|show me|worked example|just tell me)\b/i.test(question)) return "explain"
  if (turns >= 1 || /\b(stuck|don.t know|no idea|confused)\b/i.test(question)) return "hint"
  return "ask"
}

export function questionSignal(question: string, concepts: Array<{ conceptId: string; title: string }>) {
  const text = question.toLowerCase()
  const matched = concepts.find(c => text.includes(c.title.toLowerCase()))
  // Generic "this step" questions can use the single checked topic, never an unrelated topic.
  const concept = matched ?? (concepts.length === 1 ? concepts[0] : undefined)
  if (!concept || !/\?|\b(why|how|explain|stuck|confused|don.t know|example)\b/i.test(question)) return null
  return { conceptId: concept.conceptId, need: /\b(why|how does)\b/i.test(question) ? "explain reasoning" : "clarify procedure", certainty: "learner request, not evidence of failure", source: "lesson conversation" }
}
