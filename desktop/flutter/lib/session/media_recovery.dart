import 'dart:async';

/// Bounded recovery for the existing peer. The owner serializes SDP mutations;
/// no tracks or channels are replaced. Repeated disconnected events cannot
/// postpone recovery forever, and close cancels every pending timer.
class MediaRecovery {
  MediaRecovery({
    required this.restart,
    required this.onExhausted,
    this.grace = const Duration(seconds: 3),
    this.timeout = const Duration(seconds: 15),
    this.maxAttempts = 2,
  });
  final Future<void> Function() restart;
  final void Function(Object) onExhausted;
  final Duration grace, timeout;
  final int maxAttempts;
  Timer? _timer;
  bool _closed = false,
      _recovering = false,
      _working = false,
      _exhausted = false;
  int _attempts = 0, _generation = 0;
  int get attempts => _attempts;
  bool get recovering => _recovering;

  void connected() {
    if (_closed) return;
    _generation++;
    _timer?.cancel();
    _timer = null;
    _attempts = 0;
    _exhausted = false;
    _recovering = false;
  }

  void disconnected({bool failed = false}) {
    if (_closed || _exhausted) return;
    _recovering = true;
    if (_working) return;
    if (failed && _attempts == 0) {
      _timer?.cancel();
      _timer = null;
      unawaited(_attempt());
    } else if (_timer == null) {
      _schedule(grace);
    }
  }

  void _schedule(Duration delay) {
    _timer = Timer(delay, () {
      _timer = null;
      unawaited(_attempt());
    });
  }

  Future<void> _attempt() async {
    if (_closed || !_recovering || _working) return;
    if (_attempts >= maxAttempts) {
      _recovering = false;
      _exhausted = true;
      onExhausted(StateError('远程连接恢复失败（已尝试 $maxAttempts 次 ICE 重连）'));
      return;
    }
    _attempts++;
    _working = true;
    final generation = _generation;
    try {
      // Native calls can stall too. Their queued work remains owned by the
      // session, but cannot hold the recovery budget open indefinitely.
      await restart().timeout(timeout);
    } catch (error) {
      if (!_closed && generation == _generation && _attempts >= maxAttempts) {
        _recovering = false;
        _exhausted = true;
        onExhausted(error);
      }
    } finally {
      _working = false;
      if (!_closed && _recovering && generation == _generation) {
        _schedule(timeout);
      }
    }
  }

  void close() {
    _closed = true;
    _timer?.cancel();
    _timer = null;
  }
}
