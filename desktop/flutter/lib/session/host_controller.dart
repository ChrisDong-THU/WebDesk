import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../native/desktop_bridge.dart';
import '../protocol/quality.dart';
import 'remote_session.dart';

class HostController extends ChangeNotifier {
  static const lifecycle = MethodChannel('webdesk/lifecycle');
  bool _suspended = false, _disposed = false;
  final void Function(String)? diagnostic;
  HostController({this.diagnostic}) {
    lifecycle.setMethodCallHandler((call) async {
      if (call.method == 'suspend') {
        _suspended = true;
        _retry?.cancel();
        await _end(true);
        _socket?.disconnect();
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
  bool enabled = false, busy = false, connected = false;
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
      final path = p.join(
        (await getApplicationSupportDirectory()).path,
        'preferences.json',
      );
      final saved = jsonDecode(await File(path).readAsString()) as Map;
      if (saved['server'] is String) server = saved['server'] as String;
    } catch (_) {}
    if (!_disposed) notifyListeners();
  }

  Future<void> enable(String value, {bool persist = true}) async {
    if (_disposed || busy || enabled) return;
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
      if (persist) {
        final preferences = File(
          p.join(
            (await getApplicationSupportDirectory()).path,
            'preferences.json',
          ),
        );
        await preferences.parent.create(recursive: true);
        await preferences.writeAsString(jsonEncode({'server': server}));
      }
      await DesktopBridge.ensure();
      if (generation != _generation) return;
      final random = Random.secure();
      device = List.generate(9, (_) => random.nextInt(10)).join();
      const alphabet =
          'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
      password = List.generate(
        16,
        (_) => alphabet[random.nextInt(alphabet.length)],
      ).join();
      enabled = true;
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
    } catch (cause) {
      if (generation == _generation) {
        enabled = false;
        busy = false;
        error = cause.toString();
        notifyListeners();
      }
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
    if (_session != null || !enabled) return;
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

  Future<void> _end(bool notify) async {
    final session = _session;
    _session = null;
    if (notify && session != null) _socket?.emit('end-session');
    _pending.clear();
    _starting = false;
    connected = false;
    busy = false;
    await lifecycle.invokeMethod('holdAwake', false);
    await session?.close();
    if (!_disposed) notifyListeners();
  }

  Future<void> disable() async {
    ++_generation;
    enabled = false;
    _retry?.cancel();
    await _end(true);
    _socket?.dispose();
    _socket = null;
    device = '';
    password = '';
    busy = false;
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    ++_generation;
    enabled = false;
    lifecycle.setMethodCallHandler(null);
    _retry?.cancel();
    _socket?.dispose();
    unawaited(_session?.close() ?? Future.value());
    _session = null;
    super.dispose();
  }
}
