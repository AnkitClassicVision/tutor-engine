import { build } from 'esbuild';
import { mkdir, cp } from 'node:fs/promises';
await build({ stdin: { contents: 'export { put } from "@vercel/blob/client";', resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, outfile: 'public/blob-client.js' });
await mkdir('dist', { recursive: true });
for (const file of ['app.css', 'session.js', 'journey.js', 'job-watch.js', 'planner-drawer.js', 'pack-ask.js', 'manipulatives.js', 'live-tutor.js', 'blob-client.js', 'fonts', 'worlds']) await cp(`public/${file}`, `dist/${file}`, { recursive: true });
