import { readdir, readFile, access } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
const root = resolve('.vercel/output/functions/api/tutor.func');
const missing = [];
async function check(directory) {
  for (const file of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, file.name);
    if (file.isDirectory()) await check(path);
    else if (file.name.endsWith('.js')) {
      const source = await readFile(path, 'utf8');
      for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)) {
        if (!match[1].startsWith('.')) continue;
        try { await access(resolve(dirname(path), match[1])); }
        catch { missing.push(`${path}: ${match[1]}`); }
      }
    }
  }
}
for (const directory of ['src', 'api']) await check(join(root, directory));
if (missing.length) throw new Error(`Compiled function imports are missing:\n${missing.join('\n')}`);
// Dynamic skill/data reads need the deployment file map as well as JS imports.
const config = JSON.parse(await readFile(join(root, '.vc-config.json'), 'utf8'));
const resources = ['src/data/math-backbone.json'];
for (const entry of await readdir('skills', { withFileTypes: true })) {
  if (entry.isDirectory()) resources.push(`skills/${entry.name}/SKILL.md`);
}
for (const file of await readdir('src/migrations')) {
  if (file.endsWith('.sql')) resources.push(`src/migrations/${file}`);
}
for (const resource of resources) {
  await access(config.filePathMap?.[resource] ? resolve(config.filePathMap[resource]) : join(root, resource));
}
for (const resource of Object.keys(config.filePathMap || {})) {
  if (/^(?:\.env|data\/|handoffs\/)/.test(resource)) throw new Error('Private content is mapped into the function bundle.');
}
console.log('Compiled imports, teaching skills, curriculum data and migrations resolve. Verify invocation on Vercel before accepting the deployment.');
