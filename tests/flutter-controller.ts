import { io } from 'socket.io-client';
import { BilldDeskRuntime } from '../src/core/runtime';
import { DEFAULT_QUALITY } from '../shared/protocol.mjs';
declare global { interface Window { flutterTest: { credentials(): Promise<{deviceId: string;password: string;nativeWidth:number;nativeHeight:number}>;report(data: unknown): void } } }
(async () => {
  let peer: BilldDeskRuntime | undefined, failure: unknown, ready = false;
  const socket = io('http://127.0.0.1:44300', { transports: ['websocket'], reconnection: false });
  const wait = async (condition: () => boolean, label: string, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    while (!condition() && Date.now() < deadline) { if (failure) throw failure; await new Promise(r => setTimeout(r, 100)); }
    if (!condition()) throw Error(label);
  };
  try {
    const credentials = await window.flutterTest.credentials();
    await wait(() => socket.connected, 'Socket not connected');
    const joined = await socket.timeout(5000).emitWithAck('connect-host', { deviceId:credentials.deviceId, password:credentials.password, quality: DEFAULT_QUALITY });
    if (!joined.ok) throw Error(joined.error);
    const container = document.createElement('div'); container.style.cssText = 'width:1000px;height:650px'; document.body.append(container);
    peer = new BilldDeskRuntime({ role: 'controller', sessionId: joined.sessionId, iceServers: [], container, quality: { ...DEFAULT_QUALITY },
      onSignal: signal => socket.emit('signal', { ...signal, sessionId: joined.sessionId }),
      onReady: () => { ready = true; socket.emit('session-ready', { sessionId: joined.sessionId }); },
      onError: error => { failure = error; },
    });
    let signals = Promise.resolve(); socket.on('signal', message => { signals = signals.then(() => peer!.receive(message)).catch(e => { failure = e; }); });
    socket.on('session-ended', data => { failure = Error(data.reason); });
    await wait(() => ready && !!peer?.video?.videoWidth, 'Native video/control did not connect', 40000);
    console.log('FLUTTER:connected');
    const video = peer.video!, pc = peer.peerConnection;
    const initial = { width: video.videoWidth, height: video.videoHeight };
    console.log(`FLUTTER:initial ${JSON.stringify(initial)}`);
    const qualities = [];
    for (const height of [360, 720, 1080, 1440, 2160, 4320]) {
      console.log(`FLUTTER:quality ${height}`);
      peer.updateQuality({ ...DEFAULT_QUALITY, resolutionRatio: height, maxFramerate: 30 });
      try {
        await wait(() => video.videoHeight <= Math.min(credentials.nativeHeight, height) + 2 && video.videoHeight >= Math.min(credentials.nativeHeight, height) - 16, `quality ${height} not applied`);
      } catch (error) { throw Error(`${error}; actual=${video.videoWidth}x${video.videoHeight}`); }
      qualities.push({ requested: height, width: video.videoWidth, height: video.videoHeight });
    }
    peer.updateQuality({ ...DEFAULT_QUALITY, maxFramerate: 60, maxBitrate: 4000 });
    await wait(() => peer!.tools?.channel.readyState === 'open', 'Tools not open');
    const tools = peer.tools!;
    const oldClip = await tools.request('clipboard.read');
    try {
      await tools.request('clipboard.write', { text: 'WebDesk Flutter 测试' });
      if (await tools.request('clipboard.read') !== 'WebDesk Flutter 测试') throw Error('Clipboard mismatch');
    } finally { await tools.request('clipboard.write', { text: oldClip }); }
    const bytes = new Uint8Array(2 * 1024 * 1024 + 371); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const file = await tools.sendFile({ name: 'webdesk-flutter-regression.bin', size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length).buffer });
    if (peer.peerConnection !== pc || pc?.connectionState !== 'connected') throw Error('Peer reconnected');
    window.flutterTest.report({ ok: true, initial, qualities, clipboard: true, uploadBytes: bytes.length, file, samePeerConnection: true });
  } catch (error) { window.flutterTest.report({ ok: false, error: String(error), stack: error instanceof Error ? error.stack : undefined }); }
  finally { peer?.close(); socket.disconnect(); }
})();
