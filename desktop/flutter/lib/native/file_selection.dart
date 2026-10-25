import 'package:cross_file/cross_file.dart';
import 'package:flutter/services.dart';

const _lifecycle = MethodChannel('webdesk/lifecycle');

/// One tool channel owns its picker, so late session cleanup cannot cancel a
/// subsequent session's selection. Native selection never blocks RTC dispatch.
class RemoteFileSelection {
  RemoteFileSelection(this.owner);
  final String owner;

  Future<XFile?> select() async {
    final path = await _lifecycle.invokeMethod<String>('selectFile', owner);
    return path == null ? null : XFile(path);
  }

  Future<void> cancel() =>
      _lifecycle.invokeMethod<void>('cancelFileSelection', owner);
}
