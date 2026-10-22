import { readdirSync, lstatSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

// Path policy only. Source provenance is checked separately in the private upstream.
export function checkPublicTree(root) {
  root = resolve(root)
  const findings = []
  const privateRoots = new Set(['private-learning', 'data', 'handoffs', 'delivery', '.agents', '.vercel'])
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const path = resolve(dir, name), rel = relative(root, path).replaceAll('\\', '/')
      if (rel === '.git' || rel === 'node_modules') continue
      const stat = lstatSync(path)
      const environmentExample = ['.env.example', '.env.production.example'].includes(rel)
      const forbidden = privateRoots.has(rel.split('/')[0]) ||
        /^(docs\/(release)(\/|$)|AGENTS\.md$)/.test(rel) ||
        (name.startsWith('.env') && !environmentExample) ||
        /\.(sqlite(?:-wal|-shm|-journal)?|db|pem|key|p12|pfx)$/i.test(name)
      if (forbidden || stat.isSymbolicLink()) { findings.push(rel); continue }
      if (stat.isDirectory()) walk(path)
    }
  }
  walk(root)
  return findings.sort()
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/check-public-content.mjs PUBLIC_TREE')
  const findings = checkPublicTree(process.argv[2])
  for (const path of findings) console.error(`Disallowed public path: ${path}`)
  console.log(`Public path check: ${findings.length} finding(s)`)
  process.exitCode = findings.length ? 1 : 0
}
