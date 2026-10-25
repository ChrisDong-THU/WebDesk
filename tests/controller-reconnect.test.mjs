import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import * as vue from 'vue';

await build({
  entryPoints: ['src/core/session.ts'],
  outfile: 'test-results/controller-reconnect.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  define: { 'import.meta.env.VITE_SIGNALING_URL': '""' },
  plugins: [
    {
      name: 'controller-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /^(vue|socket.io-client|\.\/runtime)$/ }, (args) => ({
          path: args.path,
          namespace: 'fixture',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents:
            args.path === 'vue'
              ? 'export const { computed, reactive, ref, watch } = globalThis.__controllerReconnect.vue; export const onBeforeUnmount = fn => globalThis.__controllerReconnect.disposers.push(fn);'
              : args.path === 'socket.io-client'
                ? 'export const io = globalThis.__controllerReconnect.io;'
                : 'export const BilldDeskRuntime = globalThis.__controllerReconnect.Runtime;',
        }));
      },
    },
  ],
});
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets = [],
    peers = [],
    responses = [],
    disposers = [],
    requests = [];
  const scope = vue.effectScope();
  class Socket extends EventEmitter {
    connected = false;
    sent = [];
    connect() {
      this.connected = true;
      super.emit('connect');
      return this;
    }
    disconnect() {
      if (this.connected) {
        this.connected = false;
        super.emit('disconnect', 'transport close');
      }
      return this;
    }
    emit(name, data) {
      this.sent.push([name, data]);
      return true;
    }
    receive(name, data) {
      return super.emit(name, data);
    }
    timeout() {
      return this;
    }
    async emitWithAck(name, data) {
      assert.equal(name, 'connect-host');
      requests.push(data);
      const response = responses.shift();
      if (typeof response === 'function') return response();
      return (
        response ?? { ok: true, protocolVersion: 1, sessionId: `session-${requests.length}`, iceServers: [] }
      );
    }
  }
  class Runtime {
    closes = 0;
    qualityUpdates = [];
    peerConnection = { connectionState: 'connecting' };
    dataChannel = { readyState: 'open' };
    constructor(options) {
      this.options = options;
      peers.push(this);
    }
    ready() {
      this.peerConnection.connectionState = 'connected';
      this.options.onReady();
    }
    close() {
      this.closes++;
    }
    async receive() {}
    updateQuality(value) {
      this.qualityUpdates.push({ ...value });
      this.options.quality = { ...value };
    }
  }
  globalThis.__controllerReconnect = {
    vue,
    disposers,
    Runtime,
    io: (_url, options) => {
      assert.equal(options.reconnection, false, 'old server cannot resume an authenticated room');
      const socket = new Socket();
      sockets.push(socket);
      return socket;
    },
  };
  const browser = new EventTarget();
  browser.isSecureContext = true;
  globalThis.window = browser;
  globalThis.localStorage = { getItem: () => 'https://example.invalid', setItem() {} };
  const require = createRequire(import.meta.url),
    path = require.resolve('../test-results/controller-reconnect.cjs');
  delete require.cache[path];
  const { useSession } = require(path);
  const session = scope.run(() => useSession(() => ({})));
  session.deviceId.value = '123456789';
  session.password.value = 'unchanged-in-page-password';
  t.after(() => {
    disposers.forEach((dispose) => dispose());
    scope.stop();
    delete globalThis.__controllerReconnect;
    delete globalThis.window;
    delete globalThis.localStorage;
  });
  return {
    session,
    sockets,
    peers,
    responses,
    requests,
    browser,
    async connected() {
      await session.connect();
      peers.at(-1).ready();
      await settle();
    },
    async tick(ms) {
      t.mock.timers.tick(ms);
      await settle();
    },
  };
}

test('unexpected WebSocket loss closes the old peer and creates a new authenticated session', async (t) => {
  const f = fixture(t);
  await f.connected();
  const old = f.peers[0],
    credentials = { device: f.session.deviceId.value, password: f.session.password.value };
  f.sockets[0].disconnect();
  assert.equal(old.closes, 1);
  assert.equal(f.session.inSession.value, false);
  assert.equal(f.session.busy.value, true);
  assert.match(f.session.status.value, /将建立新会话/);
  await f.tick(1999);
  assert.equal(f.sockets.length, 1);
  await f.tick(1);
  assert.equal(f.sockets.length, 2);
  assert.equal(f.peers.length, 2);
  assert.equal(f.peers[1].options.sessionId, 'session-2');
  assert.equal(f.requests[1].deviceId, credentials.device);
  assert.equal(f.requests[1].password, credentials.password);
  old.ready();
  old.options.onError(Error('late old failure'));
  assert.equal(f.session.connected.value, false);
  assert.equal(f.session.error.value, '');
  f.peers[1].ready();
  assert.equal(f.session.connected.value, true);
  await f.tick(70000);
  assert.equal(f.peers.length, 2);
  assert.equal(f.session.error.value, '');
});

test('modern codec changes keep the same room and peer; unrelated quality settings never reconnect', async (t) => {
  const f = fixture(t);
  await f.connected();
  f.session.quality.codecPreference = 'H264';
  await settle();
  assert.equal(f.peers[0].closes, 0);
  assert.equal(f.session.connected.value, true);
  assert.equal(f.peers[0].qualityUpdates.at(-1).codecPreference, 'H264');
  f.session.quality.maxFramerate = 30;
  await settle();
  await f.tick(5000);
  assert.equal(f.requests.length, 1);
  assert.equal(f.peers[0].closes, 0);
});

test('busy and network errors retry with backoff but authentication terminates recovery', async (t) => {
  const f = fixture(t);
  await f.connected();
  f.responses.push({ error: '设备正在被控制，请稍后重试' }, () => Promise.reject(Error('ack timeout')), {
    error: '设备离线或连接密码不正确',
  });
  f.sockets[0].disconnect();
  await f.tick(2000);
  assert.equal(f.requests.length, 2);
  assert.equal(f.session.busy.value, true, 'backoff remains an active recovery, preventing manual overlap');
  assert.match(f.session.status.value, /正在重试/);
  await f.tick(3999);
  assert.equal(f.requests.length, 2);
  await f.tick(1);
  assert.equal(f.requests.length, 3);
  await f.tick(8000);
  assert.equal(f.requests.length, 4);
  assert.match(f.session.error.value, /密码不正确/);
  assert.equal(f.session.busy.value, false);
  await f.tick(120000);
  assert.equal(f.requests.length, 4);
});

test('temporary peer-offline notification recovers; an explicit remote end does not', async (t) => {
  const f = fixture(t);
  await f.connected();
  f.sockets[0].receive('session-ended', { sessionId: 'session-1', reason: '对方已离线' });
  await f.tick(2000);
  f.peers[1].ready();
  f.sockets[1].receive('session-ended', { sessionId: 'session-2', reason: '连接已结束' });
  assert.equal(f.peers[1].closes, 1);
  await f.tick(120000);
  assert.equal(f.requests.length, 2);
  assert.equal(f.session.status.value, '连接已结束');
});

test('manual end cancels a pending retry and ignores an acknowledgement already in flight', async (t) => {
  const f = fixture(t);
  await f.connected();
  const ack = deferred();
  f.responses.push(() => ack.promise);
  f.sockets[0].disconnect();
  await f.tick(2000);
  assert.equal(f.requests.length, 2);
  f.session.end();
  ack.resolve({ ok: true, protocolVersion: 1, sessionId: 'late-session', iceServers: [] });
  await settle();
  await f.tick(120000);
  assert.equal(f.peers.length, 1);
  assert.equal(f.session.inSession.value, false);
  assert.equal(f.session.status.value, '连接已结束');
  f.browser.dispatchEvent(new Event('online'));
  await settle();
  assert.equal(f.requests.length, 2);
});

test('online events and duplicate disconnects cannot overlap attempts or extend the deadline', async (t) => {
  const f = fixture(t);
  await f.connected();
  const ack = deferred();
  f.responses.push(() => ack.promise);
  f.sockets[0].disconnect();
  f.browser.dispatchEvent(new Event('online'));
  await settle();
  assert.equal(f.requests.length, 2);
  f.browser.dispatchEvent(new Event('online'));
  f.browser.dispatchEvent(new Event('online'));
  f.sockets[1].disconnect();
  await settle();
  assert.equal(f.requests.length, 2);
  await f.tick(60000);
  assert.match(f.session.error.value, /自动重新连接已超时/);
  ack.resolve({ ok: true, protocolVersion: 1, sessionId: 'expired', iceServers: [] });
  await settle();
  await f.tick(120000);
  assert.equal(f.peers.length, 1);
  assert.equal(f.requests.length, 2);
});

test('closing the page cancels recovery and leaves no new peer or socket', async (t) => {
  const f = fixture(t);
  await f.connected();
  f.sockets[0].disconnect();
  f.browser.dispatchEvent(new Event('beforeunload'));
  await f.tick(120000);
  assert.equal(f.sockets.length, 1);
  assert.equal(f.peers[0].closes, 1);
});
