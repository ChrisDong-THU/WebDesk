import 'dart:async';
import 'dart:convert';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../native/desktop_bridge.dart';
import '../native/secure_capture.dart';
import '../native/system_audio.dart';
import '../protocol/input.dart';
import '../protocol/quality.dart';
import '../tools/tool_channel.dart';

class RemoteSession {
  RemoteSession({
    required this.id,
    required this.quality,
    required this.signal,
    required this.onReady,
    required this.onError,
    this.diagnostic,
  });
  final String id;
  Quality quality;
  final void Function(String, Map<String, dynamic>) signal;
  final void Function() onReady;
  final void Function(Object) onError;
  final void Function(String)? diagnostic;
  late final desktop = DesktopBridge(_fail, diagnostic: diagnostic);
  RTCPeerConnection? _pc;
  MediaStream? _stream;
  RTCRtpSender? _sender;
  RTCDataChannel? _input;
  ToolChannel? _tools;
  final _audio = SystemAudio();
  final _candidates = <RTCIceCandidate>[];
  Future<void> _settings = Future.value();
  bool _closed = false, _remoteSet = false, _ready = false;
  Timer? _status;
  bool _polling = false;
  String? _secureId;
  DateTime? _secureStarted;

  Future<void> start(List<dynamic> ice) async {
    await desktop.start();
    if (_closed) return;
    final pc = await createPeerConnection({
      'iceServers': ice,
      'sdpSemantics': 'unified-plan',
    });
    if (_closed) {
      await pc.dispose();
      return;
    }
    _pc = pc;
    pc.onIceCandidate = (candidate) {
      if (!_closed && (candidate.candidate?.isNotEmpty ?? false)) {
        signal('nativeWebRtcCandidate', {'candidate': candidate.toMap()});
      }
    };
    pc.onConnectionState = (state) {
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
      RTCDataChannelInit()
        ..ordered = false
        ..maxRetransmits = 3,
    );
    _input!.onDataChannelState = (_) => _checkReady();
    _tools = await ToolChannel.create(pc, setAudioEnabled: _audio.setEnabled);
    await _capture();
    if (_closed) return;
    _sender = await pc.addTrack(_stream!.getVideoTracks().first, _stream!);
    final audioStream = await _audio.create();
    if (_closed) return;
    // Both tracks advertise the same stream so the upstream browser video
    // receives picture and sound together. No renegotiation on audio toggles.
    await pc.addTrack(audioStream.getAudioTracks().single, _stream!);
    await _applyParameters();
    final offer = await pc.createOffer({
      'offerToReceiveAudio': false,
      'offerToReceiveVideo': false,
    });
    await pc.setLocalDescription(offer);
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
          'frameRate': quality.fps,
          'mandatory': {'frameRate': quality.fps},
        },
      });
    }
    if (_closed) {
      if (_secureId != null) await SecureCapture.stop(_secureId!);
      await _disposeStream(stream);
      return;
    }
    final old = _stream;
    if (_sender != null) {
      await _sender!.replaceTrack(stream.getVideoTracks().first);
    }
    _stream = stream;
    if (old != null) await _disposeStream(old);
    await _applyParameters();
  }

  Future<void> _queueCapture() {
    _settings = _settings.then((_) async {
      if (!_closed) await _capture();
    });
    return _settings;
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
    for (final encoding in encodings) {
      if (encoding.minBitrate == 0) encoding.minBitrate = null;
      if (encoding.scalabilityMode?.isEmpty ?? false) {
        encoding.scalabilityMode = null;
      }
      encoding.maxBitrate = quality.bitrate == 0
          ? null
          : quality.bitrate * 1000;
      encoding.maxFramerate = quality.fps;
      encoding.scaleResolutionDownBy = _secureId != null
          ? 1.0
          : (desktop.height / quality.height).clamp(1.0, 16.0).toDouble();
    }
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
          unawaited(
            desktop.request(input).catchError((Object e) {
              _fail(e);
              return input;
            }),
          );
        }
      } else if ([
        'changeMaxFramerate',
        'changeMaxBitrate',
        'changeResolutionRatio',
      ].contains(json['msgType'])) {
        final type = json['msgType'] as String;
        quality = quality.change(type, data['val']);
        _settings = _settings
            .then((_) async {
              if (_closed) return;
              if (type == 'changeMaxFramerate' ||
                  (_secureId != null && type == 'changeResolutionRatio')) {
                await _capture();
              } else {
                await _applyParameters();
              }
            })
            .catchError(_fail);
      }
    } on FormatException {
      /* Invalid messages cannot invoke native operations. */
    } catch (error) {
      _fail(error);
    }
  }

  Future<void> receive(Map data) async {
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
      await _applyParameters();
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

  static Future<void> _disposeStream(MediaStream stream) async {
    for (final track in stream.getTracks()) {
      await track.stop();
    }
    await stream.dispose();
  }

  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    _status?.cancel();
    await _audio.close();
    try {
      await desktop.release();
    } catch (_) {}
    desktop.close();
    if (_secureId != null) {
      await SecureCapture.stop(_secureId!);
      _secureId = null;
    }
    await _tools?.close();
    await _input?.close();
    await _pc?.close();
    await _pc?.dispose();
    if (_stream != null) await _disposeStream(_stream!);
    _stream = null;
  }
}
