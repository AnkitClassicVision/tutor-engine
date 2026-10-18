import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { loginUser } from '../../src/auth.ts'
import { reserveThrottle, throttleKey } from '../../src/auth-throttle.ts'
import { hashToken } from '../../src/auth.ts'

const db = new DatabaseSync(workerData.path)
db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 15000')
parentPort!.postMessage('ready')
Atomics.wait(new Int32Array(workerData.gate), 0, 0)
let accepted = 0
for (let i = 0; i < 25; i++) {
  // A wrong guess either reaches verification ("does not match") or is refused first; only the first kind counts.
  if (workerData.code ? await reserveThrottle(db as any, throttleKey('student', hashToken(workerData.code)), 5, 15 * 60000) : !/Too many/.test(String((await loginUser(db as any, 'parallel@example.invalid', 'wrong-synthetic-guess', new Date(), 5, 'synthetic-parent-source')).error))) accepted++
}
db.close()
parentPort!.postMessage(accepted)
