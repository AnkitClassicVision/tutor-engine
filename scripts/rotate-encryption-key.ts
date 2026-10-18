// Re-encrypts every value still under an older deployment key (listed in TUTOR_ENCRYPTION_KEYS_PREVIOUS) with the
// current TUTOR_ENCRYPTION_KEY: AI provider keys, ChatGPT sign-ins, student links, queued mail and each family's
// wrapped data key. Children's sealed data is untouched; only the family keys protecting it are re-wrapped.
// Safe to rerun. Prints counts only.
//   Local:  TUTOR_DB=data/tutor.sqlite node --experimental-strip-types scripts/rotate-encryption-key.ts
//   Online: node --env-file=<file with both keys> --experimental-strip-types scripts/rotate-encryption-key.ts --cloud
import type { Database } from '../src/database.ts'
import { rewrapSecret, ENCRYPTED } from '../src/secrets.ts'

async function rotate(db: Database) {
  let changed = 0, current = 0
  for (const { name: table } of await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
    for (const { name: column } of await db.prepare(`PRAGMA table_info(${table})`).all()) {
      if (column === 'rowid') continue
      const rows = await db.prepare(`SELECT rowid AS rid, ${column} AS value FROM ${table} WHERE CAST(${column} AS TEXT) LIKE 'enc:v%'`).all()
      for (const row of rows) {
        if (!ENCRYPTED.test(String(row.value))) continue
        const next = rewrapSecret(String(row.value))
        if (next === row.value) { current++; continue }
        await db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ? AND ${column} = ?`).run(next, row.rid, row.value)
        changed++
      }
    }
  }
  return { changed, current }
}

if (process.argv.includes('--cloud')) {
  const { withPostgres, closePostgres } = await import('../src/postgres.ts')
  const result = await withPostgres(rotate, true)
  await closePostgres()
  console.log(`Re-encrypted ${result.changed} values; ${result.current} were already on the current key.`)
} else {
  const { openDb } = await import('../src/db.ts')
  const db = openDb(process.env.TUTOR_DB || 'data/tutor.sqlite')
  const result = await rotate(db)
  db.close()
  console.log(`Re-encrypted ${result.changed} values; ${result.current} were already on the current key.`)
}
