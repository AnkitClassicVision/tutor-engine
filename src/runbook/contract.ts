// The runbook contract: one shape for every AI step, so any model can run it and the app checks the
// result the same way. Instructions live in skills/<id>/SKILL.md; this file holds what code enforces.

import type { Issue } from "./gates.ts"
import type { Schema } from "./schema.ts"

export type Role = "planner" | "coach" | "verifier"

export interface Critic<I, O> {
  /** What the reviewer is told. It sees `view(output)`, never the writer's reasoning or hidden keys unless the view includes them. */
  brief: string
  schema: Schema
  view: (output: O, input: I) => unknown
  /** Turns the reviewer's reply into issues against the output. */
  judge: (verdict: Record<string, unknown>, output: O, input: I) => Issue[]
}

export interface Contract<I, O> {
  /** The AI step, e.g. "fresh-practice". Recorded with every run. */
  id: string
  /** Bump when the step's instructions or rules change; a test holds the instruction text to it. */
  version: number
  role: Role
  /** Runbooks (skills/<name>/SKILL.md) whose instructions apply, primary first. */
  skills: string[]
  /** Extra instructions computed from the input. */
  brief?: (input: I) => string
  /** The reply shape without `selfCheck`; the runner adds that field. */
  schema: Schema
  /** Questions the model answers about its own output. A "no" blocks it. */
  selfCheck: string[]
  /** The data the model reads. Treated as data, never instructions. */
  prompt: (input: I) => unknown
  /** Shape the checked reply into the typed output. Throw to reject it. */
  parse: (reply: Record<string, unknown>, input: I) => O
  /** Code rules. Issues with `item` can be pruned instead of failing the whole output. */
  gate: (output: O, input: I) => Issue[]
  /** Drop the listed items. Return null when what remains is not usable. */
  prune?: (output: O, items: Set<number>, input: I) => O | null
  critic?: Critic<I, O>
  /** Extra writer attempts after a blocked reply. Default 1. */
  repairs?: number
  timeoutMs?: number
  maxTokens?: number
}

export interface SelfCheckAnswer { question: string; answer: string; ok: boolean }

export interface RunReport {
  runbook: string
  version: number
  role: Role
  provider: string
  model: string
  outcome: "accepted" | "pruned" | "rejected"
  attempts: number
  issues: Issue[]
  critic: { ran: boolean; provider?: string; model?: string; issues: Issue[] }
  selfCheck: SelfCheckAnswer[]
  ms: number
}

export interface RunResult<O> { output: O | null; report: RunReport }
