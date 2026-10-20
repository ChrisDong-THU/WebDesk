import 'package:flutter_webrtc/flutter_webrtc.dart';

/// Interval metrics, reset when the sender/codec changes. Missing hardware
/// information remains unknown; a codec name alone never proves acceleration.
class MediaStats {
  String? _id;
  num? _frames, _encodeTime;
  Map<String, dynamic> sample(List<StatsReport> reports) {
    final video = reports
        .where(
          (r) =>
              r.type == 'outbound-rtp' &&
              (r.values['kind'] ?? r.values['mediaType']) == 'video',
        )
        .firstOrNull;
    if (video == null) return {};
    final values = video.values;
    final codec = reports.where((r) => r.id == values['codecId']).firstOrNull;
    final frames = values['framesEncoded'] as num?;
    final time = values['totalEncodeTime'] as num?;
    double? encodeMs;
    final id = '${video.id}:${values['codecId']}';
    if (id == _id &&
        frames != null &&
        time != null &&
        _frames != null &&
        _encodeTime != null &&
        frames > _frames! &&
        time >= _encodeTime!) {
      encodeMs = (time - _encodeTime!) * 1000 / (frames - _frames!);
    }
    _id = id;
    _frames = frames;
    _encodeTime = time;
    return {
      'codec': codec?.values['mimeType'],
      'encoder': values['encoderImplementation'],
      'hardware': values['powerEfficientEncoder'],
      'encodeMs': encodeMs,
      'qualityLimit': values['qualityLimitationReason'],
      'framesEncoded': frames,
      'fps': values['framesPerSecond'],
    };
  }
}
