import { randomUUID } from "node:crypto"
import type { Database as DatabaseSync } from "../database.ts"
import type { RunReport } from "./contract.ts"
import type { Issue } from "./gates.ts"

// Counts of rule names only. Issue messages and reviewer text can quote learner material, so they
// never reach this table.
const tally = (issues: Issue[]) => {
  const counts: Record<string, { block: number; warn: number }> = {}
  for (const found of issues) {
    const entry = counts[found.rule] ??= { block: 0, warn: 0 }
    if (found.block) entry.block++; else entry.warn++
  }
  return counts
}

export async function recordRun(db: DatabaseSync, ownerUserId: string, studentId: string | null, report: RunReport, now = new Date()) {
  await db.prepare(`INSERT INTO runbook_runs (id, owner_user_id, student_id, runbook, version, role, provider, model, outcome, attempts, rules, critic, ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    randomUUID(), ownerUserId, studentId, report.runbook, report.version, report.role, report.provider, report.model.slice(0, 120), report.outcome, report.attempts,
    JSON.stringify(tally(report.issues.filter(found => !report.critic.issues.includes(found)))),
    JSON.stringify({ ran: report.critic.ran, provider: report.critic.provider ?? "", model: (report.critic.model ?? "").slice(0, 120), rules: tally(report.critic.issues) }),
    report.ms, now.toISOString(),
  )
}

/** Accept rate and the most common blocking rules per runbook version, for the quality page and the eval script. */
export async function runbookHealth(db: DatabaseSync, since: string) {
  const rows = await db.prepare("SELECT runbook, version, provider, model, outcome, rules, critic FROM runbook_runs WHERE created_at >= ?").all(since) as Array<Record<string, string>>
  const groups = new Map<string, { runbook: string; version: number; provider: string; model: string; runs: number; accepted: number; pruned: number; rejected: number; blocks: Record<string, number> }>()
  for (const row of rows) {
    const key = `${row.runbook}@${row.version}|${row.provider}|${row.model}`
    const group = groups.get(key) ?? { runbook: row.runbook, version: Number(row.version), provider: row.provider, model: row.model, runs: 0, accepted: 0, pruned: 0, rejected: 0, blocks: {} }
    group.runs++
    group[row.outcome as "accepted" | "pruned" | "rejected"]++
    const rules = { ...JSON.parse(row.rules || "{}"), ...(JSON.parse(row.critic || "{}").rules ?? {}) } as Record<string, { block: number }>
    for (const [rule, counts] of Object.entries(rules)) if (counts.block) group.blocks[rule] = (group.blocks[rule] ?? 0) + counts.block
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => a.runbook.localeCompare(b.runbook) || b.version - a.version)
}
