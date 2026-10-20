// Production billd-desk chain, real desktop capture, real authenticated signaling.
// DOM input events are exercised, but no native OS input is injected.
import { BilldDeskRuntime, type CaptureSource, type NativeCommand } from '../src/core/runtime';
import { DEFAULT_QUALITY, RESOLUTION_OPTIONS } from '../shared/protocol.mjs';
import { io, type Socket } from 'socket.io-client';
import { version } from '../package.json';
declare global { interface Window { smoke: {
  source(): Promise<CaptureSource & { serverUrl: string; forceRelay?: boolean; turnTransport?: string }>;
  report(result: unknown): void;
  forceSecure?(value: boolean): Promise<void>;
} } }
async function run() {
  let host: BilldDeskRuntime | undefined, controller: BilldDeskRuntime | undefined;
  let hostSocket: Socket | undefined, controllerSocket: Socket | undefined;
  const OriginalPeer = window.RTCPeerConnection;
  const commands: Array<{ channel: string; command: NativeCommand }> = [];
  let ready = false, failure: unknown;
  const wait = async (condition: () => boolean, label: string, timeout = 15000) => {
    const until = Date.now() + timeout;
    while (!condition() && Date.now() < until) {
      if (failure) throw failure;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!condition()) throw Error(label);
  };
  try {
    console.log('SMOKE:upstream native capture source');
    const source = await window.smoke.source();
    const { serverUrl, forceRelay, turnTransport } = source;
    if (forceRelay) {
      // Test-only policy applied before the unchanged upstream constructor.
      window.RTCPeerConnection = class extends OriginalPeer {
        constructor(configuration: RTCConfiguration) { super({ ...configuration, iceTransportPolicy: 'relay' }); }
      };
    }
    console.log('SMOKE:public signaling');
    const connect = async () => {
      const socket = io(serverUrl, { transports: ['websocket'], reconnection: false, timeout: 10000 });
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
      return socket;
    };
    hostSocket = await connect(); controllerSocket = await connect();
    const credentials = { deviceId: String(100000000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000000), password: crypto.randomUUID() };
    const registered = await hostSocket.timeout(3000).emitWithAck('register-host', credentials);
    if (!registered.ok) throw Error(registered.error);
    const joined = await controllerSocket.timeout(3000).emitWithAck('connect-host', { ...credentials, quality: DEFAULT_QUALITY });
    if (!joined.ok) throw Error(joined.error);
    const iceServers = forceRelay ? (registered.iceServers as RTCIceServer[]).map(server => ({ ...server,
      urls: (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(url => turnTransport === 'tls' ? url.startsWith('turns:') : url.startsWith('turn:') && url.endsWith(`transport=${turnTransport}`)),
    })).filter(server => server.urls.length) : [];
    if (forceRelay && !iceServers.length) throw Error('No TURN server');
    const area = document.createElement('div'); area.style.cssText = 'width:1000px;height:650px'; document.body.append(area);
    const onError = (error: unknown) => { failure = error; };
    let clip = '', received: Uint8Array[] = [];
    const fileBytes = new Uint8Array(2 * 1024 * 1024 + 371);
    for (let i = 0; i < fileBytes.length; i++) fileBytes[i] = i % 251;
    const meta = { id: 'test-file', name: '测试.bin', size: fileBytes.length };
    host = new BilldDeskRuntime({ role: 'host', sessionId: joined.sessionId, iceServers, container: document.createElement('div'), quality: { ...DEFAULT_QUALITY },
      onSignal: message => hostSocket!.emit('signal', { ...message, sessionId: joined.sessionId }), onReady: () => {}, onError,
      onNativeCommand: (channel, command) => commands.push({ channel, command }),
      tools: { native: async (operation, data) => {
        if (operation === 'file.begin') { received = []; return meta; }
        if (operation === 'file.write') { received.push(new Uint8Array(data.bytes)); return; }
        if (operation === 'file.end' || operation === 'file.info') return meta;
        if (operation === 'file.read') return fileBytes.slice(data.offset, data.offset + data.length).buffer;
        if (operation === 'file.release' || operation === 'file.abort') return;
        if (operation === 'clipboard.write') { clip = data.text; return; }
        if (operation === 'clipboard.read') return clip;
        throw Error(operation);
      } },
    });
    controller = new BilldDeskRuntime({ role: 'controller', sessionId: joined.sessionId, iceServers, container: area, quality: { ...DEFAULT_QUALITY },
      onSignal: message => controllerSocket!.emit('signal', { ...message, sessionId: joined.sessionId }), onReady: () => { ready = true; }, onError,
    });
    let a = Promise.resolve(), b = Promise.resolve();
    hostSocket.on('signal', signal => { a = a.then(() => host!.receive(signal)).catch(onError); });
    controllerSocket.on('signal', signal => { b = b.then(() => controller!.receive(signal)).catch(onError); });
    console.log('SMOKE:upstream desktop -> remoteDesk -> WebRTC -> receive');
    await host.startHost(source);
    await wait(() => !!controller!.video?.videoWidth && ready, 'Video/control did not connect', forceRelay ? 40000 : 15000);
    hostSocket.emit('session-ready', { sessionId: joined.sessionId }); controllerSocket.emit('session-ready', { sessionId: joined.sessionId });
    const video = controller.video!;
    const receivedInput: Array<{ type: number }> = [];
    host.rtc.cbDataChannel.addEventListener('message', (event: MessageEvent) => {
      const message = JSON.parse(event.data);
      if (message.msgType === 'billdDeskBehavior') receivedInput.push(message.data);
    });
    for (const peer of [host, controller]) {
      const channel = peer.dataChannel!;
      if (!channel.ordered || channel.maxRetransmits !== null || channel.maxPacketLifeTime !== null) {
        throw Error('Control messages require reliable, ordered delivery');
      }
    }
    const track = host.anchorStream.value!.getVideoTracks()[0];
    const nativeCapture = track.getSettings();
    const originalPC = host.peerConnection, originalTrack = track.id;
    if (nativeCapture.frameRate !== DEFAULT_QUALITY.maxFramerate) throw Error('Wrong capture frame rate');
    console.log('SMOKE:upstream controller -> DataChannel -> renderer IPC');
    const rect = video.getBoundingClientRect();
    video.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    video.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: rect.left + 20, clientY: rect.top + 20 }));
    video.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: rect.left + 20, clientY: rect.top + 20 }));
    await wait(() => commands.some(item => item.channel === 'mouseReleaseButtonLeft'), 'Initial mouse release missing');
    const initialDown = commands.findIndex(item => item.channel === 'mousePressButtonLeft');
    const clickPosition = commands.slice(0, initialDown).filter(item => item.channel === 'mouseMove').at(-1)?.command.data;
    if (!clickPosition || Math.abs(clickPosition.x - source.width * source.scaleFactor * 20 / rect.width) > 2 ||
        Math.abs(clickPosition.y - source.height * source.scaleFactor * 20 / rect.height) > 2) {
      throw Error(`Click position mismatch: ${JSON.stringify({ clickPosition, width: source.width, height: source.height,
        scale: source.scaleFactor, rect: { width: rect.width, height: rect.height }, commands: commands.slice(0, initialDown + 1) })}`);
    }
    const doubleStart = commands.length;
    for (let i = 0; i < 2; i++) {
      for (const type of ['mousedown', 'mouseup', 'click']) {
        video.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0,
          buttons: type === 'mousedown' ? 1 : 0, detail: i + 1, clientX: rect.left + 30, clientY: rect.top + 30 }));
      }
    }
    video.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0, detail: 2 }));
    controller.releaseInput(); // Ordered barrier after all double-click messages.
    await wait(() => commands.slice(doubleStart).some(item => item.channel === 'webdesk:release'), 'Double-click barrier missing');
    const doubleButtons = commands.slice(doubleStart).filter(item =>
      ['mousePressButtonLeft', 'mouseReleaseButtonLeft', 'mouseDoubleClick', 'mouseLeftClick'].includes(item.channel));
    if (doubleButtons.map(item => item.channel).join(',') !==
        'mousePressButtonLeft,mouseReleaseButtonLeft,mousePressButtonLeft,mouseReleaseButtonLeft') {
      throw Error('Double-click injected extra or missing mouse transitions');
    }
    const rightStart = receivedInput.length;
    video.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2, buttons: 2, clientX: rect.left + 40, clientY: rect.top + 40 }));
    video.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 2, clientX: rect.right + 50, clientY: rect.bottom + 50 }));
    controller.releaseInput();
    await wait(() => receivedInput.slice(rightStart).some(item => item.type === 17), 'Right-drag barrier missing');
    // The legacy Electron IPC adapter has no right/middle edge dispatch.
    // Assert the wire consumed by Flutter; its protocol tests check Win32 flags.
    const rightButtons = receivedInput.slice(rightStart).filter(item => [3, 5, 9].includes(item.type));
    if (rightButtons.map(item => item.type).join(',') !== '3,5') {
      throw Error('Right drag injected extra or missing mouse transitions');
    }
    const middleStart = receivedInput.length;
    video.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 1, buttons: 4, clientX: rect.left + 40, clientY: rect.top + 40 }));
    video.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 1, clientX: rect.left + 40, clientY: rect.top + 40 }));
    video.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    controller.releaseInput();
    await wait(() => receivedInput.slice(middleStart).some(item => item.type === 17), 'Middle-click barrier missing');
    const middleButtons = receivedInput.slice(middleStart).filter(item => [18, 19].includes(item.type));
    if (middleButtons.map(item => item.type).join(',') !== '18,19') throw Error('Middle button transitions missing');
    const dragStart = commands.length;
    video.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1, clientX: rect.left + 20, clientY: rect.top + 20 }));
    document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: rect.right + 50, clientY: rect.bottom + 50 }));
    await wait(() => commands.slice(dragStart).some(item => item.channel === 'mouseReleaseButtonLeft'), 'Release outside video missing');
    const dragCommands = commands.slice(dragStart).filter(item => ['mousePressButtonLeft', 'mouseReleaseButtonLeft'].includes(item.channel));
    if (dragCommands.map(item => item.channel).join(',') !== 'mousePressButtonLeft,mouseReleaseButtonLeft') throw Error('Mouse state delivered out of order');
    video.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 }));
    video.focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', key: 'a' }));
    for (const [code, key, expected] of [['Comma', ',', 94], ['Semicolon', ';', 80], ['Quote', "'", 81], ['Backquote', '`', 28], ['Digit1', '!', 29]] as const) {
      const start = commands.length;
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key, shiftKey: code === 'Digit1', cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code, key, cancelable: true }));
      await wait(() => ['keyboardPressKey', 'keyboardReleaseKey'].every(channel => commands.slice(start).some(item => item.channel === channel && item.command.data.key[0] === expected)), `Keyboard mapping failed: ${code}`);
    }
    await wait(() => ['mouseMove', 'mousePressButtonLeft', 'mouseReleaseButtonLeft', 'mouseScrollDown', 'keyboardPressKey', 'keyboardReleaseKey'].every(channel => commands.some(item => item.channel === channel)), 'Original input handlers failed');
    if (commands.find(item => item.channel === 'mouseScrollDown')!.command.data.amount !== 1) throw Error('Wheel pixels were not normalized to one detent');
    const escapeStart = commands.length;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', key: 'Escape' }));
    await wait(() => ['keyboardPressKey', 'keyboardReleaseKey'].every(channel =>
      commands.slice(escapeStart).some(item => item.channel === channel && item.command.data.key[0] === 0)), 'Non-fullscreen Escape was not delivered');
    if (document.activeElement !== video) throw Error('Non-fullscreen Escape released video focus');
    video.blur();
    // This harness uses an unfocused, hidden BrowserWindow. Chromium does not
    // dispatch native focus events there; simulate the browser's focusout edge.
    video.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await wait(() => commands.slice(escapeStart).some(item => item.channel === 'webdesk:release'), 'Blur did not release input');
    const before = commands.length;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', key: 'b' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyB', key: 'b' }));
    await new Promise(resolve => setTimeout(resolve, 100));
    if (commands.length !== before) throw Error('Unfocused keyboard sent input');
    console.log('SMOKE:upstream constraints, native resolution compatibility');
    const resolutions = [];
    for (const option of RESOLUTION_OPTIONS) {
      const expectedHeight = Math.min(nativeCapture.height!, option.value);
      controller.updateQuality({ ...DEFAULT_QUALITY, resolutionRatio: option.value });
      await wait(() => track.getSettings().height === expectedHeight, 'Live resolution failed');
      const actual = track.getSettings();
      if (actual.height !== expectedHeight) throw Error(`${option.label}: ${actual.height}, expected ${expectedHeight}`);
      resolutions.push({ preset: option.label, width: actual.width, height: actual.height });
    }
    await wait(() => video.videoWidth === nativeCapture.width && video.videoHeight === nativeCapture.height, 'Native resolution not restored');
    const sender = host.peerConnection!.getSenders().find(sender => sender.track?.kind === 'video')!;
    if (sender.getParameters().encodings[0].maxBitrate !== undefined) throw Error('Unexpected default bitrate cap');
    controller.updateQuality({ ...DEFAULT_QUALITY, maxBitrate: 4000, maxFramerate: 30, videoContentHint: 'text' });
    await wait(() => sender.getParameters().encodings[0].maxBitrate === 4000000 && track.getSettings().frameRate === 30 && track.contentHint === 'text', 'Live bitrate/FPS/content hint failed');
    controller.updateQuality({ ...DEFAULT_QUALITY });
    await wait(() => sender.getParameters().encodings[0].maxBitrate === undefined && track.getSettings().frameRate === 60 && track.contentHint === 'detail', 'Auto bitrate restore failed');
    if (host.peerConnection !== originalPC || track.id !== originalTrack) throw Error('Settings replaced connection/track');
    console.log('SMOKE:reliable tools channel, bidirectional multi-window files and clipboard');
    await wait(() => controller!.tools?.channel.readyState === 'open', 'Tools channel unavailable');
    const tools = controller.tools!;
    await tools.request('ping');
    await tools.sendFile({ ...meta, read: async (offset, length) => fileBytes.slice(offset, offset + length).buffer });
    const incoming = new Uint8Array(await new Blob(received).arrayBuffer());
    if (incoming.length !== fileBytes.length || incoming.some((byte, i) => byte !== fileBytes[i])) throw Error('Upload mismatch');
    const downloaded: Uint8Array[] = [];
    await tools.download(meta, { write: async data => { downloaded.push(data); }, close: async () => {}, abort: async () => {} });
    const outgoing = new Uint8Array(await new Blob(downloaded).arrayBuffer());
    if (outgoing.length !== fileBytes.length || outgoing.some((byte, i) => byte !== fileBytes[i])) throw Error('Download mismatch');
    await tools.request('clipboard.write', { text: 'WebDesk 中文\nclipboard ✓' });
    if (await tools.request('clipboard.read') !== clip) throw Error('Clipboard mismatch');
    // The new negotiated channel must not replace the upstream input channel.
    const previous = commands.length;
    video.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
    await wait(() => commands.length > previous, 'File channel interfered with input');
    await new Promise(resolve => setTimeout(resolve, forceRelay ? 2500 : 100));
    const reports = await controller.peerConnection!.getStats();
    let selectedPath: any;
    reports.forEach(report => {
      if (report.type !== 'transport' || !report.selectedCandidatePairId) return;
      const pair = reports.get(report.selectedCandidatePairId), local = reports.get(pair.localCandidateId), remote = reports.get(pair.remoteCandidateId);
      selectedPath = { localType: local?.candidateType, remoteType: remote?.candidateType, relayProtocol: local?.relayProtocol, roundTripTime: pair.currentRoundTripTime };
    });
    if (forceRelay && (selectedPath?.localType !== 'relay' || selectedPath?.remoteType !== 'relay')) throw Error('Relay not used');
    if (source.nativeDesktop) {
      console.log('SMOKE:native frame fallback -> same RTC -> normal capture recovery');
      await window.smoke.forceSecure!(true);
      await wait(() => sender.track?.id !== originalTrack, 'Native fallback did not replace media');
      await wait(() => video.videoWidth > 0 && video.readyState >= 2, 'Native fallback did not decode');
      if (host.peerConnection !== originalPC || host.dataChannel?.readyState !== 'open') throw Error('Fallback replaced the connection');
      await window.smoke.forceSecure!(false);
      await wait(() => sender.track?.id === originalTrack, 'Normal capture did not resume');
      track.stop();
      await wait(() => sender.track?.id !== originalTrack && sender.track?.readyState === 'live', 'Ended capture did not recover');
      if (host.peerConnection !== originalPC || host.dataChannel?.readyState !== 'open') throw Error('Track recovery ended the connection');
    }
    const media = { width: video.videoWidth, height: video.videoHeight, capture: nativeCapture, resolutions, selectedPath, automaticBitrate: true };
    host.close(); controller.close();
    if (track.readyState !== 'ended' || area.querySelector('video')) throw Error('Original lifecycle cleanup failed');
    window.smoke.report({ ok: true, version, upstreamChain: true, nativeRecovery: !!source.nativeDesktop,
      input: { doubleClickTransitions: doubleButtons.length, rightDragTransitions: rightButtons.length, middleClickTransitions: middleButtons.length },
      liveSettingsWithoutReconnect: true, tools: { uploadBytes: incoming.length, downloadBytes: outgoing.length, clipboard: true }, media, inputChannels: [...new Set(commands.map(item => item.channel))], nativeInputInjected: false, serverUrl, forceRelay: !!forceRelay });
  } catch (error) { window.smoke.report({ ok: false, error: String(error) }); }
  finally { host?.close(); controller?.close(); hostSocket?.disconnect(); controllerSocket?.disconnect(); window.RTCPeerConnection = OriginalPeer; }
}
void run();
