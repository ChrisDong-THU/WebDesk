import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Server } from 'socket.io';
import { validQuality } from '../shared/protocol.mjs';
import { registerRemoteSignals } from './billd/signaling.mjs';
import { clientAddressResolver } from './client-address.mjs';
import { createPasswordHasher } from './password-hash.mjs';

const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const defaultOrigins = [5173, 5174, 4300].flatMap(port => [`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
export function createSignalingServer({ origins = defaultOrigins, iceServers = [], sessionTimeout = 30000, trustedProxies = [], passwordHash = createPasswordHasher() } = {}) {
  const clientAddress = clientAddressResolver(trustedProxies);
  const http = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ service: 'WebDesk', status: 'ok', version })); return;
    }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) throw Error('Not found');
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch { res.writeHead(404); res.end('Not found. Build WebDesk with npm run build.'); }
  });
  // Chromium Electron file pages send file://; both host and controller still
  // require password-authenticated session membership before signaling.
  const originAllowed = origin => !origin || origin === 'null' || origin === 'file://' || origins.includes(origin);
  const io = new Server(http, {
    cors: { origin: (origin, cb) => cb(null, originAllowed(origin)) },
    allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin)),
    maxHttpBufferSize: 128 * 1024,
  });
  const hosts = new Map(), sessions = new Map(), attempts = new Map();
  const limited = (key, max = 10) => {
    const now = Date.now();
    let item = attempts.get(key);
    if (!item || item.until <= now) { item = { count: 0, until: now + 60000 }; attempts.set(key, item); }
    return ++item.count > max;
  };
  const sweep = setInterval(() => { for (const [key, value] of attempts) if (value.until <= Date.now()) attempts.delete(key); }, 60000);
  sweep.unref();
  function endSession(id, reason = '连接已结束') {
    const session = sessions.get(id);
    if (!session) return;
    clearTimeout(session.timer);
    sessions.delete(id);
    for (const peer of [session.host, session.controller]) {
      const socket = io.sockets.sockets.get(peer);
      if (socket) { socket.leave(id); socket.data.session = undefined; socket.emit('session-ended', { sessionId: id, reason }); }
    }
  }
  io.on('connection', socket => {
    const address = clientAddress(socket);
    // Original upstream handlers dispatch to an authenticated two-peer room.
    // The adapter retains WebDesk's wire envelope for already-installed clients.
    const upstreamSignals = new Map();
    registerRemoteSignals({ socket: {
      on: (name, handler) => upstreamSignals.set(name, handler),
      to: roomId => ({ emit: (msgType, data) => {
        if (roomId !== socket.data.session || !sessions.has(roomId)) return;
        socket.to(roomId).emit('signal', { sessionId: roomId, msgType, data });
      } }),
    } });
    socket.on('register-host', async (data, ack = () => {}) => {
      if (typeof ack !== 'function') return;
      if (socket.data.authenticating) return ack({ error: '认证正在进行，请稍后重试' });
      if (limited(`register:${address}`, 20)) return ack({ error: '请求过于频繁，请一分钟后重试' });
      if (socket.data.deviceId || socket.data.session || !data || typeof data.deviceId !== 'string' || !/^\d{9}$/.test(data.deviceId) || typeof data.password !== 'string' || data.password.length < 12 || data.password.length > 128) return ack({ error: '无效的设备注册' });
      if (hosts.has(data.deviceId)) return ack({ error: '设备代码已占用，请关闭重复运行的客户端或点击重新生成' });
      const token = socket.data.authenticating = {};
      try {
        const salt = randomBytes(16);
        const hash = await passwordHash(data.password, salt);
        if (!socket.connected || socket.data.authenticating !== token) return;
        if (hosts.has(data.deviceId)) return ack({ error: '设备代码已占用，请关闭重复运行的客户端或点击重新生成' });
        hosts.set(data.deviceId, { socketId: socket.id, salt, hash });
        socket.data.deviceId = data.deviceId;
        ack({ ok: true, iceServers });
      } catch { if (socket.connected) ack({ error: '认证请求繁忙，请稍后重试' }); }
      finally { if (socket.data.authenticating === token) socket.data.authenticating = undefined; }
    });
    socket.on('connect-host', async (data, ack = () => {}) => {
      if (typeof ack !== 'function') return;
      if (socket.data.authenticating) return ack({ error: '认证正在进行，请稍后重试' });
      if (limited(`connect:${address}`, 60)) return ack({ error: '连接尝试过多，请一分钟后重试' });
      if (socket.data.deviceId || socket.data.session || !data || !validQuality(data.quality) || typeof data.deviceId !== 'string' || typeof data.password !== 'string' || data.password.length > 128) return ack({ error: '连接参数不正确' });
      if (!/^\d{9}$/.test(data.deviceId)) return ack({ error: '连接参数不正确' });
      if (limited(`device:${address}:${data.deviceId}`)) return ack({ error: '连接尝试过多，请一分钟后重试' });
      const host = hosts.get(data.deviceId);
      if (!host) return ack({ error: '设备离线或连接密码不正确' });
      const token = socket.data.authenticating = {};
      try {
        const hash = await passwordHash(data.password, host.salt);
        if (!socket.connected || socket.data.authenticating !== token) return;
        if (hosts.get(data.deviceId) !== host || !timingSafeEqual(host.hash, hash)) return ack({ error: '设备离线或连接密码不正确' });
        const hostSocket = io.sockets.sockets.get(host.socketId);
        if (!hostSocket || hostSocket.data.session) return ack({ error: '设备正在被控制，请稍后重试' });
        const sessionId = randomUUID();
        const session = { host: host.socketId, controller: socket.id, ready: new Set(), timer: setTimeout(() => endSession(sessionId, '连接超时，请检查网络或 TURN 配置'), sessionTimeout) };
        sessions.set(sessionId, session);
        socket.data.session = hostSocket.data.session = sessionId;
        socket.join(sessionId); hostSocket.join(sessionId);
        ack({ ok: true, sessionId, iceServers });
        hostSocket.emit('session-start', { sessionId, quality: data.quality, iceServers });
      } catch { if (socket.connected) ack({ error: '认证请求繁忙，请稍后重试' }); }
      finally { if (socket.data.authenticating === token) socket.data.authenticating = undefined; }
    });
    socket.on('signal', data => {
      const session = sessions.get(socket.data.session);
      if (!session || data?.sessionId !== socket.data.session || limited(`signal:${socket.id}`, 600)) return;
      const fromHost = session.host === socket.id;
      if (!['nativeWebRtcOffer', 'nativeWebRtcAnswer', 'nativeWebRtcCandidate'].includes(data.msgType)) return;
      if (data.msgType === 'nativeWebRtcOffer' && !fromHost || data.msgType === 'nativeWebRtcAnswer' && fromHost) return;
      const payload = data.data;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || JSON.stringify(payload).length > 100000) return;
      // Never trust a client-selected room or peer identity. The original
      // signaling body is retained; routing fields come from this session.
      upstreamSignals.get(data.msgType)?.({ data: { ...payload,
        live_room_id: socket.data.session,
        sender: fromHost ? 'host' : 'controller', receiver: fromHost ? 'controller' : 'host',
      } });
    });
    socket.on('session-ready', data => {
      const session = sessions.get(socket.data.session);
      if (!session || data?.sessionId !== socket.data.session) return;
      session.ready.add(socket.id);
      if (session.ready.size === 2) clearTimeout(session.timer);
    });
    socket.on('end-session', () => {
      socket.data.authenticating = undefined;
      endSession(socket.data.session);
    });
    socket.on('disconnect', () => {
      endSession(socket.data.session, '对方已离线');
      if (socket.data.deviceId) hosts.delete(socket.data.deviceId);
    });
  });
  return { http, io, close: async () => { clearInterval(sweep); for (const id of sessions.keys()) endSession(id); await new Promise(resolve => io.close(resolve)); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const iceServers = JSON.parse(process.env.ICE_SERVERS || '[]');
  if (!Array.isArray(iceServers)) throw Error('ICE_SERVERS must be a JSON array');
  const server = createSignalingServer({
    origins: process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()), iceServers,
    trustedProxies: (process.env.TRUSTED_PROXIES || '').split(',').map(s => s.trim()).filter(Boolean),
  });
  const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 4300);
  server.http.listen(port, host, () => console.log(`WebDesk: http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
}
