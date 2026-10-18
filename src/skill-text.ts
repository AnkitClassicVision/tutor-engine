import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(fileURLToPath(import.meta.url))

export function skillText(name: string) {
  return readFileSync(join(root, "../skills", name, "SKILL.md"), "utf8")
    .replace(/^---[\s\S]*?---\s*/, "")
    .trim()
}
