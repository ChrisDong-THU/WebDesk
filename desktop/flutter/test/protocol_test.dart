import 'dart:typed_data';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:webdesk/native/desktop_bridge.dart';
import 'package:webdesk/protocol/input.dart';
import 'package:webdesk/protocol/quality.dart';
import 'package:webdesk/tools/tool_channel.dart';

void main() {
  test(
    'physical button edges inject one transition each, including middle',
    () {
      for (final entry in {2: 2, 4: 4, 3: 8, 5: 16, 18: 32, 19: 64}.entries) {
        final packet = encodeBehavior({'type': entry.key}, 1920, 1080)!;
        expect(packet.length, 21);
        expect(
          ByteData.sublistView(packet).getInt32(13, Endian.little),
          entry.value,
        );
      }
      final flags = [2, 4, 2, 4]
          .map(
            (type) => ByteData.sublistView(
              encodeBehavior({'type': type}, 1920, 1080)!,
            ).getInt32(13, Endian.little),
          )
          .toList();
      expect(flags, [2, 4, 2, 4]);
    },
  );
  test(
    'browser punctuation fixtures encode Windows press and release keys',
    () {
      final cases =
          jsonDecode(
                File('../../tests/fixtures/keyboard.json').readAsStringSync(),
              )
              as List;
      for (final row in cases) {
        for (final type in [15, 16]) {
          final packet = encodeBehavior(
            {
              'type': type,
              'key': [row[1]],
            },
            3200,
            2000,
          )!;
          final bytes = ByteData.sublistView(packet);
          expect(packet.length, 21, reason: row[0]);
          expect(bytes.getUint8(0), 2);
          expect(bytes.getInt32(1, Endian.little), 1);
          expect(bytes.getInt32(5, Endian.little), row[2], reason: row[0]);
          expect(
            bytes.getInt32(13, Endian.little),
            (row[3] as int) | (type == 16 ? 2 : 0),
            reason: row[0],
          );
        }
      }
    },
  );
  test('all six qualities validate; arbitrary caps are rejected', () {
    for (final height in Quality.heights) {
      expect(Quality(height: height).validated().height, height);
    }
    expect(
      () => const Quality(height: 9999).validated(),
      throwsFormatException,
    );
    expect(() => const Quality(fps: -1).validated(), throwsFormatException);
    expect(
      () => const Quality(bitrate: 123).validated(),
      throwsFormatException,
    );
    expect(const Quality().change('changeMaxFramerate', 30).height, 4320);
  });
  test('physical input is normalized once; signed scroll matches old host', () {
    final mouse = ByteData.sublistView(
      encodeBehavior({'type': 0, 'x': 500, 'y': 500}, 3200, 2000)!,
    );
    expect(mouse.getInt32(5, Endian.little), (1600 * 65535 / 3199).round());
    expect(mouse.getInt32(9, Endian.little), (1000 * 65535 / 1999).round());
    final wheel = ByteData.sublistView(
      encodeBehavior({'type': 10, 'amount': 3}, 3200, 2000)!,
    );
    expect(wheel.getInt32(17, Endian.little), -360);
    expect(encodeBehavior({'type': 17}, 3200, 2000), [4]);
  });
  test('invalid input never produces a native request', () {
    expect(
      encodeBehavior({'type': 0, 'x': double.nan, 'y': 0}, 3200, 2000),
      isNull,
    );
    expect(
      encodeBehavior(
        {
          'type': 15,
          'key': [9999],
        },
        3200,
        2000,
      ),
      isNull,
    );
    expect(encodeBehavior({'type': 10, 'amount': -1}, 3200, 2000), isNull);
    expect(encodeBehavior({'type': 100}, 3200, 2000), isNull);
  });
  test('split response headers and coalesced replies preserve boundaries', () {
    final header = ByteData(8)..setUint32(4, 5, Endian.little);
    final bytes = [
      ...header.buffer.asUint8List(),
      1,
      2,
      3,
      4,
      5,
      ...Uint8List(8),
    ];
    for (var split = 1; split <= bytes.length; split++) {
      final decoder = ReplyDecoder(), replies = <List<int>>[];
      for (var offset = 0; offset < bytes.length; offset += split) {
        decoder.add(
          bytes.sublist(offset, (offset + split).clamp(0, bytes.length)),
          (error, payload) {
            expect(error, 0);
            replies.add(payload);
          },
        );
      }
      expect(replies, [
        [1, 2, 3, 4, 5],
        [],
      ]);
    }
  });
  test(
    'response size is checked before allocation; cancellation resets parser',
    () {
      final decoder = ReplyDecoder();
      final oversized = ByteData(8)..setUint32(4, 0xffffffff, Endian.little);
      expect(
        () => decoder.add(oversized.buffer.asUint8List(), (_, _) {}),
        throwsFormatException,
      );
      decoder.reset();
      decoder.add([0, 0, 0], (_, _) {});
      decoder.reset();
      var count = 0;
      decoder.add(Uint8List(8), (_, _) => count++);
      expect(count, 1);
    },
  );
  test('Windows filenames cannot escape the download directory', () {
    expect(safeFileName('../report.txt'), '.._report.txt');
    expect(() => safeFileName('CON.txt'), throwsFormatException);
    expect(() => safeFileName('LPT1'), throwsFormatException);
    expect(() => safeFileName('.. '), throwsFormatException);
    expect(safeFileName('报告.txt'), '报告.txt');
  });
}
