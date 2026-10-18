import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve, sep, dirname, join } from 'node:path'
import { put, get, del } from '@vercel/blob'

const privateKey = /^families\/[0-9a-f-]{36}\/(?:uploads|pdf)\/[0-9a-f.-]+\.(?:png|jpg|pdf)$/i
export function cloudStorage() { return process.env.TUTOR_STORAGE === 'blob' }
function localPath(path: string, root: string) {
  const resolved = resolve(path)
  if (!resolved.startsWith(resolve(root) + sep)) throw new Error('File outside private storage.')
  return resolved
}
function blobKey(path: string) {
  const key = path.slice('blob:'.length)
  if (!path.startsWith('blob:') || !privateKey.test(key)) throw new Error('Invalid private file reference.')
  return key
}
export async function storePrivateFile(root: string, owner: string, name: string, bytes: Buffer, contentType: string, kind: 'uploads' | 'pdf' = 'uploads', allowOverwrite = false) {
  const key = `families/${owner}/${kind}/${name}`
  if (!privateKey.test(key)) throw new Error('Invalid private file name.')
  if (cloudStorage()) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Private file storage is not configured.')
    await put(key, bytes, { access: 'private', addRandomSuffix: false, contentType, allowOverwrite })
    return `blob:${key}`
  }
  const target = localPath(join(root, owner, name), root)
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await writeFile(target, bytes, { mode: 0o600, flag: 'wx' })
  return target
}
export async function readPrivateFile(path: string, root: string) {
  if (!path.startsWith('blob:')) return readFile(localPath(path, root))
  const file = await get(blobKey(path), { access: 'private', useCache: false })
  if (!file || file.statusCode !== 200) throw new Error('Private file is unavailable.')
  return Buffer.from(await new Response(file.stream).arrayBuffer())
}
export async function deletePrivateFile(path: string, root: string) {
  if (path.startsWith('blob:')) await del(blobKey(path))
  else await rm(localPath(path, root), { force: true })
}
