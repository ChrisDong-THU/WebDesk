import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

await build({
  entryPoints: ['src/core/runtime.ts', 'src/core/signaling.ts', 'src/core/connection-health.ts'],
  outdir: 'test-results/media-recovery',
  bundle: true,
  platform: 'node',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
});
const { BilldDeskRuntime } = await import('../test-results/media-recovery/runtime.mjs');
const { RemoteSignaling } = await import('../test-results/media-recovery/signaling.mjs');
const { monitorConnection } = await import('../test-results/media-recovery/connection-health.mjs');
const offer = (id, generation) => ({
  msgType: 'nativeWebRtcOffer',
  data: {
    negotiationId: id,
    sdp: { type: 'offer', sdp: `v=0\r\na=ice-ufrag:${generation}\r\n` },
  },
});
const candidate = (generation) => ({
  msgType: 'nativeWebRtcCandidate',
  data: {
    candidate: {
      candidate: 'candidate:1 1 UDP 1 127.0.0.1 9 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
      ...(generation ? { usernameFragment: generation } : {}),
    },
  },
});

class Peer extends EventTarget {
  remoteDescription = { type: 'offer', sdp: 'v=0\r\na=ice-ufrag:initial\r\n' };
  localDescription;
  signalingState = 'stable';
  connectionState = 'connected';
  iceConnectionState = 'connected';
  remoteOffers = [];
  candidates = [];
  answerCount = 0;
  closes = 0;
  gate;
  async setRemoteDescription(description) {
    if (this.gate) await this.gate;
    this.remoteDescription = description;
    this.remoteOffers.push(description);
  }
  async createAnswer() {
    this.answerCount++;
    return { type: 'answer', sdp: 'v=0\r\na=ice-ufrag:browser\r\n' };
  }
  async setLocalDescription(description) {
    this.localDescription = { ...description, toJSON: () => ({ ...description }) };
  }
  async addIceCandidate(value) {
    this.candidates.push(value);
  }
  addTrack() {
    assert.fail('renegotiation must retain existing video/audio tracks');
  }
  createDataChannel() {
    assert.fail('renegotiation must retain existing tool/input channels');
  }
  close() {
    this.closes++;
    this.connectionState = this.iceConnectionState = 'closed';
  }
  state(connection, ice = connection) {
    this.connectionState = connection;
    this.iceConnectionState = ice;
    this.dispatchEvent(new Event('connectionstatechange'));
    this.dispatchEvent(new Event('iceconnectionstatechange'));
  }
}

// Exercise the production runtime/serial signaling boundary with an established
// local peer. UI/capture setup is deliberately outside these transport tests.
function establishedRuntime() {
  const pc = new Peer(),
    signals = [],
    tools = {
      closes: 0,
      close() {
        this.closes++;
      },
    };
  const rtc = { peerConnection: pc };
  const runtime = Object.create(BilldDeskRuntime.prototype);
  Object.assign(runtime, {
    options: { role: 'controller', sessionId: 'recovery', onSignal: (signal) => signals.push(signal) },
    receiverId: { value: 'host' },
    mySocketId: { value: 'controller' },
    networkStore: {
      rtcMap: new Map([['host', rtc]]),
      wsMap: new Map(),
      removeAllRtc() {
        pc.close();
      },
      $dispose() {},
    },
    appStore: { $dispose() {} },
    anchorStream: { value: undefined },
    callbacks: new Map([['nativeWebRtcCandidate', (data) => pc.addIceCandidate(data.candidate)]]),
    cleanup: [],
    scope: { stop() {} },
    tools,
    closed: false,
  });
  runtime.signaling = new RemoteSignaling(
    (signal) => runtime.dispatchSignal(signal),
    () => !!pc.remoteDescription,
    () => pc.remoteDescription?.sdp,
  );
  return { runtime, pc, signals, tools };
}

test('host-led ICE/codec offers retain peer, tracks and tool channel, and echo negotiation ID', async () => {
  const { runtime, pc, signals, tools } = establishedRuntime();
  await runtime.receive(offer(1, 'one'));
  await runtime.receive(offer(2, 'two'));
  assert.equal(runtime.peerConnection, pc);
  assert.equal(runtime.tools, tools);
  assert.equal(tools.closes, 0);
  assert.equal(pc.closes, 0);
  assert.equal(pc.answerCount, 2);
  assert.deepEqual(
    signals.map((signal) => signal.data.negotiationId),
    [1, 2],
  );
  runtime.close();
});

test('duplicate and delayed older offers cannot roll an established peer back to stale ICE', async () => {
  const { runtime, pc, signals } = establishedRuntime();
  await runtime.receive(offer(1, 'one'));
  await runtime.receive(offer(2, 'two'));
  await runtime.receive(offer(2, 'two'));
  await runtime.receive(offer(1, 'one'));
  assert.equal(pc.answerCount, 2);
  assert.deepEqual(
    signals.map((signal) => signal.data.negotiationId),
    [1, 2],
  );
  assert.match(pc.remoteDescription.sdp, /ice-ufrag:two/);
  runtime.close();
});

test('future ICE waits for its offer, retired and untagged stale candidates are discarded', async () => {
  const { runtime, pc } = establishedRuntime();
  await runtime.receive(candidate('future'));
  assert.equal(pc.candidates.length, 0);
  await runtime.receive(offer(1, 'future'));
  assert.equal(pc.candidates.length, 1);
  await runtime.receive(candidate('initial'));
  await runtime.receive(candidate(undefined));
  assert.equal(pc.candidates.length, 1);
  await runtime.receive(candidate('future'));
  assert.equal(pc.candidates.length, 2);
  runtime.close();
});

test('close during asynchronous SDP application cannot send an Answer or continue native negotiation', async () => {
  const { runtime, pc, signals, tools } = establishedRuntime();
  let release;
  pc.gate = new Promise((resolve) => {
    release = resolve;
  });
  const receiving = runtime.receive(offer(1, 'future'));
  await Promise.resolve();
  runtime.close();
  release();
  await receiving;
  await runtime.receive(offer(2, 'later'));
  assert.equal(pc.answerCount, 0);
  assert.equal(signals.length, 0);
  assert.equal(pc.closes, 1);
  assert.equal(tools.closes, 1);
});

test('browser allows the failed-state host recovery window without replacing the peer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { runtime, pc, tools } = establishedRuntime(),
    errors = [];
  const dispose = monitorConnection(pc, (error) => errors.push(error.message), 55000, 55000);
  pc.state('failed');
  t.mock.timers.tick(33000);
  assert.equal(errors.length, 0);
  await runtime.receive(offer(1, 'recovered'));
  pc.state('connected', 'completed');
  t.mock.timers.tick(60000);
  assert.equal(errors.length, 0);
  assert.equal(pc.closes, 0);
  assert.equal(tools.closes, 0);
  dispose();
  runtime.close();
});
