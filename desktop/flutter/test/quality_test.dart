import 'package:flutter_test/flutter_test.dart';
import 'package:webdesk/protocol/quality.dart';

void main() {
  test('wire settings require every current field and correct types', () {
    final wire = const Quality().toMap();
    expect(Quality.fromMap(wire).toMap(), wire);
    for (final key in wire.keys) {
      final missing = {...wire}..remove(key);
      expect(
        () => Quality.fromMap(missing),
        throwsFormatException,
        reason: key,
      );
      expect(
        () => Quality.fromMap({...wire, key: null}),
        throwsFormatException,
        reason: key,
      );
    }
    expect(
      () => Quality.fromMap({...wire, 'maxFramerate': 120}),
      throwsFormatException,
    );
    expect(
      () => Quality.fromMap({...wire, 'codecPreference': 1}),
      throwsFormatException,
    );
  });

  test(
    'live settings reject invalid values without losing other user choices',
    () {
      const quality = Quality(
        codecPreference: 'AV1',
        networkMode: 'low-latency',
      );
      final changed = quality.change('changeMaxFramerate', 30);
      expect(changed.fps, 30);
      expect(changed.codecPreference, 'AV1');
      expect(changed.networkMode, 'low-latency');
      expect(
        () => quality.change('changeVideoCodec', 1),
        throwsFormatException,
      );
      expect(
        () => quality.change('changeMaxFramerate', '30'),
        throwsFormatException,
      );
      expect(() => quality.change('unknown', 1), throwsFormatException);
    },
  );
}
