import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SESSION_PROTOCOL_VERSION } from '../shared/protocol.mjs';
const json = (file) => JSON.parse(readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
const { version } = json('package.json');
const flutter = readFileSync(new URL('../desktop/flutter/pubspec.yaml', import.meta.url), 'utf8');
assert.match(version, /^\d+\.\d+\.\d+$/);
const flutterVersion = flutter.match(/^version:\s*(\d+\.\d+\.\d+)\+(\d+)\s*$/m);
assert.equal(flutterVersion?.[1], version, 'Flutter version mismatch');
assert.ok(
  Number(flutterVersion?.[2]) >= 1 && Number(flutterVersion?.[2]) <= 65535,
  'Flutter build number must fit the Windows installer file version',
);
const dartProtocol = readFileSync(
  new URL('../desktop/flutter/lib/protocol/version.dart', import.meta.url),
  'utf8',
);
assert.equal(
  Number(dartProtocol.match(/sessionProtocolVersion\s*=\s*(\d+)/)?.[1]),
  SESSION_PROTOCOL_VERSION,
  'Session protocol version mismatch',
);
const runtime = json('deploy/runtime/package.json');
assert.equal(runtime.version, version, 'Server version mismatch');
assert.deepEqual(
  Object.keys(runtime.dependencies),
  ['socket.io'],
  'Server must not depend on the desktop/development project',
);
for (const file of ['package-lock.json', 'deploy/runtime/package-lock.json']) {
  const lock = json(file);
  assert.equal(lock.version, version, `${file} version mismatch`);
  assert.equal(lock.packages[''].version, version, `${file} root version mismatch`);
  if (file.startsWith('deploy/')) {
    assert.deepEqual(
      lock.packages[''].dependencies,
      runtime.dependencies,
      'Server lock dependencies mismatch',
    );
    for (const [name, dependency] of Object.entries(lock.packages)) {
      assert.ok(!dependency.link && !name.startsWith('..'), `Local dependency in server release: ${name}`);
      assert.ok(
        !dependency.resolved || dependency.resolved.startsWith('https://'),
        `Non-registry server dependency: ${name}`,
      );
    }
  }
}
console.log(`Release ${version}: web, server, Flutter and locks agree`);
