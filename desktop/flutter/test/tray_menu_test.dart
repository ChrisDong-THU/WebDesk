import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:webdesk/native/tray_menu.dart';

void main() {
  test(
    'repeated right clicks do not nest popups; dismissal permits reopening',
    () async {
      var calls = 0;
      var gate = Completer<void>();
      final menu = TrayMenu(() {
        calls++;
        return gate.future;
      });
      final first = menu.open();
      await menu.open();
      expect(calls, 1);
      gate.complete();
      await first;
      gate = Completer<void>();
      final second = menu.open();
      expect(calls, 2);
      gate.complete();
      await second;
    },
  );

  test(
    'failed popup can retry and disposal blocks subsequent events',
    () async {
      var calls = 0;
      final menu = TrayMenu(() async {
        calls++;
        throw StateError('native failure');
      });
      await expectLater(menu.open(), throwsStateError);
      await expectLater(menu.open(), throwsStateError);
      expect(calls, 2);
      menu.dispose();
      await menu.open();
      expect(calls, 2);
    },
  );
}
