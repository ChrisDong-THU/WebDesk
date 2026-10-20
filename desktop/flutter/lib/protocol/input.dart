import 'dart:typed_data';
import 'key_map.dart';

/// Adapts billd-desk's normalized coordinates and Key enum to Wire input.
Uint8List? encodeBehavior(Map data, int width, int height) {
  final type = data['type'];
  if (type == 17) return Uint8List.fromList([4]);
  final entries = <List<int>>[];
  void mouse(int flags, [int amount = 0, int x = 0, int y = 0]) =>
      entries.add([0, x, y, flags, amount]);
  if ([0, 1, 6].contains(type)) {
    final x = data['x'], y = data['y'];
    if (x is! num || y is! num || !x.isFinite || !y.isFinite) return null;
    final px = (width * x / 1000).clamp(0, width - 1);
    final py = (height * y / 1000).clamp(0, height - 1);
    mouse(
      0x8001,
      0,
      (px * 65535 / (width - 1).clamp(1, width)).round(),
      (py * 65535 / (height - 1).clamp(1, height)).round(),
    );
  } else if ([14, 15, 16].contains(type)) {
    final keys = data['key'];
    if (keys is! List ||
        keys.isEmpty ||
        keys.length > 8 ||
        keys.any((k) => k is! int || !windowsKeys.containsKey(k))) {
      return null;
    }
    void key(int value, bool up) {
      final pair = windowsKeys[value]!;
      entries.add([1, pair[0], 0, pair[1] | (up ? 2 : 0), 0]);
    }

    for (final value in keys) {
      key(value as int, type == 16);
    }
    if (type == 14) {
      for (final value in keys.reversed) {
        key(value as int, true);
      }
    }
  } else if ([10, 11, 12, 13].contains(type)) {
    final amount = data['amount'];
    if (amount is! num || !amount.isFinite || amount <= 0 || amount > 10000) {
      return null;
    }
    mouse(
      type == 12 || type == 13 ? 0x1000 : 0x800,
      (amount * 120).round() * (type == 10 || type == 12 ? -1 : 1),
    );
  } else {
    switch (type) {
      case 2:
        mouse(2);
      case 3:
        mouse(8);
      case 4:
        mouse(4);
      case 5:
        mouse(16);
      case 18:
        mouse(32);
      case 19:
        mouse(64);
      case 7:
        mouse(2);
        mouse(4);
        mouse(2);
        mouse(4);
      case 8:
        mouse(2);
        mouse(4);
      case 9:
        mouse(8);
        mouse(16);
      default:
        return null;
    }
  }
  final body = ByteData(1 + entries.length * 20)..setUint8(0, 2);
  var offset = 1;
  for (final entry in entries) {
    for (final value in entry) {
      body.setInt32(offset, value, Endian.little);
      offset += 4;
    }
  }
  return body.buffer.asUint8List();
}
