import 'package:flutter_test/flutter_test.dart';
import 'package:webdesk/session/native_texture_policy.dart';

void main() {
  Map<String, dynamic> sample(
    int frames, {
    String track = 'video-1',
    String path = 'CROSS-ADAPTER-NV12',
    double cost = 16,
    double fps = 30,
  }) => {
    'captureTrackId': track,
    'framesEncoded': frames,
    'nativeTextureActive': true,
    'encoder': 'WebDesk-NVENC-H264-$path',
    'encodeMs': cost,
    'fps': fps,
  };

  test('only fresh consecutive costly bridge samples cause one switch', () {
    final policy = NativeTexturePolicy();
    expect(policy.sample(sample(30), 30), isFalse);
    expect(policy.sample(sample(60), 30), isFalse);
    for (var i = 0; i < 5; i++) {
      expect(policy.sample(sample(60), 30), isFalse);
    }
    expect(policy.sample(sample(90), 30), isFalse);
    expect(policy.sample(sample(120), 30), isTrue);
    for (var i = 5; i < 20; i++) {
      expect(policy.sample(sample(i * 30), 30), isFalse);
    }
  });

  test(
    'direct texture, unknown encoders and static screens stay unchanged',
    () {
      for (final path in ['D3D11', 'GPU-READBACK-NV12', 'CPU-NV12']) {
        final policy = NativeTexturePolicy();
        for (var i = 1; i < 12; i++) {
          expect(policy.sample(sample(i * 30, path: path), 30), isFalse);
        }
      }
      final policy = NativeTexturePolicy();
      for (var i = 1; i < 12; i++) {
        expect(policy.sample(sample(i, cost: 100, fps: 1), 30), isFalse);
      }
    },
  );

  test(
    'cheap intervals and capture replacement reset accumulated evidence',
    () {
      final policy = NativeTexturePolicy();
      for (var i = 1; i <= 3; i++) {
        expect(policy.sample(sample(i * 30), 30), isFalse);
      }
      expect(policy.sample(sample(120, cost: 6), 30), isFalse);
      expect(policy.sample(sample(150), 30), isFalse);
      expect(policy.sample(sample(180), 30), isFalse);
      expect(policy.sample(sample(30, track: 'replacement'), 30), isFalse);
      expect(policy.sample(sample(60, track: 'replacement'), 30), isFalse);
      expect(policy.sample(sample(90, track: 'replacement'), 30), isFalse);
      expect(policy.sample(sample(120, track: 'replacement'), 30), isTrue);
    },
  );

  test('60 FPS budget detects the bridge without accepting invalid costs', () {
    final policy = NativeTexturePolicy();
    expect(policy.sample({}, 60), isFalse);
    expect(policy.sample(sample(60, fps: 60), 60), isFalse);
    expect(policy.sample(sample(120, cost: double.nan, fps: 60), 60), isFalse);
    expect(policy.sample(sample(180, cost: 9, fps: 60), 60), isFalse);
    expect(policy.sample(sample(240, cost: 9, fps: 60), 60), isFalse);
    expect(policy.sample(sample(300, cost: 9, fps: 60), 60), isTrue);
  });
  test('same-codec software fallback can shed expensive texture readback', () {
    final policy = NativeTexturePolicy();
    for (var i = 1; i <= 4; i++) {
      expect(
        policy.sample({...sample(i * 30, cost: 24), 'encoder': 'OpenH264'}, 30),
        i == 4,
      );
    }
  });
}
