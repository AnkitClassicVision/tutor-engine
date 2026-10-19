// Records the instruction fingerprint for each runbook step after its version was bumped.
// A changed fingerprint at an unchanged version is refused: bump the contract version first.
import { readFileSync, writeFileSync } from "node:fs"
import { CONTRACTS } from "../src/runbook/registry.ts"
import { fingerprint, goldenCases } from "../src/runbook/golden.ts"

const path = new URL("../src/runbook/versions.json", import.meta.url)
const lock = JSON.parse(readFileSync(path, "utf8")) as Record<string, { version: number; fingerprint: string }>
let failed = false
for (const contract of CONTRACTS) {
  const now = fingerprint(contract, goldenCases(contract.id)[0]?.input ?? {})
  const held = lock[contract.id]
  if (held && held.version === contract.version && held.fingerprint !== now) { console.error(`${contract.id}: instructions changed at version ${contract.version}; bump the version.`); failed = true; continue }
  if (!held || held.version < contract.version) { lock[contract.id] = { version: contract.version, fingerprint: now }; console.log(`${contract.id}: locked version ${contract.version}`) }
}
writeFileSync(path, JSON.stringify(Object.fromEntries(Object.entries(lock).sort()), null, 1) + "\n")
if (failed) process.exit(1)
