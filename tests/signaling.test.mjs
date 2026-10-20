import test from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { createSignalingServer } from '../server/index.mjs';
import { DEFAULT_QUALITY } from '../shared/protocol.mjs';

async function setup(t, options) {
  const server = createSignalingServer(options);
  await new Promise(resolve => server.http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.http.address().port}`;
  const clients = [];
  t.after(async () => { clients.forEach(client => client.disconnect()); await server.close(); });
  async function client() {
    const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  }
  const host = await client();
  const credentials = { deviceId: '123456789', password: 'temporary-secret-123' };
  assert.equal((await host.timeout(1000).emitWithAck('register-host', credentials)).ok, true);
  return { host, client, credentials, url };
}
const event = (socket, name) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error(`Missing ${name}`)), 1500); socket.once(name, data => { clearTimeout(timer); resolve(data); }); });
test('built HTML and its assets are served on Windows paths', async t => {
  const { url } = await setup(t);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  const html = await page.text();
  const asset = html.match(/src="\.\/([^" ]+\.js)"/)[1];
  const response = await fetch(`${url}/${asset}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(`${url}/%2e%2e%2fpackage.json`)).status, 404);
});
test('authentication, scoped signaling, disconnect and host reuse', async t => {
  const { host, client, credentials } = await setup(t);
  const controller = await client(), intruder = await client();
  const wrong = await controller.timeout(1000).emitWithAck('connect-host', { ...credentials, password: 'wrong', quality: DEFAULT_QUALITY });
  assert.match(wrong.error, /密码/);
  const hostStarted = event(host, 'session-start');
  const joined = await controller.timeout(1000).emitWithAck('connect-host', { ...credentials, quality: DEFAULT_QUALITY });
  assert.equal(joined.ok, true);
  assert.equal((await hostStarted).sessionId, joined.sessionId);
  assert.equal('password' in joined, false);
  let leaked = false;
  intruder.on('signal', () => leaked = true);
  let forged = false;
  host.on('signal', message => { if (message.data.sdp?.sdp === 'forged') forged = true; });
  intruder.emit('signal', { sessionId: joined.sessionId, msgType: 'nativeWebRtcAnswer', data: { sdp: { type: 'answer', sdp: 'forged' } } });
  const receivedOffer = event(controller, 'signal');
  host.emit('signal', { sessionId: joined.sessionId, msgType: 'nativeWebRtcOffer', data: { sdp: { type: 'offer', sdp: 'test-sdp' } } });
  assert.equal((await receivedOffer).data.sdp.sdp, 'test-sdp');
  const receivedAnswer = event(host, 'signal');
  controller.emit('signal', { sessionId: joined.sessionId, msgType: 'nativeWebRtcAnswer', data: { sdp: { type: 'answer', sdp: 'answer-sdp' } } });
  assert.equal((await receivedAnswer).data.sdp.sdp, 'answer-sdp');
  const duplicate = await intruder.timeout(1000).emitWithAck('connect-host', { ...credentials, quality: DEFAULT_QUALITY });
  assert.match(duplicate.error, /正在被控制/);
  const ended = event(host, 'session-ended');
  controller.disconnect();
  assert.equal((await ended).sessionId, joined.sessionId);
  const rejoin = await intruder.timeout(1000).emitWithAck('connect-host', { ...credentials, quality: DEFAULT_QUALITY });
  assert.equal(rejoin.ok, true);
  assert.notEqual(rejoin.sessionId, joined.sessionId);
  assert.equal(leaked, false); assert.equal(forged, false);
});
test('rejects device takeover, invalid quality, and excessive authentication attempts', async t => {
  const { client, credentials } = await setup(t);
  const attacker = await client();
  assert.match((await attacker.timeout(1000).emitWithAck('register-host', credentials)).error, /占用/);
  assert.match((await attacker.timeout(1000).emitWithAck('connect-host', { ...credentials, quality: { ...DEFAULT_QUALITY, maxFramerate: 10000 } })).error, /参数/);
  let result;
  for (let i = 0; i < 11; i++) result = await attacker.timeout(1000).emitWithAck('connect-host', { ...credentials, password: 'invalid', quality: DEFAULT_QUALITY });
  assert.match(result.error, /过多/);
});
test('negotiation timeout releases both endpoints', async t => {
  const { host, client, credentials } = await setup(t, { sessionTimeout: 70 });
  const controller = await client();
  const ended = event(host, 'session-ended');
  await controller.timeout(1000).emitWithAck('connect-host', { ...credentials, quality: DEFAULT_QUALITY });
  assert.match((await ended).reason, /超时/);
  const second = await controller.timeout(1000).emitWithAck('connect-host', { ...credentials, quality: DEFAULT_QUALITY });
  assert.equal(second.ok, true);
});
test('only both authenticated endpoints can mark a negotiation ready', async t => {
  const { host, client, credentials } = await setup(t, { sessionTimeout: 70 });
  const controller = await client(), intruder = await client();
  const ended = event(host, 'session-ended');
  const joined = await controller.timeout(1000).emitWithAck('connect-host', { ...credentials, quality: DEFAULT_QUALITY });
  host.emit('session-ready', joined);
  intruder.emit('session-ready', joined);
  assert.match((await ended).reason, /超时/);
});
test('host departure invalidates credentials', async t => {
  const { host, client, credentials } = await setup(t);
  const controller = await client();
  await controller.timeout(1000).emitWithAck('connect-host', { ...credentials, quality: DEFAULT_QUALITY });
  const ended = event(controller, 'session-ended');
  host.disconnect(); await ended;
  assert.match((await controller.timeout(1000).emitWithAck('connect-host', { ...credentials, quality: DEFAULT_QUALITY })).error, /离线/);
});

test('malformed registration and readiness messages cannot crash the server', async t => {
  const { host, client, credentials, url } = await setup(t);
  const controller = await client();
  for (const deviceId of [123456789, { toString: 'invalid' }, null, []]) {
    assert.match((await controller.timeout(1000).emitWithAck('register-host', { ...credentials, deviceId })).error, /无效/);
  }
  const joined = await controller.timeout(1000).emitWithAck('connect-host', { ...credentials, quality: DEFAULT_QUALITY });
  for (const data of [null, undefined, [], 42, 'invalid']) controller.emit('session-ready', data);
  const candidate = event(host, 'signal');
  controller.emit('signal', { sessionId: joined.sessionId, msgType: 'nativeWebRtcCandidate', data: { candidate: {} } });
  await candidate;
  const health = await (await fetch(`${url}/health`)).json();
  assert.equal(health.status, 'ok');
  assert.match(health.version, /^\d+\.\d+\.\d+$/);
});

test('upstream room relay cannot target a different session or preserve forged peer identities', async t => {
  const { host, client, credentials } = await setup(t);
  const controller = await client(), otherHost = await client(), otherController = await client();
  const otherCredentials = { deviceId: '987654321', password: 'another-secret-123' };
  await otherHost.timeout(1000).emitWithAck('register-host', otherCredentials);
  const first = await controller.timeout(1000).emitWithAck('connect-host', { ...credentials, quality: DEFAULT_QUALITY });
  const second = await otherController.timeout(1000).emitWithAck('connect-host', { ...otherCredentials, quality: DEFAULT_QUALITY });
  let leak = false; otherHost.on('signal', () => leak = true); otherController.on('signal', () => leak = true);
  const offer = event(controller, 'signal');
  host.emit('signal', { sessionId: first.sessionId, msgType: 'nativeWebRtcOffer', data: { live_room_id: second.sessionId, sender: 'forged', receiver: 'forged', sdp: { type: 'offer', sdp: 'original-body' } } });
  const result = await offer;
  assert.equal(result.data.live_room_id, first.sessionId);
  assert.equal(result.data.sender, 'host'); assert.equal(result.data.receiver, 'controller');
  assert.equal(result.data.sdp.sdp, 'original-body');
  const ended = event(host, 'session-ended'); controller.emit('end-session'); await ended;
  host.emit('signal', { sessionId: first.sessionId, msgType: 'nativeWebRtcOffer', data: { live_room_id: second.sessionId } });
  const newJoin = await controller.timeout(1000).emitWithAck('connect-host', { ...credentials, quality: DEFAULT_QUALITY });
  const candidate = event(host, 'signal');
  controller.emit('signal', { sessionId: newJoin.sessionId, msgType: 'nativeWebRtcCandidate', data: { candidate: { candidate: 'candidate-test' } } });
  assert.equal((await candidate).data.candidate.candidate, 'candidate-test');
  assert.equal(leak, false);
});
