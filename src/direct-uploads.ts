import { UserError } from "./errors.ts"
import { queueFileErasure, eraseLateUpload, ticketRetention } from "./file-erasures.ts"
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client'
import type { Database } from './database.ts'
import { assertStudent, getUpload } from './services.ts'
import { readPrivateFile, storePrivateFile, deletePrivateFile, cloudStorage } from './storage.ts'
import { reserveUpload } from './upload-reservations.ts'
import { withWrite } from './transaction.ts'

import { validateImage, stripImageMetadata } from "./image-validation.ts"
export { validateImage } from "./image-validation.ts"
export async function createUploadIntent(db: Database, owner: string, student: string, mime: string) {
  return withWrite(db, async () => {
    await assertStudent(db, owner, student)
    if (!cloudStorage() || !['image/png', 'image/jpeg'].includes(mime)) throw new UserError('Choose a PNG or JPEG photo.')
    const id = crypto.randomUUID()
    const pathname = `families/${owner}/uploads/${id}.${mime === 'image/png' ? 'png' : 'jpg'}`
    const expires = await reserveUpload(db, owner, student, id, `blob:${pathname}`, mime)
    const token = await generateClientTokenFromReadWriteToken({ pathname, allowedContentTypes: [mime], maximumSizeInBytes: 15_000_000, validUntil: Date.parse(expires), addRandomSuffix: false, allowOverwrite: false })
    return { id, pathname, token }
  })
}

export async function completeUpload(db: Database, owner: string, student: string, id: string, root: string, storage: { read: typeof readPrivateFile; remove: typeof deletePrivateFile; write?: typeof storePrivateFile } = { read: readPrivateFile, remove: deletePrivateFile }) {
  if (await eraseLateUpload(db, owner, id, root, storage.remove)) throw new UserError('This upload is no longer available.')
  let result: string | { error: unknown }
  try { result = await withWrite(db, async () => {
    await assertStudent(db, owner, student)
    const intent = await db.prepare('SELECT * FROM upload_intents WHERE id = ? AND owner_user_id = ? AND student_id = ?').get(id, owner, student)
    if (!intent) throw new UserError('Upload not found.')
    if (intent.completed_at) { if (!(await getUpload(db, owner, id))) throw new UserError('Upload is unavailable.'); return id }
    if (String(intent.expires_at) <= new Date().toISOString()) throw new UserError('Upload expired. Please retry saving your photo.')
    const bytes = await storage.read(String(intent.stored_path), root)
    try {
      validateImage(bytes, String(intent.mime))
      const stripped = stripImageMetadata(bytes)
      if (!stripped.equals(bytes)) await (storage.write ?? storePrivateFile)(root, owner, String(intent.stored_path).split('/').pop()!, stripped, String(intent.mime), 'uploads', true)
    }
    catch (error) {
      await queueFileErasure(db, owner, String(intent.stored_path), id, ticketRetention(String(intent.expires_at)))
      await db.prepare('DELETE FROM upload_intents WHERE id = ?').run(id)
      return { error }
    }
    await db.prepare('INSERT INTO uploads (id, owner_user_id, student_id, stored_path, created_at) VALUES (?, ?, ?, ?, ?)').run(id, owner, student, intent.stored_path, new Date().toISOString())
    await db.prepare('UPDATE upload_intents SET completed_at = ? WHERE id = ?').run(new Date().toISOString(), id)
    return id
  }) } catch (error) {
    await eraseLateUpload(db, owner, id, root, storage.remove)
    throw error
  }
  if (typeof result !== 'string') {
    await eraseLateUpload(db, owner, id, root, storage.remove)
    throw result.error
  }
  return result
}
