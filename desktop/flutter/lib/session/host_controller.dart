import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../native/desktop_bridge.dart';
import '../protocol/quality.dart';
import 'host_preferences.dart';
import 'remote_session.dart';

enum HostPhase { disabled, enabling, listening, stopping, disposed }

class HostController extends ChangeNotifier {
  static const lifecycle = MethodChannel('webdesk/lifecycle');
  bool _suspended = false, _disposed = false;
  final void Function(String)? diagnostic;
  final HostPreferences _preferences;
  final Future<void> Function() _ensureDesktop;
  bool _regenerating = false, _persist = true;
  HostController({
    this.diagnostic,
    HostPreferences? preferences,
    Future<void> Function()? ensureDesktop,
  }) : _preferences = preferences ?? HostPreferences(),
       _ensureDesktop = ensureDesktop ?? DesktopBridge.ensure {
    lifecycle.setMethodCallHandler((call) async {
      if (call.method == 'suspend') {
        _suspended = true;
        _retry?.cancel();
        final socket = _socket;
        final ending = _end(true);
        socket?.disconnect();
        await ending;
      } else if (call.method == 'resume') {
        _suspended = false;
        if (enabled) _socket?.connect();
      }
    });
  }
  String server = 'https://120.55.241.162',
      device = '',
      password = '',
      error = '';
  HostPhase _phase = HostPhase.disabled;
  HostPhase get phase => _phase;
  bool get enabled => _phase == HostPhase.listening;
  bool _busy = false, connected = false;
  bool get busy => _busy || _phase == HostPhase.stopping;
  set busy(bool value) => _busy = value;
  Future<void>? _stopping;
  Future<void> _cleanup = Future.value();
  io.Socket? _socket;
  RemoteSession? _session;
  int _generation = 0;
  Timer? _retry;
  Future<void> _signals = Future.value();
  final _pending = <Map>[];
  bool _starting = false;
  bool get connectingBrowser => _session != null && !connected;
  Future<void> load() async {
    try {
      await _preferences.load();
      if (_disposed) return;
      if (!busy && !enabled) {
        server = _preferences.server ?? server;
        final saved = _preferences.credentials;
        if (saved != null) {
          device = saved.device;
          password = saved.password;
        }
      }
    } catch (cause) {
      error = '无法读取本机连接信息：$cause';
    }
    if (!_disposed) notifyListeners();
  }

  Future<void> enable(String value, {bool persist = true}) async {
    if (_disposed || busy || enabled || _regenerating) return;
    _phase = HostPhase.enabling;
    busy = true;
    error = '';
    notifyListeners();
    final generation = ++_generation;
    try {
      final uri = Uri.parse(value.trim());
      if (!['http', 'https'].contains(uri.scheme) ||
          uri.host.isEmpty ||
          uri.userInfo.isNotEmpty) {
        throw const FormatException('请输入有效的服务地址');
      }
      server = uri.origin;
      _persist = persist;
      HostCredentials? credentials;
      if (persist) {
        await _preferences.load();
        credentials = _preferences.credentials;
      }
      credentials ??= device.isNotEmpty
          ? HostCredentials(device, password)
          : HostCredentials.generate();
      if (generation != _generation) return;
      if (persist) await _preferences.save(server, credentials);
      if (generation != _generation) return;
      device = credentials.device;
      password = credentials.password;
      await _ensureDesktop();
      if (generation != _generation) return;
      _connect(generation);
    } catch (cause) {
      if (generation == _generation) {
        _phase = HostPhase.disabled;
        busy = false;
        error = cause.toString();
        notifyListeners();
      }
    }
  }

  void _connect(int generation) {
    _phase = HostPhase.listening;
    final socket = io.io(
      server,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .disableAutoConnect()
          .enableForceNew()
          .setReconnectionDelay(1000)
          .setReconnectionDelayMax(10000)
          .build(),
    );
    _socket = socket;
    socket.onConnect((_) => _register(socket, generation));
    socket.onConnectError((_) {
      if (generation == _generation) {
        busy = false;
        error = '无法连接服务器，正在重试';
        notifyListeners();
      }
    });
    socket.onDisconnect((_) {
      if (generation != _generation) return;
      unawaited(_end(false));
      error = '正在恢复设备连接…';
      notifyListeners();
    });
    socket.on('session-start', (data) {
      if (generation == _generation && enabled) {
        unawaited(_start(Map.from(data as Map)));
      }
    });
    socket.on('session-ended', (data) {
      if (generation == _generation && data['sessionId'] == _session?.id) {
        unawaited(_end(false));
      }
    });
    socket.on('signal', (data) {
      if (generation != _generation || data['sessionId'] != _session?.id) {
        return;
      }
      if (_starting) {
        if (_pending.length < 256) _pending.add(Map.from(data as Map));
        return;
      }
      _receive(Map.from(data as Map));
    });
    socket.connect();
    notifyListeners();
  }

  Future<void> regenerate() async {
    if (_disposed || busy || _regenerating) return;
    _regenerating = true;
    busy = true;
    error = '';
    notifyListeners();
    var generation = _generation;
    final wasEnabled = enabled;
    try {
      var credentials = HostCredentials.generate();
      while (credentials.device == device || credentials.password == password) {
        credentials = HostCredentials.generate();
      }
      // If persistence fails, keep the current credentials and connection.
      if (_persist) {
        await _preferences.save(server, credentials, replaceInvalid: true);
      }
      if (_disposed || generation != _generation) return;
      await disable();
      if (_disposed || _generation != generation + 1) return;
      generation = _generation;
      device = credentials.device;
      password = credentials.password;
      error = '';
      if (wasEnabled) {
        busy = true;
        generation = ++_generation;
        _connect(generation);
      }
    } catch (cause) {
      if (!_disposed && _generation == generation) {
        busy = false;
        error = '无法重新生成连接信息：$cause';
      }
    } finally {
      _regenerating = false;
      if (!_disposed) notifyListeners();
    }
  }

  void _register(io.Socket socket, int generation) {
    if (_suspended || !enabled || generation != _generation) return;
    _retry?.cancel();
    bool answered = false;
    _retry = Timer(const Duration(seconds: 8), () {
      if (generation == _generation && !answered) {
        busy = false;
        error = '正在恢复设备注册…';
        notifyListeners();
        socket.disconnect();
        socket.connect();
      }
    });
    socket.emitWithAck(
      'register-host',
      {'deviceId': device, 'password': password},
      ack: (result) {
        if (generation != _generation) return;
        answered = true;
        _retry?.cancel();
        busy = false;
        error = result is Map && result['error'] != null
            ? result['error'].toString()
            : '';
        if (error.isNotEmpty) {
          _retry = Timer(
            const Duration(seconds: 5),
            () => _register(socket, generation),
          );
        }
        notifyListeners();
      },
    );
  }

  Future<void> _start(Map data) async {
    if (_session != null || !enabled || _suspended) return;
    late final RemoteSession session;
    session = RemoteSession(
      diagnostic: diagnostic,
      id: data['sessionId'] as String,
      quality: Quality.fromMap(data['quality'] as Map),
      signal: (type, payload) {
        if (_session != session) return;
        _socket?.emit('signal', {
          'sessionId': session.id,
          'msgType': type,
          'data': {
            ...payload,
            'sender': 'host',
            'receiver': 'controller',
            'isRemoteDesk': true,
            'roomId': session.id,
          },
        });
      },
      onReady: () {
        if (_session == session) {
          connected = true;
          unawaited(lifecycle.invokeMethod('holdAwake', true));
          busy = false;
          _socket?.emit('session-ready', {'sessionId': session.id});
          notifyListeners();
        }
      },
      onError: (cause) {
        diagnostic?.call('remote error: $cause');
        if (_session == session) {
          error = cause.toString();
          unawaited(_end(true));
        }
      },
    );
    _session = session;
    _starting = true;
    busy = true;
    error = '';
    notifyListeners();
    try {
      // A new server session can arrive before the previous media teardown
      // finishes. Keep its signaling queued, but never overlap native owners.
      await _cleanup;
      if (_session != session || !enabled || _suspended) return;
      await session.start(data['iceServers'] as List? ?? []);
      if (_session != session) return;
      _starting = false;
      for (final message in _pending) {
        _receive(message);
      }
      _pending.clear();
    } catch (cause, stack) {
      diagnostic?.call('session start: $cause\n$stack');
      if (_session == session) {
        error = cause.toString();
        await _end(true);
      }
    }
  }

  void _receive(Map data) {
    final session = _session;
    _signals = _signals
        .then((_) async {
          if (session != null && session == _session) {
            await session.receive(data);
          }
        })
        .catchError((Object cause) {
          if (session == _session) {
            error = cause.toString();
            unawaited(_end(true));
          }
        });
  }

  Future<void> _end(bool notify, {io.Socket? socket}) {
    final session = _session;
    final generation = _generation;
    _session = null;
    if (notify && session != null) (socket ?? _socket)?.emit('end-session');
    _pending.clear();
    _starting = false;
    connected = false;
    busy = false;
    if (!_disposed) notifyListeners();
    _cleanup = _cleanup
        .then((_) async {
          try {
            await lifecycle.invokeMethod('holdAwake', false);
          } finally {
            await session?.close();
          }
        })
        .catchError((Object cause) {
          diagnostic?.call('session cleanup: $cause');
          if (!_disposed && generation == _generation) {
            error = '会话清理失败：$cause';
            notifyListeners();
          }
        });
    return _cleanup;
  }

  Future<void> disable() {
    if (_disposed) return _cleanup;
    if (_phase == HostPhase.stopping) return _stopping ?? _cleanup;
    ++_generation;
    _phase = HostPhase.stopping;
    _retry?.cancel();
    // Detach before the first await. Only this operation owns this socket.
    final socket = _socket;
    _socket = null;
    final ending = _end(true, socket: socket);
    socket?.dispose();
    return _stopping = () async {
      try {
        await ending;
      } finally {
        _stopping = null;
        if (!_disposed) {
          _phase = HostPhase.disabled;
          busy = false;
          notifyListeners();
        }
      }
    }();
  }

  @override
  void dispose() {
    _disposed = true;
    ++_generation;
    _phase = HostPhase.disposed;
    lifecycle.setMethodCallHandler(null);
    _retry?.cancel();
    _socket?.dispose();
    unawaited(_end(false));
    super.dispose();
  }
}
