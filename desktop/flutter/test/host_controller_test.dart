import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:webdesk/session/host_controller.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('webdesk/lifecycle');

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test(
    'disposing while shutdown awaits native reply does not notify a dead view',
    () async {
      final reply = Completer<void>();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (_) => reply.future);
      final host = HostController();
      final shutdown = host.disable();
      host.dispose();
      reply.complete();
      await expectLater(shutdown, completes);
    },
  );

  test(
    'invalid server URL fails before native startup and allows retry',
    () async {
      final host = HostController();
      addTearDown(host.dispose);
      await host.enable('file:///windows', persist: false);
      expect(host.enabled, isFalse);
      expect(host.busy, isFalse);
      expect(host.error, contains('有效的服务地址'));
    },
  );
}
