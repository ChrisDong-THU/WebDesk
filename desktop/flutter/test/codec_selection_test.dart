import 'package:flutter_test/flutter_test.dart';
import 'package:webdesk/protocol/quality.dart';
import 'package:webdesk/session/codec_selection.dart';

void main() {
  final start = DateTime.utc(2026, 10, 25);
  final caps = ['video/VP8', 'video/H264', 'video/VP9', 'video/AV1'];
  const detail = Quality(fps: 30);
  CodecSelection policy([Quality q = detail, bool hardware = true]) =>
      CodecSelection()..initialize(caps, q, start, hardware: hardware);
  Map<String, dynamic> stats(String codec, int second, {bool busy = false}) => {
    'codec': 'video/$codec',
    'framesEncoded': second * 30,
    'fps': 30.0,
    'encodeMs': busy ? 32.0 : 5.0,
    'qualityLimit': busy ? 'cpu' : 'none',
    'packetLoss': 0.0,
  };
  test(
    'switch count describes observed codec changes, not requested trials',
    () {
      final p = policy();
      p.sample(stats('AV1', 0), detail, start);
      p.sample(stats('H264', 2), detail, start.add(const Duration(seconds: 2)));
      p.sample(stats('H264', 4), detail, start.add(const Duration(seconds: 4)));
      expect(p.switches, 1);
      expect(p.attempts, 0);
    },
  );
  test('Auto varies by settings and preserves all supported formats', () {
    expect(policy().order.first, 'video/av1');
    final latency = policy(const Quality(networkMode: 'low-latency'));
    expect(latency.order.first, 'video/h264');
    expect(latency.order.toSet(), caps.map((s) => s.toLowerCase()).toSet());
    expect(policy(detail, false).order.first, 'video/av1');
  });
  test('manual is a preference and unavailable selection is observable', () {
    const manual = Quality(codecPreference: 'VP9');
    final p = policy(manual);
    expect(p.order.first, 'video/vp9');
    p.acceptAnswer(
      'm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\nm=audio 9 UDP/TLS/RTP/SAVPF 98\r\na=rtpmap:98 VP9/90000\r\n',
    );
    expect(p.supported, ['video/vp8']);
    expect(p.reason, contains('不支持'));
    for (var s = 0; s < 100; s += 2) {
      expect(
        p.sample(
          stats('VP8', s, busy: true),
          manual,
          start.add(Duration(seconds: s)),
        ),
        isFalse,
      );
    }
  });
  test(
    'healthy AV1 remains stable; missing or static stats do not cause probing',
    () {
      final p = policy();
      for (var s = 0; s < 120; s += 2) {
        expect(
          p.sample(stats('AV1', s), detail, start.add(Duration(seconds: s))),
          isFalse,
        );
      }
      expect(p.attempts, 0);
      for (var s = 120; s < 150; s += 2) {
        expect(
          p.sample(
            {
              'codec': 'video/av1',
              'fps': 1,
              'encodeMs': 100,
              'framesEncoded': 3600,
            },
            detail,
            start.add(Duration(seconds: s)),
          ),
          isFalse,
        );
      }
    },
  );
  test(
    'all codecs including H264 can yield under sustained measured pressure',
    () {
      for (final codec in ['AV1', 'H264', 'VP9', 'VP8']) {
        final p = policy();
        bool changed = false;
        for (var s = 0; s <= 12; s += 2) {
          changed =
              p.sample(
                stats(codec, s, busy: true),
                detail,
                start.add(Duration(seconds: s)),
              ) ||
              changed;
        }
        expect(changed, isTrue, reason: codec);
        expect(p.order.first, isNot('video/${codec.toLowerCase()}'));
        expect(
          p.cooldownMs(start.add(const Duration(seconds: 20))),
          greaterThan(0),
        );
        final count = p.attempts;
        for (var s = 14; s < 45; s += 2) {
          p.sample(
            stats(p.order.first.split('/').last, s, busy: true),
            detail,
            start.add(Duration(seconds: s)),
          );
        }
        expect(p.attempts, count);
      }
    },
  );
  test(
    'remote capability intersection bounds trials and fallback formats survive',
    () {
      final p = policy();
      p.acceptAnswer(
        'm=video 9 UDP/TLS/RTP/SAVPF 96 102\r\na=rtpmap:96 VP8/90000\r\na=rtpmap:102 H264/90000\r\n',
      );
      for (var s = 0; s <= 12; s += 2) {
        p.sample(
          stats('H264', s, busy: true),
          detail,
          start.add(Duration(seconds: s)),
        );
      }
      expect(p.order, ['video/vp8', 'video/h264']);
      expect(p.supported.toSet(), {'video/h264', 'video/vp8'});
    },
  );
  test('only fresh receiver decoder pressure can trigger a bounded trial', () {
    final p = policy();
    for (var s = 0; s <= 12; s += 2) {
      p.receiverFeedback({
        'codec': 'video/av1',
        'decodeMs': 35,
        'fps': 30,
      }, start.add(Duration(seconds: s)));
      p.sample(stats('AV1', s), detail, start.add(Duration(seconds: s)));
    }
    expect(p.attempts, 1);
    expect(p.reason, contains('解码'));
    final stale = policy();
    stale.receiverFeedback({
      'codec': 'video/av1',
      'decodeMs': 35,
      'fps': 30,
    }, start);
    for (var s = 0; s <= 24; s += 2) {
      stale.sample(stats('AV1', s), detail, start.add(Duration(seconds: s)));
    }
    expect(stale.attempts, 0);
  });
  test(
    'loss alone never forces a codec change and rejected trials do not loop',
    () {
      final p = policy();
      for (var s = 0; s < 120; s += 2) {
        p.sample(
          {
            ...stats('H264', s),
            'packetLoss': .1,
            'qualityLimit': 'bandwidth',
            'availableBitrate': 1e6,
          },
          detail,
          start.add(Duration(seconds: s)),
        );
      }
      expect(p.attempts, 0);
      final reject = policy();
      for (var s = 0; s < 300; s += 2) {
        reject.sample(
          stats('AV1', s, busy: true),
          detail,
          start.add(Duration(seconds: s)),
        );
      }
      expect(reject.attempts, lessThanOrEqualTo(3));
    },
  );
  test('counter and capture resets require fresh observations', () {
    final p = policy();
    p.sample(stats('AV1', 0), detail, start);
    p.sample(
      stats('AV1', 6, busy: true),
      detail,
      start.add(const Duration(seconds: 6)),
    );
    p.captureChanged(start.add(const Duration(seconds: 7)));
    expect(
      p.sample(
        stats('AV1', 8, busy: true),
        detail,
        start.add(const Duration(seconds: 8)),
      ),
      isFalse,
    );
    expect(
      p.sample(
        stats('AV1', 0, busy: true),
        detail,
        start.add(const Duration(seconds: 14)),
      ),
      isFalse,
    );
    expect(p.attempts, 0);
  });
}
