import 'dart:math' as math;
import '../protocol/quality.dart';

String effectiveDegradationPreference(Quality quality) =>
    quality.degradationPreference != 'auto'
    ? quality.degradationPreference
    : switch (quality.contentHint) {
        'motion' => 'maintain-framerate',
        '' => 'balanced',
        _ => 'maintain-resolution',
      };

class VideoAdaptation {
  const VideoAdaptation({
    this.cpuSteps = 0,
    this.networkSteps = 0,
    this.networkBitrate,
    this.reason = 'none',
  });
  final int cpuSteps, networkSteps;
  final int? networkBitrate;
  final String reason;
  int get steps => math.max(cpuSteps, networkSteps);
}

/// Uses measured encoder and network pressure, not low frame rates on a still
/// desktop. Hysteresis is intentionally slower on recovery than degradation.
/// It changes sender ceilings within user limits; libwebrtc owns congestion
/// control, packet pacing and its native per-frame adaptation.
class AdaptiveVideoPolicy {
  VideoAdaptation _current = const VideoAdaptation();
  VideoAdaptation get current => _current;
  int _cpuBad = 0, _networkBad = 0, _healthy = 0;
  DateTime? _changedAt;

  void reset() {
    _current = const VideoAdaptation();
    _cpuBad = _networkBad = _healthy = 0;
    _changedAt = null;
  }

  static double? _number(Map<String, dynamic> stats, String key) {
    final value = stats[key];
    return value is num && value.isFinite && value >= 0
        ? value.toDouble()
        : null;
  }

  bool sample(Map<String, dynamic> stats, Quality quality, DateTime now) {
    final fps = _number(stats, 'fps');
    final encodeMs = _number(stats, 'encodeMs');
    final loss = _number(stats, 'packetLoss');
    final rtt = _number(stats, 'rttMs');
    final available = _number(stats, 'availableBitrate');
    final sent = _number(stats, 'sendBitrate');
    final limitation = stats['qualityLimit'];
    // Actual encoding utilisation distinguishes an expensive active encoder
    // from a slow, static screen that correctly emits only changed frames.
    final utilisation = fps == null || encodeMs == null
        ? null
        : fps * encodeMs / 1000;
    final cpu =
        limitation == 'cpu' || (utilisation != null && utilisation > 0.85);
    final latencyBudget = quality.networkMode == 'low-latency' ? 180 : 350;
    // Loss can destroy complete H264 frames even on a low-RTT path. Requiring
    // high RTT as well leaves a nearby saturated bottleneck unhandled.
    final lossBudget = quality.networkMode == 'low-latency' ? 0.02 : 0.04;
    final network =
        limitation == 'bandwidth' ||
        (loss != null && loss > lossBudget) ||
        (available != null &&
            available > 0 &&
            sent != null &&
            sent > 0 &&
            available < sent * 0.8 &&
            rtt != null &&
            rtt > latencyBudget);
    final healthy =
        limitation == 'none' &&
        (utilisation != null || available != null) &&
        (utilisation == null || utilisation < 0.55) &&
        (loss == null || loss < 0.02) &&
        (rtt == null || rtt < latencyBudget);
    _cpuBad = cpu ? _cpuBad + 1 : 0;
    _networkBad = network ? _networkBad + 1 : 0;
    _healthy = !cpu && !network && healthy ? _healthy + 1 : 0;
    if (_changedAt != null && now.difference(_changedAt!).inSeconds < 10) {
      return false;
    }
    var cpuSteps = _current.cpuSteps, networkSteps = _current.networkSteps;
    var cap = _current.networkBitrate;
    var reason = _current.reason;
    final disabled = effectiveDegradationPreference(quality) == 'disabled';
    if (_cpuBad >= 3 && !disabled) {
      cpuSteps = math.min(4, cpuSteps + 1);
      reason = 'cpu';
    }
    if (_networkBad >= 3) {
      networkSteps = math.min(4, networkSteps + 1);
      reason = 'bandwidth';
      if (available != null && available > 0) {
        final observedCap = (available * 0.85).round().clamp(100000, 32000000);
        cap = cap == null ? observedCap : math.min(cap, observedCap);
      }
    }
    if (_healthy >= 8) {
      cpuSteps = math.max(0, cpuSteps - 1);
      networkSteps = math.max(0, networkSteps - 1);
      // A measured available bitrate is a ceiling, not a permanent latch.
      // Releasing it after sustained health allows BWE to probe and recover.
      cap = networkSteps == 0
          ? null
          : (cap == null ? null : (cap * 1.25).round());
      reason = cpuSteps > 0
          ? 'cpu'
          : networkSteps > 0
          ? 'bandwidth'
          : 'none';
    }
    if (cpuSteps == _current.cpuSteps &&
        networkSteps == _current.networkSteps &&
        cap == _current.networkBitrate) {
      return false;
    }
    _current = VideoAdaptation(
      cpuSteps: cpuSteps,
      networkSteps: networkSteps,
      networkBitrate: cap,
      reason: reason,
    );
    _changedAt = now;
    _cpuBad = _networkBad = _healthy = 0;
    return true;
  }
}
