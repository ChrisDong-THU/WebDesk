import 'dart:math' as math;

/// A texture is not zero-copy when the actual encoder reports a CPU bridge.
/// Try the existing CPU early-scaling path once after sustained, measured cost.
/// Same-device D3D11 and unknown encoders keep their current path.
class NativeTexturePolicy {
  String? _track;
  num? _frames;
  int _costly = 0;
  bool attempted = false;

  bool sample(Map<String, dynamic> stats, int targetFps) {
    if (attempted) return false;
    final track = stats['captureTrackId'];
    final frames = stats['framesEncoded'];
    final encode = stats['encodeMs'];
    final fps = stats['fps'];
    if (track is! String || frames is! num || !frames.isFinite) return false;
    if (track != _track || (_frames != null && frames < _frames!)) {
      _track = track;
      _frames = frames;
      _costly = 0;
      return false;
    }
    if (_frames == frames) return false;
    _frames = frames;
    final budget = 1000 / targetFps.clamp(1, 60);
    final encoder = stats['encoder'];
    final needsCpuReadback =
        encoder == 'WebDesk-NVENC-H264-CROSS-ADAPTER-NV12' ||
        encoder == 'OpenH264';
    final expensiveBridge =
        stats['nativeTextureActive'] == true &&
        needsCpuReadback &&
        encode is num &&
        encode.isFinite &&
        encode > math.max(8, budget * .35) &&
        fps is num &&
        fps.isFinite &&
        fps >= targetFps.clamp(1, 60) * .5;
    _costly = expensiveBridge ? _costly + 1 : 0;
    if (_costly < 3) return false;
    attempted = true;
    return true;
  }
}
