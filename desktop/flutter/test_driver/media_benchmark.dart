// Real native desktop capture/encoder test host. Loopback-only, no desktop service.
// Never ship this entrypoint. The production media policy is reused below.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:window_manager/window_manager.dart';
import 'package:webdesk/protocol/quality.dart';
import 'package:webdesk/session/video_policy.dart';
import 'package:webdesk/session/video_codecs.dart';
import 'package:webdesk/session/peer_connection.dart';

final picture = ValueNotifier<int>(0);
int challenge = 0;
RTCPeerConnection? pc;
MediaStream? stream;
final candidates = <Map<String, dynamic>>[];
Quality quality = const Quality();
int width = 3200, height = 2000;

Future<void> stop() async {
  await closePeerConnection(pc);
  pc = null;
  for (final track in stream?.getTracks() ?? <MediaStreamTrack>[]) {
    await track.stop();
  }
  await stream?.dispose();
  stream = null;
  candidates.clear();
}

Future<void> parameters() async {
  final sender = (await pc!.getSenders()).firstWhere(
    (s) => s.track?.kind == 'video',
  );
  final p = sender.parameters;
  configureVideoParameters(p, quality, width, height);
  if (!await sender.setParameters(p)) throw StateError('setParameters failed');
}

Future<dynamic> command(String path, Map<String, dynamic> data) async {
  if (path == '/start') {
    await stop();
    await windowManager.setAlwaysOnTop(true);
    await windowManager.show();
    await windowManager.focus();
    width = data['width'] as int;
    height = data['height'] as int;
    quality = Quality(
      height: data['heightLimit'] as int,
      fps: data['fps'] as int,
      bitrate: data['kbps'] as int,
    );
    final sources = await desktopCapturer.getSources(
      types: [SourceType.Screen],
    );
    stream = await navigator.mediaDevices.getDisplayMedia({
      'audio': false,
      'video': {
        'deviceId': {'exact': sources.first.id},
        'cursor': 'never',
        'frameRate': quality.fps,
        'mandatory': {'frameRate': quality.fps},
      },
    });
    pc = await createPeerConnection({
      'iceServers': [],
      'sdpSemantics': 'unified-plan',
    });
    pc!.onIceCandidate = (c) {
      if (c.candidate?.isNotEmpty ?? false) candidates.add(c.toMap());
    };
    final channel = await pc!.createDataChannel(
      'benchmark',
      RTCDataChannelInit()..ordered = true,
    );
    channel.onMessage = (m) {
      challenge = int.parse(m.text);
      picture.value++;
    };
    await pc!.addTrack(stream!.getVideoTracks().first, stream!);
    final caps = await getRtpSenderCapabilities('video');
    final selected = data['codec'] as String;
    if (selected == 'auto' && data['platformOrder'] != true) {
      await preferDesktopCodecs(pc!);
    }
    if (selected != 'auto') {
      final codecs = caps.codecs!
          .where(
            (c) =>
                c.mimeType.toLowerCase() == 'video/${selected.toLowerCase()}',
          )
          .toList();
      if (codecs.isEmpty) {
        throw StateError('Unsupported native codec $selected');
      }
      final repair = caps.codecs!.where(
        (c) => [
          'video/rtx',
          'video/red',
          'video/ulpfec',
        ].contains(c.mimeType.toLowerCase()),
      );
      await (await pc!.getTransceivers()).first.setCodecPreferences([
        ...codecs,
        ...repair,
      ]);
    }
    final offer = await pc!.createOffer({
      'offerToReceiveAudio': false,
      'offerToReceiveVideo': false,
    });
    await pc!.setLocalDescription(offer);
    return {
      'sdp': offer.toMap(),
      'capabilities': caps.codecs!.map((c) => c.mimeType).toSet().toList(),
    };
  }
  if (path == '/answer') {
    await pc!.setRemoteDescription(
      RTCSessionDescription(data['sdp'] as String, data['type'] as String),
    );
    await parameters();
    return {'ok': true};
  }
  if (path == '/candidates') {
    final list = List.of(candidates);
    candidates.clear();
    return list;
  }
  if (path == '/stats') {
    return (await pc!.getStats())
        .map(
          (r) => {
            'id': r.id,
            'type': r.type,
            'timestamp': r.timestamp,
            'values': r.values,
          },
        )
        .toList();
  }
  if (path == '/stop') {
    await stop();
    return {'ok': true};
  }
  if (path == '/quit') {
    await stop();
    Timer(const Duration(milliseconds: 300), () => exit(0));
    return {'ok': true};
  }
  throw StateError('Unknown test operation');
}

Future<void> main(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();
  await windowManager.ensureInitialized();
  runApp(
    MaterialApp(
      home: Scaffold(
        body: ValueListenableBuilder<int>(
          valueListenable: picture,
          builder: (_, tick, child) =>
              CustomPaint(painter: Pattern(tick), size: Size.infinite),
        ),
      ),
    ),
  );
  await windowManager.setTitle(
    'WebDesk media benchmark — temporary test pattern',
  );
  await windowManager.setFullScreen(true);
  await windowManager.setAlwaysOnTop(true);
  await windowManager.show();
  await windowManager.focus();
  Timer.periodic(const Duration(milliseconds: 33), (_) => picture.value++);
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 44402);
  await for (final req in server) {
    try {
      final body = await utf8.decoder.bind(req).join();
      final result = await command(
        req.uri.path,
        body.isEmpty ? {} : jsonDecode(body) as Map<String, dynamic>,
      );
      req.response.headers.contentType = ContentType.json;
      req.response.write(jsonEncode(result));
    } catch (e, stack) {
      stderr.writeln('$e\n$stack');
      req.response.statusCode = 500;
      req.response.write(jsonEncode({'error': '$e'}));
    }
    await req.response.close();
  }
}

class Pattern extends CustomPainter {
  Pattern(this.tick);
  final int tick;
  @override
  void paint(Canvas c, Size s) {
    c.drawColor(const Color(0xffeeeeee), BlendMode.src);
    final colors = [
      const Color(0xffff0000),
      const Color(0xff00ff00),
      const Color(0xff0000ff),
      Colors.white,
      Colors.black,
      const Color(0xff00ffff),
      const Color(0xffff00ff),
      const Color(0xffffff00),
    ];
    // Large constant swatches permit color-error measurements independent of motion.
    for (var i = 0; i < 8; i++) {
      c.drawRect(
        Rect.fromLTWH(
          i * s.width / 8,
          s.height * .08,
          s.width / 8,
          s.height * .14,
        ),
        Paint()..color = colors[i],
      );
    }
    // Sixteen binary challenge bits, decoded from the received video, measure
    // input -> fixture paint -> capture -> encode -> network -> decoded frame.
    for (var i = 0; i < 16; i++) {
      c.drawRect(
        Rect.fromLTWH(i * s.width / 16, 0, s.width / 16, s.height * .06),
        Paint()
          ..color = (challenge & (1 << i)) != 0 ? Colors.white : Colors.black,
      );
    }
    for (var row = 0; row < 30; row++) {
      final text = TextPainter(
        text: TextSpan(
          text:
              'WebDesk 文本滚动 / RGB color / frame $tick / row $row   0123456789',
          style: const TextStyle(color: Colors.black, fontSize: 22),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      text.paint(
        c,
        Offset(
          30,
          s.height * .26 +
              ((row * 36 - tick * 3) % (math.max(1, s.height * .74))),
        ),
      );
    }
    c.drawRect(
      Rect.fromLTWH((tick * 11) % (s.width - 300), s.height * 0.55, 300, 240),
      Paint()..color = Colors.blue,
    );
  }

  @override
  bool shouldRepaint(covariant Pattern old) => true;
}
