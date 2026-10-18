import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.ts'
import { registerUser } from '../src/auth.ts'
import { createStudent, addTalk, listStudents } from '../src/services.ts'
import { leaveNote, unreadNote } from '../src/notes.ts'
import { recordDecision } from '../src/decisions.ts'
import { deleteFamily, exportFamily } from '../src/accounts.ts'
import { FAMILY_FIELDS, SEALED_PREFIX, sealAllFamilyData } from '../src/family-crypto.ts'

process.env.TUTOR_ENCRYPTION_KEY = Buffer.alloc(32, 41).toString('base64')

async function store() {
  const dir = mkdtempSync(join(tmpdir(), 'tutor-family-crypto-'))
  const path = join(dir, 'tutor.sqlite')
  const db = openDb(path)
  const raw = new DatabaseSync(path)
  const user = await registerUser(db, `family-${Math.random()}@example.invalid`, 'synthetic-password')
  assert.ok(user.ok)
  return { db, raw, owner: user.userId, done: () => { raw.close(); db.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('children\'s names, birthdays, notes, chats and decision details are ciphertext in the database and plain in the app', async () => {
  const f = await store()
  try {
    const student = await createStudent(f.db, f.owner, { displayName: 'Synthetic Rowan', birthDate: '2017-03-04', sessionCapMinutes: 10 })
    await leaveNote(f.db, f.owner, student, 'Proud of you for the fractions')
    await addTalk(f.db, f.owner, student, { subject: 'Math', role: 'parent', body: 'Rowan struggles with long division' })
    await recordDecision(f.db, student, 'synthetic', 'A synthetic decision.', { message: 'Private parent words' })
    const rawStudent = f.raw.prepare('SELECT display_name, birth_date FROM students WHERE id = ?').get(student) as any
    assert.ok(rawStudent.display_name.startsWith(SEALED_PREFIX) && rawStudent.birth_date.startsWith(SEALED_PREFIX))
    const everything = JSON.stringify(Object.keys(FAMILY_FIELDS).map(t => f.raw.prepare(`SELECT * FROM ${t}`).all()))
    assert.doesNotMatch(everything, /Rowan|2017-03-04|fractions|long division|Private parent words/)
    assert.equal((await listStudents(f.db, f.owner))[0].display_name, 'Synthetic Rowan')
    assert.equal((await unreadNote(f.db, student))!.body, 'Proud of you for the fractions')
    // The wrapped family key is not part of a family's export.
    const exported = JSON.stringify(await exportFamily(f.db, f.owner, '/tmp/tutor-export-test'))
    assert.match(exported, /Synthetic Rowan/)
    assert.doesNotMatch(exported, /data_key|fam:v1:/)
  } finally { f.done() }
})

test('a sealed value cannot be relabelled to another family, and two families have different keys', async () => {
  const f = await store()
  try {
    const other = await registerUser(f.db, 'second-family@example.invalid', 'synthetic-password'); assert.ok(other.ok)
    const mine = await createStudent(f.db, f.owner, { displayName: 'Same Name', grade: 3, sessionCapMinutes: 10 })
    const theirs = await createStudent(f.db, other.userId, { displayName: 'Same Name', grade: 3, sessionCapMinutes: 10 })
    const keys = f.raw.prepare('SELECT data_key FROM users WHERE data_key != \'\'').all() as any[]
    assert.equal(keys.length, 2)
    assert.notEqual(keys[0].data_key, keys[1].data_key)
    const sealed = String((f.raw.prepare('SELECT display_name FROM students WHERE id = ?').get(mine) as any).display_name)
    // Swap the owner label inside the value: the authentication tag no longer matches.
    f.raw.prepare('UPDATE students SET display_name = ? WHERE id = ?').run(sealed.replace(f.owner, other.userId), theirs)
    assert.throws(() => f.db.prepare('SELECT display_name FROM students WHERE id = ?').get(theirs))
  } finally { f.done() }
})

test('values saved before encryption are sealed at startup, and a deleted family leaves nothing readable', async () => {
  const f = await store()
  try {
    const student = await createStudent(f.db, f.owner, { displayName: 'Synthetic Kai', grade: 3, sessionCapMinutes: 10 })
    f.raw.prepare('UPDATE students SET display_name = ? WHERE id = ?').run('Plain Kai', student)
    f.raw.prepare('INSERT INTO parent_notes (id, student_id, body, created_at) VALUES (?, ?, ?, ?)').run('n1', student, 'Plain note', new Date().toISOString())
    assert.ok((await sealAllFamilyData(f.db)) >= 2)
    assert.equal(await sealAllFamilyData(f.db), 0)
    assert.doesNotMatch(JSON.stringify(f.raw.prepare('SELECT * FROM students').all()) + JSON.stringify(f.raw.prepare('SELECT * FROM parent_notes').all()), /Plain/)
    assert.equal((await listStudents(f.db, f.owner))[0].display_name, 'Plain Kai')
    const leftover = String((f.raw.prepare('SELECT display_name FROM students WHERE id = ?').get(student) as any).display_name)
    await deleteFamily(f.db, f.owner, '/tmp/tutor-family-crypto-uploads')
    // A stray copy (a log line, an old backup page) of a deleted family's value opens to nothing.
    f.raw.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run('stray', 'stray@example.invalid', 'x', new Date().toISOString())
    f.raw.prepare('CREATE TABLE stray (value TEXT)').run(); f.raw.prepare('INSERT INTO stray VALUES (?)').run(leftover)
    assert.equal((f.db.prepare('SELECT value FROM stray').get() as any).value, '')
  } finally { f.done() }
})

test('after a restore gives a family a fresh key, new writes use it and earlier values are sealed again', async () => {
  const f = await store()
  try {
    const first = await createStudent(f.db, f.owner, { displayName: 'Synthetic Ada', grade: 3, sessionCapMinutes: 10 })
    const before = String((f.raw.prepare('SELECT data_key FROM users WHERE id = ?').get(f.owner) as any).data_key)
    // A restore writes opened values and clears the wrapped key.
    f.raw.prepare("UPDATE users SET data_key = '' WHERE id = ?").run(f.owner)
    f.raw.prepare('UPDATE students SET display_name = ? WHERE id = ?').run('Synthetic Ada', first)
    await createStudent(f.db, f.owner, { displayName: 'Synthetic Bea', grade: 3, sessionCapMinutes: 10 })
    await sealAllFamilyData(f.db)
    const after = String((f.raw.prepare('SELECT data_key FROM users WHERE id = ?').get(f.owner) as any).data_key)
    assert.ok(after && after !== before)
    assert.deepEqual((await listStudents(f.db, f.owner)).map(s => s.display_name).sort(), ['Synthetic Ada', 'Synthetic Bea'])
    assert.doesNotMatch(JSON.stringify(f.raw.prepare('SELECT display_name FROM students').all()), /Synthetic/)
  } finally { f.done() }
})

test('a family can be deleted by a tool that cannot open its data (no deployment key needed)', async () => {
  const f = await store()
  try {
    const { encryptSecret } = await import('../src/secrets.ts')
    const configured = process.env.TUTOR_ENCRYPTION_KEY
    process.env.TUTOR_ENCRYPTION_KEY = Buffer.alloc(32, 99).toString('base64')
    const foreign = encryptSecret(Buffer.alloc(32, 1).toString('base64'))
    process.env.TUTOR_ENCRYPTION_KEY = configured
    f.raw.prepare('UPDATE users SET data_key = ? WHERE id = ?').run(foreign, f.owner)
    f.raw.prepare("INSERT INTO students (id, owner_user_id, display_name, grade, session_cap_minutes, created_at) VALUES ('s1', ?, ?, 3, 10, ?)").run(f.owner, `${SEALED_PREFIX}${f.owner}:aaaa:bbbb:cccc`, new Date().toISOString())
    await deleteFamily(f.db, f.owner, '/tmp/tutor-family-crypto-uploads')
    assert.equal((f.raw.prepare('SELECT count(*) n FROM students').get() as any).n, 0)
  } finally { f.done() }
})
