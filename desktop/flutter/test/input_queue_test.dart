import 'dart:async';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:webdesk/session/input_queue.dart';

void main() {
  test(
    'slow native input coalesces moves without crossing button barriers',
    () async {
      final gate = Completer<void>(), calls = <int>[], errors = <Object>[];
      final queue = InputQueue((bytes) async {
        calls.add(bytes.single);
        if (calls.length == 1) await gate.future;
      }, errors.add);
      void add(int id, bool move) =>
          queue.add(Uint8List.fromList([id]), move: move);
      add(1, true);
      for (var i = 0; i < 1000; i++) {
        add(2, true);
      }
      add(3, false); // button down
      add(4, true);
      add(5, true);
      add(6, false); // button up
      gate.complete();
      await Future<void>.delayed(Duration.zero);
      expect(calls, [1, 2, 3, 5, 6]);
      expect(errors, isEmpty);
      await queue.close();
    },
  );
  test(
    'closing drains only in-flight input and ignores later events',
    () async {
      final gate = Completer<void>(), calls = <int>[];
      final queue = InputQueue((bytes) async {
        calls.add(bytes.single);
        await gate.future;
      }, (_) {});
      queue.add(Uint8List.fromList([1]), move: false);
      queue.add(Uint8List.fromList([2]), move: false);
      final closing = queue.close();
      queue.add(Uint8List.fromList([3]), move: false);
      gate.complete();
      await closing;
      expect(calls, [1]);
    },
  );
}
