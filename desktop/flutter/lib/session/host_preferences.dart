import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

class HostCredentials {
  const HostCredentials(this.device, this.password);
  final String device, password;

  factory HostCredentials.generate() {
    final random = Random.secure();
    const alphabet =
        'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    return HostCredentials(
      List.generate(9, (_) => random.nextInt(10)).join(),
      List.generate(
        16,
        (_) => alphabet[random.nextInt(alphabet.length)],
      ).join(),
    );
  }
}

/// Keep credentials alongside the server setting in Windows application data.
/// A failed read/write must not silently replace an existing device identity.
class HostPreferences {
  HostPreferences({File? file}) : _file = file;
  File? _file;
  Map<String, dynamic> _values = {};
  Future<void>? _loading;

  String? get server => _values['server'] as String?;
  HostCredentials? get credentials {
    final device = _values['device'], password = _values['password'];
    if (device == null && password == null) {
      return null; // Pre-upgrade settings.
    }
    if (device is! String ||
        !RegExp(r'^\d{9}$').hasMatch(device) ||
        password is! String ||
        password.length < 12 ||
        password.length > 128) {
      throw const FormatException('已保存的连接信息损坏，请点击重新生成');
    }
    return HostCredentials(device, password);
  }

  Future<void> load() => _loading ??= _read().catchError((Object error) {
    _loading = null;
    throw error;
  });

  Future<void> _read() async {
    final file = _file ??= File(
      p.join((await getApplicationSupportDirectory()).path, 'preferences.json'),
    );
    String text;
    try {
      text = await file.readAsString();
    } on FileSystemException catch (error) {
      if (error.osError?.errorCode == 2 ||
          (Platform.isWindows && error.osError?.errorCode == 3)) {
        return; // First run: file or its application-data directory is absent.
      }
      rethrow;
    }
    final decoded = jsonDecode(text);
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('已保存的配置无效，请点击重新生成');
    }
    _values = decoded;
    if (_values['server'] != null && _values['server'] is! String) {
      throw const FormatException('已保存的服务地址无效');
    }
  }

  Future<void> save(
    String server,
    HostCredentials credentials, {
    bool replaceInvalid = false,
  }) async {
    try {
      await load();
    } on FormatException {
      if (!replaceInvalid) rethrow;
      // Only an explicit regeneration may repair malformed saved settings.
      _values = {};
      _loading = Future.value();
    }
    final values = {
      ..._values,
      'server': server,
      'device': credentials.device,
      'password': credentials.password,
    };
    final file = _file!;
    await file.parent.create(recursive: true);
    // Replace only after the complete new pair has been flushed to disk.
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(jsonEncode(values), flush: true);
    await temporary.rename(file.path);
    _values = values;
  }
}
