import 'dart:async';
import 'dart:convert';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../native/desktop_bridge.dart';
import '../native/secure_capture.dart';
import '../native/system_audio.dart';
import '../native/media_pipeline.dart';
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
import 'adaptive_video.dart';
import 'media_recovery.dart';
import 'capture_recovery.dart';
import 'native_texture_policy.dart';
import 'codec_selection.dart';

class _PendingCandidate {
  _PendingCandidate(this.candidate, this.ufrag);
  final RTCIceCandidate candidate;
  final String? ufrag;
}

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
  final _candidates = <_PendingCandidate>[];
  Set<String> _remoteUfrags = {};
  final _retiredUfrags = <String>{};
  int _negotiationId = 0;
  final _settings = SerialOperations();
  Future<void>? _starting, _closing;
  Future<void> _signals = Future.value();
  final _mediaStats = MediaStats();
  final _adaptiveVideo = AdaptiveVideoPolicy();
  final _captureRecovery = CaptureRecoveryPolicy();
  final _texturePolicy = NativeTexturePolicy();
  final _codecSelection = CodecSelection();
  bool _codecDirty = false;
  int _codecRevision = 0;
  int? _captureWidth, _captureHeight;
  late final _recovery = MediaRecovery(
    restart: _restartTransport,
    onExhausted: _fail,
  );
  bool _awaitingAnswer = false, _monitoring = false;
  bool _hardwareH264 = false, _earlyScaling = false;
  bool _codecPreferenceApplied = false;
  bool _nativeTextureAllowed = true;
  Timer? _mediaMonitor;
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
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected ||
          state == RTCPeerConnectionState.RTCPeerConnectionStateFailed) {
        // A missed key-up must not leave keys held while ICE recovers.
        unawaited(desktop.release().catchError(_fail));
        _recovery.disconnected(
          failed: state == RTCPeerConnectionState.RTCPeerConnectionStateFailed,
        );
      }
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
        _recovery.connected();
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
    try {
      final capabilities = await MediaNative.capabilities();
      _hardwareH264 = capabilities['hardwareH264'] == true;
      _earlyScaling = capabilities['earlyScaling'] == true;
      // Unknown/software encoding does not benefit from a texture that must
      // synchronously read back into I420. Wire codec is selected separately.
      _nativeTextureAllowed = _hardwareH264;
    } catch (error) {
      diagnostic?.call('Native media probe unavailable: $error');
    }
    if (_closed) return;
    try {
      final capabilities = await getRtpSenderCapabilities('video');
      _codecSelection.initialize(
        (capabilities.codecs ?? []).map((c) => c.mimeType),
        quality,
        DateTime.now(),
        hardware: _hardwareH264,
      );
      _nativeTextureAllowed =
          _hardwareH264 && _codecSelection.order.firstOrNull == 'video/h264';
    } catch (error) {
      diagnostic?.call('Codec capabilities unavailable: $error');
    }
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
      _codecPreferenceApplied = await preferDesktopCodecs(
        pc,
        order: _codecSelection.order,
      );
    } catch (error) {
      // Optional preference support must not prevent a compatible connection.
      diagnostic?.call(
        'Codec preference unavailable; using platform order: $error',
      );
    }
    if (_closed) return;
    await _applyParameters();
    await _queueSignal(() => _offer());
    if (_closed) return;
    _mediaMonitor = Timer.periodic(const Duration(seconds: 2), (_) {
      unawaited(_monitorMedia());
    });
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
          'frameRate': quality.fps.clamp(1, 60),
          'webdeskMaxHeight': quality.height,
          'webdeskNativeTexture': _nativeTextureAllowed,
          'mandatory': {'frameRate': quality.fps.clamp(1, 60)},
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
      _codecSelection.captureChanged(DateTime.now());
    } catch (_) {
      await _disposeStream(stream);
      rethrow;
    }
    _stream = stream;
    _captureWidth = _captureHeight = null;
    final settings = stream.getVideoTracks().first.getSettings();
    _updateCaptureDimensions(settings['width'], settings['height']);
    if (_secureId == null && _earlyScaling) {
      final size = captureOutputSize(
        _captureWidth ?? desktop.width,
        _captureHeight ?? desktop.height,
        quality.height,
      );
      _captureWidth = size.width;
      _captureHeight = size.height;
    }
    _captureRecovery.started(DateTime.now());
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
      _captureWidth ?? desktop.width,
      _captureHeight ?? desktop.height,
      secure: _secureId != null,
      adaptation: _adaptiveVideo.current,
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
      } else if (json['msgType'] == 'mediaReceiverStats') {
        _codecSelection.receiverFeedback(data, DateTime.now());
      } else if ([
        'changeMaxFramerate',
        'changeMaxBitrate',
        'changeResolutionRatio',
        'changeVideoContentHint',
        'changeDegradationPreference',
        'changeNetworkMode',
        'changeVideoCodec',
      ].contains(json['msgType'])) {
        final type = json['msgType'] as String;
        quality = quality.change(type, data['val']);
        if (_codecSelection.configure(quality, DateTime.now())) {
          _codecDirty = true;
          _codecRevision++;
        }
        _adaptiveVideo.reset();
        unawaited(
          _settings
              .run(() async {
                if (_closed) return;
                if (type == 'changeMaxFramerate' ||
                    type == 'changeResolutionRatio') {
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
    return _queueSignal(() => _receive(data));
  }

  Future<void> _queueSignal(Future<void> Function() action) {
    final operation = _signals.then((_) => action());
    _signals = operation.catchError((Object _) {});
    return operation;
  }

  Future<void> _offer({bool restart = false}) async {
    final pc = _pc;
    if (_closed || pc == null) return;
    if (_awaitingAnswer) {
      if (!restart) return;
      // A lost Answer must not leave the next ICE attempt in have-local-offer.
      // A platform without rollback exhausts the bounded recovery, rather than
      // creating overlapping offers or rebuilding audio/tool channels.
      await pc.setLocalDescription(RTCSessionDescription('', 'rollback'));
      if (_closed) return;
      _awaitingAnswer = false;
    }
    if (restart) await pc.restartIce();
    if (_closed) return;
    final offer = await pc.createOffer({
      'offerToReceiveAudio': false,
      'offerToReceiveVideo': false,
      if (restart) 'iceRestart': true,
    });
    if (_closed) return;
    await pc.setLocalDescription(offer);
    if (_closed) return;
    _awaitingAnswer = true;
    _negotiationId++;
    signal('nativeWebRtcOffer', {
      'sdp': offer.toMap(),
      'negotiationId': _negotiationId,
    });
  }

  Future<void> _restartTransport() => _queueSignal(() async {
    if (_closed) return;
    diagnostic?.call('ICE recovery: restarting existing peer');
    await _offer(restart: true);
  });

  Future<void> _monitorMedia() async {
    if (_closed || _monitoring || !_remoteSet || _recovery.recovering) return;
    _monitoring = true;
    try {
      final stats = await _getMediaStats();
      if (_closed) return;
      if (_secureId == null &&
          stats['captureTrackId'] ==
              _stream?.getVideoTracks().firstOrNull?.id) {
        if (_texturePolicy.sample(stats, quality.fps)) {
          final trackId = stats['captureTrackId'] as String;
          final switched = await MediaNative.setNativeTexture(trackId, false);
          if (_closed) return;
          if (switched) {
            _nativeTextureAllowed = false;
            _codecSelection.captureChanged(DateTime.now());
            diagnostic?.call(
              'Costly texture readback; using CPU early scaling '
              'on the existing video track',
            );
            // Observe the new path before adapting quality from old costs.
            return;
          }
        }
        if (_captureRecovery.sample(stats, DateTime.now())) {
          diagnostic?.call(
            'Capture stalled; rebuilding video track '
            '(attempt ${_captureRecovery.attempts})',
          );
          await _queueCapture();
          return;
        }
        if (_captureRecovery.exhausted) {
          _fail(StateError('屏幕采集恢复失败'));
          return;
        }
      }
      final changed = _adaptiveVideo.sample(stats, quality, DateTime.now());
      if (changed) {
        diagnostic?.call(
          'Video adaptation: ${_adaptiveVideo.current.reason} '
          'cpu=${_adaptiveVideo.current.cpuSteps} '
          'network=${_adaptiveVideo.current.networkSteps}',
        );
        await _settings.run(_applyParameters);
      }
      if (_closed || _awaitingAnswer) return;
      // Codec selection owns cross-codec decisions; quality adaptation above
      // owns frame/bitrate budgets. Neither treats a hardware flag as speed.
      if (_codecSelection.sample(stats, quality, DateTime.now())) {
        _codecDirty = true;
        _codecRevision++;
      }
      if (_codecDirty) {
        await _queueSignal(() async {
          if (_closed || _awaitingAnswer || _recovery.recovering) return;
          final revision = _codecRevision;
          if (_nativeTextureAllowed &&
              _codecSelection.order.firstOrNull != 'video/h264' &&
              _secureId == null) {
            final trackId = _stream?.getVideoTracks().firstOrNull?.id;
            if (trackId != null &&
                await MediaNative.setNativeTexture(trackId, false)) {
              _nativeTextureAllowed = false;
              _codecSelection.captureChanged(DateTime.now());
            }
          }
          if (_closed) return;
          _codecPreferenceApplied = await preferDesktopCodecs(
            _pc!,
            order: _codecSelection.order,
          );
          if (!_closed) {
            await _offer();
            if (revision == _codecRevision) _codecDirty = false;
          }
        });
      }
    } catch (error) {
      // Optional metrics/preferences must never terminate a healthy session.
      diagnostic?.call('Video adaptation unavailable: $error');
    } finally {
      _monitoring = false;
    }
  }

  Future<void> _receive(Map data) async {
    if (_closed) return;
    final pc = _pc;
    if (pc == null) throw StateError('媒体连接未就绪');
    final payload = data['data'] as Map;
    if (data['msgType'] == 'nativeWebRtcAnswer') {
      final negotiationId = payload['negotiationId'];
      // A delayed or unnumbered Answer must never mutate a negotiation.
      if (negotiationId is! int ||
          negotiationId < 1 ||
          negotiationId != _negotiationId ||
          !_awaitingAnswer) {
        return;
      }
      final sdp = payload['sdp'] as Map;
      await pc.setRemoteDescription(
        RTCSessionDescription(sdp['sdp'] as String, sdp['type'] as String),
      );
      if (_closed) return;
      _remoteSet = true;
      _codecSelection.acceptAnswer(sdp['sdp'] as String);
      _awaitingAnswer = false;
      final nextUfrags = RegExp(r'^a=ice-ufrag:([^\r\n]+)', multiLine: true)
          .allMatches(sdp['sdp'] as String)
          .map((match) => match.group(1)!.trim())
          .toSet();
      _retiredUfrags.addAll(_remoteUfrags.difference(nextUfrags));
      while (_retiredUfrags.length > 32) {
        _retiredUfrags.remove(_retiredUfrags.first);
      }
      _remoteUfrags = nextUfrags;
      await _settings.run(_applyParameters);
      for (final candidate in _candidates) {
        if (_closed) return;
        if ((candidate.ufrag == null && _negotiationId <= 1) ||
            _remoteUfrags.contains(candidate.ufrag)) {
          await pc.addCandidate(candidate.candidate);
        }
      }
      _candidates.removeWhere(
        (candidate) =>
            candidate.ufrag == null ||
            _remoteUfrags.contains(candidate.ufrag) ||
            _retiredUfrags.contains(candidate.ufrag),
      );
    } else if (data['msgType'] == 'nativeWebRtcCandidate') {
      final value = payload['candidate'] as Map;
      final candidate = RTCIceCandidate(
        value['candidate'] as String?,
        value['sdpMid'] as String?,
        value['sdpMLineIndex'] as int?,
      );
      final ufrag =
          value['usernameFragment'] as String? ??
          RegExp(
            r'(?:^|\s)ufrag\s+(\S+)',
          ).firstMatch(candidate.candidate ?? '')?.group(1);
      if (_retiredUfrags.contains(ufrag) ||
          (ufrag == null && _negotiationId > 1)) {
        return;
      }
      if (_remoteSet && (ufrag == null || _remoteUfrags.contains(ufrag))) {
        await pc.addCandidate(candidate);
      } else if (_candidates.length < 256) {
        _candidates.add(_PendingCandidate(candidate, ufrag));
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

  void _updateCaptureDimensions(dynamic width, dynamic height) {
    if (width is num &&
        width.isFinite &&
        width > 0 &&
        height is num &&
        height.isFinite &&
        height > 0) {
      _captureWidth = width.round();
      _captureHeight = height.round();
    }
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
          .then((reports) async {
            final track = _stream?.getVideoTracks().firstOrNull;
            Map<String, dynamic> capture = {};
            if (_secureId == null && track != null && !_closed) {
              try {
                capture = await MediaNative.captureStats(
                  track.id!,
                ).timeout(const Duration(seconds: 2));
                if (!_closed &&
                    _stream?.getVideoTracks().firstOrNull == track) {
                  final width = _captureWidth, height = _captureHeight;
                  _updateCaptureDimensions(
                    capture['outputWidth'],
                    capture['outputHeight'],
                  );
                  if (width != _captureWidth || height != _captureHeight) {
                    await _settings.run(_applyParameters);
                  }
                } else {
                  capture = {};
                }
              } catch (_) {
                // Diagnostics are optional on older native hosts.
              }
            }
            return {
              ..._mediaStats.sample(reports),
              ...capture,
              'capture': _secureId == null ? 'desktop' : 'secure',
              'captureTrackId': track?.id,
              'adaptationReason': _adaptiveVideo.current.reason,
              'cpuSteps': _adaptiveVideo.current.cpuSteps,
              'networkSteps': _adaptiveVideo.current.networkSteps,
              'degradationPreference': effectiveDegradationPreference(quality),
              'networkMode': quality.networkMode,
              'recoveryAttempts': _recovery.attempts,
              'captureRecoveryAttempts': _captureRecovery.attempts,
              'codecPolicy': 'adaptive-v1',
              'codecPreference': quality.codecPreference,
              'codecOrder': _codecSelection.order,
              'codecDecision': _codecSelection.reason,
              'codecSwitches': _codecSelection.switches,
              'codecTrials': _codecSelection.attempts,
              'codecCooldownMs': _codecSelection.cooldownMs(DateTime.now()),
              'supportedCodecs': _codecSelection.supported,
              'codecPreferenceApplied': _codecPreferenceApplied,
              'hardwareH264Available': _hardwareH264,
            };
          })
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
    _mediaMonitor?.cancel();
    _recovery.close();
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
