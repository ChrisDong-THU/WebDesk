import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

test('production relay forwards bounded chunks and validates response lengths', { skip: process.platform !== 'win32' }, () => {
  mkdirSync('test-results/native-wire', { recursive: true });
  const output = path.resolve('test-results/native-wire/test.exe');
  const env = { ...process.env }; delete env.LIB;
  execFileSync(path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), [
    '/nologo', '/target:exe', '/platform:x64', '/warnaserror+', `/out:${output}`,
    ...['native/windows/Win32.cs', 'native/windows/Wire.cs', 'tests/native-wire.cs'].map(file => path.resolve(file)),
  ], { env, windowsHide: true, stdio: 'inherit' });
  assert.match(execFileSync(output, { encoding: 'utf8', windowsHide: true }), /passed/);
});
