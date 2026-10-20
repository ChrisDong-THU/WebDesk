import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
await build({ entryPoints: ['src/core/pointer.ts'], outfile: 'test-results/pointer.mjs', bundle: true, platform: 'node', format: 'esm' });
const { bindPointerInput } = await import('../test-results/pointer.mjs');
class Target {
  listeners = new Map();
  addEventListener(type, fn) { this.listeners.set(type, [...this.listeners.get(type) || [], fn]); }
  removeEventListener(type, fn) { this.listeners.set(type, this.listeners.get(type).filter(item => item !== fn)); }
  emit(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn(event); }
}
function fixture(t) {
  const area = new Target(), window = new Target(), sent = [];
  const video = { focus() {}, getBoundingClientRect: () => ({ left: 10, top: 20, right: 110, bottom: 120 }) };
  let active = true, congested = false;
  const pointer = bindPointerInput({
    area, window, video: () => video, active: () => active,
    down: event => sent.push(['down', event]), move: event => sent.push(['move', event]),
    up: event => sent.push(['up', event]), cancel: () => sent.push(['cancel']),
    congested: () => congested,
  });
  t.after(pointer.dispose);
  const down = () => area.emit('mousedown', { target: video, button: 0, buttons: 1, clientX: 40, clientY: 50 });
  return { area, window, video, sent, pointer, down, deactivate: () => { active = false; }, congest: value => { congested = value; } };
}
test('move bursts keep only the latest position and respect transport backpressure', async t => {
  const f = fixture(t);
  f.congest(true);
  for (let i = 0; i < 1000; i++) f.window.emit('mousemove', { target: f.video, buttons: 0, clientX: i, clientY: 60 });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(f.sent.length, 0);
  f.congest(false);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0][1].clientX, 110);
  f.window.emit('mousemove', { target: f.video, buttons: 0, clientX: 50, clientY: 60 });
  f.pointer.dispose();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.sent.length, 1);
});
test('drag outside the picture keeps video coordinates and releases exactly once', t => {
  const f = fixture(t);
  f.down();
  f.window.emit('mousemove', { target: {}, buttons: 1, clientX: 200, clientY: -5 });
  f.window.emit('mouseup', { target: {}, button: 0, buttons: 0, clientX: 200, clientY: -5 });
  f.window.emit('mouseup', { target: f.video, button: 0 });
  assert.deepEqual(f.sent.map(item => item[0]), ['down', 'move', 'up']);
  for (const [, event] of f.sent.slice(1)) {
    assert.equal(event.target, f.video);
    assert.equal(event.clientX, 110); assert.equal(event.clientY, 20);
  }
});
test('cancellation, blur, focus loss and missing release reconcile held buttons', t => {
  const f = fixture(t);
  for (const [target, name] of [[f.window, 'pointercancel'], [f.window, 'blur'], [f.area, 'focusout']]) {
    f.down(); target.emit(name); target.emit(name);
  }
  f.down(); f.window.emit('mousemove', { target: {}, buttons: 0 });
  assert.equal(f.sent.filter(item => item[0] === 'cancel').length, 4);
  f.window.emit('mouseup', { button: 0 });
  assert.equal(f.sent.filter(item => item[0] === 'up').length, 0);
});
test('unrelated releases, unsupported buttons and disconnected sessions do not inject input', t => {
  const f = fixture(t);
  f.window.emit('mouseup', { button: 0 });
  f.area.emit('mousedown', { target: f.video, button: 4 });
  assert.equal(f.sent.length, 0);
  f.down(); f.deactivate();
  f.window.emit('mouseup', { button: 0 });
  f.down();
  assert.equal(f.sent.length, 1);
  f.pointer.dispose();
  assert.ok([...f.window.listeners.values()].every(list => !list.length));
});
