import { io } from 'socket.io-client';
import { BilldDeskRuntime } from '../src/core/runtime';
import { DEFAULT_QUALITY } from '../shared/protocol.mjs';
type WindowState = { visible: boolean; minimized: boolean; maximized: boolean; buttons: { x: number; y: number }[] };
type HostState = { secure: boolean; connected: boolean; error: string };
declare global { interface Window { flutterTest: { credentials(): Promise<{deviceId: string;password: string;nativeWidth:number;nativeHeight:number;lockTest:boolean}>;probe(action: 'show' | 'inspect'): Promise<WindowState>;probe(action: 'status'): Promise<HostState>;probe(action: 'lock'): Promise<unknown>;phase(value: string): void;report(data: unknown): void } } }
(async () => {
  let peer: BilldDeskRuntime | undefined, failure: unknown, ready = false, ending = false;
  const socket = io('http://127.0.0.1:44300', { transports: ['websocket'], reconnection: false });
  const wait = async (condition: () => boolean, label: string, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    while (!condition() && Date.now() < deadline) { if (failure) throw failure; await new Promise(r => setTimeout(r, 100)); }
    if (!condition()) throw Error(label);
  };
  try {
    const credentials = await window.flutterTest.credentials();
    await wait(() => socket.connected, 'Socket not connected');
    const container = document.createElement('div'); container.style.cssText = 'width:1000px;height:650px'; document.body.append(container);
    let signals = Promise.resolve(); socket.on('signal', message => { signals = signals.then(() => peer!.receive(message)).catch(e => { failure = e; }); });
    socket.on('session-ended', data => { if (!ending) failure = Error(data.reason); });
    const connect = async () => {
      ready = false; failure = undefined; ending = false;
      const joined = await socket.timeout(5000).emitWithAck('connect-host', { deviceId:credentials.deviceId, password:credentials.password, quality: DEFAULT_QUALITY });
      if (!joined.ok) throw Error(joined.error);
      peer = new BilldDeskRuntime({ role: 'controller', sessionId: joined.sessionId, iceServers: [], container, quality: { ...DEFAULT_QUALITY },
        onSignal: signal => socket.emit('signal', { ...signal, sessionId: joined.sessionId }),
        onReady: () => { ready = true; socket.emit('session-ready', { sessionId: joined.sessionId }); },
        onError: error => { if (!ending) failure = error; },
      });
      await wait(() => ready && !!peer?.video?.videoWidth, 'Native video/control did not connect', 40000);
      for (const channel of [peer.dataChannel, peer.rtc.cbDataChannel] as RTCDataChannel[]) {
        if (!channel?.ordered || channel.maxRetransmits !== null || channel.maxPacketLifeTime !== null) {
          throw Error('Native control channel must be reliable and ordered');
        }
      }
    };
    await connect();
    console.log('FLUTTER:connected');
    const video = peer!.video!, pc = peer!.peerConnection;
    const initial = { width: video.videoWidth, height: video.videoHeight };
    console.log(`FLUTTER:initial ${JSON.stringify(initial)}`);
    const captionResults = [];
    let state = await window.flutterTest.probe('show');
    for (const [button, expected] of [[0, 'minimized'], [1, 'maximized'], [1, 'restored'], [2, 'hidden']] as const) {
      const point = state.buttons[button];
      if (point.x <= 0 || point.y <= 0 || point.x >= credentials.nativeWidth || point.y >= credentials.nativeHeight) throw Error('Caption button outside primary monitor');
      const send = (data: unknown) => peer!.dataChannel!.send(JSON.stringify({ msgType: 'billdDeskBehavior', data }));
      send({ type: 0, x: point.x * 1000 / credentials.nativeWidth, y: point.y * 1000 / credentials.nativeHeight });
      await new Promise(r => setTimeout(r, 150));
      send({ type: 2 });
      // A separate later message is essential: batching down/up hides the bug.
      await new Promise(r => setTimeout(r, 200));
      send({ type: 4 });
      const deadline = Date.now() + 5000;
      let matched = false;
      do {
        await new Promise(r => setTimeout(r, 100));
        state = await window.flutterTest.probe('inspect');
        matched = expected === 'minimized' ? state.minimized :
          expected === 'maximized' ? state.maximized :
          expected === 'restored' ? !state.maximized && !state.minimized : !state.visible;
      } while (!matched && Date.now() < deadline);
      if (!matched) throw Error(`Caption ${expected} failed: ${JSON.stringify(state)}`);
      captionResults.push(expected);
      console.log(`FLUTTER:caption ${expected} passed`);
      if (expected === 'minimized' || expected === 'hidden') state = await window.flutterTest.probe('show');
    }
    const qualities = [];
    for (const height of [360, 720, 1080, 1440, 2160, 4320]) {
      console.log(`FLUTTER:quality ${height}`);
      peer!.updateQuality({ ...DEFAULT_QUALITY, resolutionRatio: height, maxFramerate: 30 });
      try {
        await wait(() => video.videoHeight <= Math.min(credentials.nativeHeight, height) + 2 && video.videoHeight >= Math.min(credentials.nativeHeight, height) - 16, `quality ${height} not applied`);
      } catch (error) { throw Error(`${error}; actual=${video.videoWidth}x${video.videoHeight}`); }
      qualities.push({ requested: height, width: video.videoWidth, height: video.videoHeight });
    }
    peer!.updateQuality({ ...DEFAULT_QUALITY, maxFramerate: 60, maxBitrate: 4000 });
    await wait(() => peer!.tools?.channel.readyState === 'open', 'Tools not open');
    const tools = peer!.tools!;
    await tools.request('media.stats');
    await new Promise(resolve => setTimeout(resolve, 1100));
    const media = await tools.request('media.stats');
    if (typeof media.codec !== 'string' || media.capture !== 'desktop' ||
        typeof media.framesEncoded !== 'number' || media.framesEncoded <= 0) {
      throw Error(`Invalid native media statistics: ${JSON.stringify(media)}`);
    }
    const oldClip = await tools.request('clipboard.read');
    try {
      await tools.request('clipboard.write', { text: 'WebDesk Flutter 测试' });
      if (await tools.request('clipboard.read') !== 'WebDesk Flutter 测试') throw Error('Clipboard mismatch');
    } finally { await tools.request('clipboard.write', { text: oldClip }); }
    const bytes = new Uint8Array(2 * 1024 * 1024 + 371); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const file = await tools.sendFile({ name: 'webdesk-flutter-regression.bin', size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length).buffer });
    if (peer!.peerConnection !== pc || pc?.connectionState !== 'connected') throw Error('Peer reconnected');
    let lockScreen: unknown = 'not requested';
    if (credentials.lockTest) {
      const waitDesktop = async (secure: boolean, timeout = 20000) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          if (failure) throw failure;
          const status = await window.flutterTest.probe('status');
          if (status.error) throw Error(status.error);
          if (status.secure === secure) return;
          await new Promise(r => setTimeout(r, 300));
        }
        throw Error(`Desktop secure=${secure} timed out`);
      };
      const liveFrames = async () => {
        const decoded = async () => {
          const stats = await peer!.peerConnection!.getStats();
          let frames = 0;
          stats.forEach(stat => { if (stat.type === 'inbound-rtp' && stat.kind === 'video') frames += stat.framesDecoded || 0; });
          return frames;
        };
        const before = await decoded();
        await new Promise(r => setTimeout(r, 2000));
        const after = await decoded();
        if (failure) throw failure;
        if (after <= before) throw Error('No new decoded frames after desktop transition');
        return after - before;
      };
      const clickLocked = async () => {
        peer!.dataChannel!.send(JSON.stringify({ msgType: 'billdDeskBehavior', data: { type: 0, x: 500, y: 400 } }));
        for (let i = 0; i < 3; i++) {
          await new Promise(r => setTimeout(r, 200));
          peer!.dataChannel!.send(JSON.stringify({ msgType: 'billdDeskBehavior', data: { type: 2 } }));
          await new Promise(r => setTimeout(r, 200));
          peer!.dataChannel!.send(JSON.stringify({ msgType: 'billdDeskBehavior', data: { type: 4 } }));
        }
      };
      window.flutterTest.phase('locking');
      await window.flutterTest.probe('lock');
      await waitDesktop(true);
      await new Promise(r => setTimeout(r, 1500));
      await clickLocked();
      const transitionFrames = await liveFrames();
      ending = true;
      peer!.close();
      socket.emit('end-session');
      await new Promise(r => setTimeout(r, 1500));
      await connect();
      await clickLocked();
      const connectedWhileLockedFrames = await liveFrames();
      window.flutterTest.phase('locked-clicks-passed-unlock-now');
      await waitDesktop(false, 120000);
      await new Promise(r => setTimeout(r, 1500));
      const unlockedFrames = await liveFrames();
      lockScreen = { transitionFrames, connectedWhileLockedFrames, unlockedFrames, clicksBeforePassword: 6 };
    }
    window.flutterTest.report({ ok: true, initial, captionResults, captureLifetimeCycles: 30, qualities, media, clipboard: true, uploadBytes: bytes.length, file, samePeerConnection: true, lockScreen });
  } catch (error) { window.flutterTest.report({ ok: false, error: String(error), stack: error instanceof Error ? error.stack : undefined }); }
  finally { peer?.close(); socket.disconnect(); }
})();
