import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { createPasswordHasher } from '../server/password-hash.mjs';

test('async hashes preserve credentials and reject excess work without blocking timers', async () => {
  const hash = createPasswordHasher({ concurrency: 1, queueLimit: 1 });
  let timerRan = false;
  const timer = new Promise(resolve => setTimeout(() => { timerRan = true; resolve(); }, 0));
  const first = hash('secret', 'salt'), second = hash('next', 'salt');
  await assert.rejects(hash('excess', 'salt'), /繁忙/);
  const result = await first;
  assert.equal(timerRan, true);
  await timer;
  assert.deepEqual(result, scryptSync('secret', 'salt', 32));
  assert.deepEqual(await second, scryptSync('next', 'salt', 32));
  assert.deepEqual(await hash('again', 'salt'), scryptSync('again', 'salt', 32));
});
