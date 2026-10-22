import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
await build({ entryPoints: ['src/core/connection-health.ts'], outfile: 'test-results/connection-health.mjs', bundle: true, platform: 'node', format: 'esm' });
await build({ entryPoints: ['src/billd/webRTC.ts'], outfile: 'test-results/rtc-recovery.mjs', bundle: true, platform: 'node', format: 'esm' });
const { monitorConnection } = await import('../test-results/connection-health.mjs');
const { createWebRTCClass } = await import('../test-results/rtc-recovery.mjs');

class Peer extends EventTarget {
  connectionState = 'connected';
  iceConnectionState = 'connected';
  closes = 0;
  createDataChannel() { return { close() {} }; }
  close() { this.closes++; }
  state(connection, ice = connection) {
    this.connectionState = connection; this.iceConnectionState = ice;
    this.dispatchEvent(new Event('iceconnectionstatechange'));
    this.dispatchEvent(new Event('connectionstatechange'));
  }
}

test('generated transport survives a brief interruption and cancels the recovery timeout', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const oldWindow = globalThis.window, oldPeer = globalThis.RTCPeerConnection;
  globalThis.window = { RTCPeerConnection: Peer }; globalThis.RTCPeerConnection = Peer;
  t.after(() => { globalThis.window = oldWindow; globalThis.RTCPeerConnection = oldPeer; });
  const RTC = createWebRTCClass({ iceServers: [], appStore: { remoteDesk: new Map(), setLiveLine() {} }, networkStore: { rtcMap: new Map() } });
  const rtc = new RTC({ roomId: 'test', sender: 'controller', receiver: 'host', isSRS: false, videoEl: { remove() {} } });
  const pc = rtc.peerConnection, errors = [];
  const dispose = monitorConnection(pc, error => errors.push(error.message));
  t.after(() => { dispose(); rtc.close(); });
  pc.state('disconnected');
  t.mock.timers.tick(14000);
  assert.equal(pc.closes, 0);
  pc.state('connected', 'completed');
  t.mock.timers.tick(20000);
  assert.deepEqual(errors, []);
  assert.equal(pc.closes, 0);
});

test('persistent interruption expires once; repeated events do not extend its deadline', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pc = new Peer(), errors = [];
  monitorConnection(pc, error => errors.push(error.message));
  pc.state('disconnected');
  t.mock.timers.tick(10000);
  pc.state('disconnected');
  t.mock.timers.tick(5000);
  assert.equal(errors.length, 1);
  pc.state('failed');
  t.mock.timers.tick(20000);
  assert.equal(errors.length, 1);
});

test('failed transport ends immediately and local disposal cancels a pending timeout', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const errors = [], pc = new Peer();
  monitorConnection(pc, error => errors.push(error.message));
  pc.state('failed');
  assert.equal(errors.length, 1);
  const next = new Peer();
  const dispose = monitorConnection(next, error => errors.push(error.message));
  next.state('disconnected'); dispose();
  t.mock.timers.tick(30000);
  assert.equal(errors.length, 1);
});
