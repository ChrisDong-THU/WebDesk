import 'dart:async';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:webdesk/native/system_audio.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('FlutterWebRTC.Method');
  final calls = <MethodCall>[];
  Future<Object?> Function(MethodCall)? intercept;
  setUp(() {
    calls.clear();
    intercept = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          if (call.method == 'webdeskAudioCreate') {
            return {
              'streamId': 'audio-test',
              'videoTracks': [],
              'audioTracks': [
                {
                  'id': 'audio-test',
                  'label': 'System audio',
                  'kind': 'audio',
                  'enabled': true,
                },
              ],
            };
          }
          if (call.method == 'webdeskAudioSetEnabled') {
            if (intercept != null) return intercept!(call);
            return call.arguments['enabled'];
          }
          return null;
        });
  });
  tearDown(
    () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null),
  );

  test(
    'creation reserves audio without starting capture; close disposes native resources',
    () async {
      final audio = SystemAudio();
      final stream = await audio.create();
      expect(stream.getAudioTracks().length, 1);
      expect(calls.map((call) => call.method), ['webdeskAudioCreate']);
      expect(await audio.setEnabled(true), true);
      expect(await audio.setEnabled(false), false);
      await audio.close();
      await audio.close();
      expect(
        calls.where((call) => call.method == 'webdeskAudioDispose').length,
        1,
      );
      await expectLater(audio.setEnabled(true), throwsStateError);
    },
  );

  test('failed capture does not poison later toggle requests', () async {
    final audio = SystemAudio();
    await audio.create();
    intercept = (_) async => throw PlatformException(code: 'SystemAudio');
    await expectLater(
      audio.setEnabled(true),
      throwsA(isA<PlatformException>()),
    );
    intercept = null;
    expect(await audio.setEnabled(true), true);
    await audio.close();
  });

  test('close waits for pending native capture then disposes it', () async {
    final audio = SystemAudio();
    await audio.create();
    final pending = Completer<bool>();
    intercept = (_) => pending.future;
    final enabling = audio.setEnabled(true);
    await Future<void>.delayed(Duration.zero);
    final closing = audio.close();
    expect(
      calls.where((call) => call.method == 'webdeskAudioDispose'),
      isEmpty,
    );
    pending.complete(true);
    await enabling;
    await closing;
    expect(
      calls.where((call) => call.method == 'webdeskAudioDispose').length,
      1,
    );
  });
}
