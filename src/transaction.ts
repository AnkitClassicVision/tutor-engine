import { AsyncLocalStorage } from 'node:async_hooks'
import type { Database } from './database.ts'

const scopes = new AsyncLocalStorage<Set<Database>>()
const queues = new WeakMap<Database, Promise<void>>()
const effects = new WeakMap<Database, Array<Array<() => Promise<void>>>>()

// SQLite has one connection locally. Serialize request scopes and writer callbacks;
// nested calls retain ownership. PostgreSQL uses a separate connection per scope.
export async function withDatabaseScope<T>(db: Database, fn: () => Promise<T>): Promise<T> {
  if ('dialect' in db || scopes.getStore()?.has(db)) return fn()
  const previous = queues.get(db) ?? Promise.resolve()
  let release!: () => void
  const next = new Promise<void>(resolve => { release = resolve })
  queues.set(db, previous.then(() => next))
  await previous
  const owned = new Set(scopes.getStore()); owned.add(db)
  try { return await scopes.run(owned, fn) }
  finally { release() }
}
export function onWriteRollback(db: Database, undo: () => Promise<void>) {
  effects.get(db)?.at(-1)?.push(undo)
}
export async function lockFamily(db: Database, owner: string) {
  if ('dialect' in db && db.isTransaction) {
    if (!(await db.prepare('SELECT id FROM users WHERE id = ? FOR UPDATE').get(owner))) throw new Error('Family account not found.')
  }
}
export async function withWrite<T>(db: Database, fn: () => Promise<T>): Promise<T> {
  return withDatabaseScope(db, async () => {
    const nested = db.isTransaction, point = `write_${crypto.randomUUID().replaceAll('-', '')}`
    const frames = effects.get(db) ?? []; effects.set(db, frames)
    await db.exec(nested ? `SAVEPOINT ${point}` : 'BEGIN IMMEDIATE')
    const frame: Array<() => Promise<void>> = []; frames.push(frame)
    try {
      const result = await fn()
      await db.exec(nested ? `RELEASE ${point}` : 'COMMIT')
      frames.pop(); frames.at(-1)?.push(...frame)
      return result
    } catch (e) {
      if (nested) { await db.exec(`ROLLBACK TO ${point}`); await db.exec(`RELEASE ${point}`) }
      else await db.exec('ROLLBACK')
      frames.pop()
      for (const undo of frame.reverse()) {
        try { await undo() } catch { console.error('Private file cleanup requires a retry.') }
      }
      throw e
    }
  })
}
