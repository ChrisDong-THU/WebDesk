import test from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { createSignalingServer } from '../server/index.mjs';
import { DEFAULT_QUALITY } from '../shared/protocol.mjs';
import { createPasswordHasher } from '../server/password-hash.mjs';

function controlledHasher() {
  const hash = createPasswordHasher();
  const waiting = [];
  let paused = false;
  return {
    waiting, pause() { paused = true; },
    hash: async (...args) => {
      if (paused) await new Promise(resolve => waiting.push(resolve));
      return hash(...args);
    },
    async wait(count) {
      const deadline = Date.now() + 2000;
      while (waiting.length < count) {
        if (Date.now() > deadline) throw Error('Hash did not start');
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    },
    resume() { paused = false; waiting.splice(0).forEach(resolve => resolve()); },
  };
}

async function setup(t, options) {
  const server = createSignalingServer(options);
  await new Promise(resolve => server.http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.http.address().port}`;
  const clients = [];
  t.after(async () => { clients.forEach(client => client.disconnect()); await server.close(); });
  async function client(extraHeaders = {}) {
    const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders });
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

test('trusted proxy isolates users and batch registrations while enforcing each target quota', async t => {
  const { client, credentials } = await setup(t, { trustedProxies: ['127.0.0.1'] });
  const noisy = await client({ 'X-Real-IP': '192.0.2.1' });
  const request = { ...credentials, password: 'wrong', quality: DEFAULT_QUALITY };
  for (let i = 0; i < 10; i++) await noisy.timeout(1000).emitWithAck('connect-host', request);
  assert.match((await noisy.timeout(1000).emitWithAck('connect-host', request)).error, /过多/);
  const legitimate = await client({ 'X-Real-IP': '192.0.2.2' });
  assert.equal((await legitimate.timeout(1000).emitWithAck('connect-host', {
    ...credentials, quality: DEFAULT_QUALITY,
  })).ok, true);
  for (let i = 0; i < 22; i++) {
    const host = await client({ 'X-Real-IP': `198.51.100.${i + 1}` });
    assert.equal((await host.timeout(1000).emitWithAck('register-host', {
      deviceId: String(200000000 + i), password: credentials.password,
    })).ok, true);
  }
});

test('untrusted forwarding headers cannot reset authentication quotas', async t => {
  const { client, credentials } = await setup(t);
  for (let i = 0; i < 11; i++) {
    const attacker = await client({ 'X-Real-IP': `192.0.2.${i + 1}`, 'X-Forwarded-For': `198.51.100.${i + 1}` });
    const result = await attacker.timeout(1000).emitWithAck('connect-host', {
      ...credentials, password: 'wrong', quality: DEFAULT_QUALITY,
    });
    assert.match(result.error, i < 10 ? /密码/ : /过多/);
  }
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

test('async authentication rechecks host ownership and permits only one concurrent controller', async t => {
  const hashes = controlledHasher();
  t.after(() => hashes.resume());
  const { client, credentials, url } = await setup(t, { passwordHash: hashes.hash });
  const first = await client(), second = await client();
  hashes.pause();
  const one = first.timeout(3000).emitWithAck('connect-host', { ...credentials, quality: DEFAULT_QUALITY });
  const two = second.timeout(3000).emitWithAck('connect-host', { ...credentials, quality: DEFAULT_QUALITY });
  await hashes.wait(2);
  assert.equal((await (await fetch(`${url}/health`)).json()).status, 'ok');
  assert.match((await first.timeout(1000).emitWithAck('register-host', {
    deviceId: '999999999', password: credentials.password,
  })).error, /正在进行/);
  hashes.resume();
  const results = await Promise.all([one, two]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.match(results.find(result => result.error).error, /正在被控制/);
});

test('simultaneous registration cannot replace an existing owner', async t => {
  const hashes = controlledHasher();
  t.after(() => hashes.resume());
  const { client, credentials } = await setup(t, { passwordHash: hashes.hash });
  const first = await client(), second = await client();
  const registration = { ...credentials, deviceId: '999999999' };
  hashes.pause();
  const one = first.timeout(3000).emitWithAck('register-host', registration);
  const two = second.timeout(3000).emitWithAck('register-host', registration);
  await hashes.wait(2);
  hashes.resume();
  const results = await Promise.all([one, two]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.match(results.find(result => result.error).error, /占用/);
});

test('host disconnect during hashing invalidates in-flight authentication', async t => {
  const hashes = controlledHasher();
  t.after(() => hashes.resume());
  const { host, client, credentials } = await setup(t, { passwordHash: hashes.hash });
  const controller = await client();
  hashes.pause();
  const joining = controller.timeout(3000).emitWithAck('connect-host', { ...credentials, quality: DEFAULT_QUALITY });
  await hashes.wait(1);
  host.disconnect();
  // Round trip on another socket lets the disconnect event reach the server.
  await new Promise(resolve => setTimeout(resolve, 30));
  hashes.resume();
  assert.match((await joining).error, /离线/);
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
