import 'package:flutter_test/flutter_test.dart';
import 'package:webdesk/protocol/quality.dart';
import 'package:webdesk/session/adaptive_video.dart';

void main() {
  final start = DateTime.utc(2026, 10, 25);
  const quality = Quality();
  Map<String, dynamic> cpu({String codec = 'video/VP8'}) => {
    'qualityLimit': 'cpu',
    'fps': 30.0,
    'encodeMs': 30.0,
    'codec': codec,
  };
  Map<String, dynamic> healthy() => {
    'qualityLimit': 'none',
    'fps': 30.0,
    'encodeMs': 4.0,
    'packetLoss': 0.0,
    'rttMs': 30.0,
    'availableBitrate': 16000000.0,
  };
  test(
    'sustained packet loss degrades a low RTT link without CPU pressure',
    () {
      final policy = AdaptiveVideoPolicy();
      final congested = {
        ...healthy(),
        'packetLoss': 0.07,
        'rttMs': 65.0,
        'availableBitrate': 2000000.0,
      };
      expect(policy.sample(congested, quality, start), isFalse);
      expect(
        policy.sample(
          congested,
          quality,
          start.add(const Duration(seconds: 2)),
        ),
        isFalse,
      );
      expect(
        policy.sample(
          congested,
          quality,
          start.add(const Duration(seconds: 4)),
        ),
        isTrue,
      );
      expect(policy.current.cpuSteps, 0);
      expect(policy.current.networkSteps, 1);
      expect(policy.current.networkBitrate, lessThan(2000000));
    },
  );

  test(
    'isolated loss bursts do not accumulate across healthy observations',
    () {
      final policy = AdaptiveVideoPolicy();
      for (var i = 0; i < 12; i++) {
        expect(
          policy.sample(
            {...healthy(), 'packetLoss': i % 3 == 2 ? .01 : .08},
            quality,
            start.add(Duration(seconds: i * 2)),
          ),
          isFalse,
        );
      }
      expect(policy.current.networkSteps, 0);
    },
  );

  test(
    'low latency mode reacts sooner to loss while auto keeps its budget',
    () {
      final normal = AdaptiveVideoPolicy(), low = AdaptiveVideoPolicy();
      const lowQuality = Quality(networkMode: 'low-latency');
      for (var i = 0; i < 3; i++) {
        final stats = {...healthy(), 'packetLoss': .03, 'rttMs': 60.0};
        final now = start.add(Duration(seconds: i * 2));
        expect(normal.sample(stats, quality, now), isFalse);
        expect(low.sample(stats, lowQuality, now), i == 2);
      }
      expect(normal.current.networkSteps, 0);
      expect(low.current.networkSteps, 1);
    },
  );
  test(
    'static screens and missing statistics do not prove encoder pressure',
    () {
      final policy = AdaptiveVideoPolicy();
      for (var i = 0; i < 20; i++) {
        expect(
          policy.sample(
            {'fps': 1.0, 'encodeMs': 100.0, 'qualityLimit': 'none'},
            quality,
            start.add(Duration(seconds: i * 2)),
          ),
          isFalse,
        );
      }
      expect(policy.current.cpuSteps, 0);
      expect(
        policy.sample({}, quality, start.add(const Duration(minutes: 2))),
        isFalse,
      );
    },
  );
  test('CPU pressure has hysteresis and cooldown; recovery is gradual', () {
    final policy = AdaptiveVideoPolicy();
    expect(policy.sample(cpu(), quality, start), isFalse);
    expect(
      policy.sample(cpu(), quality, start.add(const Duration(seconds: 2))),
      isFalse,
    );
    expect(
      policy.sample(cpu(), quality, start.add(const Duration(seconds: 4))),
      isTrue,
    );
    expect(policy.current.cpuSteps, 1);
    for (var i = 3; i < 7; i++) {
      expect(
        policy.sample(cpu(), quality, start.add(Duration(seconds: i * 2))),
        isFalse,
      );
    }
    expect(
      policy.sample(cpu(), quality, start.add(const Duration(seconds: 14))),
      isTrue,
    );
    expect(policy.current.cpuSteps, 2);
    for (var i = 0; i < 7; i++) {
      expect(
        policy.sample(
          healthy(),
          quality,
          start.add(Duration(seconds: 16 + i * 2)),
        ),
        isFalse,
      );
    }
    expect(
      policy.sample(healthy(), quality, start.add(const Duration(seconds: 30))),
      isTrue,
    );
    expect(policy.current.cpuSteps, 1);
    for (var i = 0; i < 20; i++) {
      policy.sample({}, quality, start.add(Duration(seconds: 32 + i * 2)));
    }
    expect(
      policy.current.cpuSteps,
      1,
      reason: 'missing observations cannot trigger recovery',
    );
  });
  test(
    'bandwidth pressure is distinct and its cap is released after recovery',
    () {
      final policy = AdaptiveVideoPolicy();
      for (var i = 0; i < 3; i++) {
        policy.sample(
          {
            'qualityLimit': 'bandwidth',
            'availableBitrate': 1000000.0,
            'fps': 15.0,
            'encodeMs': 2.0,
          },
          quality,
          start.add(Duration(seconds: i * 2)),
        );
      }
      expect(policy.current.cpuSteps, 0);
      expect(policy.current.networkSteps, 1);
      expect(policy.current.networkBitrate, 850000);
      for (var i = 0; i < 8; i++) {
        policy.sample(
          healthy(),
          quality,
          start.add(Duration(seconds: 6 + i * 2)),
        );
      }
      expect(policy.current.networkSteps, 0);
      expect(policy.current.networkBitrate, isNull);
    },
  );
  test(
    'disabled degradation retains spatial and temporal ceilings under CPU load',
    () {
      final policy = AdaptiveVideoPolicy();
      const disabled = Quality(degradationPreference: 'disabled');
      for (var i = 0; i < 10; i++) {
        policy.sample(
          cpu(codec: 'video/AV1'),
          disabled,
          start.add(Duration(seconds: i * 2)),
        );
      }
      expect(policy.current.cpuSteps, 0);
    },
  );
  test('H264 pressure adjusts budgets independently of codec selection', () {
    for (final hardware in [true, false]) {
      final policy = AdaptiveVideoPolicy();
      for (var i = 0; i < 12; i++) {
        policy.sample(
          {
            ...cpu(codec: 'video/H264'),
            'hardware': hardware,
            'encoder': hardware ? 'WebDesk-NVENC-H264-D3D11' : 'OpenH264',
          },
          quality,
          start.add(Duration(seconds: i * 2)),
        );
      }
      expect(policy.current.cpuSteps, greaterThan(0));
    }
  });
  test(
    'low latency mode detects network pressure at a smaller latency budget',
    () {
      final normal = AdaptiveVideoPolicy(), low = AdaptiveVideoPolicy();
      for (var i = 0; i < 3; i++) {
        final stats = {
          'packetLoss': 0.01,
          'rttMs': 250.0,
          'availableBitrate': 1000000.0,
          'sendBitrate': 2000000.0,
        };
        final at = start.add(Duration(seconds: i * 2));
        normal.sample(stats, quality, at);
        low.sample(stats, const Quality(networkMode: 'low-latency'), at);
      }
      expect(normal.current.networkSteps, 0);
      expect(low.current.networkSteps, 1);
    },
  );
}
