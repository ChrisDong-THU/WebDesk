import 'dart:math' as math;
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../protocol/quality.dart';

/// A ceiling for congestion control, never a target or minimum sending rate.
/// Unsetting maxBitrate falls back to libwebrtc's 2.5 Mbps VP8 ceiling even at
/// 4K. Size Auto to the output pixels with a bounded 0.1 bits/pixel/frame budget.
int videoBitrateLimit(
  Quality quality,
  int width,
  int height, {
  bool secure = false,
}) {
  if (quality.bitrate > 0) return quality.bitrate * 1000;
  final scale = math.max(1.0, height / quality.height);
  final fps = math.min(quality.fps, secure ? 30 : 60);
  return (width * height / (scale * scale) * fps * 0.1).round().clamp(
    2000000,
    32000000,
  );
}

void configureVideoParameters(
  RTCRtpParameters parameters,
  Quality quality,
  int width,
  int height, {
  bool secure = false,
}) {
  parameters.degradationPreference = switch (quality.contentHint) {
    'motion' => RTCDegradationPreference.MAINTAIN_FRAMERATE,
    '' => RTCDegradationPreference.BALANCED,
    _ => RTCDegradationPreference.MAINTAIN_RESOLUTION,
  };
  for (final encoding in parameters.encodings ?? <RTCRtpEncoding>[]) {
    if (encoding.minBitrate == 0) encoding.minBitrate = null;
    if (encoding.scalabilityMode?.isEmpty ?? false) {
      encoding.scalabilityMode = null;
    }
    encoding.maxBitrate = videoBitrateLimit(
      quality,
      width,
      height,
      secure: secure,
    );
    encoding.maxFramerate = math.min(quality.fps, secure ? 30 : 60);
    encoding.scaleResolutionDownBy = secure
        ? 1.0
        : (height / quality.height).clamp(1.0, 16.0).toDouble();
  }
}
