import { randomUUID } from 'node:crypto';
import { put, get, del } from '@vercel/blob';

// Load a git-ignored environment file only when explicitly supplied.
if (process.argv[2]) process.loadEnvFile(process.argv[2]);

const contents = 'Synthetic storage verification: no learner information.';
let createdUrl;
let failed = false;
try {
  const blob = await put(`setup-checks/${randomUUID()}.txt`, contents, {
    access: 'private',
    addRandomSuffix: false,
    contentType: 'text/plain',
  });
  createdUrl = blob.url;
  const result = await get(createdUrl, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) throw new Error('Authenticated read failed');
  if (await new Response(result.stream).text() !== contents) throw new Error('Content mismatch');
  const anonymous = await fetch(createdUrl, { signal: AbortSignal.timeout(15_000) });
  await anonymous.body?.cancel();
  if (anonymous.status !== 401 && anonymous.status !== 403) {
    throw new Error('Anonymous access was not explicitly denied');
  }
  console.log(JSON.stringify({ privateUpload: 'passed', authenticatedRead: 'passed', anonymousReadStatus: anonymous.status }));
} catch {
  // SDK errors may contain request details. Keep credentials and URLs out of logs.
  failed = true;
  console.error('Private storage verification failed. Check the linked store and credentials.');
} finally {
  if (createdUrl) {
    try {
      await del(createdUrl);
      console.log('Synthetic file deleted.');
    } catch {
      failed = true;
      console.error('Synthetic file cleanup failed. Remove the setup-checks file in the storage dashboard.');
    }
  }
}
if (failed) process.exitCode = 1;
