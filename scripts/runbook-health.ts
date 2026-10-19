// Accept rate and the most common blocking rules per runbook version, from recorded runs.
//   node --experimental-strip-types scripts/runbook-health.ts [--days 30]   (uses TUTOR_DB or DATABASE_URL like the app)
import { openDb } from "../src/db.ts"
import { runbookHealth } from "../src/runbook/record.ts"

const args = process.argv.slice(2)
const days = Number(args.includes("--days") ? args[args.indexOf("--days") + 1] : 30)
const db = openDb(process.env.TUTOR_DB || "data/tutor.sqlite")
const since = new Date(Date.now() - days * 86400000).toISOString()
for (const row of await runbookHealth(db, since)) {
  const rate = row.runs ? Math.round(((row.accepted + row.pruned) / row.runs) * 100) : 0
  const top = Object.entries(row.blocks).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([rule, n]) => `${rule} ${n}`).join(", ") || "none"
  console.log(`${row.runbook}@${row.version} ${row.provider}/${row.model || "default"}: ${row.runs} runs, ${rate}% usable (${row.pruned} pruned, ${row.rejected} refused); top blocks: ${top}`)
}
