import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { skillText } from "./skill-text.ts"

const root = dirname(fileURLToPath(import.meta.url))

/** Shared pedagogy supplied before provider dispatch, for proposals and course builds. */
export function coursePlanningBrief(): string {
  const spec = readFileSync(join(root, "../Tutor Engine — The Shape (v1 spec).md"), "utf8")
  const start = spec.indexOf("## Layer 0")
  const end = spec.indexOf("## Device mapping")
  if (start < 0 || end <= start) throw new Error("The Tutor Engine curriculum spec is missing.")
  const decisions = readFileSync(join(root, "../docs/DECISIONS.md"), "utf8")
  const conflicts = decisions.indexOf("## Conflict calls inside the spec")
  if (conflicts < 0) throw new Error("The Tutor Engine implementation choices are missing.")
  return [
    skillText("plan-course"),
    skillText("update-learning-path"),
    skillText("record-learning-decisions"),
    `Source excerpt from the v1 spec:\n${spec.slice(start, end).trim()}`,
    `Recorded implementation choices:\n${decisions.slice(conflicts).trim()}`,
  ].join("\n\n")
}
