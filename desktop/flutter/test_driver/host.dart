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

class TestWindowListener with WindowListener {
  @override
  void onWindowClose() => unawaited(windowManager.hide());
}

void main(List<String> args) {
  runZonedGuarded(() => run(args), (error, stack) {
    stderr.writeln('$error\n$stack');
    exit(1);
  });
}

Future<void> run(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();
  if ((args.length != 2 && args.length != 3) ||
      Uri.parse(args[0]).host != '127.0.0.1' ||
      Uri.parse(args[1]).host != '127.0.0.1') {
    exit(2);
  }
  await windowManager.ensureInitialized();
  windowManager.addListener(TestWindowListener());
  await windowManager.setPreventClose(true);
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
  // Exercise actual plugin/source destruction, including rapid frame-rate
  // changes. A mock cannot catch pure virtual calls inside libwebrtc.dll.
  for (var i = 0; i < 30; i++) {
    final sources = await desktopCapturer.getSources(
      types: [SourceType.Screen],
    );
    final stream = await navigator.mediaDevices.getDisplayMedia({
      'audio': false,
      'video': {
        'deviceId': {'exact': sources.first.id},
        'mandatory': {'frameRate': i.isEven ? 30 : 60},
      },
    });
    await Future<void>.delayed(Duration(milliseconds: 5 + (i % 5) * 13));
    for (final track in stream.getTracks()) {
      await track.stop();
    }
    await stream.dispose();
  }
  stdout.writeln('native capture lifetime: 30 rapid start/stop cycles passed');
  final control = await HttpServer.bind(InternetAddress.loopbackIPv4, 44302);
  final keepAlive = Timer.periodic(const Duration(seconds: 5), (_) async {
    try {
      await bridge.status();
    } catch (error) {
      stdout.writeln('control bridge: $error');
    }
  });
  control.listen((request) async {
    request.response.headers.contentType = ContentType.json;
    try {
      final action = request.uri.path;
      if (action == '/status') {
        await bridge.status();
        request.response.write(
          jsonEncode({
            'secure': bridge.secure,
            'connected': host.connected,
            'error': host.error,
          }),
        );
      } else if (['/show', '/inspect'].contains(action) ||
          (action == '/lock' && args.length == 3 && args[2] == 'lock-test')) {
        final probe = File(Platform.resolvedExecutable).parent.parent.parent.uri
            .resolve('task-runner/flutter-window-probe.exe');
        final result = await Process.run(probe.toFilePath(), [
          '$pid',
          action.substring(1),
        ]);
        if (result.exitCode != 0) {
          throw StateError('Window probe ${result.exitCode}: ${result.stderr}');
        }
        request.response.write(result.stdout);
      } else {
        request.response.statusCode = 404;
      }
    } catch (error) {
      request.response.statusCode = 500;
      request.response.write(jsonEncode({'error': '$error'}));
    }
    await request.response.close();
  });
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
            'pid': pid,
            'lockTest': args.length == 3,
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
        keepAlive.cancel();
        bridge.close();
        await control.close(force: true);
        client.close();
        exit(0);
      }
    } catch (_) {}
  });
}
