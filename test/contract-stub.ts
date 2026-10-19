// Model stubs in tests answer the parts of the runbook contract that are not under test: the writer's
// self-check and the blind reviewer. A reviewer with no answer and top ratings never blocks.
export function stubReply(system: string, result: any) {
  if (system.includes("You independently review questions")) return { items: Array.from({ length: 40 }, (_, id) => ({ id, answer: "", bloom: 6, onTopic: 5, ageFit: 5, issue: "" })) }
  if (system.includes("Self-check. Before replying") && result && typeof result === "object" && !("selfCheck" in result)) return { ...result, selfCheck: Array.from({ length: 12 }, (_, i) => ({ question: `Check ${i + 1}`, answer: "Yes, checked.", ok: true })) }
  return result
}
