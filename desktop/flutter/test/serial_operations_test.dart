import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:webdesk/session/serial_operations.dart';

void main() {
  test(
    'Answer and live media changes cannot overlap native mutations',
    () async {
      final queue = SerialOperations(), first = Completer<void>();
      final calls = <String>[];
      final answer = queue.run(() async {
        calls.add('answer');
        await first.future;
        calls.add('applied');
      });
      final update = queue.run(() async {
        calls.add('quality');
      });
      await Future<void>.delayed(Duration.zero);
      expect(calls, ['answer']);
      first.complete();
      await Future.wait([answer, update, queue.settled]);
      expect(calls, ['answer', 'applied', 'quality']);
    },
  );

  test(
    'failure reaches its caller without poisoning later cleanup or updates',
    () async {
      final queue = SerialOperations();
      await expectLater(
        queue.run(() async => throw StateError('capture')),
        throwsStateError,
      );
      var cleaned = false;
      await queue.run(() async {
        cleaned = true;
      });
      await queue.settled;
      expect(cleaned, isTrue);
    },
  );
}
