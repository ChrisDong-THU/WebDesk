import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_QUALITY, RESOLUTION_OPTIONS, validQuality } from '../shared/protocol.mjs';

test('retained upstream code has no unrecorded modifications', () => {
  assert.match(execFileSync(process.execPath, ['scripts/extract-billd.mjs', '--check'], { encoding: 'utf8' }), /Verified 56 upstream blocks/);
});
test('upstream server signaling blocks remain reproducible', () => {
  assert.match(execFileSync(process.execPath, ['scripts/extract-billd-server.mjs', '--check'], { encoding: 'utf8' }), /Verified 5 upstream server blocks/);
});

test('six requested quality presets remain compatible with the deployed signaling service', () => {
  assert.equal(DEFAULT_QUALITY.resolutionRatio, 4320);
  assert.equal(DEFAULT_QUALITY.maxBitrate, 0);
  assert.deepEqual(RESOLUTION_OPTIONS.map(item => item.value), [360, 720, 1080, 1440, 2160, 4320]);
  for (const option of RESOLUTION_OPTIONS) assert.ok(validQuality({ ...DEFAULT_QUALITY, resolutionRatio: option.value }));
  assert.equal(validQuality({ ...DEFAULT_QUALITY, resolutionRatio: '4320' }), false);
});

test('upstream IPC handlers execute original native operations without OS input', async () => {
  await mkdir('test-results/native', { recursive: true });
  await build({ entryPoints: ['electron-main/billd/handlers.ts'], outfile: 'test-results/native/handlers.cjs', bundle: true, platform: 'node', format: 'cjs' });
  const require = createRequire(import.meta.url);
  const { registerNativeHandlers } = require(path.resolve('test-results/native/handlers.cjs'));
  const handlers = new Map(), calls = [], responses = [];
  const method = name => async (...args) => { calls.push({ name, args }); };
  registerNativeHandlers({ ipcMain: { on: (name, fn) => handlers.set(name, fn), handle: (name, fn) => handlers.set(name, fn) },
    windowMap: new Map([[1, {}]]), winWebContentsSend: value => responses.push(value),
    nutjs: { mouse: Object.fromEntries(['move', 'drag', 'setPosition', 'pressButton', 'releaseButton', 'doubleClick', 'click', 'scrollDown', 'scrollUp', 'scrollLeft', 'scrollRight'].map(name => [name, method(name)])),
      keyboard: { type: method('type'), pressKey: method('pressKey'), releaseKey: method('releaseKey') }, Button: { LEFT: 0, RIGHT: 1 } },
    desktopCapturer: { getSources: async () => [{ id: 'first-screen' }, { id: 'second-screen' }] },
    screen: { getPrimaryDisplay: () => ({ size: { width: 1600, height: 1000 }, scaleFactor: 2 }) }, platform: 'win32',
  });
  const invoke = async (name, data = {}) => handlers.get(name)(null, { requestId: name, data: { windowId: 1, ...data } });
  await invoke('mouseMove', { x: 1600, y: 1000 });
  await invoke('mouseScrollDown', { amount: 120 });
  await invoke('keyboardPressKey', { key: [1, 2] });
  await invoke('keyboardReleaseKey', { key: [1, 2] });
  await invoke('mousePressButtonLeft'); await invoke('mouseReleaseButtonLeft');
  assert.deepEqual(calls, [
    { name: 'move', args: [[{ x: 1600, y: 1000 }]] }, { name: 'scrollDown', args: [120] },
    { name: 'pressKey', args: [1, 2] }, { name: 'releaseKey', args: [1, 2] },
    { name: 'pressButton', args: [0] }, { name: 'releaseButton', args: [0] },
  ]);
  await invoke('getScreenStream');
  assert.equal(responses.at(-1).data.stream.id, 'first-screen');
  assert.equal((await invoke('scaleFactor')).data.scaleFactor, 2);
  assert.deepEqual((await invoke('getPrimaryDisplaySize')).data, { width: 1600, height: 1000 });
});
