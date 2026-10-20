import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const releases = path.join(root, 'server-release');
await mkdir(releases, { recursive: true });
// Each bundle gets a fresh directory; never include a developer .env or key.
const staging = await mkdtemp(path.join(releases, 'webdesk-'));
try {
  for (const name of ['dist', 'server', 'shared', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.md']) {
    await cp(path.join(root, name), path.join(staging, name), { recursive: true });
  }
  for (const name of ['package.json', 'package-lock.json']) {
    await cp(path.join(root, 'deploy/runtime', name), path.join(staging, name));
  }
  await mkdir(path.join(staging, 'deploy'));
  for (const name of ['webdesk.service', 'nginx.conf.example', 'turnserver.conf.example']) {
    await cp(path.join(root, 'deploy', name), path.join(staging, 'deploy', name));
  }
  const archive = `${staging}.tar.gz`;
  execFileSync('tar', ['-czf', archive, '-C', staging, '.'], { stdio: 'inherit' });
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(`${archive}.sha256`, `${digest}  ${path.basename(archive)}\n`);
  console.log(JSON.stringify({ archive, sha256: digest }));
} finally {
  // Staging is a freshly created child, never a source tree or dependency cache.
  await rm(staging, { recursive: true, force: true });
}
