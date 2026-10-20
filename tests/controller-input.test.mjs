import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
await build({ entryPoints: ['src/core/controller-input.ts'], outfile: 'test-results/controller-input.mjs', bundle: true, platform: 'node', format: 'esm' });
const { bindControllerInput } = await import('../test-results/controller-input.mjs');

class Target {
  listeners = new Map();
  addEventListener(type, fn) { this.listeners.set(type, [...this.listeners.get(type) || [], fn]); }
  removeEventListener(type, fn) { this.listeners.set(type, this.listeners.get(type).filter(item => item !== fn)); }
  emit(type, event) { for (const fn of this.listeners.get(type) || []) fn(event); }
}
function fixture(t) {
  const area = new Target(), window = new Target(), document = new Target(), sent = [];
  let focused = false, active = true;
  document.hidden = false;
  const video = {
    focus(options) { assert.equal(options.preventScroll, true); focused = true; }, blur() { focused = false; },
    getBoundingClientRect: () => ({ left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100 }),
  };
  document.fullscreenElement = null;
  document.exitFullscreen = async () => {
    document.fullscreenElement = null;
    document.emit('fullscreenchange', {});
  };
  const input = bindControllerInput({ area, window, document, video: () => video,
    active: () => active, focused: () => focused, congested: () => false, send: data => sent.push(data) });
  t.after(input.dispose);
  const event = extra => ({ target: video, clientX: 70, clientY: 60, button: 0, buttons: 0,
    ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, prevented: false,
    preventDefault() { this.prevented = true; }, ...extra });
  const fire = (target, type, extra = {}) => { const e = event(extra); target.emit(type, e); return e; };
  const click = (button = 0) => {
    fire(area, 'mousedown', { button, buttons: [1, 4, 2][button] });
    fire(window, 'mouseup', { button });
    fire(area, button === 0 ? 'click' : 'auxclick', { button });
  };
  return { area, window, document, video, input, sent, fire, click,
    fullscreen: () => { document.fullscreenElement = { contains: node => node === video }; document.emit('fullscreenchange', {}); },
    focused: () => focused, blur: () => { focused = false; }, deactivate: () => { active = false; } };
}
const edges = sent => sent.filter(data => [2, 3, 4, 5, 7, 8, 9, 18, 19].includes(data.type));

test('native browser double-click sequence sends exactly two press/release pairs', t => {
  const f = fixture(t);
  f.click(); f.click();
  const double = f.fire(f.area, 'dblclick', { detail: 2 });
  assert(double.prevented);
  assert.deepEqual(edges(f.sent).map(data => data.type), [2, 4, 2, 4]);
  // A third click is sent only when a third physical pair arrives.
  f.click();
  assert.deepEqual(edges(f.sent).map(data => data.type), [2, 4, 2, 4, 2, 4]);
});

test('every edge positions the cursor even when no mousemove arrived', t => {
  const f = fixture(t);
  f.click();
  assert.deepEqual(f.sent, [
    { type: 0, x: 300, y: 400 }, { type: 2 },
    { type: 0, x: 300, y: 400 }, { type: 4 },
  ]);
});

test('right and middle drag edges remain paired; contextmenu cannot add a click', t => {
  const f = fixture(t);
  f.fire(f.area, 'mousedown', { button: 2, buttons: 2 });
  assert(f.fire(f.area, 'contextmenu', { button: 2 }).prevented);
  f.fire(f.window, 'mousemove', { target: {}, button: 2, buttons: 2, clientX: 300, clientY: 200 });
  f.fire(f.window, 'mouseup', { target: {}, button: 2, clientX: 300, clientY: 200 });
  f.click(1);
  assert.deepEqual(edges(f.sent).map(data => data.type), [3, 5, 18, 19]);
  assert.deepEqual(f.sent[3], { type: 0, x: 1000, y: 1000 });
});

test('chorded buttons release independently and ignore duplicate or unrelated releases', t => {
  const f = fixture(t);
  f.fire(f.area, 'mousedown', { button: 0, buttons: 1 });
  f.fire(f.area, 'mousedown', { button: 2, buttons: 3 });
  f.fire(f.area, 'mousedown', { button: 2, buttons: 3 });
  f.fire(f.window, 'mouseup', { button: 0, buttons: 2 });
  f.fire(f.window, 'mouseup', { button: 0, buttons: 2 });
  f.fire(f.window, 'mousemove', { target: {}, buttons: 2 });
  f.fire(f.window, 'mouseup', { button: 2 });
  assert.deepEqual(edges(f.sent).map(data => data.type), [2, 3, 4, 5]);
  assert.equal(f.sent.filter(data => data.type === 17).length, 0);
});

test('Ctrl-click recovers held modifiers and wheel positions before both axes', t => {
  const f = fixture(t);
  f.fire(f.area, 'mousedown', { buttons: 1, ctrlKey: true });
  assert.deepEqual(f.sent.slice(0, 3), [{ type: 0, x: 300, y: 400 }, { type: 15, key: [103] }, { type: 2 }]);
  f.fire(f.window, 'mouseup', { ctrlKey: true });
  f.sent.length = 0;
  const wheel = f.fire(f.area, 'wheel', { deltaMode: 0, deltaX: -100, deltaY: 100 });
  assert(wheel.prevented);
  assert.deepEqual(f.sent, [{ type: 0, x: 300, y: 400 }, { type: 16, key: [103] }, { type: 10, amount: 1 }, { type: 12, amount: 1 }]);
});

test('lost focus, hidden page and disconnect clear pending input', async t => {
  const f = fixture(t);
  f.click();
  f.fire(f.window, 'keydown', { code: 'KeyA', ctrlKey: true });
  f.fire(f.window, 'mousemove', { buttons: 0 });
  f.document.hidden = true;
  f.fire(f.document, 'visibilitychange');
  const afterRelease = f.sent.length;
  f.fire(f.window, 'keyup', { code: 'KeyA', ctrlKey: true });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.sent.length, afterRelease);
  assert.equal(f.sent.at(-1).type, 17);
  f.blur();
  f.fire(f.window, 'keydown', { code: 'KeyB' });
  assert.equal(f.sent.length, afterRelease);
  f.deactivate();
  f.click(); f.fire(f.area, 'wheel', { deltaY: 100, deltaMode: 0 });
  assert.equal(f.sent.length, afterRelease);
});

test('Escape outside fullscreen is a remote key and preserves keyboard focus', t => {
  const f = fixture(t);
  f.click(); f.sent.length = 0;
  f.fire(f.window, 'keydown', { code: 'Escape' });
  f.fire(f.window, 'keyup', { code: 'Escape' });
  assert.deepEqual(f.sent, [{ type: 15, key: [0] }, { type: 16, key: [0] }]);
  assert(f.focused());
});

test('fullscreen Escape releases locally, exits fullscreen and absorbs held repeats and keyup', t => {
  const f = fixture(t);
  f.click(); f.fullscreen(); f.sent.length = 0;
  assert(f.fire(f.window, 'keydown', { code: 'Escape' }).prevented);
  assert.equal(f.document.fullscreenElement, null);
  assert.equal(f.focused(), false);
  assert.deepEqual(f.sent, [{ type: 17 }]);
  f.click(); f.sent.length = 0;
  assert(f.fire(f.window, 'keydown', { code: 'Escape', repeat: true }).prevented);
  assert(f.fire(f.window, 'keyup', { code: 'Escape' }).prevented);
  assert.deepEqual(f.sent, []);
  f.fire(f.window, 'keydown', { code: 'Escape' });
  f.fire(f.window, 'keyup', { code: 'Escape' });
  assert.deepEqual(f.sent, [{ type: 15, key: [0] }, { type: 16, key: [0] }]);
});

test('browser-consumed Escape and toolbar fullscreen exit release held input without keydown', async t => {
  const f = fixture(t);
  f.click(); f.fullscreen();
  f.fire(f.window, 'keydown', { code: 'ControlLeft', ctrlKey: true });
  f.sent.length = 0;
  await f.document.exitFullscreen();
  assert.equal(f.focused(), false);
  assert.deepEqual(f.sent, [{ type: 17 }]);
  // The browser may consume keyup too; the next physical Escape must work.
  f.click(); f.sent.length = 0;
  f.fire(f.window, 'keydown', { code: 'Escape' });
  f.fire(f.window, 'keyup', { code: 'Escape' });
  assert.deepEqual(f.sent, [{ type: 15, key: [0] }, { type: 16, key: [0] }]);
});

test('fullscreen belonging to another element does not reserve Escape for this session', t => {
  const f = fixture(t);
  f.click(); f.sent.length = 0;
  f.document.fullscreenElement = { contains: () => false };
  f.fire(f.document, 'fullscreenchange');
  f.fire(f.window, 'keydown', { code: 'Escape' });
  f.fire(f.window, 'keyup', { code: 'Escape' });
  assert.deepEqual(f.sent, [{ type: 15, key: [0] }, { type: 16, key: [0] }]);
});

test('toolbar focus and unrelated DOM targets never inject input; dispose removes listeners', t => {
  const f = fixture(t);
  f.fire(f.window, 'keydown', { code: 'KeyA' });
  f.fire(f.area, 'mousedown', { target: {}, buttons: 1 });
  f.fire(f.area, 'dblclick', { target: {} });
  assert.deepEqual(f.sent, []);
  f.input.dispose();
  for (const target of [f.area, f.window, f.document]) {
    assert([...target.listeners.values()].every(list => list.length === 0));
  }
});

test('repeated blur and explicit release emit only one release-all message', t => {
  const f = fixture(t);
  f.fire(f.area, 'mousedown', { buttons: 1 });
  f.fire(f.area, 'focusout');
  f.fire(f.window, 'blur');
  f.input.release();
  f.fire(f.window, 'mouseup');
  assert.equal(f.sent.filter(data => data.type === 17).length, 1);
  assert.deepEqual(edges(f.sent).map(data => data.type), [2]);
});
