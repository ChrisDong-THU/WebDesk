import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:webdesk/session/host_controller.dart';
import 'package:webdesk/session/host_preferences.dart';

Future<void> waitUntil(bool Function() condition) async {
  final deadline = DateTime.now().add(const Duration(seconds: 10));
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) {
      throw TimeoutException('Host did not reach the expected signaling state');
    }
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'real signaling keeps identity across restart and revokes it on rotation',
    () async {
      const channel = MethodChannel('webdesk/lifecycle');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (_) async => null);
      addTearDown(() {
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, null);
      });
      final directory = await Directory.systemTemp.createTemp(
        'webdesk-signaling-',
      );
      addTearDown(() => directory.delete(recursive: true));
      final preferences = File('${directory.path}/preferences.json');
      final server = await Process.start('node', [
        '../../tests/fixtures/credential-server.mjs',
      ]);
      addTearDown(() async {
        await server.stdin.close();
        await server.exitCode.timeout(
          const Duration(seconds: 5),
          onTimeout: () {
            server.kill();
            return -1;
          },
        );
      });
      final port = await server.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .first
          .timeout(const Duration(seconds: 10));
      final url = 'http://127.0.0.1:$port';
      final observer = io.io(
        url,
        io.OptionBuilder()
            .setTransports(['websocket'])
            .enableForceNew()
            .disableAutoConnect()
            .build(),
      );
      addTearDown(observer.dispose);
      observer.connect();
      await waitUntil(() => observer.connected);

      HostController createHost() {
        final host = HostController(
          preferences: HostPreferences(file: preferences),
          ensureDesktop: () async {},
        );
        addTearDown(host.dispose);
        return host;
      }

      Future<void> registered(HostController host) =>
          waitUntil(() => host.enabled && !host.busy && host.error.isEmpty);

      final first = createHost();
      await first.enable(url);
      await registered(first);
      final oldDevice = first.device, oldPassword = first.password;
      await first.disable();

      final restarted = createHost();
      await restarted.load();
      await restarted.enable(restarted.server);
      await registered(restarted);
      expect(restarted.device, oldDevice);
      expect(restarted.password, oldPassword);

      await restarted.regenerate();
      await registered(restarted);
      expect(restarted.device, isNot(oldDevice));
      expect(restarted.password, isNot(oldPassword));
      final revoked = await observer
          .emitWithAckAsync('connect-host', {
            'deviceId': oldDevice,
            'password': oldPassword,
            'quality': {
              'resolutionRatio': 1080,
              'maxFramerate': 30,
              'maxBitrate': 0,
              'videoContentHint': 'detail',
            },
          })
          .timeout(const Duration(seconds: 5));
      expect(revoked['error'], contains('设备离线或连接密码不正确'));

      final newDevice = restarted.device, newPassword = restarted.password;
      await restarted.disable();
      final afterRotation = createHost();
      await afterRotation.load();
      await afterRotation.enable(afterRotation.server);
      await registered(afterRotation);
      expect(afterRotation.device, newDevice);
      expect(afterRotation.password, newPassword);
      await afterRotation.disable();
    },
  );
}
