import 'package:flutter_test/flutter_test.dart';
import 'package:webdesk/session/capture_recovery.dart';

void main() {
  final start = DateTime.utc(2026, 10, 25);
  Map<String, dynamic> health(
    int captured,
    int age, {
    bool recovering = false,
  }) => {
    'framesCaptured': captured,
    'lastFrameAgeMs': age,
    'recovering': recovering,
  };
  test(
    'successful source progress stays healthy even when encoding emits no frames',
    () {
      final policy = CaptureRecoveryPolicy()..started(start);
      for (var i = 0; i < 30; i++) {
        expect(
          policy.sample(
            health(i + 1, 60000),
            start.add(Duration(seconds: i * 2)),
          ),
          isFalse,
        );
      }
      expect(policy.exhausted, isFalse);
      expect(policy.attempts, 0);
    },
  );
  test(
    'first-frame failure uses grace, bounded rebuilds and cooldown across tracks',
    () {
      final policy = CaptureRecoveryPolicy()..started(start);
      expect(
        policy.sample(health(0, -1), start.add(const Duration(seconds: 9))),
        isFalse,
      );
      expect(
        policy.sample(health(0, -1), start.add(const Duration(seconds: 10))),
        isTrue,
      );
      expect(policy.attempts, 1);
      policy.started(start.add(const Duration(seconds: 10)));
      expect(
        policy.sample(health(0, -1), start.add(const Duration(seconds: 20))),
        isFalse,
      );
      expect(
        policy.sample(health(0, -1), start.add(const Duration(seconds: 26))),
        isTrue,
      );
      expect(policy.attempts, 2);
      policy.started(start.add(const Duration(seconds: 26)));
      expect(
        policy.sample(health(0, -1), start.add(const Duration(seconds: 42))),
        isFalse,
      );
      expect(policy.exhausted, isTrue);
      policy.sample(health(10, 50), start.add(const Duration(seconds: 44)));
      expect(policy.exhausted, isFalse);
      expect(policy.attempts, 0);
    },
  );
  test('missing diagnostics and native recovery never race a Dart rebuild', () {
    final policy = CaptureRecoveryPolicy()..started(start);
    expect(policy.sample({}, start.add(const Duration(minutes: 1))), isFalse);
    expect(
      policy.sample(
        health(0, -1, recovering: true),
        start.add(const Duration(minutes: 1)),
      ),
      isFalse,
    );
    expect(policy.attempts, 0);
    expect(policy.exhausted, isFalse);
  });
}
