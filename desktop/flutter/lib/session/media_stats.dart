import 'package:flutter_webrtc/flutter_webrtc.dart';

/// Interval counters belong to a particular sender/codec and selected ICE path.
/// Missing observations stay unknown, including hardware acceleration.
class MediaStats {
  String? _id, _remoteId;
  num? _frames, _encodeTime, _bytes, _packets, _lost;
  DateTime? _at;

  static num? _number(dynamic value) =>
      value is num && value.isFinite ? value : null;

  Map<String, dynamic> sample(List<StatsReport> reports, {DateTime? now}) {
    final video = reports
        .where(
          (r) =>
              r.type == 'outbound-rtp' &&
              (r.values['kind'] ?? r.values['mediaType']) == 'video' &&
              r.values['isRemote'] != true,
        )
        .firstOrNull;
    if (video == null) return {};
    final at = now ?? DateTime.now();
    final values = video.values;
    final codec = reports.where((r) => r.id == values['codecId']).firstOrNull;
    final remote = reports
        .where(
          (r) =>
              r.type == 'remote-inbound-rtp' &&
              (r.id == values['remoteId'] || r.values['localId'] == video.id),
        )
        .firstOrNull;
    final transport = reports
        .where((r) => r.type == 'transport' && r.id == values['transportId'])
        .firstOrNull;
    final pair = reports
        .where(
          (r) =>
              r.type == 'candidate-pair' &&
              (transport?.values['selectedCandidatePairId'] == r.id ||
                  r.values['selected'] == true),
        )
        .firstOrNull;
    final frames = _number(values['framesEncoded']);
    final time = _number(values['totalEncodeTime']);
    final bytes = _number(values['bytesSent']);
    final packets = _number(values['packetsSent']);
    final lost = _number(remote?.values['packetsLost']);
    double? encodeMs, fps, sendBitrate, loss;
    final id = '${video.id}:${values['codecId']}';
    final elapsed = _at == null ? 0 : at.difference(_at!).inMicroseconds / 1e6;
    if (id == _id) {
      if (frames != null &&
          time != null &&
          _frames != null &&
          _encodeTime != null &&
          frames > _frames! &&
          time >= _encodeTime!) {
        encodeMs = (time - _encodeTime!) * 1000 / (frames - _frames!);
      }
      if (elapsed > 0) {
        if (frames != null && _frames != null && frames >= _frames!) {
          fps = (frames - _frames!) / elapsed;
        }
        if (bytes != null && _bytes != null && bytes >= _bytes!) {
          sendBitrate = (bytes - _bytes!) * 8 / elapsed;
        }
      }
      // Remote RTCP counters cannot be joined across reports or a reset.
      if (remote?.id == _remoteId &&
          lost != null &&
          _lost != null &&
          packets != null &&
          _packets != null &&
          packets > _packets!) {
        final deltaLost = lost - _lost!;
        if (deltaLost >= 0) {
          loss = (deltaLost / (packets - _packets!)).clamp(0.0, 1.0);
        }
      }
    }
    _id = id;
    _remoteId = remote?.id;
    _frames = frames;
    _encodeTime = time;
    _bytes = bytes;
    _packets = packets;
    _lost = lost;
    _at = at;
    final rtt =
        _number(remote?.values['roundTripTime']) ??
        _number(pair?.values['currentRoundTripTime']);
    return {
      'codec': codec?.values['mimeType'],
      'encoder': values['encoderImplementation'],
      'hardware': values['powerEfficientEncoder'],
      'encodeMs': encodeMs,
      'qualityLimit': values['qualityLimitationReason'],
      'framesEncoded': frames,
      'fps': fps ?? _number(values['framesPerSecond']),
      'sendBitrate': sendBitrate,
      'availableBitrate': _number(pair?.values['availableOutgoingBitrate']),
      'rttMs': rtt == null ? null : rtt * 1000,
      'packetLoss': loss,
      'frameWidth': _number(values['frameWidth']),
      'frameHeight': _number(values['frameHeight']),
    };
  }
}
