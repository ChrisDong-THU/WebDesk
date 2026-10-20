import 'package:flutter_webrtc/flutter_webrtc.dart';

Future<void> closePeerConnection(RTCPeerConnection? connection) async {
  if (connection == null) return;
  try {
    // The pinned Windows plugin needs the native connection to remain in its
    // registry while dispose drains channels and detaches the event observer.
    await connection.dispose();
  } finally {
    // close removes the registry entry, including when disposal failed.
    await connection.close();
  }
}
