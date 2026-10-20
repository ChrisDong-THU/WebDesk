import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/services.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import '../session/cleanup.dart';

final _random = Random.secure();
String randomId() => List.generate(
  16,
  (_) => _random.nextInt(256).toRadixString(16).padLeft(2, '0'),
).join();
String safeFileName(String name) {
  final value = name
      .replaceAll(RegExp(r'[<>:"/\\|?*\x00-\x1f]'), '_')
      .replaceAll(RegExp(r'[. ]+$'), '');
  if (value.isEmpty ||
      value.length > 180 ||
      RegExp(
        r'^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)',
        caseSensitive: false,
      ).hasMatch(value)) {
    throw const FormatException('Windows 不支持此文件名');
  }
  return value;
}

/// Matches the existing browser's reliable, negotiated SCTP channel (ID 42).
/// Files are streamed and paths never cross the network.
class ToolChannel {
  ToolChannel._(
    this.channel,
    this.setAudioEnabled,
    this.getMediaStats,
    this._downloadsDirectory,
    this._selectFile,
  ) {
    channel.onMessage = (message) {
      if (_closed) return;
      final size = message.isBinary
          ? message.binary.length
          : message.text.length * 2;
      _queuedBytes += size;
      if (_queuedBytes > 2 * 1024 * 1024) {
        unawaited(close());
        return;
      }
      _queue = _queue
          .then((_) => _receive(message))
          .catchError((Object _) {
            unawaited(close());
          })
          .whenComplete(() => _queuedBytes -= size);
    };
    channel.onDataChannelState = (state) {
      if (state == RTCDataChannelState.RTCDataChannelClosed) unawaited(close());
    };
  }
  static Future<ToolChannel> create(
    RTCPeerConnection pc, {
    Future<bool> Function(bool)? setAudioEnabled,
    Future<Map<String, dynamic>> Function()? getMediaStats,
    Future<Directory?> Function()? downloadsDirectory,
    Future<XFile?> Function()? selectFile,
  }) async => ToolChannel._(
    await pc.createDataChannel(
      'WebDesk tools v2',
      RTCDataChannelInit()
        ..negotiated = true
        ..id = 42
        ..ordered = true,
    ),
    setAudioEnabled,
    getMediaStats,
    downloadsDirectory ?? getDownloadsDirectory,
    selectFile ?? (() => openFile(confirmButtonText: '发送')),
  );
  final RTCDataChannel channel;
  final Future<bool> Function(bool)? setAudioEnabled;
  final Future<Map<String, dynamic>> Function()? getMediaStats;
  final Future<Directory?> Function() _downloadsDirectory;
  final Future<XFile?> Function() _selectFile;
  final _pending = <String, Completer<dynamic>>{};
  final _selected = <String, XFile>{};
  Future<void> _queue = Future.value();
  Future<void>? _closing;
  bool _closed = false, _selecting = false, _sending = false;
  int _queuedBytes = 0, _received = 0, _expected = 0;
  RandomAccessFile? _incoming;
  File? _partial;
  String? _destination;
  static const chunkSize = 16 * 1024,
      windowSize = 256 * 1024,
      pipelineWindows = 4,
      maxSize = 2 * 1024 * 1024 * 1024;
  void _active() {
    if (_closed) throw StateError('会话已结束');
  }

  Future<void> _json(Map value) {
    _active();
    return channel.send(RTCDataChannelMessage(jsonEncode(value)));
  }

  Future<dynamic> _request(String operation, [Map data = const {}]) async {
    _active();
    final id = randomId(), completer = Completer<dynamic>();
    _pending[id] = completer;
    final timer = Timer(const Duration(seconds: 30), () {
      if (!completer.isCompleted) {
        completer.completeError(TimeoutException('工具通道响应超时'));
      }
    });
    try {
      // Observe the reply immediately: close may reject it while send is
      // still awaiting the platform channel.
      final results = await Future.wait<dynamic>([
        _json({'id': id, 'operation': operation, 'data': data}),
        completer.future,
      ], eagerError: true);
      return results[1];
    } finally {
      timer.cancel();
      _pending.remove(id);
      if (!completer.isCompleted) completer.complete(null);
    }
  }

  Future<void> _receive(RTCDataChannelMessage message) async {
    if (_closed) return;
    if (message.isBinary) {
      final bytes = message.binary;
      if (_incoming == null ||
          bytes.length > chunkSize ||
          _received + bytes.length > _expected) {
        throw const FormatException('Invalid file chunk');
      }
      await _incoming!.writeFrom(bytes);
      _received += bytes.length;
      return;
    }
    if (message.text.length > 700000) {
      throw const FormatException('Message too large');
    }
    final value = jsonDecode(message.text) as Map;
    if (value['id'] is! String || (value['id'] as String).length > 64) {
      throw const FormatException('Invalid request');
    }
    if (value.containsKey('reply')) {
      final pending = _pending.remove(value['id']);
      if (pending != null) {
        if (value['error'] != null) {
          pending.completeError(StateError(value['error'].toString()));
        } else {
          pending.complete(value['reply']);
        }
      }
      return;
    }
    if ([
      'file.begin',
      'file.ack',
      'file.end',
      'file.abort',
    ].contains(value['operation'])) {
      await _respond(value);
    } else {
      unawaited(_respond(value).catchError((Object _) => close()));
    }
  }

  Future<void> _respond(Map message) async {
    try {
      final result = await _handle(
        message['operation'] as String,
        message['data'] as Map? ?? {},
      );
      if (!_closed) await _json({'id': message['id'], 'reply': result});
    } catch (error) {
      if (!_closed) {
        await _json({
          'id': message['id'],
          'reply': null,
          'error': error.toString(),
        });
      }
    }
  }

  Future<dynamic> _handle(String operation, Map data) async {
    _active();
    switch (operation) {
      case 'media.stats':
        final handler = getMediaStats;
        if (handler == null) throw StateError('媒体统计未就绪');
        return handler();
      case 'audio.set':
        if (data['enabled'] is! bool) throw const FormatException('无效的声音设置');
        final handler = setAudioEnabled;
        if (handler == null) throw StateError('此客户端不支持声音传输');
        return handler(data['enabled'] as bool);
      case 'ping':
        return {'version': 2};
      case 'clipboard.read':
        final text =
            (await Clipboard.getData(Clipboard.kTextPlain))?.text ?? '';
        _active();
        return text.substring(0, text.length.clamp(0, 65536));
      case 'clipboard.write':
        final text = data['text'];
        if (text is! String || text.length > 65536) {
          throw const FormatException('剪贴板文字不能超过 64K 字符');
        }
        await Clipboard.setData(ClipboardData(text: text));
        return null;
      case 'file.begin':
        if (_incoming != null) throw StateError('已有文件正在接收');
        final size = data['size'];
        if (size is! int ||
            size < 0 ||
            size > maxSize ||
            data['name'] is! String) {
          throw const FormatException('文件无效或超过 2 GB');
        }
        final name = safeFileName(data['name'] as String);
        final downloads = await _downloadsDirectory();
        if (downloads == null) throw StateError('无法找到下载目录');
        final root = await Directory(
          p.join(downloads.path, 'WebDesk'),
        ).create(recursive: true);
        final directory = await root.createTemp('receive-');
        _active();
        _destination = p.join(directory.path, name);
        _partial = File('$_destination.webdesk-part');
        _incoming = await _partial!.open(mode: FileMode.writeOnly);
        _expected = size;
        _received = 0;
        return true;
      case 'file.ack':
        // Ordered receive queue has completed all previous writes. Durability
        // is guaranteed by file.end, not a costly disk flush per window.
        return _incoming == null ? null : _received;
      case 'file.end':
        if (_incoming == null || _received != _expected) {
          throw StateError('文件大小不完整');
        }
        await _incoming!.flush();
        await _incoming!.close();
        _incoming = null;
        _active();
        await _partial!.rename(_destination!);
        _partial = null;
        return {
          'name': p.basename(_destination!),
          'size': _received,
          'location': '下载 / WebDesk',
        };
      case 'file.abort':
        await _abort();
        return null;
      case 'file.select':
        if (_selecting || _selected.length >= 100) {
          throw StateError('请先完成当前文件选择');
        }
        _selecting = true;
        try {
          final file = await _selectFile();
          _active();
          if (file == null) return null;
          final size = await file.length();
          _active();
          if (size > maxSize) throw StateError('请选择不超过 2 GB 的文件');
          final id = randomId();
          _selected[id] = file;
          return {'id': id, 'name': file.name, 'size': size};
        } finally {
          _selecting = false;
        }
      case 'file.download':
        final file = _selected.remove(data['id']);
        if (file == null) throw StateError('请选择远程文件');
        return _send(file);
      default:
        throw StateError('不支持的操作');
    }
  }

  Future<dynamic> _send(XFile file) async {
    if (_sending) throw StateError('请等待当前文件传输完成');
    _sending = true;
    RandomAccessFile? handle;
    bool begun = false;
    try {
      handle = await File(file.path).open();
      final size = await handle.length();
      if (size > maxSize) throw StateError('文件超过 2 GB');
      await _request('file.begin', {'name': file.name, 'size': size});
      begun = true;
      final confirmations = <Future<void>>[];
      Object? failed;
      Future<void> confirmed() async {
        await confirmations.removeAt(0);
        if (failed != null) throw failed!;
      }

      var offset = 0;
      while (offset < size) {
        final end = min(offset + windowSize, size);
        while (offset < end) {
          _active();
          if (failed != null) throw failed!;
          final bytes = await handle.read(min(chunkSize, end - offset));
          if (bytes.isEmpty) throw StateError('文件读取失败');
          await channel.send(RTCDataChannelMessage.fromBinary(bytes));
          offset += bytes.length;
        }
        final expected = offset;
        confirmations.add(
          _request('file.ack')
              .then<void>((bytes) {
                if (bytes != expected) throw StateError('文件传输校验失败');
              })
              .catchError((Object error) {
                failed ??= error;
              }),
        );
        if (confirmations.length >= pipelineWindows) await confirmed();
      }
      while (confirmations.isNotEmpty) {
        await confirmed();
      }
      return await _request('file.end');
    } catch (_) {
      if (begun && !_closed) {
        try {
          await _request('file.abort');
        } catch (_) {}
      }
      rethrow;
    } finally {
      try {
        await handle?.close();
      } finally {
        _sending = false;
      }
    }
  }

  Future<void> _abort() async {
    final incoming = _incoming, partial = _partial;
    _incoming = null;
    _partial = null;
    await cleanup({
      'partial handle': () async {
        await incoming?.close();
      },
      'partial file': () async {
        if (partial != null && await partial.exists()) await partial.delete();
      },
    });
  }

  Future<void> close() {
    if (_closed) return _closing ?? Future.value();
    _closed = true;
    for (final pending in _pending.values) {
      pending.completeError(StateError('连接已结束'));
    }
    _pending.clear();
    _selected.clear();
    // Receive error handlers schedule close without awaiting it, so callers
    // can await both channel closure and removal of incomplete disk files.
    return _closing = Future.wait<void>([
      _queue.then((_) => _abort()),
      channel.close(),
    ]).then((_) {});
  }
}
