import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

await build({ entryPoints: ['src/core/wheel.ts'], outfile: 'test-results/wheel.cjs', bundle: true, platform: 'node', format: 'cjs' });
const { createWheelNormalizer } = createRequire(import.meta.url)('../test-results/wheel.cjs');
const event = (deltaY, deltaMode = 0, deltaX = 0) => ({ deltaY, deltaMode, deltaX });

test('pixel and line inputs map to the same moderate native wheel movement', () => {
  const wheel = createWheelNormalizer();
  assert.deepEqual(wheel.normalize(event(100)), { deltaX: 0, deltaY: 1 });
  assert.deepEqual(wheel.normalize(event(-3, 1)), { deltaX: 0, deltaY: -1 });
  assert.equal(wheel.normalize(event(120)).deltaY * 120, 144);
  assert.equal(wheel.normalize(event(0, 1, 3)).deltaX, 1);
});

test('large spikes and page events are bounded without deferred jumps', () => {
  const wheel = createWheelNormalizer();
  assert.equal(wheel.normalize(event(100000)).deltaY, 3);
  assert.equal(wheel.normalize(event(-1, 2)).deltaY, -3);
  assert.equal(wheel.normalize(event(0)).deltaY, 0);
  assert.equal(wheel.normalize(event(100)).deltaY, 1);
});

test('fine touchpad deltas accumulate per axis rather than being lost or amplified', () => {
  const wheel = createWheelNormalizer();
  let x = 0, y = 0;
  for (let i = 0; i < 1000; i++) {
    const delta = wheel.normalize(event(0.1, 0, -0.05));
    x += delta.deltaX; y += delta.deltaY;
  }
  assert.ok(Math.abs(y - 1) < 1 / 120 + 1e-10);
  assert.ok(Math.abs(x + 0.5) < 1 / 120 + 1e-10);
});

test('reset discards fractional leftovers and invalid input does not scroll', () => {
  const wheel = createWheelNormalizer();
  wheel.normalize(event(0.5)); wheel.reset();
  assert.equal(wheel.normalize(event(0.5)).deltaY, 0);
  for (const delta of [NaN, Infinity, -Infinity]) assert.equal(wheel.normalize(event(delta)).deltaY, 0);
  assert.equal(wheel.normalize(event(100, 99)).deltaY, 0);
});
