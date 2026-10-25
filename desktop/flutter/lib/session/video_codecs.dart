import 'package:flutter_webrtc/flutter_webrtc.dart';

/// Reorder only from the selection policy or user's preference. With no policy
/// order, preserve platform order; every profile/repair object survives intact.
List<RTCRtpCodecCapability> desktopCodecPreferences(
  List<RTCRtpCodecCapability> capabilities, {
  List<String> order = const [],
}) {
  final preferred = order.map((s) => s.toLowerCase()).toSet();
  return [
    for (final mime in preferred)
      ...capabilities.where((codec) => codec.mimeType.toLowerCase() == mime),
    ...capabilities.where(
      (codec) => !preferred.contains(codec.mimeType.toLowerCase()),
    ),
  ];
}

Future<bool> preferDesktopCodecs(
  RTCPeerConnection pc, {
  List<String> order = const [],
}) async {
  final capabilities = await getRtpSenderCapabilities('video');
  final codecs = desktopCodecPreferences(
    capabilities.codecs ?? [],
    order: order,
  );
  if (codecs.isEmpty) return false;
  var applied = false;
  for (final transceiver in await pc.getTransceivers()) {
    if (transceiver.sender.track?.kind == 'video') {
      await transceiver.setCodecPreferences(codecs);
      applied = true;
    }
  }
  return applied;
}
