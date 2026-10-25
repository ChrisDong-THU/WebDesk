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

class MediaPeer extends RecoveryPeer {
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

class RecoveryPeer extends Peer {
  RecoveryPeer(super.calls);
  final remoteDescriptions = <RTCSessionDescription>[];
  final localDescriptions = <RTCSessionDescription>[];
  final candidates = <RTCIceCandidate>[];
  final offers = <Map<String, dynamic>>[];
  Completer<void>? offerGate;
  int restarts = 0;
  @override
  Future<void> restartIce() async {
    restarts++;
  }

  @override
  Future<RTCSessionDescription> createOffer([
    Map<String, dynamic>? constraints,
  ]) async {
    offers.add(constraints ?? {});
    await offerGate?.future;
    return RTCSessionDescription(
      'v=0\r\na=ice-ufrag:local$restarts\r\n',
      'offer',
    );
  }

  @override
  Future<void> setLocalDescription(RTCSessionDescription description) async {
    localDescriptions.add(description);
  }

  @override
  Future<void> setRemoteDescription(RTCSessionDescription description) async {
    remoteDescriptions.add(description);
  }

  @override
  Future<List<RTCRtpSender>> getSenders() async => [];
  @override
  Future<void> addCandidate(RTCIceCandidate candidate) async {
    candidates.add(candidate);
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
    'close during an ICE offer drains it without sending SDP or reopening resources',
    () async {
      final calls = <String>[], signals = <Map<String, dynamic>>[];
      final pc = RecoveryPeer(calls)..offerGate = Completer<void>();
      final remote = RemoteSession(
        id: 'closing',
        quality: const Quality(),
        signal: (_, data) => signals.add(data),
        onReady: () {},
        onError: (_) {},
        desktopFactory: (_) => Bridge(calls),
        connectionFactory: (_) async => pc,
      );
      await expectLater(remote.start([]), throwsStateError);
      pc.onConnectionState!(
        RTCPeerConnectionState.RTCPeerConnectionStateFailed,
      );
      await Future<void>.delayed(Duration.zero);
      expect(pc.offers, hasLength(1));
      final closing = remote.close();
      pc.offerGate!.complete();
      await expectLater(closing, throwsA(isA<CleanupException>()));
      expect(signals, isEmpty);
      expect(pc.localDescriptions, isEmpty);
      expect(calls.where((call) => call == 'peer close'), hasLength(1));
    },
  );
  test(
    'ICE restarts retain the peer and reject stale Answers and candidates',
    () async {
      final calls = <String>[];
      final pc = RecoveryPeer(calls), bridge = Bridge(calls);
      final signals = <Map<String, dynamic>>[];
      final remote = RemoteSession(
        id: 'recovery',
        quality: const Quality(),
        signal: (_, payload) => signals.add(payload),
        onReady: () {},
        onError: (_) {},
        desktopFactory: (_) => bridge,
        connectionFactory: (_) async => pc,
      );
      Map<String, dynamic> answer(String ufrag, [int? id]) => {
        'msgType': 'nativeWebRtcAnswer',
        'data': {
          'sdp': {'sdp': 'v=0\r\na=ice-ufrag:$ufrag\r\n', 'type': 'answer'},
          'negotiationId': ?id,
        },
      };
      Map<String, dynamic> candidate(String? ufrag) => {
        'msgType': 'nativeWebRtcCandidate',
        'data': {
          'candidate': {
            'candidate': 'candidate:1 1 udp 1 127.0.0.1 99 typ host',
            'sdpMid': '0',
            'sdpMLineIndex': 0,
            'usernameFragment': ?ufrag,
          },
        },
      };
      // Startup stops after callbacks, before capture/native audio is required.
      await expectLater(remote.start([]), throwsStateError);
      await remote.receive(answer('unsolicited', 0));
      expect(pc.remoteDescriptions, isEmpty);
      pc.onConnectionState!(
        RTCPeerConnectionState.RTCPeerConnectionStateFailed,
      );
      await Future<void>.delayed(Duration.zero);
      expect(pc.restarts, 1);
      expect(signals.single['negotiationId'], 1);
      await remote.receive(candidate('old'));
      await remote.receive(answer('old', 1));
      expect(pc.candidates, hasLength(1));
      pc.onConnectionState!(
        RTCPeerConnectionState.RTCPeerConnectionStateConnected,
      );
      pc.onConnectionState!(
        RTCPeerConnectionState.RTCPeerConnectionStateFailed,
      );
      await Future<void>.delayed(Duration.zero);
      expect(pc.restarts, 2);
      expect(pc.offers.last['iceRestart'], isTrue);
      expect(signals.last['negotiationId'], 2);
      expect(calls, [
        'release',
        'release',
      ], reason: 'recovery retains the peer/channel');
      await remote.receive(candidate('new'));
      expect(pc.candidates, hasLength(1));
      await remote.receive(answer('stale', 1));
      await remote.receive(answer('missing-id'));
      expect(pc.remoteDescriptions, hasLength(1));
      await remote.receive(answer('new', 2));
      expect(pc.remoteDescriptions, hasLength(2));
      expect(
        pc.candidates,
        hasLength(2),
        reason: 'future generation is buffered until its Answer',
      );
      await remote.receive(candidate('old'));
      expect(pc.candidates, hasLength(2));
      pc.onConnectionState!(
        RTCPeerConnectionState.RTCPeerConnectionStateConnected,
      );
      pc.onConnectionState!(
        RTCPeerConnectionState.RTCPeerConnectionStateFailed,
      );
      await Future<void>.delayed(Duration.zero);
      expect(pc.restarts, 3);
      expect(signals.last['negotiationId'], 3);
      await remote.receive(answer('late', 2));
      await remote.receive(candidate(null));
      expect(pc.remoteDescriptions, hasLength(2));
      expect(pc.candidates, hasLength(2));
      await expectLater(remote.close(), throwsA(isA<CleanupException>()));
    },
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
      pc.onConnectionState!(
        RTCPeerConnectionState.RTCPeerConnectionStateFailed,
      );
      await Future<void>.delayed(Duration.zero);
      final input = IncomingChannel();
      pc.onDataChannel!(input);
      final answer = remote.receive({
        'msgType': 'nativeWebRtcAnswer',
        'data': {
          'sdp': {'type': 'answer', 'sdp': 'fixture'},
          'negotiationId': 1,
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
