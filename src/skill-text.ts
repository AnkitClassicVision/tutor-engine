import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(fileURLToPath(import.meta.url))

export const skillPath = (name: string, file = "SKILL.md") => join(root, "../skills", name, file)

export function skillText(name: string) {
  return readFileSync(skillPath(name), "utf8")
    .replace(/^---[\s\S]*?---\s*/, "")
    .trim()
}

/** The front matter of a runbook: plain `key: value` lines between the opening `---` fences. */
export function skillMeta(name: string): Record<string, string> {
  const block = readFileSync(skillPath(name), "utf8").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ""
  const fields: Record<string, string> = {}
  for (const line of block.split("\n")) {
    const at = line.indexOf(":")
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return fields
}
