import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { io, type Socket } from 'socket.io-client';
import { DEFAULT_QUALITY, SESSION_PROTOCOL_VERSION } from '../../shared/protocol.mjs';
import { BilldDeskRuntime, type Quality, type Signal } from './runtime';
import type { FileInfo, FileSink } from './tools';
import { RemoteAudio } from './audio';
import { SessionReconnect, TransientConnectionError } from './session-reconnect';

export function useSession(video: () => HTMLElement | undefined) {
  const bridge = window.webdesk;
  const isHost = !!bridge;
  const savedUrl = localStorage.getItem('webdesk.server') || '';
  const serverUrl = ref(
    savedUrl || (isHost ? import.meta.env.VITE_SIGNALING_URL || 'http://127.0.0.1:4300' : location.origin),
  );
  const deviceId = ref(''),
    password = ref('');
  const quality = reactive<Quality>({ ...DEFAULT_QUALITY });
  const enabled = ref(false),
    busy = ref(false),
    connected = ref(false),
    error = ref('');
  const status = ref(isHost ? '远程控制未开启' : '准备连接');
  const sessionId = ref('');
  const transfer = ref('');
  const audioEnabled = ref(false),
    audioBusy = ref(false);
  let audio: RemoteAudio | undefined;
  const stats = reactive({
    fps: 0,
    bitrate: 0,
    rtt: 0,
    width: 0,
    height: 0,
    path: '协商中',
    codec: '',
    mediaDiagnostics: '',
  });
  let socket: Socket | undefined, peer: BilldDeskRuntime | undefined;
  let generation = 0;
  let pending: Signal[] = [];
  let signalQueue = Promise.resolve();
  let nativeCleanup = Promise.resolve();
  let suspended = false;
  let registrationTimer: ReturnType<typeof setTimeout> | undefined;
  let registrationAttempt = 0;
  let controllerIntent = false;
  let controllerAuthorized = false;
  const reconnect = new SessionReconnect({
    attempt: () => connectOnce(),
    onStatus: (message) => {
      busy.value = true;
      status.value = message;
      error.value = '';
    },
    onFailure: (cause) => fail(cause),
  });
  function closeSocket() {
    registrationAttempt++;
    clearTimeout(registrationTimer);
    const old = socket;
    socket = undefined;
    old?.disconnect();
  }
  const inSession = computed(() => !!sessionId.value);
  function end(reason = isHost ? '等待浏览器连接' : '连接已结束', notify = true) {
    controllerIntent = false;
    controllerAuthorized = false;
    reconnect.cancel();
    disposeSession(reason, notify);
  }
  function disposeSession(reason: string, notify: boolean) {
    generation++;
    if (notify && sessionId.value) socket?.emit('end-session');
    audio?.close();
    audio = undefined;
    audioEnabled.value = false;
    audioBusy.value = false;
    peer?.close();
    peer = undefined;
    pending = [];
    signalQueue = Promise.resolve();
    connected.value = false;
    busy.value = false;
    sessionId.value = '';
    transfer.value = '';
    status.value = reason;
    if (bridge) nativeCleanup = nativeCleanup.then(() => bridge.end()).catch(() => {});
    if (!isHost) closeSocket();
  }
  function recoverController() {
    if (isHost || !controllerIntent || !controllerAuthorized) return false;
    disposeSession('网络连接已中断', false);
    reconnect.start();
    return true;
  }
  function fail(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    end('连接失败');
    error.value = message;
  }
  function receive(signal: Signal) {
    const target = peer,
      token = generation;
    if (!target) {
      if (pending.length < 256) pending.push(signal);
      return;
    }
    signalQueue = signalQueue
      .then(async () => {
        if (target === peer) await target.receive(signal);
      })
      .catch((cause) => {
        if (token === generation) fail(cause);
      });
  }
  function createPeer(iceServers: RTCIceServer[], configuration: Quality) {
    const targetVideo = video();
    if (!targetVideo) throw Error('视频视图尚未就绪');
    const token = generation;
    const ready = () => {
      if (
        token !== generation ||
        !peer ||
        peer.dataChannel?.readyState !== 'open' ||
        peer.peerConnection?.connectionState !== 'connected'
      )
        return;
      connected.value = true;
      busy.value = false;
      reconnect.connected();
      status.value = isHost ? '浏览器正在控制此电脑' : '已连接';
      socket?.emit('session-ready', { sessionId: sessionId.value });
    };
    peer = new BilldDeskRuntime({
      iceServers,
      container: targetVideo,
      quality: configuration,
      role: isHost ? 'host' : 'controller',
      sessionId: sessionId.value,
      onSignal: (signal) => {
        if (token === generation) socket?.emit('signal', { ...signal, sessionId: sessionId.value });
      },
      onReady: ready,
      onError: (cause) => {
        if (token === generation) fail(cause);
      },
      onNativeCommand: (channel, command) => {
        if (bridge && enabled.value && token === generation)
          bridge.command(sessionId.value, channel, command);
      },
      onStats: (value) => Object.assign(stats, value),
      tools: {
        native: bridge ? (operation, data) => bridge.tool(sessionId.value, operation, data) : undefined,
        onProgress: (value) => {
          if (token === generation)
            transfer.value = `${value.direction === 'send' ? '发送' : '接收'} ${value.name} · ${value.total ? Math.floor((value.bytes / value.total) * 100) : 100}%`;
        },
      },
    });
    for (const signal of pending.splice(0)) receive(signal);
    return peer;
  }
  async function startHostSession(data: { sessionId: string; quality: Quality; iceServers: RTCIceServer[] }) {
    if (!bridge || !enabled.value || suspended || sessionId.value) return;
    sessionId.value = data.sessionId;
    busy.value = true;
    status.value = '正在采集桌面…';
    const token = generation;
    try {
      await nativeCleanup;
      if (token !== generation) return;
      const source = await bridge.capture(data.sessionId);
      if (token !== generation) return;
      const instance = createPeer(data.iceServers, data.quality);
      await instance.startHost(source);
      const track = instance.anchorStream.value?.getVideoTracks()[0];
      if (track && !source.nativeDesktop)
        track.onended = () => {
          if (token === generation) end('屏幕采集已停止');
        };
      if (token === generation) status.value = '正在建立安全连接…';
    } catch (cause) {
      if (token === generation) fail(cause);
    }
  }
  async function openSocket() {
    const url = new URL(serverUrl.value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw Error('请填写有效的 HTTP(S) 信令服务地址');
    if (!isHost && !window.isSecureContext) throw Error('浏览器远控需要 HTTPS；本机开发请使用 localhost');
    localStorage.setItem('webdesk.server', url.origin);
    const current = io(url.origin, {
      autoConnect: false,
      reconnection: isHost,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 8000,
      transports: ['websocket'],
    });
    socket = current;
    if (isHost) {
      const register = async () => {
        if (socket !== current || !enabled.value || suspended || !current.connected) return;
        clearTimeout(registrationTimer);
        const attempt = ++registrationAttempt;
        try {
          const result = await current.timeout(8000).emitWithAck('register-host', {
            deviceId: deviceId.value,
            password: password.value,
            protocolVersion: SESSION_PROTOCOL_VERSION,
          });
          if (socket !== current || attempt !== registrationAttempt || !enabled.value || suspended) return;
          if (
            result.code === 'PROTOCOL_MISMATCH' ||
            (!result.error && result.protocolVersion !== SESSION_PROTOCOL_VERSION)
          ) {
            await disable();
            error.value = '客户端与服务端版本不一致，请同步更新';
            return;
          }
          if (result.error) {
            busy.value = false;
            status.value = '正在恢复设备连接…';
            error.value = result.error;
            registrationTimer = setTimeout(() => {
              void register();
            }, 5000);
            return;
          }
          busy.value = false;
          error.value = '';
          status.value = '等待浏览器连接';
        } catch (cause) {
          if (socket !== current || attempt !== registrationAttempt || !enabled.value || suspended) return;
          busy.value = false;
          status.value = '正在恢复设备连接…';
          error.value = cause instanceof Error ? cause.message : '设备注册失败';
          // A sleeping client's old server socket can survive until its ping
          // timeout. Retry registration without rotating the user's credentials.
          registrationTimer = setTimeout(() => {
            if (socket === current && enabled.value && !suspended) current.disconnect().connect();
          }, 5000);
        }
      };
      current.on('connect', () => {
        void register();
      });
      current.on('connect_error', () => {
        if (socket !== current || !enabled.value) return;
        busy.value = false;
        status.value = '正在恢复设备连接…';
        error.value = '无法连接信令服务，正在重试';
      });
    }
    current.on('signal', (data) => {
      if (socket !== current) return;
      // A reply and an offer may arrive in the same event-loop turn.
      if (data.sessionId === sessionId.value || (!sessionId.value && busy.value && !isHost)) receive(data);
    });
    current.on('session-start', (data) => {
      if (socket === current) void startHostSession(data);
    });
    current.on('session-ended', (data) => {
      if (socket !== current || data.sessionId !== sessionId.value) return;
      if (data.reason === '对方已离线' && recoverController()) return;
      end(data.reason, false);
    });
    current.on('disconnect', () => {
      if (socket !== current) return;
      registrationAttempt++;
      clearTimeout(registrationTimer);
      if (isHost && enabled.value) {
        end(suspended ? '电脑已睡眠' : '正在恢复设备连接…', false);
        return;
      }
      if (recoverController()) return;
      socket = undefined;
      enabled.value = false;
      end('信令服务已断开', false);
      if (bridge) void bridge.disable();
    });
    if (isHost) {
      current.connect();
      return current;
    }
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        current.off('connect', connected);
        current.off('connect_error', failed);
        current.off('disconnect', failed);
      };
      const connected = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new TransientConnectionError('无法连接信令服务，请检查地址与服务状态'));
      };
      current.once('connect', connected);
      current.once('connect_error', failed);
      current.once('disconnect', failed);
      current.connect();
    });
    return current;
  }
  async function enable() {
    if (!bridge || busy.value || enabled.value) return;
    error.value = '';
    busy.value = true;
    status.value = '正在连接信令服务…';
    const token = ++generation;
    try {
      const credentials = await bridge.enable();
      if (token !== generation) return;
      deviceId.value = credentials.deviceId;
      password.value = credentials.password;
      enabled.value = true;
      await openSocket();
    } catch (cause) {
      if (token === generation) {
        await disable();
        error.value = cause instanceof Error ? cause.message : '开启失败';
      }
    }
  }
  async function disable() {
    enabled.value = false;
    end('远程控制未开启');
    busy.value = true;
    closeSocket();
    password.value = '';
    deviceId.value = '';
    try {
      await bridge?.disable();
    } finally {
      busy.value = false;
    }
  }
  async function connect() {
    if (busy.value || sessionId.value || isHost) return;
    error.value = '';
    if (!/^\d{9}$/.test(deviceId.value.replace(/\s/g, '')) || !password.value) {
      error.value = '请输入 Windows 端显示的 9 位设备代码和连接密码';
      return;
    }
    busy.value = true;
    status.value = '正在验证设备…';
    controllerIntent = true;
    try {
      await connectOnce();
    } catch (cause) {
      fail(cause);
    }
  }
  async function connectOnce() {
    busy.value = true;
    const token = ++generation;
    try {
      const current = await openSocket();
      if (token !== generation) return;
      let result;
      try {
        result = await current.timeout(8000).emitWithAck('connect-host', {
          deviceId: deviceId.value.replace(/\s/g, ''),
          password: password.value,
          quality: { ...quality },
          protocolVersion: SESSION_PROTOCOL_VERSION,
        });
      } catch {
        throw new TransientConnectionError('信令服务响应超时，正在等待网络恢复');
      }
      if (token !== generation) return;
      if (result.error) {
        if (/正在被控制|认证正在进行|认证请求繁忙/.test(result.error)) {
          throw new TransientConnectionError(result.error);
        }
        // Treat the combined response as terminal rather than retrying auth.
        throw Error(result.error);
      }
      if (result.protocolVersion !== SESSION_PROTOCOL_VERSION)
        throw Error('网页与服务端版本不一致，请同步更新');
      // Keep credentials in page memory so disconnecting does not require re-entry.
      controllerAuthorized = true;
      sessionId.value = result.sessionId;
      createPeer(result.iceServers, { ...quality });
      status.value = reconnect.active ? '正在建立新的桌面会话…' : '正在建立桌面连接…';
    } catch (cause) {
      if (token !== generation) return;
      disposeSession('正在等待重新连接', false);
      throw cause;
    }
  }
  watch(quality, (value) => {
    if (!connected.value || isHost) return;
    try {
      peer?.updateQuality({ ...value });
    } catch (cause) {
      error.value = String(cause);
    }
  });
  const tools = () => {
    if (!connected.value || !peer?.tools) throw Error('远程连接尚未就绪');
    return peer.tools;
  };
  async function toggleAudio() {
    if (!connected.value || !peer?.video || audioBusy.value) return;
    const token = generation;
    const target = peer.tools;
    if (!target) return;
    audio ??= new RemoteAudio(peer.video, (enabled) => target.request('audio.set', { enabled }, 10000));
    const current = audio;
    audioBusy.value = true;
    error.value = '';
    try {
      await current.setEnabled(!audioEnabled.value);
      if (token === generation) audioEnabled.value = current.enabled;
    } catch (cause) {
      if (token === generation) {
        audioEnabled.value = current.enabled;
        error.value = `声音传输失败：${cause instanceof Error ? cause.message : String(cause)}`;
      }
    } finally {
      if (token === generation) audioBusy.value = false;
    }
  }
  async function upload(files: File[]) {
    const target = tools();
    for (const file of files) {
      await target.sendFile({
        name: file.name,
        size: file.size,
        read: (offset, length) => file.slice(offset, offset + length).arrayBuffer(),
      });
    }
    transfer.value = '已保存到远程电脑的 下载 / WebDesk';
  }
  const selectRemoteFile = (): Promise<FileInfo | null> => tools().request('file.select', {}, 10 * 60 * 1000);
  const downloadRemote = (file: FileInfo, sink: FileSink) => tools().download(file, sink);
  const readClipboard = (): Promise<string> => tools().request('clipboard.read');
  const writeClipboard = (text: string) => tools().request('clipboard.write', { text });
  const offStop = bridge?.onStop(() => {
    void disable();
  });
  const offPower = bridge?.onPower((state) => {
    if (state === 'suspend') {
      if (suspended) return;
      suspended = true;
      if (!enabled.value) return;
      // Upstream responsePowerMonitorResume/handleCloseAll discard the old
      // media/RTC state. Also unregister here so no stale session is accepted.
      end('电脑已睡眠');
      closeSocket();
    } else {
      if (!suspended) return;
      suspended = false;
      if (!enabled.value) return;
      status.value = '正在恢复设备连接…';
      void openSocket().catch((cause) => {
        void disable();
        error.value = String(cause);
      });
    }
  });
  const offError = bridge?.onError((message) => fail(message));
  const unload = () => {
    enabled.value = false;
    end('', false);
    closeSocket();
  };
  const online = () => {
    if (controllerIntent) reconnect.online();
  };
  window.addEventListener('online', online);
  window.addEventListener('beforeunload', unload);
  onBeforeUnmount(() => {
    unload();
    offStop?.();
    offPower?.();
    offError?.();
    window.removeEventListener('beforeunload', unload);
    window.removeEventListener('online', online);
  });
  return {
    isHost,
    serverUrl,
    deviceId,
    password,
    quality,
    enabled,
    busy,
    connected,
    error,
    status,
    stats,
    inSession,
    transfer,
    audioEnabled,
    audioBusy,
    toggleAudio,
    enable,
    disable,
    connect,
    end,
    upload,
    selectRemoteFile,
    downloadRemote,
    readClipboard,
    writeClipboard,
  };
}
