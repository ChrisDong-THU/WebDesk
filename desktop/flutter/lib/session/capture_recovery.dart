/// Source progress, not encoded FPS, determines capture health. A static screen
/// may encode no frames while the native capturer continues reporting success.
class CaptureRecoveryPolicy {
  DateTime? _started, _progress, _rebuilt;
  num? _captured;
  int _attempts = 0;
  bool _exhausted = false;
  int get attempts => _attempts;
  bool get exhausted => _exhausted;

  void started(DateTime now) {
    _started = _progress = now;
    _captured = null;
  }

  bool sample(Map<String, dynamic> stats, DateTime now) {
    final frames = stats['framesCaptured'], age = stats['lastFrameAgeMs'];
    if (frames is! num ||
        !frames.isFinite ||
        frames < 0 ||
        age is! num ||
        !age.isFinite ||
        _started == null) {
      return false;
    }
    final advancing = _captured != null && frames > _captured!;
    if (advancing || (frames > 0 && age >= 0 && age < 3000)) {
      _progress = now;
      _attempts = 0;
      _exhausted = false;
    }
    _captured = frames;
    if (stats['recovering'] == true ||
        _exhausted ||
        now.difference(_progress!).inSeconds < 10 ||
        (age >= 0 && age < 10000) ||
        (_rebuilt != null && now.difference(_rebuilt!).inSeconds < 15)) {
      return false;
    }
    if (_attempts >= 2) {
      _exhausted = true;
      return false;
    }
    _attempts++;
    _rebuilt = now;
    return true;
  }
}
