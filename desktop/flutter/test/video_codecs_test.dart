import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:webdesk/session/video_codecs.dart';

void main() {
  RTCRtpCodecCapability codec(String mime, [String? fmtp]) =>
      RTCRtpCodecCapability(
        mimeType: mime,
        clockRate: 90000,
        sdpFmtpLine: fmtp,
      );
  test('no policy preserves platform order and capability identity', () {
    final caps = [
      codec('video/VP8'),
      codec('video/rtx'),
      codec('video/AV1'),
      codec('video/H264'),
    ];
    expect(desktopCodecPreferences(caps), caps);
    for (var i = 0; i < caps.length; i++) {
      expect(desktopCodecPreferences(caps)[i], same(caps[i]));
    }
  });
  test(
    'policy retains all profiles and repair objects without duplication',
    () {
      final h264 = codec('video/H264', 'profile-level-id=42e01f'),
          high = codec('video/H264', 'profile-level-id=640c1f');
      final av1 = codec('video/AV1'),
          vp9 = codec('video/VP9', 'profile-id=0'),
          vp9b = codec('video/VP9', 'profile-id=2');
      final vp8 = codec('video/VP8'), rtx = codec('video/rtx');
      final caps = [vp8, rtx, h264, av1, high, vp9, vp9b];
      expect(
        desktopCodecPreferences(
          caps,
          order: ['video/AV1', 'video/h264', 'video/h264'],
        ),
        [av1, h264, high, vp8, rtx, vp9, vp9b],
      );
      expect(caps.first, same(vp8));
    },
  );
  test(
    'all formats can be reordered; unavailable formats are never invented',
    () {
      final h = codec('video/H264'),
          a = codec('video/AV1'),
          v = codec('video/VP8');
      expect(
        desktopCodecPreferences(
          [h, a, v],
          order: ['video/av1', 'video/vp8', 'video/h264'],
        ),
        [a, v, h],
      );
      expect(desktopCodecPreferences([v], order: ['video/h264']), [v]);
      expect(desktopCodecPreferences([], order: ['video/h264']), isEmpty);
    },
  );
}
