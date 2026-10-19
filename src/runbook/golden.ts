// Golden cases: fixed inputs with scripted model replies and the outcome the checks must reach.
// They run in CI with a stub model, and on demand against a real model (scripts/eval-runbooks.ts).

import { createHash } from "node:crypto"
import { readFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Contract, RunReport } from "./contract.ts"
import type { Ask, AskPurpose } from "./run.ts"
import { replySchema, systemFor } from "./run.ts"

export interface GoldenCase {
  name: string
  input: unknown
  /** Scripted replies by purpose; {"sequence": [...]} scripts successive calls. */
  replies: Partial<Record<AskPurpose, unknown>>
  expect: { outcome: RunReport["outcome"]; rules?: string[]; absent?: string[] }
  /** Include in live model evaluation. */
  live?: boolean
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../../eval/golden")

export function goldenCases(id: string): GoldenCase[] {
  const path = join(root, `${id}.json`)
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as GoldenCase[] : []
}

export function scriptedAsk(replies: GoldenCase["replies"]): { ask: Ask; calls: AskPurpose[] } {
  const used: Partial<Record<AskPurpose, number>> = {}
  const calls: AskPurpose[] = []
  const ask: Ask = async ({ purpose }) => {
    calls.push(purpose)
    // Repairs continue the write script unless they have their own.
    const source: AskPurpose = purpose === "repair" && replies.repair === undefined ? "write" : purpose
    const scripted = replies[source]
    if (scripted === undefined) throw new Error(`No scripted ${purpose} reply`)
    // {"sequence": [...]} scripts successive calls; anything else is the reply to every call.
    const list = scripted && typeof scripted === "object" && Array.isArray((scripted as { sequence?: unknown[] }).sequence) ? (scripted as { sequence: unknown[] }).sequence : [scripted]
    const index = Math.min(used[source] ?? 0, list.length - 1)
    used[source] = (used[source] ?? 0) + 1
    const reply = list[index]
    return typeof reply === "string" ? reply : JSON.stringify(reply)
  }
  return { ask, calls }
}

/** A fingerprint of everything the model is told. A change without a version bump fails the lock test. */
export function fingerprint(contract: Contract<any, any>, sample: unknown) {
  return createHash("sha256").update(JSON.stringify([systemFor(contract, sample), replySchema(contract), contract.critic?.brief ?? "", contract.critic?.schema ?? null])).digest("hex").slice(0, 16)
}
