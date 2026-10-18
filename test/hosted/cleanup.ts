import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { withPostgres, closePostgres } from '../../src/postgres.ts'
import { deleteFamily } from '../../src/accounts.ts'

const ledger = resolve('data/backups/hosted-fixture-ids.json')
// IDs only: never persist fixture passwords, tokens or real parent records.
export function trackFixture(owner: string) {
  mkdirSync(dirname(ledger), { recursive: true, mode: 0o700 })
  const ids: string[] = existsSync(ledger) ? JSON.parse(readFileSync(ledger,'utf8')) : []
  if (!ids.includes(owner)) ids.push(owner)
  writeFileSync(ledger,JSON.stringify(ids), { mode: 0o600 })
}
export default async function cleanupFixtures() {
  if (!existsSync(ledger)) return
  const ids: string[] = JSON.parse(readFileSync(ledger,'utf8'))
  try {
    for (const owner of ids) await withPostgres(async db => {
      const row = await db.prepare('SELECT id FROM users WHERE id = ?').get(owner)
      if (!row) return
      if (!await db.prepare("SELECT id FROM users WHERE id = ? AND email LIKE 'hosted-%@example.invalid'").get(owner)) throw new Error('Fixture cleanup ownership guard failed.')
      await deleteFamily(db,owner,'/tmp/tutor-hosted-fixtures')
    },true)
    unlinkSync(ledger)
  } finally { await closePostgres() }
}
