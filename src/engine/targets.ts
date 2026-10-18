import type { TargetRecord } from "./types.ts"

export function activeFocus(targets: TargetRecord[], today: string): TargetRecord | null {
  const dated = targets
    .filter((target) => target.kind === "target" && target.deadline != null && target.deadline >= today)
    .sort((a, b) => a.deadline!.localeCompare(b.deadline!) || b.priority - a.priority)
  if (dated.length) return dated[0]
  const programs = targets.filter((target) => target.kind === "program").sort((a, b) => b.priority - a.priority)
  if (programs.length) return programs[0]
  const curiosity = targets.filter((target) => target.kind === "curiosity").sort((a, b) => b.priority - a.priority)
  return curiosity[0] ?? null
}
