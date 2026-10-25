import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:webdesk/session/media_recovery.dart';

void main() {
  testWidgets(
    'a stalled native restart cannot hold recovery open indefinitely',
    (tester) async {
      final gate = Completer<void>(), failures = <Object>[];
      var restarts = 0;
      final recovery = MediaRecovery(
        restart: () {
          restarts++;
          return gate.future;
        },
        onExhausted: failures.add,
      );
      recovery.disconnected(failed: true);
      await tester.pump(const Duration(seconds: 15));
      expect(failures, isEmpty);
      await tester.pump(const Duration(seconds: 15));
      expect(restarts, 2);
      await tester.pump(const Duration(seconds: 15));
      expect(failures, hasLength(1));
      recovery.close();
      gate.complete();
      await tester.pump();
    },
  );
  testWidgets(
    'brief loss is allowed, sustained loss uses two bounded attempts',
    (tester) async {
      var restarts = 0;
      final failures = <Object>[];
      final recovery = MediaRecovery(
        restart: () async {
          restarts++;
        },
        onExhausted: failures.add,
      );
      recovery.disconnected();
      await tester.pump(const Duration(seconds: 2));
      recovery.connected();
      await tester.pump(const Duration(seconds: 2));
      expect(restarts, 0);
      recovery.disconnected();
      await tester.pump(const Duration(seconds: 2));
      recovery.disconnected();
      await tester.pump(const Duration(seconds: 1));
      expect(
        restarts,
        1,
        reason: 'duplicate disconnect does not extend the grace period',
      );
      await tester.pump(const Duration(seconds: 15));
      expect(restarts, 2);
      await tester.pump(const Duration(seconds: 15));
      expect(failures, hasLength(1));
      recovery.close();
    },
  );
  testWidgets(
    'failed state restarts immediately and success resets the budget',
    (tester) async {
      var restarts = 0;
      final recovery = MediaRecovery(
        restart: () async {
          restarts++;
        },
        onExhausted: (_) => fail('healthy peer cannot exhaust recovery'),
      );
      recovery.disconnected(failed: true);
      await tester.pump();
      expect(restarts, 1);
      recovery.connected();
      expect(recovery.attempts, 0);
      await tester.pump(const Duration(seconds: 20));
      expect(restarts, 1);
      recovery.disconnected(failed: true);
      await tester.pump();
      expect(restarts, 2);
      recovery.close();
      await tester.pump(const Duration(seconds: 30));
      expect(restarts, 2);
    },
  );
  testWidgets(
    'connected during an in-flight restart does not arm a stale timeout',
    (tester) async {
      final gate = Completer<void>();
      final recovery = MediaRecovery(
        restart: () => gate.future,
        onExhausted: (_) => fail('stale timeout'),
      );
      recovery.disconnected(failed: true);
      recovery.connected();
      gate.complete();
      await tester.pump();
      await tester.pump(const Duration(seconds: 60));
      expect(recovery.recovering, isFalse);
      recovery.close();
    },
  );
  testWidgets('restart exceptions consume the same bounded attempt budget', (
    tester,
  ) async {
    var restarts = 0;
    final failures = <Object>[];
    final recovery = MediaRecovery(
      restart: () async {
        restarts++;
        throw StateError('native failure');
      },
      onExhausted: failures.add,
    );
    recovery.disconnected(failed: true);
    await tester.pump();
    expect(failures, isEmpty);
    await tester.pump(const Duration(seconds: 15));
    expect(restarts, 2);
    expect(failures, hasLength(1));
    recovery.close();
  });
}
