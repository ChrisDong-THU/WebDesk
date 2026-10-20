import 'dart:async';
import 'dart:collection';
import 'dart:io';
import 'dart:typed_data';
import 'package:path/path.dart' as p;

/// Wire-compatible with WebDeskNative. One authenticated RTC session owns it.
class DesktopBridge {
  Process? _process;
  final _pending = Queue<Completer<Uint8List>>();
  final _decoder = ReplyDecoder();
  bool _closed = false;
  Future<void> _writes = Future.value();
  int width = 1, height = 1;
  bool secure = false;
  final void Function(Object) onError;
  final void Function(String)? diagnostic;
  DesktopBridge(this.onError, {this.diagnostic});
  static String get executable => p.join(
    Platform.environment['ProgramW6432'] ??
        Platform.environment['ProgramFiles'] ??
        r'C:\Program Files',
    'WebDesk Native',
    'WebDeskNative.exe',
  );
  static Future<void> ensure() async {
    final result = await Process.run(executable, ['--ensure']);
    if (result.exitCode != 0) throw StateError('本机服务未就绪，请重新安装 WebDesk');
  }

  Future<void> start() async {
    if (_closed) throw StateError('会话已取消');
    final process = await Process.start(
      executable,
      ['--bridge'],
      environment: diagnostic == null
          ? null
          : {'WEBDESK_NATIVE_DIAGNOSTICS': '1'},
    );
    if (_closed) {
      process.kill();
      return;
    }
    _process = process;
    process.stderr.transform(const SystemEncoding().decoder).listen((message) {
      diagnostic?.call('native stderr: ${message.trim()}');
    });
    process.stdout.listen((chunk) {
      try {
        _decoder.add(chunk, (error, bytes) {
          diagnostic?.call('native reply error=$error bytes=${bytes.length}');
          if (_pending.isEmpty) {
            throw const FormatException('Unexpected native response');
          }
          final pending = _pending.removeFirst();
          if (error != 0) {
            pending.completeError(StateError('Windows 桌面错误 $error'));
          } else {
            pending.complete(bytes);
          }
        });
      } catch (error) {
        _fail(error);
      }
    }, onError: _fail);
    process.exitCode.then((_) {
      if (!_closed) _fail(StateError('本机桌面服务已退出'));
    });
    await status();
  }

  Future<Uint8List> request(Uint8List body) {
    if (_closed || _process == null) return Future.error(StateError('桌面服务不可用'));
    if (_pending.length >= 128) {
      _fail(StateError('输入队列已满'));
      return Future.error(StateError('输入队列已满'));
    }
    final pending = Completer<Uint8List>();
    _pending.add(pending);
    diagnostic?.call(
      'native request op=${body.first} pending=${_pending.length}',
    );
    final header = ByteData(4)..setUint32(0, body.length, Endian.little);
    _writes = _writes
        .then((_) async {
          if (_closed) return;
          _process!.stdin.add(header.buffer.asUint8List());
          _process!.stdin.add(body);
          await _process!.stdin.flush();
          diagnostic?.call('native flushed op=${body.first}');
        })
        .catchError(_fail);
    return pending.future.timeout(
      const Duration(seconds: 10),
      onTimeout: () {
        final error = TimeoutException('桌面服务响应超时');
        _fail(error);
        throw error;
      },
    );
  }

  Future<void> status() async {
    final bytes = await request(Uint8List.fromList([1]));
    if (bytes.length != 20) {
      throw const FormatException('Invalid desktop status');
    }
    final data = ByteData.sublistView(bytes);
    if (data.getInt32(12, Endian.little) != 1 ||
        data.getInt32(16, Endian.little) != 1) {
      throw StateError('桌面服务权限不足');
    }
    secure = data.getInt32(0, Endian.little) != 0;
    width = data.getInt32(4, Endian.little);
    height = data.getInt32(8, Endian.little);
  }

  Future<void> release() async {
    if (!_closed) await request(Uint8List.fromList([4]));
  }

  void _fail(Object error) {
    if (_closed) return;
    close();
    onError(error);
  }

  void close() {
    if (_closed) return;
    _closed = true;
    unawaited(
      _process?.stdin.close().catchError((Object _) {}) ?? Future.value(),
    );
    _process?.kill(ProcessSignal.sigkill);
    _process = null;
    _decoder.reset();
    while (_pending.isNotEmpty) {
      _pending.removeFirst().completeError(StateError('会话已结束'));
    }
  }
}

class ReplyDecoder {
  final _header = Uint8List(8);
  int _head = 0, _offset = 0, _error = 0;
  Uint8List? _body;
  void add(List<int> chunk, void Function(int, Uint8List) consume) {
    var offset = 0;
    while (offset < chunk.length) {
      if (_body == null) {
        final count = (8 - _head).clamp(0, chunk.length - offset);
        _header.setRange(_head, _head + count, chunk, offset);
        _head += count;
        offset += count;
        if (_head != 8) continue;
        final data = ByteData.sublistView(_header);
        final size = data.getUint32(4, Endian.little);
        if (size > 32 * 1024 * 1024) {
          throw const FormatException('Native reply too large');
        }
        _error = data.getUint32(0, Endian.little);
        _body = Uint8List(size);
      }
      final count = (_body!.length - _offset).clamp(0, chunk.length - offset);
      _body!.setRange(_offset, _offset + count, chunk, offset);
      _offset += count;
      offset += count;
      if (_offset == _body!.length) {
        final body = _body!, error = _error;
        reset();
        consume(error, body);
      }
    }
  }

  void reset() {
    _head = 0;
    _offset = 0;
    _body = null;
  }
}
