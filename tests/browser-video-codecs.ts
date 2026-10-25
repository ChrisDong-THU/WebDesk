import { BilldDeskRuntime, type Signal } from '../src/core/runtime';
import type { CodecPreference } from '../src/core/video-codecs';
import { DEFAULT_QUALITY } from '../shared/protocol.mjs';

declare global {
  interface Window {
    codecTest: { done: (result: unknown) => void };
  }
}
const assert = (condition: unknown, message: string) => {
  if (!condition) throw Error(message);
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const toolChannelCounts = new WeakMap<RTCPeerConnection, number>();
const nativeCreateChannel = RTCPeerConnection.prototype.createDataChannel;
RTCPeerConnection.prototype.createDataChannel = function (label, options) {
  if (label === 'WebDesk tools v2') toolChannelCounts.set(this, (toolChannelCounts.get(this) ?? 0) + 1);
  return nativeCreateChannel.call(this, label, options);
};
function firstVideoCodec(sdp: string) {
  const video = sdp.split(/\r?\nm=video /)[1]?.split(/\r?\nm=/)[0];
  const payload = video?.split(/\r?\n/)[0].split(' ')[2];
  return new RegExp(`^a=rtpmap:${payload} ([^/]+)`, 'm').exec(video ?? '')?.[1]?.toUpperCase();
}
async function runCase(
  name: string,
  sequence: { offer: string; preference: CodecPreference; expected: string; only?: boolean }[],
  unsupportedPreference = false,
) {
  const sender = new RTCPeerConnection({ iceServers: [] }),
    signals: Signal[] = [],
    hostMessages: any[] = [],
    errors: string[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext('2d')!;
  let frame = 0;
  const paint = () => {
    ctx.fillStyle = frame++ % 2 ? '#88aaff' : '#225588';
    ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = 'white';
    ctx.fillText(String(frame), 10, 30);
  };
  paint();
  const drawing = setInterval(paint, 100);
  const stream = canvas.captureStream(10),
    track = stream.getVideoTracks()[0];
  const transceiver = sender.addTransceiver(track, { direction: 'sendonly', streams: [stream] });
  sender.addTransceiver('audio', { direction: 'sendonly' });
  const channel = sender.createDataChannel('MessageChannel');
  const hostTools = sender.createDataChannel('WebDesk tools v2', { negotiated: true, id: 42, ordered: true });
  hostTools.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.operation === 'media.stats')
      hostTools.send(
        JSON.stringify({
          id: message.id,
          reply: {
            codecPolicy: 'adaptive-v1',
            codecPreference: 'auto',
            encoder: 'fixture',
            codecDecision: 'fixture',
            codecOrder: ['video/av1'],
          },
        }),
      );
  };
  const receiveMessage = (event: MessageEvent) => {
    try {
      hostMessages.push(JSON.parse(event.data));
    } catch {}
  };
  channel.onmessage = receiveMessage;
  sender.ondatachannel = (event) => {
    event.channel.onmessage = receiveMessage;
  };
  // Sender-only H264 high levels can differ from the receive capability.
  // Keep real common profiles for this local fixture, never synthesize SDP.
  const receiverCapabilities = RTCRtpReceiver.getCapabilities('video')!.codecs;
  const capabilities = RTCRtpSender.getCapabilities('video')!.codecs.filter((codec) =>
    receiverCapabilities.some(
      (receiver) =>
        receiver.mimeType === codec.mimeType &&
        receiver.clockRate === codec.clockRate &&
        receiver.sdpFmtpLine === codec.sdpFmtpLine,
    ),
  );
  const pendingSenderCandidates: RTCIceCandidateInit[] = [];
  let runtime: BilldDeskRuntime;
  const addToSender = async (candidate: RTCIceCandidateInit) => {
    if (!sender.remoteDescription) pendingSenderCandidates.push(candidate);
    else await sender.addIceCandidate(candidate);
  };
  let diagnostics = '';
  runtime = new BilldDeskRuntime({
    role: 'controller',
    sessionId: name,
    iceServers: [],
    container,
    quality: { ...DEFAULT_QUALITY, codecPreference: sequence[0].preference },
    onSignal: (signal) => {
      signals.push(signal);
      if (signal.msgType === 'nativeWebRtcCandidate')
        void addToSender(signal.data.candidate).catch((error) => errors.push(String(error)));
    },
    onReady() {},
    onStats(value) {
      diagnostics = value.mediaDiagnostics ?? '';
    },
    onError: (error) => errors.push(String(error)),
  });
  sender.onicecandidate = (event) => {
    if (event.candidate)
      void runtime
        .receive({
          msgType: 'nativeWebRtcCandidate',
          data: {
            candidate: event.candidate.toJSON(),
            sender: 'host',
            receiver: 'controller',
            isRemoteDesk: true,
          },
        })
        .catch((error) => errors.push(String(error)));
  };
  const preferenceApi = RTCRtpTransceiver.prototype.setCodecPreferences;
  const result = [];
  let receiver: RTCPeerConnection | undefined,
    audio: RTCRtpTransceiver | undefined,
    tools: unknown,
    transceiverCount = 0;
  try {
    for (let i = 0; i < sequence.length; i++) {
      const step = sequence[i];
      const wanted = capabilities.filter(
        (codec) => codec.mimeType.toLowerCase() === `video/${step.offer.toLowerCase()}`,
      );
      assert(wanted.length, `fixture cannot offer ${step.offer}`);
      const others = capabilities.filter(
        (codec) =>
          codec.mimeType.toLowerCase() !== `video/${step.offer.toLowerCase()}` &&
          (!step.only || /\/(rtx|red|ulpfec)$/.test(codec.mimeType)),
      );
      Object.defineProperty(RTCRtpTransceiver.prototype, 'setCodecPreferences', {
        value: preferenceApi,
        configurable: true,
        writable: true,
      });
      transceiver.setCodecPreferences([...wanted, ...others]);
      if (i > 0) runtime.updateQuality({ ...DEFAULT_QUALITY, codecPreference: step.preference });
      const offer = await sender.createOffer();
      await sender.setLocalDescription(offer);
      assert(firstVideoCodec(offer.sdp!) === step.offer.toUpperCase(), 'fixture Offer order wrong');
      if (unsupportedPreference)
        Object.defineProperty(RTCRtpTransceiver.prototype, 'setCodecPreferences', {
          value: undefined,
          configurable: true,
          writable: true,
        });
      await runtime.receive({
        msgType: 'nativeWebRtcOffer',
        data: {
          sdp: offer,
          negotiationId: i + 1,
          isRemoteDesk: true,
          sender: 'host',
          receiver: 'controller',
        },
      });
      const answer = signals.filter((signal) => signal.msgType === 'nativeWebRtcAnswer').at(-1)!;
      assert(answer?.data.negotiationId === i + 1, 'Answer missing or stale negotiation ID');
      assert(
        firstVideoCodec(answer.data.sdp.sdp) === step.expected,
        `${name}: Answer expected ${step.expected}, got ${firstVideoCodec(answer.data.sdp.sdp)}`,
      );
      await sender.setRemoteDescription(answer.data.sdp);
      for (const candidate of pendingSenderCandidates.splice(0)) await sender.addIceCandidate(candidate);
      if (i === 0) {
        receiver = runtime.peerConnection;
        tools = runtime.tools;
        audio = receiver!.getTransceivers().find((item) => item.receiver.track.kind === 'audio');
        transceiverCount = receiver!.getTransceivers().length;
      }
      assert(
        runtime.peerConnection === receiver && runtime.tools === tools,
        'codec switch replaced peer/tools',
      );
      assert(receiver!.getTransceivers().length === transceiverCount, 'codec switch duplicated tracks');
      assert(
        receiver!.getTransceivers().find((item) => item.receiver.track.kind === 'audio') === audio,
        'codec switch replaced audio',
      );
      assert(
        toolChannelCounts.get(receiver!) === 1,
        'initial snapshot update or codec switch duplicated tools',
      );
      let actual: string | undefined,
        encoded = 0,
        decoded = 0;
      const deadline = performance.now() + 7000;
      while (performance.now() < deadline) {
        const sent = await sender.getStats(),
          received = await receiver!.getStats();
        const out = [...sent.values()].find(
          (report) => report.type === 'outbound-rtp' && report.kind === 'video',
        );
        const inbound = [...received.values()].find(
          (report) => report.type === 'inbound-rtp' && report.kind === 'video',
        );
        actual = inbound && received.get(inbound.codecId)?.mimeType?.replace('video/', '').toUpperCase();
        encoded = out?.framesEncoded ?? 0;
        decoded = inbound?.framesDecoded ?? 0;
        const sentCodec = out && sent.get(out.codecId)?.mimeType?.replace('video/', '').toUpperCase();
        if (
          actual === step.expected &&
          sentCodec === step.expected &&
          encoded > 0 &&
          decoded > 0 &&
          runtime.dataChannel?.readyState === 'open'
        )
          break;
        await sleep(100);
      }
      assert(
        actual === step.expected && encoded > 0 && decoded > 0,
        `${name}: actual RTP did not switch to ${step.expected}: ${actual}`,
      );
      if (i === 0) {
        const deadline = performance.now() + 5000;
        while (!diagnostics.includes('编码设置：') && performance.now() < deadline) await sleep(50);
        assert(
          diagnostics.includes('编码设置：'),
          'host capability was not read through the real tool channel',
        );
      }
      const offerH264 = (offer.sdp!.match(/^a=rtpmap:\d+ H264\//gm) ?? []).length;
      const answerH264 = (answer.data.sdp.sdp.match(/^a=rtpmap:\d+ H264\//gm) ?? []).length;
      assert(answerH264 === offerH264, 'codec preference removed offered H264 profiles');
      assert(/a=rtpmap:\d+ rtx\//i.test(answer.data.sdp.sdp), 'RTX repair missing');
      result.push({
        preference: step.preference,
        offeredFirst: step.offer,
        answerFirst: firstVideoCodec(answer.data.sdp.sdp),
        actualRtpCodec: actual,
        framesEncoded: encoded,
        framesDecoded: decoded,
        h264Profiles: answerH264,
      });
    }
    assert(
      !signals.some((signal) => signal.msgType === 'nativeWebRtcOffer'),
      'controller initiated an Offer',
    );
    await sleep(1100);
    const feedback = hostMessages.find((message) => message.msgType === 'mediaReceiverStats');
    assert(
      feedback && /^video\/(av1|vp9|h264|vp8)$/.test(feedback.data.codec),
      'real receiver feedback did not reach host',
    );
    assert(
      Object.keys(feedback.data).every((key) =>
        ['codec', 'decodeMs', 'fps', 'jitterBufferMs', 'freezes', 'dropped'].includes(key),
      ),
      'unapproved receiver feedback fields',
    );
    if (sequence.some((step) => step.preference !== 'auto') && sequence.length > 1) {
      await sleep(50);
      assert(
        hostMessages.some((message) => message.msgType === 'changeVideoCodec'),
        'manual choice did not notify host',
      );
    }
    assert(errors.length === 0, `unexpected signaling errors: ${errors.join('; ')}`);
    return {
      name,
      unsupportedPreference,
      samePeer: true,
      sameAudio: true,
      toolChannelsCreated: 1,
      receiverFeedback: true,
      steps: result,
    };
  } finally {
    Object.defineProperty(RTCRtpTransceiver.prototype, 'setCodecPreferences', {
      value: preferenceApi,
      configurable: true,
      writable: true,
    });
    clearInterval(drawing);
    runtime.close();
    sender.close();
    stream.getTracks().forEach((item) => item.stop());
    container.remove();
  }
}
void (async () => {
  const results = [];
  try {
    results.push(
      await runCase('host-auto-multicodec', [
        { offer: 'AV1', preference: 'auto', expected: 'AV1' },
        { offer: 'VP9', preference: 'auto', expected: 'VP9' },
        { offer: 'H264', preference: 'auto', expected: 'H264' },
        { offer: 'VP8', preference: 'auto', expected: 'VP8' },
      ]),
    );
    results.push(
      await runCase('manual-and-return-auto', [
        { offer: 'VP8', preference: 'H264', expected: 'H264' },
        { offer: 'VP8', preference: 'AV1', expected: 'AV1' },
        { offer: 'VP9', preference: 'auto', expected: 'VP9' },
        { offer: 'VP8', preference: 'AV1', expected: 'VP8', only: true },
      ]),
    );
    results.push(
      await runCase(
        'browser-no-preference-api',
        [{ offer: 'VP8', preference: 'H264', expected: 'VP8' }],
        true,
      ),
    );
    window.codecTest.done({ ok: true, chrome: navigator.userAgent, results });
  } catch (error) {
    window.codecTest.done({ ok: false, error: String(error), stack: (error as Error).stack, results });
  }
})();
