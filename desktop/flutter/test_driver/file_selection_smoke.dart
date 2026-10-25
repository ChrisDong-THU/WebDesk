// Launches the actual FlutterWindow/Win32Window lifecycle and native bridge.
// Loopback/service/capture/input are unused. Never ship this entrypoint.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:webdesk/native/file_selection.dart';

Future<void> main(List<String> arguments) async {
  WidgetsFlutterBinding.ensureInitialized();
  if (arguments.length != 2) {
    exit(2);
  }
  final report = File(arguments[0]);
  final probe = arguments[1];
  final checks = <Map<String, Object>>[];
  var ticks = 0;
  final heartbeat = Timer.periodic(
    const Duration(milliseconds: 20),
    (_) => ticks++,
  );
  runApp(
    const MaterialApp(
      home: Scaffold(body: Center(child: Text('WebDesk 文件选择回归'))),
    ),
  );
  await WidgetsBinding.instance.endOfFrame;

  Future<Map<String, dynamic>> inspect() async {
    final deadline = DateTime.now().add(const Duration(seconds: 5));
    while (DateTime.now().isBefore(deadline)) {
      final result = await Process.run(probe, ['$pid', 'inspect-picker']);
      if (result.exitCode == 0) {
        return jsonDecode(result.stdout as String) as Map<String, dynamic>;
      }
      if (result.exitCode != 7 && result.exitCode != 2) {
        throw StateError('Picker probe failed: ${result.exitCode}');
      }
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
    throw StateError('Native picker did not open');
  }

  Object? failure;
  try {
    for (final action in [
      'close-picker',
      'cancel-picker',
      'close-picker',
      'disconnect',
    ]) {
      final minimized = checks.length == 2;
      final visibility = await Process.run(probe, [
        '$pid',
        minimized ? 'minimize' : 'hide',
      ]);
      if (visibility.exitCode != 0) {
        throw StateError('Could not prepare host visibility');
      }
      final picker = RemoteFileSelection('smoke-${checks.length}');
      final before = ticks;
      final selected = picker.select();
      // Observe failures immediately, including the old first-open exception.
      final done = selected.then<Object?>(
        (value) => value,
        onError: (Object error) => error,
      );
      final state = await inspect();
      if (state['topmost'] != true ||
          state['ownerTopmost'] != false ||
          (minimized
              ? state['ownerMinimized'] != true
              : state['ownerVisible'] != false)) {
        throw StateError('Picker Z order or host visibility incorrect: $state');
      }
      await RemoteFileSelection('previous-session').cancel();
      final stillOpen = await Process.run(probe, ['$pid', 'inspect-picker']);
      if (stillOpen.exitCode != 0) {
        throw StateError('Previous session cancelled this picker');
      }
      await Future<void>.delayed(const Duration(milliseconds: 100));
      if (ticks <= before) {
        throw StateError('Flutter dispatch stalled while the picker was open');
      }
      if (action == 'disconnect') {
        await picker.cancel();
      } else {
        final result = await Process.run(probe, ['$pid', action]);
        if (result.exitCode != 0) {
          throw StateError('Picker close failed: ${result.exitCode}');
        }
      }
      final result = await done.timeout(const Duration(seconds: 5));
      if (result != null) throw StateError('Expected cancellation: $result');
      checks.add({
        'action': action,
        'cancelled': true,
        'flutterHeartbeat': ticks - before,
        'topmost': state['topmost'] as bool,
        'ownerMode': minimized ? 'minimized' : 'hidden',
      });
    }
  } catch (error, stack) {
    failure = '$error\n$stack';
  } finally {
    heartbeat.cancel();
    await report.writeAsString(
      jsonEncode({
        'ok': failure == null,
        'checks': checks,
        if (failure != null) 'error': '$failure',
      }),
    );
  }
  exit(failure == null ? 0 : 1);
}
