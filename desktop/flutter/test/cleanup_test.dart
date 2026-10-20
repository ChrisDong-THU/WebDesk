import 'package:flutter_test/flutter_test.dart';
import 'package:webdesk/session/cleanup.dart';

void main() {
  test(
    'failed releases do not skip later resources and retain every error',
    () async {
      final calls = <String>[];
      final result = cleanup({
        'audio': () async {
          calls.add('audio');
          throw StateError('native');
        },
        'input': () {
          calls.add('input');
          throw StateError('pipe');
        },
        'peer': () async {
          calls.add('peer');
        },
        'stream': () async {
          calls.add('stream');
        },
      });
      await expectLater(
        result,
        throwsA(
          isA<CleanupException>().having(
            (e) => e.failures.keys.toList(),
            'failed resources',
            ['audio', 'input'],
          ),
        ),
      );
      expect(calls, ['audio', 'input', 'peer', 'stream']);
    },
  );
}
