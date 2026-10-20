// Separate executable entrypoint; never compiled into the shipping main.dart.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:webdesk/session/host_controller.dart';
import 'package:webdesk/native/desktop_bridge.dart';
import 'package:webdesk/native/secure_capture.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:window_manager/window_manager.dart';

Future<void> main(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();
  if (args.length != 2 ||
      Uri.parse(args[0]).host != '127.0.0.1' ||
      Uri.parse(args[1]).host != '127.0.0.1') {
    exit(2);
  }
  await windowManager.ensureInitialized();
  await windowManager.setTitle('WebDesk Flutter 联调');
  runApp(
    const MaterialApp(
      home: Scaffold(
        body: Center(
          child: Text('WebDesk · 本机联调', style: TextStyle(fontSize: 32)),
        ),
      ),
    ),
  );
  final client = HttpClient(),
      host = HostController(diagnostic: (message) => stdout.writeln(message));
  final bridge = DesktopBridge(
    (error) => stdout.writeln('bridge probe: $error'),
    diagnostic: stdout.writeln,
  );
  try {
    await bridge.start();
    for (var i = 0; i < 5; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 100));
      await bridge.status();
      await bridge.release();
    }
    stdout.writeln('bridge probe passed');
  } catch (error) {
    stdout.writeln('bridge probe failed: $error');
    bridge.close();
    exit(1);
  } finally {
    bridge.close();
  }
  final captureResults = <Map<String, int>>[];
  for (final height in [720, 4320]) {
    final renderer = RTCVideoRenderer();
    await renderer.initialize();
    final frame = Completer<void>();
    renderer.onFirstFrameRendered = () {
      if (!frame.isCompleted) frame.complete();
    };
    final stream = await SecureCapture.start(height, 15);
    try {
      renderer.srcObject = stream;
      await frame.future.timeout(const Duration(seconds: 15));
      if (!await SecureCapture.healthy(stream.id)) {
        throw StateError('Native capture probe did not produce a frame');
      }
      captureResults.add({
        'requested': height,
        'width': renderer.videoWidth,
        'height': renderer.videoHeight,
      });
      stdout.writeln('native capture probe: ${captureResults.last}');
    } finally {
      renderer.srcObject = null;
      await SecureCapture.stop(stream.id);
      for (final track in stream.getTracks()) {
        await track.stop();
      }
      await stream.dispose();
      await renderer.dispose();
    }
  }
  Future<void> report(Map data) async {
    final request = await client.postUrl(Uri.parse('${args[1]}/host'));
    request.headers.contentType = ContentType.json;
    request.write(jsonEncode(data));
    await (await request.close()).drain<void>();
  }

  var published = false, reporting = false;
  host.addListener(() {
    if (reporting) return;
    reporting = true;
    unawaited(() async {
      try {
        if (host.error.isNotEmpty) await report({'error': host.error});
        if (!published && host.enabled && !host.busy) {
          published = true;
          await report({
            'deviceId': host.device,
            'password': host.password,
            'nativeWidth': bridge.width,
            'nativeHeight': bridge.height,
          });
        }
      } finally {
        reporting = false;
      }
    }());
  });
  await host.enable(args[0], persist: false);
  Timer(const Duration(minutes: 4), () async {
    await host.disable();
    exit(0);
  });
  Timer.periodic(const Duration(seconds: 1), (timer) async {
    try {
      final request = await client.getUrl(Uri.parse('${args[1]}/finished'));
      final text = await utf8.decodeStream(await request.close());
      if (text == 'yes') {
        timer.cancel();
        await host.disable();
        client.close();
        exit(0);
      }
    } catch (_) {}
  });
}
