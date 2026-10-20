import 'package:flutter/services.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
// Pinned plugin adapter: the public interface does not expose construction of
// a stream backed by our native source. Covered by the plugin patch manifest.
// ignore: implementation_imports
import 'package:flutter_webrtc/src/native/media_stream_impl.dart';

class SecureCapture {
  static const _channel = MethodChannel('FlutterWebRTC.Method');
  static Future<MediaStream> start(int height, int fps) async {
    final data = await _channel.invokeMapMethod<String, dynamic>(
      'webdeskSecureStart',
      {'height': height, 'fps': fps.clamp(1, 30)},
    );
    if (data == null) throw StateError('安全桌面采集启动失败');
    final stream = MediaStreamNative(data['streamId'] as String, 'local');
    stream.setMediaTracks(data['audioTracks'], data['videoTracks']);
    return stream;
  }

  static Future<void> stop(String id) =>
      _channel.invokeMethod('webdeskSecureStop', {'id': id});
  static Future<bool> healthy(String id) async =>
      await _channel.invokeMethod<bool>('webdeskSecureStatus', {'id': id}) ??
      false;
}
