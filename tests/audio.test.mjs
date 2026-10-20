import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

await build({ entryPoints: ['src/core/audio.ts'], outfile: 'test-results/audio.cjs', bundle: true, platform: 'node', format: 'cjs' });
const { RemoteAudio } = createRequire(import.meta.url)('../test-results/audio.cjs');

test('audio starts playback within the gesture and only enables after remote acknowledgement', async () => {
  const events = [];
  const video = { muted: true, play: async () => events.push('play') };
  const audio = new RemoteAudio(video, async enabled => { events.push(enabled); return enabled; });
  await audio.setEnabled(true);
  assert.deepEqual(events, ['play', true]);
  assert.equal(video.muted, false); assert.equal(audio.enabled, true);
  await audio.setEnabled(false);
  assert.equal(video.muted, true); assert.equal(audio.enabled, false);
  assert.deepEqual(events, ['play', true, false]);
});

test('unsupported host and blocked autoplay leave sound off', async () => {
  const video = { muted: true, play: async () => {} };
  const audio = new RemoteAudio(video, async () => { throw Error('不支持的操作'); });
  await assert.rejects(audio.setEnabled(true), /不支持/);
  assert.equal(video.muted, true); assert.equal(audio.enabled, false);
  video.play = async () => { throw Error('Autoplay denied'); };
  let requested = false;
  const blocked = new RemoteAudio(video, async () => { requested = true; });
  await assert.rejects(blocked.setEnabled(true), /Autoplay/);
  assert.equal(requested, false); assert.equal(video.muted, true);
});

test('disconnect during an audio request cannot reenable old playback', async () => {
  const video = { muted: true, play: async () => {} };
  let finish;
  const audio = new RemoteAudio(video, () => new Promise(resolve => { finish = resolve; }));
  const operation = audio.setEnabled(true);
  await new Promise(resolve => setImmediate(resolve));
  audio.close(); finish(true); await operation;
  assert.equal(audio.enabled, false); assert.equal(video.muted, true);
});

test('turning off remains locally silent even if the host cannot acknowledge', async () => {
  const video = { muted: true, play: async () => {} };
  const audio = new RemoteAudio(video, async enabled => { if (!enabled) throw Error('Timeout'); return true; });
  await audio.setEnabled(true);
  await assert.rejects(audio.setEnabled(false), /Timeout/);
  assert.equal(audio.enabled, false); assert.equal(video.muted, true);
});
