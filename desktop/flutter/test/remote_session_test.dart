import 'dart:async';
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

class Peer extends Fake implements RTCPeerConnection {
  Peer(this.calls);
  final List<String> calls;
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
}
