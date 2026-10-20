import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const json = file => JSON.parse(readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
const { version } = json('package.json');
const flutter = readFileSync(new URL('../desktop/flutter/pubspec.yaml', import.meta.url), 'utf8');
assert.match(version, /^0\.5\.\d+$/);
assert.equal(flutter.match(/^version:\s*([^+\s]+)/m)?.[1], version, 'Flutter version mismatch');
const runtime = json('deploy/runtime/package.json');
assert.equal(runtime.version, version, 'Server version mismatch');
assert.deepEqual(Object.keys(runtime.dependencies), ['socket.io'], 'Server must not depend on the desktop/development project');
for (const file of ['package-lock.json', 'deploy/runtime/package-lock.json']) {
  const lock = json(file);
  assert.equal(lock.version, version, `${file} version mismatch`);
  assert.equal(lock.packages[''].version, version, `${file} root version mismatch`);
  if (file.startsWith('deploy/')) {
    assert.deepEqual(lock.packages[''].dependencies, runtime.dependencies, 'Server lock dependencies mismatch');
    for (const [name, dependency] of Object.entries(lock.packages)) {
      assert.ok(!dependency.link && !name.startsWith('..'), `Local dependency in server release: ${name}`);
      assert.ok(!dependency.resolved || dependency.resolved.startsWith('https://'), `Non-registry server dependency: ${name}`);
    }
  }
}
console.log(`Release ${version}: web, server, Flutter and locks agree`);
