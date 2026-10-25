import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:webdesk/native/file_selection.dart';
import 'dart:async';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('webdesk/lifecycle');
  final picker = RemoteFileSelection('test-owner');
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });
  test(
    'cancelled selection returns null and another selection can succeed',
    () async {
      var requests = 0;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            expect(call.method, 'selectFile');
            expect(call.arguments, 'test-owner');
            return requests++ == 0 ? null : 'C:/files/选择.txt';
          });
      expect(await picker.select(), isNull);
      expect((await picker.select())!.path, 'C:/files/选择.txt');
    },
  );
  test('native picker failures reject the request', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (_) async {
          throw PlatformException(code: 'FileSelection');
        });
    await expectLater(picker.select(), throwsA(isA<PlatformException>()));
  });
  test(
    'cancellation carries the owning session and does not wait for the dialog',
    () async {
      final selected = Completer<String?>();
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            calls.add(call);
            return call.method == 'selectFile' ? selected.future : null;
          });
      final selection = picker.select();
      await picker.cancel();
      await RemoteFileSelection('previous-owner').cancel();
      expect(calls.map((call) => call.method), [
        'selectFile',
        'cancelFileSelection',
        'cancelFileSelection',
      ]);
      expect(calls.map((call) => call.arguments), [
        'test-owner',
        'test-owner',
        'previous-owner',
      ]);
      selected.complete(null);
      expect(await selection, isNull);
    },
  );
}
