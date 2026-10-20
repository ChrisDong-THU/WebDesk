import 'dart:async';
import 'dart:collection';
import 'dart:typed_data';

/// One native request at a time. Only adjacent unsent moves may be replaced;
/// button/key transitions form ordering barriers and are never discarded.
class InputQueue {
  InputQueue(this.send, this.onError);
  final Future<void> Function(Uint8List) send;
  final void Function(Object) onError;
  final _queue = Queue<({Uint8List bytes, bool move})>();
  bool _closed = false;
  Future<void>? _running;

  void add(Uint8List bytes, {required bool move}) {
    if (_closed) return;
    if (move && _queue.isNotEmpty && _queue.last.move) _queue.removeLast();
    if (_queue.length >= 128) {
      _closed = true;
      _queue.clear();
      onError(StateError('输入处理速度不足，请重新连接'));
      return;
    }
    _queue.add((bytes: bytes, move: move));
    _running ??= _drain();
  }

  Future<void> _drain() async {
    try {
      while (!_closed && _queue.isNotEmpty) {
        await send(_queue.removeFirst().bytes);
      }
    } catch (error) {
      _closed = true;
      _queue.clear();
      onError(error);
    } finally {
      _running = null;
    }
  }

  Future<void> close() async {
    _closed = true;
    _queue.clear();
    await _running;
  }
}
