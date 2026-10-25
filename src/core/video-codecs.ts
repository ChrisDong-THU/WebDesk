export type CodecPreference = 'auto' | 'H264' | 'AV1' | 'VP9' | 'VP8';

/** Manual selection is a preference, retaining every advertised profile and
 * repair capability. Auto leaves host-led negotiation to the browser. */
export function videoCodecPreferences<T extends { mimeType: string }>(
  capabilities: readonly T[],
  preference: CodecPreference = 'auto',
): T[] {
  if (preference === 'auto') return [...capabilities];
  const mime = `video/${preference.toLowerCase()}`;
  return [
    ...capabilities.filter((codec) => codec.mimeType.toLowerCase() === mime),
    ...capabilities.filter((codec) => codec.mimeType.toLowerCase() !== mime),
  ];
}

/** Empty preferences clear a previous manual choice on every new Offer. No
 * SDP is rewritten, and unavailable receiver APIs preserve compatibility. */
export function preferReceiverVideoCodecs(pc: RTCPeerConnection, preference: CodecPreference = 'auto'): void {
  let codecs: RTCRtpCodec[] = [];
  if (preference !== 'auto') {
    try {
      codecs = videoCodecPreferences(
        globalThis.RTCRtpReceiver?.getCapabilities?.('video')?.codecs ?? [],
        preference,
      );
    } catch {
      return;
    }
    if (!codecs.length) return;
  }
  let transceivers: RTCRtpTransceiver[];
  try {
    transceivers = pc.getTransceivers();
  } catch {
    return;
  }
  for (const transceiver of transceivers) {
    if (
      transceiver.receiver?.track?.kind !== 'video' ||
      typeof transceiver.setCodecPreferences !== 'function'
    )
      continue;
    try {
      transceiver.setCodecPreferences(codecs);
    } catch {
      /* Unsupported preference/profile combinations retain platform order. */
    }
  }
}
