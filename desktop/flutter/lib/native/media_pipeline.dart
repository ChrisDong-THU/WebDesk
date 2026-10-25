import 'package:flutter/services.dart';

/// Narrow native diagnostics. Neither pixels nor native resource handles cross
/// this boundary. Capability is distinct from the encoder selected by a session.
class MediaNative {
  static const _channel = MethodChannel('FlutterWebRTC.Method');

  static Future<Map<String, dynamic>> capabilities() async {
    Map<String, dynamic> value = {};
    for (var attempt = 0; attempt < 15; attempt++) {
      value =
          await _channel.invokeMapMethod<String, dynamic>(
            'webdeskMediaCapabilities',
          ) ??
          {};
      if (value['probeComplete'] != false) return value;
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
    return value;
  }

  static Future<Map<String, dynamic>> captureStats(String trackId) async =>
      await _channel.invokeMapMethod<String, dynamic>('webdeskCaptureStats', {
        'trackId': trackId,
      }) ??
      {};

  static Future<bool> setNativeTexture(String trackId, bool enabled) async =>
      await _channel.invokeMethod<bool>('webdeskSetNativeTexture', {
        'trackId': trackId,
        'enabled': enabled,
      }) ??
      false;
}
