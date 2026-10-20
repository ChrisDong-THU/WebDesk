import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:webdesk/session/media_stats.dart';

void main() {
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
