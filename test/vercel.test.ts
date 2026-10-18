import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('hosted request retains its background work before sending the response', () => {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--experimental-strip-types', '--test', fileURLToPath(new URL('./fixtures/vercel-runtime.ts',import.meta.url))], { encoding: 'utf8', env })
  assert.equal(result.status,0,result.stdout + result.stderr)
})
