import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { stripImageMetadata, validateImage } from '../src/image-validation.ts'
import { openDb } from '../src/db.ts'
import { registerUser } from '../src/auth.ts'
import { deleteFamily } from '../src/accounts.ts'
import { createStudent, getUpload, saveUpload } from '../src/services.ts'
import { completeUpload } from '../src/direct-uploads.ts'
import { reserveUpload } from '../src/upload-reservations.ts'
import { sweepPrivateFiles } from '../src/file-erasures.ts'
import type { storePrivateFile } from '../src/storage.ts'

process.env.TUTOR_ENCRYPTION_KEY = Buffer.alloc(32, 29).toString('base64')
process.env.TUTOR_STORAGE = 'local'

function segment(marker: number, data: Buffer) {
  const header = Buffer.from([255, marker, 0, 0]); header.writeUInt16BE(data.length + 2, 2)
  return Buffer.concat([header, data])
}
function exif(orientation: number, little = true) {
  const description = Buffer.from('GPS-private-location\0'), tiff = Buffer.alloc(112 + description.length)
  const short = (at: number, value: number) => little ? tiff.writeUInt16LE(value, at) : tiff.writeUInt16BE(value, at)
  const long = (at: number, value: number) => little ? tiff.writeUInt32LE(value, at) : tiff.writeUInt32BE(value, at)
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    short(at, tag); short(at + 2, type); long(at + 4, count)
    if (type === 3) short(at + 8, value)
    else long(at + 8, value)
  }
  tiff.write(little ? 'II' : 'MM'); short(2, 42); long(4, 16); short(16, 3)
  entry(18, 0x0112, 3, 1, orientation); entry(30, 0x8825, 4, 1, 58); entry(42, 0x010e, 2, description.length, 112)
  short(58, 2); entry(60, 1, 2, 2, 0); tiff[68] = 78; entry(72, 2, 5, 3, 88)
  for (let i = 0; i < 3; i++) { long(88 + i * 8, 40 + i); long(92 + i * 8, 1) }
  description.copy(tiff, 112)
  return segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0'), tiff]))
}
const jfif = segment(0xe0, Buffer.from('4a46494600010100000100010000', 'hex'))
const icc = segment(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0'), Buffer.from([1, 1]), Buffer.from('synthetic-profile')]))
const xmp = segment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<xmp>private-XMP</xmp>'))
const comment = segment(0xfe, Buffer.from('private-comment'))
function jpeg(metadata: Buffer[] = []) {
  const table = (id: number) => Buffer.from([id, 1, ...Array(15).fill(0), 0])
  return Buffer.concat([Buffer.from([255, 216]), jfif, icc, ...metadata,
    segment(0xdb, Buffer.from([0, ...Array(64).fill(1)])), segment(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
    segment(0xc4, Buffer.concat([table(0), table(0x10)])), segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from([0x3f, 255, 217])])
}
function jpegParts(bytes: Buffer) {
  const segments: { marker: number; data: Buffer }[] = []
  let at = 2
  while (bytes[at + 1] !== 0xda) {
    const end = at + 2 + bytes.readUInt16BE(at + 2)
    segments.push({ marker: bytes[at + 1], data: bytes.subarray(at + 4, end) }); at = end
  }
  return { segments, scan: bytes.subarray(at) }
}
function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4), content = Buffer.concat([Buffer.from(type), data])
  length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(content))
  return Buffer.concat([length, content, checksum])
}
function png(metadata: Buffer[] = []) {
  const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('sRGB', Buffer.from([0])),
    chunk('IDAT', deflateSync(Buffer.from([0, 120, 80, 40]))), ...metadata, chunk('IEND', Buffer.alloc(0))])
}
const pngMetadata = [chunk('tEXt', Buffer.from('Comment\0private-text')), chunk('eXIf', exif(6).subarray(10)),
  chunk('iTXt', Buffer.from('Comment\0\0\0\0\0private-international-text')), chunk('zTXt', Buffer.concat([Buffer.from('Comment\0\0'), deflateSync(Buffer.from('private-compressed-text'))])),
  chunk('tIME', Buffer.from([7, 234, 10, 18, 12, 0, 0]))]

for (const little of [true, false]) test(`JPEG strips GPS, XMP and comments but keeps only Orientation 6 (${little ? 'little' : 'big'} endian)`, () => {
  const original = jpeg([xmp, exif(6, little), comment, exif(6, little)]), copy = Buffer.from(original)
  const stripped = stripImageMetadata(original), before = jpegParts(original), after = jpegParts(stripped)
  assert.deepEqual(validateImage(stripped, 'image/jpeg'), { width: 1, height: 1 })
  assert.doesNotMatch(stripped.toString('latin1'), /GPS-private-location|private-XMP|private-comment|ns\.adobe/)
  const apps = after.segments.filter(s => s.marker === 0xe1)
  assert.equal(apps.length, 1)
  const data = apps[0].data
  assert.equal(data.length, 32)
  assert.equal(data.toString('ascii', 0, 6), 'Exif\0\0')
  const tiff = data.subarray(6)
  assert.equal(tiff.toString('ascii', 0, 2), 'II')
  assert.equal(tiff.readUInt16LE(2), 42)
  assert.equal(tiff.readUInt32LE(4), 8)
  assert.equal(tiff.readUInt16LE(8), 1)
  assert.equal(tiff.readUInt16LE(10), 0x0112)
  assert.equal(tiff.readUInt16LE(12), 3)
  assert.equal(tiff.readUInt32LE(14), 1)
  assert.equal(tiff.readUInt16LE(18), 6)
  assert.equal(tiff.readUInt16LE(20), 0)
  assert.equal(tiff.readUInt32LE(22), 0)
  assert.deepEqual(after.segments.filter(s => s.marker !== 0xe1), jpegParts(jpeg()).segments)
  assert.deepEqual(after.scan, before.scan)
  assert.deepEqual(stripImageMetadata(stripped), stripped)
  assert.deepEqual(original, copy)
})

test('JPEG Orientation 1 needs no Exif; all other valid orientations are retained', () => {
  for (const little of [true, false]) {
    assert.deepEqual(stripImageMetadata(jpeg([exif(1, little), xmp, comment])), jpeg())
    for (let orientation = 2; orientation <= 8; orientation++) {
      const stripped = stripImageMetadata(jpeg([exif(orientation, little)]))
      assert.equal(jpegParts(stripped).segments.find(s => s.marker === 0xe1)!.data.readUInt16LE(24), orientation)
      validateImage(stripped, 'image/jpeg')
    }
  }
})

test('JPEG drops APP3–APP15 and non-ICC APP2 while keeping JFIF, ICC and scan bytes', () => {
  const metadata = [segment(0xe2, Buffer.from('private-non-ICC')), ...Array.from({ length: 13 }, (_, i) => segment(0xe3 + i, Buffer.from('private-app-data')))]
  const stripped = stripImageMetadata(jpeg(metadata))
  assert.deepEqual(stripped, jpeg())
  validateImage(stripped, 'image/jpeg')
})

test('malformed Exif offsets, counts, types and orientations are discarded safely', () => {
  const malformed = [Buffer.from('Exif\0\0'), exif(0).subarray(4), exif(9).subarray(4), exif(6).subarray(4, 30)]
  for (const [offset, value, size] of [[8, 0, 2], [10, 0xffffffff, 4], [22, 0xffff, 2], [26, 4, 2], [28, 2, 4]]) {
    const data = Buffer.from(exif(6).subarray(4))
    if (size === 2) data.writeUInt16LE(value, offset)
    else data.writeUInt32LE(value, offset)
    malformed.push(data)
  }
  for (const data of malformed) {
    const original = jpeg([segment(0xe1, data)])
    validateImage(original, 'image/jpeg')
    assert.deepEqual(stripImageMetadata(original), jpeg())
  }
})

test('PNG drops text, Exif and time chunks and preserves all other chunks and CRCs', () => {
  const original = png(pngMetadata), copy = Buffer.from(original)
  validateImage(original, 'image/png')
  const stripped = stripImageMetadata(original)
  assert.deepEqual(stripped, png())
  assert.doesNotMatch(stripped.toString('latin1'), /tEXt|iTXt|zTXt|eXIf|tIME|private/)
  assert.deepEqual(validateImage(stripped, 'image/png'), { width: 1, height: 1 })
  assert.deepEqual(original, copy)
})

test('images without metadata and unsupported types are returned byte-identical', () => {
  for (const [bytes, mime] of [[jpeg(), 'image/jpeg'], [png(), 'image/png']] as const) {
    assert.equal(stripImageMetadata(bytes), bytes)
    validateImage(stripImageMetadata(bytes), mime)
  }
  const other = Buffer.from('unsupported synthetic image')
  assert.equal(stripImageMetadata(other), other)
})

async function family() {
  const db = openDb(':memory:'), user = await registerUser(db, 'metadata@example.invalid', 'synthetic-password')
  assert.ok(user.ok)
  const student = await createStudent(db, user.userId, { displayName: 'Synthetic learner', grade: 4, sessionCapMinutes: 10 })
  return { db, owner: user.userId, student }
}
const photos = () => [[jpeg([exif(6), xmp, comment]), 'image/jpeg'], [png(pngMetadata), 'image/png']] as const

test('local uploads store stripped photo bytes and release reservations', async () => {
  const f = await family(), root = mkdtempSync(join(tmpdir(), 'tutor-image-metadata-'))
  try {
    for (const [bytes, mime] of photos()) {
      const id = await saveUpload(f.db, f.owner, f.student, { mime, base64: bytes.toString('base64') }, root)
      const upload = await getUpload(f.db, f.owner, id), stored = readFileSync(upload!.stored_path)
      assert.notDeepEqual(stored, bytes)
      assert.deepEqual(stored, stripImageMetadata(bytes))
      validateImage(stored, mime)
      assert.equal(await getUpload(f.db, crypto.randomUUID(), id), undefined)
    }
    assert.equal(f.db.prepare('SELECT count(*) n FROM uploads').get()!.n, 2)
    assert.equal(f.db.prepare('SELECT count(*) n FROM upload_intents').get()!.n, 0)
  } finally { f.db.close(); rmSync(root, { recursive: true, force: true }) }
})

test('direct completion overwrites the same private object before completing, enforces ownership and erases it on family deletion', async () => {
  const f = await family(), root = '/tmp/synthetic-image-metadata'
  try {
    const otherStudent = await createStudent(f.db, f.owner, { displayName: 'Other synthetic learner', grade: 4, sessionCapMinutes: 10 })
    for (const [original, mime] of photos()) {
      const id = crypto.randomUUID(), name = `${id}.${mime === 'image/png' ? 'png' : 'jpg'}`, path = `blob:families/${f.owner}/uploads/${name}`
      await reserveUpload(f.db, f.owner, f.student, id, path, mime)
      let stored = original, reads = 0, writes = 0
      const storage = {
        read: async (target: string) => { assert.equal(target, path); reads++; return stored },
        write: (async (dir, owner, file, bytes, contentType, kind, overwrite) => {
          assert.deepEqual([dir, owner, file, contentType, kind, overwrite], [root, f.owner, name, mime, 'uploads', true])
          assert.equal(await getUpload(f.db, f.owner, id), undefined)
          assert.equal(f.db.prepare('SELECT completed_at FROM upload_intents WHERE id = ?').get(id)!.completed_at, null)
          stored = bytes; writes++; return path
        }) as typeof storePrivateFile,
        remove: async () => { assert.fail('Completed photos must remain until family deletion') },
      }
      await assert.rejects(completeUpload(f.db, crypto.randomUUID(), f.student, id, root, storage), /Student not found/)
      await assert.rejects(completeUpload(f.db, f.owner, otherStudent, id, root, storage), /Upload not found/)
      assert.equal(reads, 0); assert.equal(writes, 0)
      assert.equal(await completeUpload(f.db, f.owner, f.student, id, root, storage), id)
      assert.equal(await completeUpload(f.db, f.owner, f.student, id, root, storage), id)
      assert.equal(reads, 1); assert.equal(writes, 1)
      assert.deepEqual(stored, stripImageMetadata(original))
      assert.equal((await getUpload(f.db, f.owner, id))!.stored_path, path)
      const intent = f.db.prepare('SELECT completed_at, reserved_bytes FROM upload_intents WHERE id = ?').get(id)!
      assert.ok(intent.completed_at); assert.equal(intent.reserved_bytes, 15_000_000)
    }
    const paths = f.db.prepare('SELECT id, stored_path FROM uploads').all(), removed = new Set<string>()
    const remove = async (path: string) => { removed.add(path) }
    await deleteFamily(f.db, f.owner, root, remove)
    assert.deepEqual(removed, new Set(paths.map(row => String(row.stored_path))))
    for (const row of paths) await assert.rejects(completeUpload(f.db, f.owner, f.student, String(row.id), root, {
      read: async () => { assert.fail('Erased uploads must not be read') }, remove,
    }), /no longer available/)
  } finally { f.db.close() }
})

test('direct completion skips overwriting byte-identical images', async () => {
  const f = await family()
  try {
    for (const [bytes, mime] of [[png(), 'image/png'], [stripImageMetadata(jpeg([exif(6)])), 'image/jpeg']] as const) {
      const id = crypto.randomUUID(), path = `blob:families/${f.owner}/uploads/${id}.${mime === 'image/png' ? 'png' : 'jpg'}`
      await reserveUpload(f.db, f.owner, f.student, id, path, mime)
      await completeUpload(f.db, f.owner, f.student, id, '/tmp/synthetic-image-metadata', {
        read: async () => bytes, write: async () => { assert.fail('Unchanged images must not be rewritten') }, remove: async () => { assert.fail('Valid images must remain') },
      })
    }
  } finally { f.db.close() }
})

test('a failed direct rewrite cannot complete and retains durable erasure when removal fails', async () => {
  const f = await family(), root = '/tmp/synthetic-image-metadata'
  try {
    const id = crypto.randomUUID(), path = `blob:families/${f.owner}/uploads/${id}.png`
    await reserveUpload(f.db, f.owner, f.student, id, path, 'image/png')
    const expires = String(f.db.prepare('SELECT expires_at FROM upload_intents WHERE id = ?').get(id)!.expires_at)
    await assert.rejects(completeUpload(f.db, f.owner, f.student, id, root, {
      read: async () => png(pngMetadata), write: async () => { throw Error('Synthetic rewrite failure') },
      remove: async () => { throw Error('Synthetic removal failure') },
    }), /Synthetic rewrite failure/)
    assert.equal(f.db.prepare('SELECT count(*) n FROM uploads').get()!.n, 0)
    assert.equal(f.db.prepare('SELECT count(*) n FROM upload_intents').get()!.n, 0)
    const erasure = f.db.prepare('SELECT * FROM file_erasures').get()!
    assert.equal(erasure.stored_path, path); assert.equal(erasure.upload_id, id)
    assert.ok(String(erasure.retain_until) > expires)
    let removed = 0
    await sweepPrivateFiles(f.db, root, async target => { assert.equal(target, path); removed++ })
    assert.equal(removed, 1)
    assert.equal(f.db.prepare('SELECT count(*) n FROM file_erasures').get()!.n, 1)
  } finally { f.db.close() }
})
