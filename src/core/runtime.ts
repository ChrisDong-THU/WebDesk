/** Deployment/UI boundary around the extracted billd-desk call chain. */
import { createPinia } from 'pinia';
import { computed, effectScope, ref, watch, type EffectScope } from 'vue';
import { useAppStore, useNetworkStore } from '../billd/stores';
import { createWebRTCClass } from '../billd/webRTC';
import { createRemoteDesk } from '../billd/remoteDesk';
import { registerRemoteReceivers } from '../billd/receive';
import { createHostPage } from '../billd/host';
import { createInputDispatch } from '../billd/ipc';
import { handlConstraints, videoFullBox } from '../billd/utils';
import { registerControllerSettings } from '../billd/settings';
import { validQuality } from '../../shared/protocol.mjs';
import { DesktopTools, type ToolsOptions } from './tools';
import { HostCapture } from './host-capture';
import { bindControllerInput } from './controller-input';
import type { CaptureSource, NativeCommand } from '../../shared/desktop';
export type { CaptureSource, NativeCommand } from '../../shared/desktop';

export type Quality = { maxBitrate: number; maxFramerate: number; resolutionRatio: number; videoContentHint: string };
export type Signal = { msgType: string; data: Record<string, any> };
export type Stats = { fps: number; bitrate: number; rtt: number; width: number; height: number; path: string;
  codec?: string; mediaDiagnostics?: string };
type Options = {
  role: 'host' | 'controller'; sessionId: string; iceServers: RTCIceServer[];
  container: HTMLElement; quality: Quality; onSignal: (signal: Signal) => void;
  onReady: () => void; onError: (error: unknown) => void;
  onStats?: (stats: Stats) => void;
  onNativeCommand?: (channel: string, command: NativeCommand) => void;
  tools?: ToolsOptions;
};

export class BilldDeskRuntime {
  readonly pinia = createPinia();
  readonly appStore: any = useAppStore(this.pinia);
  readonly networkStore: any = useNetworkStore(this.pinia);
  readonly anchorStream = ref<MediaStream>();
  readonly roomId;
  readonly mySocketId;
  readonly receiverId;
  private scope: EffectScope = effectScope();
  private hostPage: ReturnType<typeof createHostPage>;
  private callbacks = new Map<string, (data: any) => unknown>();
  private cleanup: Array<() => void> = [];
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private ready = false;
  private lastBytes = 0;
  private lastTime = 0;
  private sampling = false;
  private currentMaxFramerate;
  private currentMaxBitrate;
  private currentResolutionRatio;
  private currentVideoContentHint;
  private nativeHeight = 0;
  private capture?: HostCapture;
  private controllerInput?: ReturnType<typeof bindControllerInput>;
  tools?: DesktopTools;

  constructor(private options: Options) {
    this.roomId = ref(options.sessionId);
    this.mySocketId = ref(options.role);
    this.receiverId = ref(options.role === 'host' ? 'controller' : 'host');
    this.currentMaxFramerate = ref(options.quality.maxFramerate);
    this.currentMaxBitrate = ref(options.quality.maxBitrate);
    this.currentResolutionRatio = ref(options.quality.resolutionRatio);
    this.currentVideoContentHint = ref(options.quality.videoContentHint);
    // Translate only the transport envelope. The original hook produces SDP,
    // ICE and sender/receiver fields, and the original handlers consume them.
    const ws = { socketIo: {
      id: options.role,
      on: (event: string, callback: (data: any) => unknown) => this.callbacks.set(event, callback),
    }, send: (message: Signal) => options.onSignal(message), close: () => {} };
    this.networkStore.wsMap.set(options.sessionId, ws);
    const environment = {
      appStore: this.appStore, networkStore: this.networkStore, iceServers: options.iceServers,
      roomId: this.roomId, mySocketId: this.mySocketId,
      deskUserUuid: ref(''), remoteDeskUserUuid: ref(''),
    };
    const WebRTCClass = createWebRTCClass(environment);
    const remote = createRemoteDesk({ ...environment, WebRTCClass });
    remote.updateWebRtcRemoteDeskConfig({ roomId: options.sessionId, anchorStream: undefined });
    registerRemoteReceivers({ ...environment, ...remote, ws });
    const dispatch = createInputDispatch({
      appStore: this.appStore,
      ipcRenderer: options.role === 'host' ? {} : undefined,
      ipcRendererSend: (command: { channel: string; windowId: number; requestId: string; data: any }) => {
        if (!this.closed) options.onNativeCommand?.(command.channel, {
          requestId: command.requestId, data: { windowId: command.windowId, ...command.data },
        });
      },
      ipcRendererInvoke: () => undefined,
    });
    this.hostPage = this.scope.run(() => {
      const hostRtc = ref<any>();
      const rtcAdapter = computed({
        get: () => ({ setMaxBitrate: async (value: number) => {
          if (value) return hostRtc.value?.setMaxBitrate(value);
          // WebDesk's existing Auto option removes the application cap.
          for (const sender of (hostRtc.value?.peerConnection?.getSenders() || []) as RTCRtpSender[]) {
            if (sender.track?.kind !== 'video') continue;
            const parameters = sender.getParameters();
            parameters.encodings.forEach(encoding => delete encoding.maxBitrate);
            await sender.setParameters(parameters);
          }
        } }),
        set: (value: any) => { hostRtc.value = value; },
      });
      if (options.role === 'controller') registerControllerSettings({ ...environment,
        receiverId: this.receiverId, currentMaxBitrate: this.currentMaxBitrate,
        currentMaxFramerate: this.currentMaxFramerate, currentResolutionRatio: this.currentResolutionRatio,
        currentVideoContentHint: this.currentVideoContentHint,
      });
      // Keep the original data-channel watch, including live quality messages.
      const host = createHostPage({ ...environment, ...remote,
        anchorStream: this.anchorStream, rtc: rtcAdapter,
        applyConstraints: (data: { frameRate: number; height: number; stream: MediaStream }) =>
          handlConstraints({ ...data, height: Math.min(data.height, this.nativeHeight || data.height) }),
        currentMaxBitrate: this.currentMaxBitrate,
        currentMaxFramerate: this.currentMaxFramerate,
        currentResolutionRatio: this.currentResolutionRatio,
        currentVideoContentHint: this.currentVideoContentHint,
        currentAudioContentHint: ref(''), cacheStore: { deskUserUuid: '', remoteDeskUserUuid: '' },
        handleRtcBilldDeskBehavior: (windowId: number, data: any) => {
          // Existing WebDesk release-on-blur boundary; ordinary input is passed
          // untouched to the upstream renderer dispatch.
          if (data.type === 17) options.onNativeCommand?.('webdesk:release', { requestId: 'release', data: {} });
          else dispatch.handleRtcBilldDeskBehavior(windowId, data);
        },
      });
      const observed = new WeakSet<RTCPeerConnection>();
      watch(() => this.networkStore.rtcMap, (map: Map<string, any>) => {
        map.forEach(rtc => {
          const pc = rtc.peerConnection as RTCPeerConnection | null;
          if (!pc || observed.has(pc)) return;
          observed.add(pc);
          this.tools = new DesktopTools(pc, options.role, options.tools);
          const ready = () => {
            if (this.closed || this.ready || pc.connectionState !== 'connected' || rtc.dataChannel.readyState !== 'open') return;
            this.ready = true;
            // Explicit non-auto selection remains a UI option; default matches
            // upstream's uncapped newWebRtc constructor.
            if (options.role === 'host' && options.quality.maxBitrate > 0) rtc.setMaxBitrate(options.quality.maxBitrate);
            options.onReady();
          };
          pc.addEventListener('connectionstatechange', ready);
          rtc.dataChannel.addEventListener('open', ready);
          if (options.role === 'controller') this.mountVideo(rtc.videoEl);
        });
      }, { deep: true, immediate: true });
      watch(() => this.appStore.remoteDesk.get(this.receiverId.value)?.isClose, (closed: boolean) => {
        if (closed && !this.closed) options.onError(new Error('远程连接已结束'));
      });
      return host;
    })!;
    if (options.role === 'controller') this.bindController();
    if (options.onStats) this.timer = setInterval(() => void this.collectStats().catch(() => {}), 1000);
  }
  get rtc(): any { return this.networkStore.rtcMap.get(this.receiverId.value); }
  get peerConnection(): RTCPeerConnection | undefined { return this.rtc?.peerConnection; }
  get dataChannel(): RTCDataChannel | undefined { return this.rtc?.dataChannel; }
  get video(): HTMLVideoElement | undefined { return this.rtc?.videoEl; }
  async startHost(source: CaptureSource) {
    this.appStore.primaryDisplaySize = { width: source.width, height: source.height };
    this.appStore.scaleFactor = source.scaleFactor;
    if (source.nativeDesktop && window.webdesk) {
      const bridge = window.webdesk, session = this.options.sessionId;
      this.capture = new HostCapture({
        state: () => bridge.desktopState(session), frame: height => bridge.desktopFrame(session, height),
        source: () => bridge.desktopSource(session),
        quality: () => ({ height: this.currentResolutionRatio.value, fps: this.currentMaxFramerate.value }),
        onError: error => { if (!this.closed) this.options.onError(error); },
        replace: async stream => {
          if (this.closed) return;
          const track = stream.getVideoTracks()[0];
          await handlConstraints({ stream, height: Math.min(this.currentResolutionRatio.value, track.getSettings().height || source.height), frameRate: this.currentMaxFramerate.value });
          track.contentHint = this.currentVideoContentHint.value;
          for (const sender of this.peerConnection?.getSenders() || []) if (sender.track?.kind === 'video') await sender.replaceTrack(track);
          if (!this.closed) this.anchorStream.value = stream;
        },
      });
      await this.capture.start(source.sourceId);
    } else await this.hostPage.handleDesktopStream(source.sourceId);
    if (this.closed) { this.anchorStream.value?.getTracks().forEach(track => track.stop()); return; }
    if (!this.anchorStream.value) throw Error('屏幕采集失败');
    // User-requested native-resolution ceiling. This pinned upstream build
    // otherwise upscales ideal heights above the physical display size.
    const nativeHeight = source.nativeDesktop ? Math.round(source.height * source.scaleFactor)
      : this.anchorStream.value.getVideoTracks()[0].getSettings().height;
    this.nativeHeight = nativeHeight || 0;
    if (nativeHeight) this.currentResolutionRatio.value = Math.min(this.currentResolutionRatio.value, nativeHeight);
    await this.hostPage.handleRTC(this.receiverId.value);
  }
  async receive(signal: Signal) {
    if (!this.closed) await this.callbacks.get(signal.msgType)?.(signal.data);
  }
  releaseInput() {
    this.controllerInput?.release();
  }
  updateQuality(value: Quality) {
    if (this.closed || !this.ready || this.options.role !== 'controller') throw Error('远程连接尚未就绪');
    if (!validQuality(value)) throw Error('无效的连接设置');
    this.currentMaxBitrate.value = value.maxBitrate;
    this.currentMaxFramerate.value = value.maxFramerate;
    this.currentResolutionRatio.value = value.resolutionRatio;
    this.currentVideoContentHint.value = value.videoContentHint;
  }
  private mountVideo(video: HTMLVideoElement) {
    this.options.container.appendChild(video);
    video.tabIndex = 0;
    video.setAttribute('aria-label', '远程 Windows 桌面');
    let sizing: ReturnType<typeof videoFullBox> | undefined;
    const resize = () => {
      if (!video.videoWidth) return;
      const bounds = this.options.container.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const wrapSize = { width: bounds.width, height: bounds.height };
      if (!sizing) sizing = videoFullBox({ wrapSize, videoEl: video });
      else sizing.changeWrapSize(wrapSize);
    };
    video.addEventListener('loadedmetadata', resize);
    const observer = new ResizeObserver(resize);
    observer.observe(this.options.container);
    this.cleanup.push(() => { observer.disconnect(); video.removeEventListener('loadedmetadata', resize); });
  }
  private bindController() {
    this.controllerInput = bindControllerInput({
      area: this.options.container, window, document,
      video: () => this.video, active: () => this.ready && !this.closed,
      focused: () => document.activeElement === this.video,
      congested: () => (this.dataChannel?.bufferedAmount ?? 0) > 16 * 1024,
      send: data => this.rtc?.dataChannelSend({
        msgType: 'billdDeskBehavior', requestId: crypto.randomUUID(),
        data: { key: [0], x: 0, y: 0, amount: 0, ...data,
          roomId: this.roomId.value, sender: this.mySocketId.value, receiver: this.receiverId.value },
      }),
    });
    this.cleanup.push(this.controllerInput.dispose);
  }
  private async collectStats() {
    const pc = this.peerConnection;
    if (!pc || this.closed || this.sampling || !this.options.onStats) return;
    this.sampling = true;
    try {
    const reports = await pc.getStats();
    const stats: Stats = { fps: 0, bitrate: 0, rtt: 0, width: 0, height: 0, path: '协商中', codec: '', mediaDiagnostics: '' };
    reports.forEach(report => {
      if (report.type === 'inbound-rtp' && report.kind === 'video') {
        stats.fps = report.framesPerSecond || 0;
        stats.width = report.frameWidth || 0; stats.height = report.frameHeight || 0;
        stats.codec = reports.get(report.codecId)?.mimeType?.replace('video/', '') ?? '';
        if (this.lastTime && report.timestamp > this.lastTime) stats.bitrate = Math.max(0, (report.bytesReceived - this.lastBytes) * 8 / (report.timestamp - this.lastTime));
        this.lastBytes = report.bytesReceived; this.lastTime = report.timestamp;
      }
      if (report.type === 'transport' && report.selectedCandidatePairId) {
        const pair = reports.get(report.selectedCandidatePairId);
        if (!pair) return;
        stats.rtt = (pair.currentRoundTripTime || 0) * 1000;
        const local = reports.get(pair.localCandidateId), remote = reports.get(pair.remoteCandidateId);
        stats.path = local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'TURN 中继' : 'P2P 直连';
      }
    });
    if (this.tools?.channel.readyState === 'open' && this.options.role === 'controller') {
      try {
        const media = await this.tools.request('media.stats', {}, 2500);
        const encode = typeof media.encodeMs === 'number' ? `${media.encodeMs.toFixed(1)} ms/帧` : '未报告';
        stats.mediaDiagnostics = `编码器：${media.encoder || '未报告'}；编码耗时：${encode}；质量限制：${media.qualityLimit || '未报告'}；采集：${media.capture === 'secure' ? '安全桌面' : '普通桌面'}`;
      } catch { stats.mediaDiagnostics = '暂时无法获取远程媒体统计'; }
    }
    if (!this.closed) this.options.onStats(stats);
    } finally { this.sampling = false; }
  }
  close() {
    if (this.closed) return;
    this.controllerInput?.release();
    this.closed = true;
    this.capture?.stop();
    clearInterval(this.timer);
    this.scope.stop();
    this.tools?.close();
    this.cleanup.forEach(fn => fn());
    this.networkStore.removeAllRtc();
    this.anchorStream.value?.getTracks().forEach(track => track.stop());
    this.networkStore.wsMap.clear();
    this.callbacks.clear();
    this.appStore.$dispose(); this.networkStore.$dispose();
  }
}
