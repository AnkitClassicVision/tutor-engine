import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

test('public path checker rejects private records, credentials and links while allowing runtime source and env examples', () => {
  const root = mkdtempSync(join(tmpdir(), 'public-content-'))
  const put = (name: string) => { const path = join(root, name); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, 'synthetic') }
  const check = () => spawnSync(process.execPath, ['scripts/check-public-content.mjs', root], { encoding: 'utf8' })
  try {
    for (const path of ['src/data/curriculum.json', '.env.example', '.env.production.example', 'docs/README.md']) put(path)
    assert.equal(check().status, 0)
    for (const path of ['private-learning/note.txt', 'data/answers.json', 'docs/release/record.md', '.env.production.local', 'backup.sqlite-wal', 'credential.pem']) put(path)
    symlinkSync(join(root, 'docs'), join(root, 'linked'))
    const result = check()
    assert.equal(result.status, 1)
    for (const path of ['private-learning', 'data', 'docs/release', '.env.production.local', 'backup.sqlite-wal', 'credential.pem', 'linked']) assert.ok(result.stderr.includes(path), path)
    assert.ok(!result.stderr.includes('synthetic'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
