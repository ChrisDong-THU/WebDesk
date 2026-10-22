import 'package:flutter_webrtc/flutter_webrtc.dart';

/// Keep every advertised profile and repair codec. This changes preference,
/// never invents support or forces a format that the receiver cannot decode.
List<RTCRtpCodecCapability> desktopCodecPreferences(
  List<RTCRtpCodecCapability> capabilities,
) {
  const preferred = ['video/av1', 'video/vp9', 'video/vp8', 'video/h264'];
  return [
    for (final mime in preferred)
      ...capabilities.where((codec) => codec.mimeType.toLowerCase() == mime),
    ...capabilities.where(
      (codec) => !preferred.contains(codec.mimeType.toLowerCase()),
    ),
  ];
}

Future<void> preferDesktopCodecs(RTCPeerConnection pc) async {
  final capabilities = await getRtpSenderCapabilities('video');
  final codecs = desktopCodecPreferences(capabilities.codecs ?? []);
  if (codecs.isEmpty) return;
  for (final transceiver in await pc.getTransceivers()) {
    if (transceiver.sender.track?.kind == 'video') {
      await transceiver.setCodecPreferences(codecs);
    }
  }
}
