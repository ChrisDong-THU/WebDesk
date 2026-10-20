import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
await build({ entryPoints: ['src/core/keyboard.ts'], outfile: 'test-results/keyboard.cjs', bundle: true, platform: 'node', format: 'cjs' });
const { createKeyboardInput, physicalKeys } = require('../test-results/keyboard.cjs');
const cases = JSON.parse(readFileSync(new URL('./fixtures/keyboard.json', import.meta.url), 'utf8'));
function setup() {
  const sent = [];
  const keyboard = createKeyboardInput(data => sent.push(data));
  const event = (code, flags = {}) => ({ code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, prevented: false, preventDefault() { this.prevented = true; }, ...flags });
  return { keyboard, sent, event };
}

test('punctuation, number row, numpad and navigation send numeric press/release pairs', () => {
  for (const [code, key] of cases) {
    const { keyboard, sent, event } = setup();
    const down = event(code), up = event(code);
    keyboard.down(down); keyboard.up(up);
    assert.deepEqual(sent, [{ type: 15, key: [key] }, { type: 16, key: [key] }], code);
    assert.ok(down.prevented && up.prevented, code);
  }
});

test('Shift symbols keep physical codes, including shifted numbers and reversed modifier release', () => {
  for (const [code, key] of cases.slice(0, 21)) {
    const { keyboard, sent, event } = setup();
    keyboard.down(event('ShiftRight', { shiftKey: true }));
    keyboard.down(event(code, { shiftKey: true }));
    keyboard.up(event('ShiftRight'));
    keyboard.up(event(code));
    assert.deepEqual(sent, [
      { type: 15, key: [97] }, { type: 15, key: [key] },
      { type: 16, key: [97] }, { type: 16, key: [key] },
    ], code);
  }
});

test('Ctrl punctuation and Ctrl navigation do not get dropped or leave keys pressed', () => {
  for (const code of ['Slash', 'BracketLeft', 'Home', 'ArrowLeft', 'KeyA']) {
    const { keyboard, sent, event } = setup();
    keyboard.down(event('ControlLeft', { ctrlKey: true }));
    keyboard.down(event(code, { ctrlKey: true }));
    keyboard.up(event(code, { ctrlKey: true }));
    keyboard.up(event('ControlLeft'));
    assert.deepEqual(sent, [
      { type: 15, key: [103] }, { type: 15, key: [physicalKeys[code]] },
      { type: 16, key: [physicalKeys[code]] }, { type: 16, key: [103] },
    ]);
  }
});

test('focus recovery reconciles held modifiers; reset drops stale key releases', () => {
  const { keyboard, sent, event } = setup();
  keyboard.down(event('Digit1', { shiftKey: true }));
  keyboard.up(event('Digit1'));
  assert.deepEqual(sent, [
    { type: 15, key: [86] }, { type: 15, key: [29] },
    { type: 16, key: [86] }, { type: 16, key: [29] },
  ]);
  keyboard.down(event('KeyA')); keyboard.reset();
  const count = sent.length;
  keyboard.up(event('KeyA'));
  assert.equal(sent.length, count);
});

test('repeat remains usable; unsupported/IME codes never send string keys', () => {
  const { keyboard, sent, event } = setup();
  keyboard.down(event('Period')); keyboard.down(event('Period')); keyboard.up(event('Period'));
  assert.equal(sent.length, 3);
  for (const code of ['Unidentified', 'Process', 'Fn', 'toString', 'Escape']) {
    const unknown = event(code);
    keyboard.down(unknown); keyboard.up(unknown);
    assert.equal(unknown.prevented, false);
  }
  assert.equal(sent.length, 3);
});
