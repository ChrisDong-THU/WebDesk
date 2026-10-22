import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

await build({ entryPoints: ['src/core/signaling.ts'], outfile: 'test-results/remote-signaling.mjs', bundle: true, platform: 'node', format: 'esm' });
const { RemoteSignaling } = await import('../test-results/remote-signaling.mjs');
const candidate = id => ({ msgType: 'nativeWebRtcCandidate', data: { id } });
const offer = { msgType: 'nativeWebRtcOffer', data: {} };

test('ICE before the offer and during SDP application is delivered exactly once in order', async () => {
  let ready = false, release;
  const gate = new Promise(resolve => { release = resolve; }), calls = [];
  const signaling = new RemoteSignaling(async signal => {
    if (signal === offer) { calls.push('offer'); await gate; ready = true; }
    else { assert.ok(ready); calls.push(signal.data.id); }
  }, () => ready);
  await signaling.receive(candidate(1));
  assert.deepEqual(calls, []);
  const applying = signaling.receive(offer);
  const later = signaling.receive(candidate(2));
  await Promise.resolve();
  assert.deepEqual(calls, ['offer']);
  release();
  await Promise.all([applying, later]);
  assert.deepEqual(calls, ['offer', 1, 2]);
});

test('close during SDP application discards queued ICE and future signals', async () => {
  let release, ready = false;
  const gate = new Promise(resolve => { release = resolve; }), calls = [];
  const signaling = new RemoteSignaling(async signal => {
    calls.push(signal.msgType); await gate; ready = true;
  }, () => ready);
  await signaling.receive(candidate(1));
  const applying = signaling.receive(offer);
  await Promise.resolve();
  signaling.close(); release();
  await applying;
  await signaling.receive(candidate(2));
  assert.deepEqual(calls, ['nativeWebRtcOffer']);
});

test('failed negotiation rejects and stops further dispatch; pending ICE is bounded', async () => {
  let calls = 0;
  const signaling = new RemoteSignaling(async () => { calls++; throw Error('bad SDP'); }, () => false);
  await assert.rejects(signaling.receive(offer), /bad SDP/);
  await signaling.receive(offer);
  assert.equal(calls, 1);
  const queued = new RemoteSignaling(async () => assert.fail('early ICE'), () => false);
  for (let i = 0; i < 256; i++) await queued.receive(candidate(i));
  await assert.rejects(queued.receive(candidate(256)), /连接候选过多/);
});

test('generated RTC and answer adapters propagate SDP and ICE errors to the caller', async t => {
  await build({ entryPoints: ['src/billd/webRTC.ts'], outfile: 'test-results/rtc-errors.mjs', bundle: true, platform: 'node', format: 'esm' });
  await build({ entryPoints: ['src/billd/remoteDesk.ts'], outfile: 'test-results/answer-errors.mjs', bundle: true, platform: 'node', format: 'esm' });
  const { createWebRTCClass } = await import('../test-results/rtc-errors.mjs');
  const { createRemoteDesk } = await import('../test-results/answer-errors.mjs');
  class Peer {
    addEventListener() {}
    createDataChannel() { return { close() {} }; }
    close() {}
  }
  for (const method of ['createOffer', 'createAnswer', 'setRemoteDescription', 'setLocalDescription', 'addIceCandidate']) {
    Peer.prototype[method] = async () => { throw Error(`failed ${method}`); };
  }
  const oldWindow = globalThis.window, oldPeer = globalThis.RTCPeerConnection;
  globalThis.window = { RTCPeerConnection: Peer }; globalThis.RTCPeerConnection = Peer;
  t.after(() => { globalThis.window = oldWindow; globalThis.RTCPeerConnection = oldPeer; });
  const networkStore = { rtcMap: new Map(), wsMap: new Map([['test', { send() { assert.fail('invalid answer sent'); } }]]) };
  const appStore = { remoteDesk: new Map() };
  const RTC = createWebRTCClass({ iceServers: [], appStore, networkStore });
  const rtc = new RTC({ roomId: 'test', sender: 'controller', receiver: 'host', isSRS: false, videoEl: { remove() {} } });
  t.after(() => rtc.close());
  for (const method of ['createOffer', 'createAnswer', 'setRemoteDescription', 'setLocalDescription', 'addIceCandidate']) {
    await assert.rejects(rtc[method]({}), new RegExp(`failed ${method}`));
  }
  const remote = createRemoteDesk({ WebRTCClass: RTC, networkStore, appStore });
  remote.updateWebRtcRemoteDeskConfig({ roomId: 'test' });
  await assert.rejects(remote.webRtcRemoteDesk.sendAnswer({ sender: 'controller', receiver: 'host', sdp: {} }), /failed setRemoteDescription/);
});
