import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:webdesk/session/peer_connection.dart';

class _Connection extends Fake implements RTCPeerConnection {
  bool registered = true, disposed = false, failDisposal = false;

  @override
  Future<void> dispose() async {
    expect(
      registered,
      isTrue,
      reason: 'Native channel lookup requires the peer',
    );
    if (failDisposal) throw StateError('Disposal failed');
    disposed = true;
  }

  @override
  Future<void> close() async {
    registered = false;
  }
}

void main() {
  test(
    'channels and observer are disposed before removing the native peer',
    () async {
      final connection = _Connection();
      await closePeerConnection(connection);
      expect(connection.disposed, isTrue);
      expect(connection.registered, isFalse);
    },
  );

  test('failed channel disposal still releases the native peer', () async {
    final connection = _Connection()..failDisposal = true;
    await expectLater(closePeerConnection(connection), throwsStateError);
    expect(connection.registered, isFalse);
  });
}
