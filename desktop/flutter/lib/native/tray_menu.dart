/// One popup at a time; repeated tray events must not nest native menu loops.
class TrayMenu {
  TrayMenu(this.show);
  final Future<void> Function() show;
  bool _opening = false, _disposed = false;

  Future<void> open() async {
    if (_opening || _disposed) return;
    _opening = true;
    try {
      await show();
    } finally {
      _opening = false;
    }
  }

  void dispose() => _disposed = true;
}
