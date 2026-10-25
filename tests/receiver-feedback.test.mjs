import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { DEFAULT_QUALITY } from '../shared/protocol.mjs';
await build({
  entryPoints: ['src/core/runtime.ts', 'src/core/media-stats.ts'],
  outdir: 'test-results/receiver-feedback',
  bundle: true,
  platform: 'node',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
});
const { BilldDeskRuntime } = await import('../test-results/receiver-feedback/runtime.mjs');
const { ReceiverMediaStats } = await import('../test-results/receiver-feedback/media-stats.mjs');

function fixture() {
  const sent = [],
    sampled = [],
    reports = [];
  const pc = {
    getStats: async () => reports.shift(),
    createOffer: () => assert.fail('controller must not initiate offers'),
  };
  const rtc = {
    peerConnection: pc,
    dataChannel: { readyState: 'open' },
    dataChannelSend: (value) => sent.push(value),
  };
  const runtime = Object.create(BilldDeskRuntime.prototype);
  Object.assign(runtime, {
    options: { role: 'controller', onStats: (value) => sampled.push(value) },
    networkStore: { rtcMap: new Map([['host', rtc]]) },
    receiverId: { value: 'host' },
    receiverStats: new ReceiverMediaStats(),
    lastReceiverFeedback: -Infinity,
    closed: false,
    ready: true,
    codecPreference: 'auto',
    advancedQuality: { degradationPreference: 'auto', networkMode: 'auto', codecPreference: 'auto' },
    currentMaxBitrate: {},
    currentMaxFramerate: {},
    currentResolutionRatio: {},
    currentVideoContentHint: {},
  });
  return { runtime, pc, sent, sampled, reports };
}
function stats(frames, decode, freezes, dropped, timestamp, codec = 'video/AV1') {
  return new Map([
    ['codec', { id: 'codec', type: 'codec', mimeType: codec }],
    [
      'video',
      {
        id: 'video',
        type: 'inbound-rtp',
        kind: 'video',
        codecId: 'codec',
        timestamp,
        framesPerSecond: 30,
        framesDecoded: frames,
        totalDecodeTime: decode,
        bytesReceived: frames * 1000,
        jitterBufferEmittedCount: frames,
        jitterBufferDelay: frames * 0.003,
        freezeCount: freezes,
        framesDropped: dropped,
        frameWidth: 1920,
        frameHeight: 1080,
        unapproved: 'must not be sent',
      },
    ],
  ]);
}

test('receiver feedback is rate-limited, whitelisted, with interval timing and cumulative freeze/drop counters', async (t) => {
  const f = fixture();
  let now = 0;
  const original = globalThis.performance;
  globalThis.performance = { now: () => now };
  t.after(() => {
    globalThis.performance = original;
  });
  f.reports.push(stats(100, 0.2, 10, 20, 1000));
  await f.runtime.collectStats();
  f.reports.push(stats(130, 0.26, 11, 21, 2000));
  now = 1000;
  await f.runtime.collectStats();
  assert.equal(f.sent.length, 1);
  f.reports.push(stats(160, 0.32, 12, 23, 3000));
  now = 2000;
  await f.runtime.collectStats();
  assert.equal(f.sent.length, 2);
  const report = f.sent[1];
  assert.equal(report.msgType, 'mediaReceiverStats');
  assert.deepEqual(
    Object.keys(report.data).sort(),
    ['codec', 'decodeMs', 'dropped', 'fps', 'freezes', 'jitterBufferMs'].sort(),
  );
  assert.equal(report.data.codec, 'video/av1');
  assert.ok(Math.abs(report.data.decodeMs - 2) < 1e-9);
  assert.ok(Math.abs(report.data.jitterBufferMs - 3) < 1e-9);
  assert.equal(report.data.freezes, 12);
  assert.equal(report.data.dropped, 23);
});

test('manual codec changes notify the host, retain Auto as a real mode, and never create a browser Offer', () => {
  const f = fixture();
  f.runtime.updateQuality({ ...DEFAULT_QUALITY, codecPreference: 'AV1' });
  assert.equal(f.runtime.codecPreference, 'AV1');
  assert.deepEqual(
    f.sent.map((message) => [message.msgType, message.data]),
    [['changeVideoCodec', { val: 'AV1' }]],
  );
  f.runtime.updateQuality({ ...DEFAULT_QUALITY, codecPreference: 'AV1' });
  assert.equal(f.sent.length, 1);
  f.runtime.updateQuality({ ...DEFAULT_QUALITY, codecPreference: 'auto' });
  assert.equal(f.runtime.codecPreference, 'auto');
  assert.equal(f.sent[1].data.val, 'auto');
});

test('codec switches with a new SSRC report the active receiver rather than the old larger byte counter', async () => {
  const f = fixture();
  const report = stats(10, 0.1, 0, 0, 3000, 'video/VP9');
  report.get('video').lastPacketReceivedTimestamp = 3000;
  report.set('old-codec', { id: 'old-codec', type: 'codec', mimeType: 'video/H264' });
  report.set('old-video', {
    id: 'old-video',
    type: 'inbound-rtp',
    kind: 'video',
    codecId: 'old-codec',
    bytesReceived: 99999999,
    framesPerSecond: 0,
    lastPacketReceivedTimestamp: 1000,
  });
  f.reports.push(report);
  await f.runtime.collectStats();
  assert.equal(f.sent[0].data.codec, 'video/vp9');
  assert.equal(f.sampled[0].codec, 'VP9');
});

test('close during a pending stats call cannot emit feedback or publish old diagnostics', async () => {
  const f = fixture();
  let release;
  f.pc.getStats = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const sampling = f.runtime.collectStats();
  f.runtime.closed = true;
  release(stats(100, 0.2, 1, 2, 1000));
  await sampling;
  assert.deepEqual(f.sent, []);
  assert.deepEqual(f.sampled, []);
});
