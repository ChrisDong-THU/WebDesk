import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

test('native file streaming, session revocation, safe names and incomplete-file cleanup', async () => {
  await mkdir('test-results/tools', { recursive: true });
  const root = await mkdtemp(path.resolve('test-results/tools/native-'));
  const selected = path.join(root, '原始.txt'); await writeFile(selected, '远程文件\n✓');
  const mock = { clip: '', selected, picker: undefined };
  globalThis.__webdeskElectronMock = mock;
  await build({ entryPoints: ['electron-main/desktop-tools.ts'], outfile: 'test-results/tools/native.cjs', bundle: true, platform: 'node', format: 'cjs', plugins: [{
    name: 'electron-test-boundary', setup(build) {
      build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `const mock = globalThis.__webdeskElectronMock;
        export const app = { getPath: () => '' };
        export const clipboard = { readText: () => mock.clip, writeText: text => mock.clip = text };
        export const dialog = { showOpenDialog: () => mock.picker ? mock.picker() : Promise.resolve({ canceled: false, filePaths: [mock.selected] }) };` }));
    },
  }] });
  const { NativeTools } = createRequire(import.meta.url)(path.resolve('test-results/tools/native.cjs'));
  const native = new NativeTools({}, () => path.join(root, 'downloads'));
  await native.start('session');
  const call = (operation, data) => native.invoke('session', operation, data);
  await assert.rejects(native.invoke('other-session', 'clipboard.read'), /会话已结束/);
  await call('clipboard.write', { text: '中文\nclipboard ✓' }); assert.equal(await call('clipboard.read'), mock.clip);
  await assert.rejects(call('clipboard.write', { text: 'a'.repeat(65537) }), /64K/);
  await assert.rejects(call('file.begin', { name: 'CON.txt', size: 1 }), /文件名/);
  const first = await call('file.begin', { name: '../../hello.txt', size: 5 });
  await assert.rejects(call('file.write', { id: first.id, bytes: new Uint8Array(6) }), /文件块/);
  await call('file.write', { id: first.id, bytes: new Uint8Array([1, 2]) });
  await assert.rejects(call('file.end', { id: first.id }), /不完整/);
  await call('file.write', { id: first.id, bytes: new Uint8Array([3, 4, 5]) });
  const complete = await call('file.end', { id: first.id });
  const dirs = await readdir(path.join(root, 'downloads'));
  const diskFile = path.join(root, 'downloads', dirs[0], complete.name);
  assert.deepEqual([...await readFile(diskFile)], [1, 2, 3, 4, 5]);
  await assert.rejects(call('files.paste', { ids: [complete.id] }));
  const zero = await call('file.begin', { name: 'empty.txt', size: 0 }); await call('file.end', { id: zero.id });
  const file = await call('file.select'); assert.equal(file.name, '原始.txt'); assert.equal('path' in file, false);
  const bytes = await call('file.read', { id: file.id, offset: 0, length: file.size });
  assert.equal(Buffer.from(bytes).toString(), '远程文件\n✓');
  await assert.rejects(call('file.read', { id: file.id, offset: -1, length: 1 }), /读取/);
  await call('file.release', { id: file.id }); await assert.rejects(call('file.info', { id: file.id }), /失效/);
  await call('file.begin', { name: 'unfinished.txt', size: 100 });
  await native.stop();
  for (const dir of await readdir(path.join(root, 'downloads'))) assert.ok(!(await readdir(path.join(root, 'downloads', dir))).some(name => name.endsWith('.webdesk-part')));
  assert.equal((await readFile(diskFile)).length, 5, 'completed downloads must remain');
  await assert.rejects(call('clipboard.read'), /会话已结束/);
  await native.start('session');
  let finishPicker; mock.picker = () => new Promise(resolve => { finishPicker = resolve; });
  const picking = call('file.select');
  await native.stop(); // Must not wait for the open native picker.
  finishPicker({ canceled: false, filePaths: [selected] });
  await assert.rejects(picking, /会话已结束/);
  delete globalThis.__webdeskElectronMock;
});
