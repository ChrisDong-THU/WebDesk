import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:webdesk/session/host_controller.dart';
import 'package:webdesk/session/host_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('webdesk/lifecycle');
  late Directory directory;
  late File preferencesFile;

  setUp(() async {
    directory = await Directory.systemTemp.createTemp('webdesk-credentials-');
    preferencesFile = File('${directory.path}/profile/preferences.json');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (_) async => null);
  });

  tearDown(() async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
    await directory.delete(recursive: true);
  });

  HostController createHost() {
    final host = HostController(
      preferences: HostPreferences(file: preferencesFile),
      ensureDesktop: () async {},
    );
    addTearDown(host.dispose);
    return host;
  }

  test('credentials survive stop, restart, and server changes', () async {
    final first = createHost();
    await first.enable('http://127.0.0.1:1');
    final device = first.device, password = first.password;
    expect(device, matches(RegExp(r'^\d{9}$')));
    expect(password.length, 16);
    await first.disable();
    expect(first.device, device);
    expect(first.password, password);
    await first.enable('http://127.0.0.1:2');
    expect(first.device, device);
    expect(first.password, password);
    await first.disable();

    final restarted = createHost();
    await restarted.load();
    expect(restarted.server, 'http://127.0.0.1:2');
    expect(restarted.device, device);
    expect(restarted.password, password);
    await restarted.enable(restarted.server);
    expect(restarted.device, device);
    expect(restarted.password, password);
    await restarted.disable();
  });

  test(
    'upgrade preserves server and generates credentials only once',
    () async {
      await preferencesFile.parent.create(recursive: true);
      await preferencesFile.writeAsString(
        jsonEncode({'server': 'http://127.0.0.1:1'}),
      );
      final host = createHost();
      await host.load();
      expect(host.server, 'http://127.0.0.1:1');
      await host.enable(host.server);
      final saved = HostPreferences(file: preferencesFile);
      await saved.load();
      expect(saved.credentials!.device, host.device);
      expect(saved.credentials!.password, host.password);
      await host.disable();
    },
  );

  test('manual regeneration replaces and persists both credentials', () async {
    final host = createHost();
    await host.enable('http://127.0.0.1:1');
    final oldDevice = host.device, oldPassword = host.password;
    // Registration normally clears busy via a server acknowledgement.
    host.busy = false;
    await host.regenerate();
    expect(host.error, isEmpty);
    expect(host.enabled, isTrue);
    expect(host.device, isNot(oldDevice));
    expect(host.password, isNot(oldPassword));
    final saved = HostPreferences(file: preferencesFile);
    await saved.load();
    expect(saved.credentials!.device, host.device);
    expect(saved.credentials!.password, host.password);
    await host.disable();
  });

  test('failed regeneration keeps the active identity', () async {
    final host = createHost();
    await host.enable('http://127.0.0.1:1');
    final device = host.device, password = host.password;
    // A directory at the temporary-file path forces the atomic save to fail.
    await Directory('${preferencesFile.path}.tmp').create();
    host.busy = false;
    await host.regenerate();
    expect(host.error, contains('无法重新生成'));
    expect(host.enabled, isTrue);
    expect(host.busy, isFalse);
    expect(host.device, device);
    expect(host.password, password);
    await host.disable();
  });

  test('invalid saved identity is not silently regenerated', () async {
    await preferencesFile.parent.create(recursive: true);
    await preferencesFile.writeAsString(
      jsonEncode({'device': 'broken', 'password': 'broken'}),
    );
    final host = createHost();
    await host.enable('http://127.0.0.1:1');
    expect(host.enabled, isFalse);
    expect(host.error, contains('重新生成'));
    await host.regenerate();
    expect(host.error, isEmpty);
    expect(host.enabled, isFalse);
    final saved = HostPreferences(file: preferencesFile);
    await saved.load();
    expect(saved.credentials!.device, host.device);
  });

  test('malformed settings require explicit regeneration to recover', () async {
    await preferencesFile.parent.create(recursive: true);
    await preferencesFile.writeAsString('{');
    final host = createHost();
    await host.enable('http://127.0.0.1:1');
    expect(host.enabled, isFalse);
    expect(await preferencesFile.readAsString(), '{');
    await host.regenerate();
    expect(host.error, isEmpty);
    final saved = HostPreferences(file: preferencesFile);
    await saved.load();
    expect(saved.credentials!.device, host.device);
    expect(saved.credentials!.password, host.password);
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
    'stop owns its socket and blocks reopening until cleanup completes',
    () async {
      final host = createHost();
      await host.enable('http://127.0.0.1:1');
      host.busy = false;
      final release = Completer<void>();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (_) => release.future);
      final stopping = host.disable();
      expect(host.phase, HostPhase.stopping);
      expect(host.enabled, isFalse);
      expect(host.busy, isTrue);
      final repeated = host.disable();
      await host.enable('http://127.0.0.1:2');
      expect(host.server, 'http://127.0.0.1:1');
      expect(host.phase, HostPhase.stopping);
      release.complete();
      await Future.wait([stopping, repeated]);
      expect(host.phase, HostPhase.disabled);
      expect(host.busy, isFalse);
      await host.enable('http://127.0.0.1:2');
      expect(host.enabled, isTrue);
      expect(host.server, 'http://127.0.0.1:2');
      await host.disable();
    },
  );

  test('cleanup failure still ends the old socket and permits retry', () async {
    final host = createHost();
    await host.enable('http://127.0.0.1:1');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (_) async {
          throw PlatformException(code: 'test-cleanup-failure');
        });
    await host.disable();
    expect(host.phase, HostPhase.disabled);
    expect(host.busy, isFalse);
    expect(host.error, contains('清理失败'));
    await host.enable('http://127.0.0.1:2');
    expect(host.enabled, isTrue);
    await host.disable();
  });

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
