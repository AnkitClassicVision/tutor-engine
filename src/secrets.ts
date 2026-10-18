import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Credentials are AES-256-GCM under the deployment key. Values name the key that sealed them (enc:v2:<key id>), so
// the key can be rotated: the new key goes in TUTOR_ENCRYPTION_KEY, older ones in TUTOR_ENCRYPTION_KEYS_PREVIOUS
// (comma-separated) until scripts/rotate-encryption-key.ts has re-encrypted everything. enc:v1 values (no key id)
// predate rotation and are opened by trying each key.
export const ENCRYPTED = /^enc:v[12]:/

function decode(value: string, name: string) {
  const bytes = Buffer.from(value.trim(), 'base64')
  if (bytes.length !== 32) throw new Error(`${name} must encode 32 bytes.`)
  return bytes
}
function key(): Buffer {
  const configured = process.env.TUTOR_ENCRYPTION_KEY
  if (configured) return decode(configured, 'TUTOR_ENCRYPTION_KEY')
  if (process.env.TUTOR_PUBLIC === '1') throw new Error('Public mode requires TUTOR_ENCRYPTION_KEY.')
  const dir = process.env.TUTOR_SECRET_DIR || 'data'
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, '.credential-key')
  if (!existsSync(path)) {
    try { writeFileSync(path, randomBytes(32), { mode: 0o600, flag: 'wx' }) } catch (e) { if (!existsSync(path)) throw e }
  }
  return readFileSync(path)
}
/** A short public name for a key: enough to pick it from the ring, nothing about the key itself. */
export const keyId = (bytes: Buffer) => createHash('sha256').update('tutor-key-id').update(bytes).digest('base64url').slice(0, 8)
/** The current key first, then any previous keys still being rotated out. */
export function keyRing(): Buffer[] {
  const previous = (process.env.TUTOR_ENCRYPTION_KEYS_PREVIOUS || '').split(',').filter(k => k.trim()).map(k => decode(k, 'TUTOR_ENCRYPTION_KEYS_PREVIOUS'))
  return [key(), ...previous]
}
export function encryptSecret(value: string): string {
  if (!value) return ''
  const current = key(), iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', current, iv)
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `enc:v2:${keyId(current)}:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${bytes.toString('base64url')}`
}
function open(secret: Buffer, iv: string, tag: string, bytes: string) {
  const cipher = createDecipheriv('aes-256-gcm', secret, Buffer.from(iv, 'base64url'))
  cipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([cipher.update(Buffer.from(bytes, 'base64url')), cipher.final()]).toString('utf8')
}
export function decryptSecret(value: string): string {
  if (!value) return ''
  if (value.startsWith('enc:v2:')) {
    const [, , id, iv, tag, bytes] = value.split(':')
    const secret = keyRing().find(k => keyId(k) === id)
    if (!secret) throw new Error('This value was encrypted with a key that is not configured. Add it to TUTOR_ENCRYPTION_KEYS_PREVIOUS.')
    return open(secret, iv, tag, bytes)
  }
  if (!value.startsWith('enc:v1:')) {
    if (process.env.TUTOR_PUBLIC === '1') throw new Error('Unencrypted legacy credential. Migrate before public startup.')
    return value
  }
  const [, , iv, tag, bytes] = value.split(':')
  const ring = keyRing()
  for (const [index, secret] of ring.entries()) {
    try { return open(secret, iv, tag, bytes) } catch (e) { if (index === ring.length - 1) throw e }
  }
  throw new Error('No encryption key is configured.')
}
/** The value re-encrypted under the current key, or unchanged when it already is. */
export function rewrapSecret(value: string): string {
  if (!ENCRYPTED.test(value) || value.startsWith(`enc:v2:${keyId(key())}:`)) return value
  return encryptSecret(decryptSecret(value))
}
export function migrateSecrets(db: import('node:sqlite').DatabaseSync) {
  // Initialize/validate the key even for a new public database.
  key()
  for (const row of db.prepare("SELECT id, ai_key FROM users WHERE ai_key != ''").all()) {
    if (!ENCRYPTED.test(String(row.ai_key))) db.prepare('UPDATE users SET ai_key = ? WHERE id = ?').run(encryptSecret(String(row.ai_key)), row.id)
  }
}
