import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import * as vue from 'vue';

test('host resumes with the same credentials, retires stale media and respects local disable', async t => {
  const sockets = [], peers = [], disposers = [];
  let power, stopped, ends = 0, disables = 0, captures = 0;
  let deferredRegistration;
  class Socket extends EventEmitter {
    connected = false;
    sent = [];
    registrations = [];
    connect() { this.connected = true; super.emit('connect'); return this; }
    disconnect() { this.connected = false; super.emit('disconnect'); return this; }
    emit(name, data) { this.sent.push([name, data]); return true; }
    receive(name, data) { return super.emit(name, data); }
    timeout() { return this; }
    async emitWithAck(name, data) {
      assert.equal(name, 'register-host'); this.registrations.push(data);
      return deferredRegistration ? deferredRegistration() : { ok: true };
    }
  }
  const bridge = {
    enable: async () => ({ deviceId: '123456789', password: 'test-password-not-a-secret' }),
    capture: async () => { captures++; return { sourceId: 'screen:0' }; },
    end: async () => { ends++; }, disable: async () => { disables++; },
    onPower: callback => { power = callback; return () => { power = undefined; }; },
    onStop: callback => { stopped = callback; return () => {}; }, onError: () => () => {},
  };
  class Runtime {
    anchorStream = { value: { getVideoTracks: () => [this.track] } };
    track = {};
    constructor() { peers.push(this); }
    async startHost() {}
    close() { this.closed = true; }
  }
  const fixture = { vue, disposers, Runtime, io: (_url, options) => {
    assert.equal(options.reconnection, true);
    const socket = new Socket(); sockets.push(socket); return socket;
  } };
  globalThis.__hostRecovery = fixture;
  globalThis.window = { webdesk: bridge, addEventListener() {}, removeEventListener() {} };
  globalThis.localStorage = { getItem: () => 'https://example.invalid', setItem() {} };
  t.after(() => { disposers.forEach(fn => fn()); delete globalThis.__hostRecovery; delete globalThis.window; delete globalThis.localStorage; });
  await build({ entryPoints: ['src/core/session.ts'], outfile: 'test-results/host-recovery.cjs', bundle: true, platform: 'node', format: 'cjs', define: { 'import.meta.env.VITE_SIGNALING_URL': '""' }, plugins: [{
    name: 'host-fixtures', setup(builder) {
      builder.onResolve({ filter: /^(vue|socket.io-client|\.\/runtime)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'vue'
        ? 'export const { computed, reactive, ref, watch } = globalThis.__hostRecovery.vue; export const onBeforeUnmount = fn => globalThis.__hostRecovery.disposers.push(fn);'
        : args.path === 'socket.io-client' ? 'export const io = globalThis.__hostRecovery.io;'
        : 'export const BilldDeskRuntime = globalThis.__hostRecovery.Runtime;' }));
    },
  }] });
  const { useSession } = createRequire(import.meta.url)('../test-results/host-recovery.cjs');
  const session = useSession(() => ({}));
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  await session.enable(); await settle();
  const credentials = { deviceId: session.deviceId.value, password: session.password.value };
  assert.equal(session.enabled.value, true);
  sockets[0].receive('session-start', { sessionId: 'before-sleep', iceServers: [], quality: {} }); await settle();
  assert.equal(captures, 1);
  power('suspend'); power('suspend'); await settle();
  assert.equal(peers[0].closed, true);
  assert.equal(session.inSession.value, false);
  assert.equal(session.enabled.value, true, 'sleep must retain local consent');
  assert.equal(disables, 0);
  assert.equal(sockets[0].connected, false);
  assert.ok(ends > 0);
  sockets[0].receive('session-start', { sessionId: 'stale', iceServers: [], quality: {} }); await settle();
  assert.equal(captures, 1, 'retired socket cannot start capture');
  power('resume'); power('resume'); await settle();
  assert.equal(sockets.length, 2, 'duplicate resume must not create duplicate sockets');
  assert.deepEqual(sockets[1].registrations[0], credentials);
  sockets[1].receive('session-start', { sessionId: 'after-sleep', iceServers: [], quality: {} }); await settle();
  assert.equal(captures, 2, 'new connection must capture a new stream');
  assert.notEqual(peers[0], peers[1]);
  sockets[1].disconnect(); await settle();
  assert.equal(session.enabled.value, true);
  assert.equal(peers[1].closed, true);
  sockets[1].connect(); await settle();
  assert.deepEqual(sockets[1].registrations[1], credentials, 'network recovery must re-register');
  power('suspend'); await session.disable(); power('resume'); await settle();
  assert.equal(sockets.length, 2, 'explicit disable while sleeping must cancel resume');
  assert.equal(session.password.value, '');
  let complete;
  deferredRegistration = () => new Promise(resolve => { complete = resolve; });
  await session.enable(); await session.disable();
  complete({ ok: true }); await settle();
  assert.equal(session.enabled.value, false, 'late registration cannot re-enable access');
  stopped(); await settle();
  assert.equal(session.enabled.value, false);
});
