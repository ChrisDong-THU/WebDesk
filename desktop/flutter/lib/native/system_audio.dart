import 'package:flutter/services.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../session/cleanup.dart';
// Pinned native adapter, as for SecureCapture. PCM never crosses Dart IPC.
// ignore: implementation_imports
import 'package:flutter_webrtc/src/native/media_stream_impl.dart';

class SystemAudio {
  static const _channel = MethodChannel('FlutterWebRTC.Method');
  MediaStream? _stream;
  bool _closed = false;
  Future<void> _pending = Future.value();
  Future<void>? _closing;

  Future<MediaStream> create() async {
    final data = await _channel.invokeMapMethod<String, dynamic>(
      'webdeskAudioCreate',
    );
    if (data == null) throw StateError('无法创建系统声音通道');
    final stream = MediaStreamNative(data['streamId'] as String, 'local');
    stream.setMediaTracks(data['audioTracks'], data['videoTracks']);
    _stream = stream;
    if (_closed) {
      await _dispose();
      throw StateError('会话已结束');
    }
    return stream;
  }

  Future<bool> setEnabled(bool enabled) async {
    // Serialize requests and disposal, including repeated network messages.
    final operation = _pending.then((_) async {
      if (_closed || _stream == null) throw StateError('系统声音通道未就绪');
      final result = await _channel.invokeMethod<bool>(
        'webdeskAudioSetEnabled',
        {'id': _stream!.id, 'enabled': enabled},
      );
      if (result != enabled) throw StateError('Windows 未确认声音设置');
    });
    _pending = operation.catchError((Object _) {});
    await operation;
    return enabled;
  }

  Future<void> close() {
    _closed = true;
    return _closing ??= _close();
  }

  Future<void> _close() async {
    await _pending;
    await _dispose();
  }

  Future<void> _dispose() async {
    final stream = _stream;
    _stream = null;
    if (stream == null) return;
    await cleanup({
      'native audio': () =>
          _channel.invokeMethod<void>('webdeskAudioDispose', {'id': stream.id}),
      for (final track in stream.getTracks()) 'track ${track.id}': track.stop,
      'audio stream': stream.dispose,
    });
  }
}
