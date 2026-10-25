import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { DEFAULT_QUALITY, CODEC_OPTIONS, validQuality } from '../shared/protocol.mjs';

await build({
  entryPoints: ['src/core/video-codecs.ts'],
  outfile: 'test-results/video-codecs.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
});
const { videoCodecPreferences, preferReceiverVideoCodecs } = await import('../test-results/video-codecs.mjs');

test('quality requires the current settings contract and accepts all codec preferences', () => {
  assert.equal(DEFAULT_QUALITY.codecPreference, 'auto');
  const { codecPreference, ...legacy } = DEFAULT_QUALITY;
  assert.equal(validQuality(legacy), false);
  assert.equal(validQuality({ ...DEFAULT_QUALITY, maxFramerate: 120 }), false);
  for (const codec of CODEC_OPTIONS) assert.ok(validQuality({ ...DEFAULT_QUALITY, codecPreference: codec }));
  for (const codec of ['h264', 'H265', '', 1, {}, ['AV1']])
    assert.equal(validQuality({ ...DEFAULT_QUALITY, codecPreference: codec }), false);
});

test('manual preferences preserve all profiles, repair and fallback capability objects; Auto is neutral', () => {
  const caps = [
    { mimeType: 'video/VP8' },
    { mimeType: 'video/rtx' },
    { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=42e01f;packetization-mode=1' },
    { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=640c1f;packetization-mode=1' },
    { mimeType: 'video/AV1' },
    { mimeType: 'video/VP9' },
    { mimeType: 'video/red' },
    { mimeType: 'video/ulpfec' },
  ];
  assert.deepEqual(videoCodecPreferences(caps), caps);
  for (const codec of ['H264', 'AV1', 'VP9', 'VP8']) {
    const sorted = videoCodecPreferences(caps, codec);
    assert.equal(sorted[0].mimeType.toLowerCase(), `video/${codec.toLowerCase()}`);
    assert.equal(sorted.length, caps.length);
    assert.equal(new Set(sorted).size, caps.length);
    assert.deepEqual(
      sorted.filter((cap) => cap.mimeType === 'video/H264'),
      [caps[2], caps[3]],
    );
  }
  assert.deepEqual(videoCodecPreferences([caps[0], caps[1]], 'AV1'), [caps[0], caps[1]]);
});

test('Auto clears a previous manual preference without requiring capabilities or changing audio', (t) => {
  const old = globalThis.RTCRtpReceiver;
  t.after(() => {
    if (old === undefined) delete globalThis.RTCRtpReceiver;
    else globalThis.RTCRtpReceiver = old;
  });
  const h264 = { mimeType: 'video/H264' },
    vp8 = { mimeType: 'video/VP8' };
  globalThis.RTCRtpReceiver = { getCapabilities: () => ({ codecs: [vp8, h264] }) };
  let applied;
  const video = {
    receiver: { track: { kind: 'video' } },
    setCodecPreferences: (codecs) => {
      applied = codecs;
    },
  };
  const audio = {
    receiver: { track: { kind: 'audio' } },
    setCodecPreferences: () => assert.fail('audio order changed'),
  };
  preferReceiverVideoCodecs({ getTransceivers: () => [audio, video] }, 'H264');
  assert.deepEqual(applied, [h264, vp8]);
  globalThis.RTCRtpReceiver = undefined;
  preferReceiverVideoCodecs({ getTransceivers: () => [audio, video] }, 'auto');
  assert.deepEqual(applied, []);
  assert.doesNotThrow(() =>
    preferReceiverVideoCodecs({ getTransceivers: () => [{ receiver: { track: { kind: 'video' } } }] }),
  );
  video.setCodecPreferences = () => {
    throw Error('not supported');
  };
  assert.doesNotThrow(() => preferReceiverVideoCodecs({ getTransceivers: () => [video] }));
  assert.doesNotThrow(() =>
    preferReceiverVideoCodecs({ getTransceivers: () => assert.fail('no capabilities') }, 'AV1'),
  );
});
