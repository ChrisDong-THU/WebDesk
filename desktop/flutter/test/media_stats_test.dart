import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:webdesk/session/media_stats.dart';

void main() {
  test(
    'interval throughput and selected-path metrics ignore unrelated transports',
    () {
      final sampler = MediaStats(), start = DateTime.utc(2026, 10, 25);
      List<StatsReport> reports(
        int frames,
        int bytes,
        int sent,
        int lost, {
        String codec = 'c1',
        String remote = 'remote',
      }) => [
        StatsReport('c1', 'codec', 0, {'mimeType': 'video/H264'}),
        StatsReport('sender', 'outbound-rtp', 0, {
          'kind': 'video',
          'codecId': codec,
          'transportId': 'transport',
          'remoteId': remote,
          'framesEncoded': frames,
          'totalEncodeTime': frames * 0.004,
          'bytesSent': bytes,
          'packetsSent': sent,
        }),
        StatsReport(remote, 'remote-inbound-rtp', 0, {
          'localId': 'sender',
          'packetsLost': lost,
          'roundTripTime': 0.05,
        }),
        StatsReport('transport', 'transport', 0, {
          'selectedCandidatePairId': 'selected',
        }),
        StatsReport('stale', 'candidate-pair', 0, {
          'nominated': true,
          'state': 'succeeded',
          'availableOutgoingBitrate': 1,
        }),
        StatsReport('selected', 'candidate-pair', 0, {
          'availableOutgoingBitrate': 8000000,
          'currentRoundTripTime': 0.1,
        }),
      ];
      sampler.sample(reports(10, 1000, 10, 1), now: start);
      final result = sampler.sample(
        reports(70, 251000, 110, 6),
        now: start.add(const Duration(seconds: 2)),
      );
      expect(result['fps'], 30);
      expect(result['encodeMs'], closeTo(4, 0.001));
      expect(result['sendBitrate'], 1000000);
      expect(result['packetLoss'], 0.05);
      expect(result['availableBitrate'], 8000000);
      expect(result['rttMs'], 50);
      final reset = sampler.sample(
        reports(1, 1, 1, 0),
        now: start.add(const Duration(seconds: 4)),
      );
      expect(reset['sendBitrate'], isNull);
      expect(reset['packetLoss'], isNull);
      expect(reset['fps'], isNull);
      final switched = sampler.sample(
        reports(10, 2000, 12, 1, codec: 'c2'),
        now: start.add(const Duration(seconds: 6)),
      );
      expect(switched['sendBitrate'], isNull);
      expect(switched['encodeMs'], isNull);
      expect(switched['packetLoss'], isNull);
    },
  );
  test('absent or malformed counters remain unknown', () {
    final sampler = MediaStats();
    expect(sampler.sample([]), isEmpty);
    final result = sampler.sample([
      StatsReport('v', 'outbound-rtp', 0, {
        'kind': 'video',
        'framesEncoded': '12',
        'totalEncodeTime': double.nan,
        'framesPerSecond': double.infinity,
      }),
    ]);
    expect(result['encodeMs'], isNull);
    expect(result['hardware'], isNull);
    expect(result['fps'], isNull);
    expect(result['availableBitrate'], isNull);
  });
  test(
    'encode duration uses interval deltas and resets after codec changes',
    () {
      final sampler = MediaStats();
      List<StatsReport> reports(
        int frames,
        double seconds, [
        String codec = 'c1',
      ]) => [
        StatsReport(codec, 'codec', 0, {'mimeType': 'video/VP8'}),
        StatsReport('sender', 'outbound-rtp', 0, {
          'kind': 'video',
          'codecId': codec,
          'framesEncoded': frames,
          'totalEncodeTime': seconds,
          'encoderImplementation': 'libvpx',
          'qualityLimitationReason': 'cpu',
        }),
      ];
      expect(sampler.sample(reports(10, 0.1))['encodeMs'], isNull);
      final result = sampler.sample(reports(20, 0.3));
      expect(result['encodeMs'], closeTo(20, 0.001));
      expect(result['codec'], 'video/VP8');
      expect(result['encoder'], 'libvpx');
      expect(result['hardware'], isNull);
      expect(sampler.sample(reports(25, 0.4, 'c2'))['encodeMs'], isNull);
      expect(sampler.sample(reports(1, 0.01, 'c2'))['encodeMs'], isNull);
    },
  );
}
