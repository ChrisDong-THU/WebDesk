import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:webdesk/native/desktop_bridge.dart';
import 'package:webdesk/protocol/quality.dart';
import 'package:webdesk/session/cleanup.dart';
import 'package:webdesk/session/remote_session.dart';

class Bridge extends DesktopBridge {
  Bridge(this.calls) : super((_) {});
  final List<String> calls;
  bool failRelease = false;
  @override
  Future<void> start() async {}
  @override
  Future<void> release() async {
    calls.add('release');
    if (failRelease) throw StateError('release failed');
  }

  @override
  void close() {
    calls.add('bridge');
  }
}

class Channel extends Fake implements RTCDataChannel {
  Channel(this.calls);
  final List<String> calls;
  @override
  void Function(RTCDataChannelState)? onDataChannelState;
  @override
  Future<void> close() async {
    calls.add('channel');
    throw StateError('channel failed');
  }
}

class IncomingChannel extends Fake implements RTCDataChannel {
  @override
  String get label => 'MessageChannel';
  @override
  void Function(RTCDataChannelMessage)? onMessage;
}

class VideoTrack extends Fake implements MediaStreamTrack {
  @override
  String get kind => 'video';
}

class VideoSender extends Fake implements RTCRtpSender {
  final firstWrite = Completer<void>(), release = Completer<void>();
  final caps = <int?>[];
  int active = 0, maximumActive = 0;
  @override
  MediaStreamTrack get track => VideoTrack();
  @override
  RTCRtpParameters get parameters =>
      RTCRtpParameters(encodings: [RTCRtpEncoding()]);
  @override
  Future<bool> setParameters(RTCRtpParameters parameters) async {
    active++;
    if (active > maximumActive) maximumActive = active;
    caps.add(parameters.encodings!.single.maxBitrate);
    if (!firstWrite.isCompleted) {
      firstWrite.complete();
      await release.future;
    }
    active--;
    return true;
  }
}

class MediaPeer extends Peer {
  MediaPeer(super.calls);
  final sender = VideoSender();
  @override
  Future<void> setRemoteDescription(RTCSessionDescription description) async {}
  @override
  Future<List<RTCRtpSender>> getSenders() async => [sender];
}

class Peer extends Fake implements RTCPeerConnection {
  Peer(this.calls);
  final List<String> calls;
  @override
  RTCPeerConnectionState? get connectionState =>
      RTCPeerConnectionState.RTCPeerConnectionStateDisconnected;
  @override
  void Function(RTCIceCandidate)? onIceCandidate;
  @override
  void Function(RTCPeerConnectionState)? onConnectionState;
  @override
  void Function(RTCDataChannel)? onDataChannel;
  @override
  Future<RTCDataChannel> createDataChannel(
    String label,
    RTCDataChannelInit init,
  ) async {
    if (label != 'MessageChannel') throw StateError('tools creation failed');
    return Channel(calls);
  }

  @override
  Future<void> dispose() async {
    calls.add('peer dispose');
  }

  @override
  Future<void> close() async {
    calls.add('peer close');
  }
}

void main() {
  RemoteSession session(
    Bridge bridge,
    Future<RTCPeerConnection> Function(Map<String, dynamic>) factory,
  ) => RemoteSession(
    id: 'test',
    quality: const Quality(),
    signal: (_, _) {},
    onReady: () {},
    onError: (_) {},
    desktopFactory: (_) => bridge,
    connectionFactory: factory,
  );
  test(
    'session releases later resources after multiple close failures',
    () async {
      final calls = <String>[];
      final native = Bridge(calls)..failRelease = true;
      final remote = session(native, (_) async => Peer(calls));
      await expectLater(remote.start([]), throwsStateError);
      final closing = remote.close();
      expect(identical(closing, remote.close()), isTrue);
      await expectLater(
        closing,
        throwsA(
          isA<CleanupException>().having(
            (e) => e.failures.keys,
            'failures',
            containsAll(['input release', 'input channel']),
          ),
        ),
      );
      expect(calls, [
        'release',
        'bridge',
        'channel',
        'peer dispose',
        'peer close',
      ]);
    },
  );
  test(
    'close waits for in-flight connection creation and disposes it once',
    () async {
      final calls = <String>[], gate = Completer<RTCPeerConnection>();
      final remote = session(Bridge(calls), (_) => gate.future);
      final starting = remote.start([]);
      await Future<void>.delayed(Duration.zero);
      final closing = remote.close();
      gate.complete(Peer(calls));
      await starting;
      await closing;
      expect(calls, ['peer dispose', 'peer close', 'release', 'bridge']);
      await expectLater(remote.start([]), throwsStateError);
    },
  );
  test(
    'temporary transport loss releases remote keys without closing the peer',
    () async {
      final calls = <String>[];
      final pc = Peer(calls);
      final remote = session(Bridge(calls), (_) async => pc);
      // The fixture stops startup at tools creation, after state callbacks exist.
      await expectLater(remote.start([]), throwsStateError);
      pc.onConnectionState!(
        RTCPeerConnectionState.RTCPeerConnectionStateDisconnected,
      );
      await Future<void>.delayed(Duration.zero);
      expect(calls, ['release']);
      await expectLater(remote.close(), throwsA(isA<CleanupException>()));
    },
  );
  test(
    'live quality waits for Answer parameters and teardown drains both',
    () async {
      final calls = <String>[];
      final pc = MediaPeer(calls);
      final bridge = Bridge(calls)
        ..width = 1920
        ..height = 1080;
      final remote = session(bridge, (_) async => pc);
      await expectLater(remote.start([]), throwsStateError);
      final input = IncomingChannel();
      pc.onDataChannel!(input);
      final answer = remote.receive({
        'msgType': 'nativeWebRtcAnswer',
        'data': {
          'sdp': {'type': 'answer', 'sdp': 'fixture'},
        },
      });
      await pc.sender.firstWrite.future;
      input.onMessage!(
        RTCDataChannelMessage(
          jsonEncode({
            'msgType': 'changeMaxBitrate',
            'data': {'val': 1000},
          }),
        ),
      );
      await Future<void>.delayed(Duration.zero);
      expect(
        pc.sender.caps.length,
        1,
        reason: 'get/setParameters must be one transaction',
      );
      pc.sender.release.complete();
      await answer;
      await Future<void>.delayed(Duration.zero);
      expect(pc.sender.caps, [12441600, 1000000]);
      expect(pc.sender.maximumActive, 1);
      await expectLater(remote.close(), throwsA(isA<CleanupException>()));
    },
  );
}
