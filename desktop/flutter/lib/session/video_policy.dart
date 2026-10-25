import 'dart:math' as math;
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../protocol/quality.dart';
import 'adaptive_video.dart';

/// Matches native capture policy: bounded, even output dimensions, no upscale.
({int width, int height}) captureOutputSize(
  int width,
  int height,
  int maxHeight,
) {
  final scale = math.min(1.0, maxHeight / math.max(1, height));
  return (
    width: math.max(2, (width * scale / 2).floor() * 2),
    height: math.max(2, (height * scale / 2).floor() * 2),
  );
}

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
  VideoAdaptation adaptation = const VideoAdaptation(),
}) {
  final degradation = effectiveDegradationPreference(quality);
  parameters.degradationPreference = switch (degradation) {
    'maintain-framerate' => RTCDegradationPreference.MAINTAIN_FRAMERATE,
    'balanced' => RTCDegradationPreference.BALANCED,
    // libwebrtc still exposes disabled explicitly; keeping this value is
    // required to honour the user's request to preserve both dimensions.
    // ignore: deprecated_member_use
    'disabled' => RTCDegradationPreference.DISABLED,
    _ => RTCDegradationPreference.MAINTAIN_RESOLUTION,
  };
  final steps = degradation == 'disabled' ? 0 : adaptation.steps;
  final fpsScale = degradation == 'maintain-framerate'
      ? 1.0
      : math.pow(degradation == 'balanced' ? 0.85 : 0.75, steps);
  final resolutionScale = degradation == 'maintain-resolution'
      ? 1.0
      : math.pow(degradation == 'balanced' ? 1.15 : 1.25, steps);
  for (final encoding in parameters.encodings ?? <RTCRtpEncoding>[]) {
    if (encoding.minBitrate == 0) encoding.minBitrate = null;
    if (encoding.scalabilityMode?.isEmpty ?? false) {
      encoding.scalabilityMode = null;
    }
    final ceiling = videoBitrateLimit(quality, width, height, secure: secure);
    final networkCeiling = (ceiling * math.pow(0.8, adaptation.networkSteps))
        .round();
    encoding.maxBitrate = math.min(
      networkCeiling,
      adaptation.networkBitrate ?? ceiling,
    );
    encoding.maxFramerate = (math.min(quality.fps, secure ? 30 : 60) * fpsScale)
        .round();
    encoding.scaleResolutionDownBy = secure
        ? resolutionScale.toDouble()
        : ((height / quality.height).clamp(1.0, 16.0) * resolutionScale)
              .clamp(1.0, 16.0)
              .toDouble();
  }
}
