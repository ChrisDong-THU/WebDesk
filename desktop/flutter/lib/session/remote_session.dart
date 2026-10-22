import 'dart:async';
import 'dart:convert';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../native/desktop_bridge.dart';
import '../native/secure_capture.dart';
import '../native/system_audio.dart';
import '../protocol/input.dart';
import '../protocol/quality.dart';
import '../tools/tool_channel.dart';
import 'peer_connection.dart';
import 'cleanup.dart';
import 'input_queue.dart';
import 'media_stats.dart';
import 'serial_operations.dart';
import 'video_policy.dart';
import 'video_codecs.dart';

class RemoteSession {
  RemoteSession({
    required this.id,
    required this.quality,
    required this.signal,
    required this.onReady,
    required this.onError,
    this.diagnostic,
    this.desktopFactory,
    this.connectionFactory,
  });
  final String id;
  Quality quality;
  final void Function(String, Map<String, dynamic>) signal;
  final void Function() onReady;
  final void Function(Object) onError;
  final void Function(String)? diagnostic;
  final DesktopBridge Function(void Function(Object))? desktopFactory;
  final Future<RTCPeerConnection> Function(Map<String, dynamic>)?
  connectionFactory;
  late final desktop =
      desktopFactory?.call(_fail) ??
      DesktopBridge(_fail, diagnostic: diagnostic);
  late final _inputs = InputQueue((bytes) async {
    await desktop.request(bytes);
  }, _fail);
  RTCPeerConnection? _pc;
  MediaStream? _stream;
  RTCRtpSender? _sender;
  RTCDataChannel? _input;
  ToolChannel? _tools;
  final _audio = SystemAudio();
  final _candidates = <RTCIceCandidate>[];
  final _settings = SerialOperations();
  Future<void>? _starting, _closing;
  Future<void> _signals = Future.value();
  final _mediaStats = MediaStats();
  Future<Map<String, dynamic>>? _sampling;
  DateTime? _sampledAt;
  bool _samplingPending = false;
  bool _closed = false, _remoteSet = false, _ready = false;
  Timer? _status;
  bool _polling = false;
  String? _secureId;
  DateTime? _secureStarted;

  Future<void> start(List<dynamic> ice) {
    if (_closed) return Future.error(StateError('会话已结束'));
    return _starting ??= _start(ice);
  }

  Future<void> _start(List<dynamic> ice) async {
    await desktop.start();
    if (_closed) return;
    final pc = await (connectionFactory ?? createPeerConnection)({
      'iceServers': ice,
      'sdpSemantics': 'unified-plan',
    });
    if (_closed) {
      await closePeerConnection(pc);
      return;
    }
    _pc = pc;
    pc.onIceCandidate = (candidate) {
      if (!_closed && (candidate.candidate?.isNotEmpty ?? false)) {
        signal('nativeWebRtcCandidate', {'candidate': candidate.toMap()});
      }
    };
    pc.onConnectionState = (state) {
      if (_closed) return;
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
        // A missed key-up must not leave keys held while ICE recovers.
        unawaited(desktop.release().catchError(_fail));
      }
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateFailed) {
        _fail(StateError('远程连接失败'));
      }
      _checkReady();
    };
    pc.onDataChannel = (channel) {
      if (channel.label == 'MessageChannel') {
        channel.onMessage = _message;
      } else {
        channel.close();
      }
    };
    _input = await pc.createDataChannel(
      'MessageChannel',
      RTCDataChannelInit()..ordered = true,
    );
    if (_closed) return;
    _input!.onDataChannelState = (_) => _checkReady();
    _tools = await ToolChannel.create(
      pc,
      setAudioEnabled: _audio.setEnabled,
      getMediaStats: _getMediaStats,
    );
    if (_closed) return;
    await _capture();
    if (_closed) return;
    _sender = await pc.addTrack(_stream!.getVideoTracks().first, _stream!);
    if (_closed) return;
    final audioStream = await _audio.create();
    if (_closed) return;
    // Both tracks advertise the same stream so the upstream browser video
    // receives picture and sound together. No renegotiation on audio toggles.
    await pc.addTrack(audioStream.getAudioTracks().single, _stream!);
    if (_closed) return;
    try {
      await preferDesktopCodecs(pc);
    } catch (error) {
      // Optional preference support must not prevent a compatible connection.
      diagnostic?.call(
        'Codec preference unavailable; using platform order: $error',
      );
    }
    if (_closed) return;
    await _applyParameters();
    final offer = await pc.createOffer({
      'offerToReceiveAudio': false,
      'offerToReceiveVideo': false,
    });
    await pc.setLocalDescription(offer);
    if (_closed) return;
    if (!_closed) signal('nativeWebRtcOffer', {'sdp': offer.toMap()});
    _status = Timer.periodic(const Duration(milliseconds: 500), (_) async {
      if (_polling || _closed) return;
      _polling = true;
      try {
        final previous = desktop.secure;
        await desktop.status();
        if (!_closed && previous != desktop.secure) await _queueCapture();
        if (!_closed &&
            _secureId != null &&
            DateTime.now().difference(_secureStarted!).inSeconds > 10 &&
            !await SecureCapture.healthy(_secureId!)) {
          throw StateError('安全桌面采集停止');
        }
      } catch (error) {
        if (!_closed) _fail(error);
      } finally {
        _polling = false;
      }
    });
  }

  Future<void> _capture() async {
    // Normal desktop uses libwebrtc's native desktop capturer. Secure-desktop
    // capture is supplied by the narrow native source adapter, not a canvas.
    final oldSecure = _secureId;
    if (oldSecure != null) {
      await SecureCapture.stop(oldSecure);
      _secureId = null;
    }
    MediaStream stream;
    if (desktop.secure) {
      stream = await SecureCapture.start(quality.height, quality.fps);
      _secureId = stream.id;
      _secureStarted = DateTime.now();
    } else {
      final sources = await desktopCapturer.getSources(
        types: [SourceType.Screen],
      );
      if (_closed) return;
      if (sources.isEmpty) throw StateError('未找到可采集的显示器');
      stream = await navigator.mediaDevices.getDisplayMedia({
        'audio': false,
        'video': {
          'deviceId': {'exact': sources.first.id},
          // Match billd-desk: do not composite the host cursor into the video.
          'cursor': 'never',
          'frameRate': quality.fps,
          'mandatory': {'frameRate': quality.fps},
        },
      });
    }
    if (_closed) {
      await cleanup({
        'cancelled secure capture': () async {
          if (_secureId != null) await SecureCapture.stop(_secureId!);
          _secureId = null;
        },
        'cancelled stream': () => _disposeStream(stream),
      });
      return;
    }
    final old = _stream;
    try {
      if (_sender != null) {
        await _sender!.replaceTrack(stream.getVideoTracks().first);
      }
    } catch (_) {
      await _disposeStream(stream);
      rethrow;
    }
    _stream = stream;
    if (old != null) await _disposeStream(old);
    await _applyParameters();
  }

  Future<void> _queueCapture() {
    return _settings.run(() async {
      if (!_closed) await _capture();
    });
  }

  Future<void> _applyParameters() async {
    if (!_remoteSet || _closed) return;
    final senders = await _pc?.getSenders() ?? [];
    final sender = senders
        .where((item) => item.track?.kind == 'video')
        .firstOrNull;
    if (sender == null || _closed) return;
    final parameters = sender.parameters;
    final encodings = parameters.encodings;
    if (encodings == null || encodings.isEmpty) return;
    configureVideoParameters(
      parameters,
      quality,
      desktop.width,
      desktop.height,
      secure: _secureId != null,
    );
    if (!await sender.setParameters(parameters)) throw StateError('无法应用画质设置');
  }

  void _message(RTCDataChannelMessage message) {
    if (_closed || message.isBinary || message.text.length > 8192) return;
    try {
      final json = jsonDecode(message.text) as Map;
      final data = json['data'] as Map;
      if (json['msgType'] == 'billdDeskBehavior') {
        final input = encodeBehavior(data, desktop.width, desktop.height);
        if (input != null) {
          _inputs.add(input, move: data['type'] == 0);
        }
      } else if ([
        'changeMaxFramerate',
        'changeMaxBitrate',
        'changeResolutionRatio',
        'changeVideoContentHint',
      ].contains(json['msgType'])) {
        final type = json['msgType'] as String;
        quality = quality.change(type, data['val']);
        unawaited(
          _settings
              .run(() async {
                if (_closed) return;
                if (type == 'changeMaxFramerate' ||
                    (_secureId != null && type == 'changeResolutionRatio')) {
                  await _capture();
                } else {
                  await _applyParameters();
                }
              })
              .catchError(_fail),
        );
      }
    } on FormatException {
      /* Invalid messages cannot invoke native operations. */
    } catch (error) {
      _fail(error);
    }
  }

  Future<void> receive(Map data) {
    final operation = _signals.then((_) => _receive(data));
    _signals = operation.catchError((Object _) {});
    return operation;
  }

  Future<void> _receive(Map data) async {
    if (_closed) return;
    final pc = _pc;
    if (pc == null) throw StateError('媒体连接未就绪');
    final payload = data['data'] as Map;
    if (data['msgType'] == 'nativeWebRtcAnswer') {
      final sdp = payload['sdp'] as Map;
      await pc.setRemoteDescription(
        RTCSessionDescription(sdp['sdp'] as String, sdp['type'] as String),
      );
      _remoteSet = true;
      await _settings.run(_applyParameters);
      for (final candidate in _candidates) {
        await pc.addCandidate(candidate);
      }
      _candidates.clear();
    } else if (data['msgType'] == 'nativeWebRtcCandidate') {
      final value = payload['candidate'] as Map;
      final candidate = RTCIceCandidate(
        value['candidate'] as String?,
        value['sdpMid'] as String?,
        value['sdpMLineIndex'] as int?,
      );
      if (_remoteSet) {
        await pc.addCandidate(candidate);
      } else if (_candidates.length < 256) {
        _candidates.add(candidate);
      }
    }
  }

  void _checkReady() {
    if (_closed || _ready) return;
    if (_pc?.connectionState ==
            RTCPeerConnectionState.RTCPeerConnectionStateConnected &&
        _input?.state == RTCDataChannelState.RTCDataChannelOpen) {
      _ready = true;
      onReady();
    }
  }

  void _fail(Object error) {
    if (!_closed) onError(error);
  }

  Future<Map<String, dynamic>> _getMediaStats() {
    if (_closed || _pc == null) return Future.error(StateError('会话已结束'));
    if (_sampling == null ||
        (!_samplingPending &&
            DateTime.now().difference(_sampledAt!).inMilliseconds >= 1000)) {
      _samplingPending = true;
      _sampledAt = DateTime.now();
      _sampling = _pc!
          .getStats()
          .then(
            (reports) => {
              ..._mediaStats.sample(reports),
              'capture': _secureId == null ? 'desktop' : 'secure',
            },
          )
          .whenComplete(() => _samplingPending = false);
    }
    return _sampling!;
  }

  static Future<void> _disposeStream(MediaStream stream) => cleanup({
    for (final track in stream.getTracks()) 'track ${track.id}': track.stop,
    'stream ${stream.id}': stream.dispose,
  });

  Future<void> close() {
    if (_closing != null) return _closing!;
    _closed = true;
    _status?.cancel();
    return _closing = _close();
  }

  Future<void> _close() async {
    // Set _closed first; in-flight creators either publish an owned resource or
    // dispose it themselves. Drain them before taking the final resource set.
    for (final operation in [_starting, _signals, _settings.settled]) {
      try {
        await operation;
      } catch (_) {
        /* Reported by the operation owner. */
      }
    }
    await cleanup({
      'audio': _audio.close,
      'input queue': _inputs.close,
      'input release': desktop.release,
      'desktop bridge': desktop.close,
      'secure capture': () async {
        if (_secureId != null) await SecureCapture.stop(_secureId!);
        _secureId = null;
      },
      'tools': () async {
        await _tools?.close();
      },
      'input channel': () async {
        await _input?.close();
      },
      'media statistics': () async {
        try {
          await _sampling;
        } catch (_) {}
      },
      'peer connection': () => closePeerConnection(_pc),
      'video stream': () async {
        if (_stream != null) await _disposeStream(_stream!);
        _stream = null;
      },
    });
  }
}
