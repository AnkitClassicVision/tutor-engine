// Access support versus the skill a question measures (owner decision, 2026-10-19). Reading a question aloud
// supplies the skill in a reading check, and a spoken answer supplies it in a spelling check; elsewhere both
// are access support that leaves independence unchanged. See docs/ux/RESEARCH.md.
// The subject is the question's own (its concept), not the mission's: a mission can mix in reviews from other subjects.
// Known limits of reading the subject's name: "Map reading" counts as reading, and plain "English" as reasoning.

export type MeasuredSkill = "reading" | "spelling" | "reasoning"

/** The skill a subject's questions measure, from the subject's name. Anything else (maths, science…) is reasoning. */
export function measuredSkill(subject: unknown): MeasuredSkill {
  const name = String(subject ?? "")
  if (/\bspell/i.test(name)) return "spelling"
  if (/\b(reading|phonics|decod\w*|literacy|ela)\b|english language arts/i.test(name)) return "reading"
  return "reasoning"
}

/** True when the access support used supplied the skill being measured, so the attempt counts as supported. */
export function supportSuppliesSkill(skill: MeasuredSkill, access: string[] | undefined) {
  return (skill === "reading" && Boolean(access?.includes("read_aloud"))) || (skill === "spelling" && Boolean(access?.includes("voice_entry")))
}

/** The subject a question belongs to: a family's own concept carries its subject; built-in concepts are maths. */
export function conceptSubject(conceptId: unknown, custom: Map<string, string>, fallback: unknown) {
  const id = String(conceptId ?? "")
  return custom.get(id) ?? (id.startsWith("math.") ? "Math" : String(fallback ?? ""))
}
