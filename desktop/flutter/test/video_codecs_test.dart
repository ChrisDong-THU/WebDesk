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
  test(
    'desktop preference retains profiles, repair codecs and capability objects',
    () {
      final vp8 = codec('video/VP8'),
          h264 = codec('video/H264', 'profile-level-id=42e01f');
      final vp9 = codec('video/VP9', 'profile-id=0'), av1 = codec('video/AV1');
      final rtx = codec('video/rtx'), red = codec('video/red');
      final secondProfile = codec('video/VP9', 'profile-id=2');
      final original = [vp8, rtx, h264, av1, vp9, secondProfile, red];
      expect(desktopCodecPreferences(original), [
        av1,
        vp9,
        secondProfile,
        vp8,
        h264,
        rtx,
        red,
      ]);
      expect(original.first, same(vp8));
      expect(desktopCodecPreferences(original)[1].sdpFmtpLine, 'profile-id=0');
    },
  );
  test(
    'missing modern codecs preserve compatible fallbacks without inventing support',
    () {
      final vp8 = codec('video/VP8'),
          h264 = codec('video/H264'),
          rtx = codec('video/rtx');
      expect(desktopCodecPreferences([h264, rtx, vp8]), [vp8, h264, rtx]);
      expect(desktopCodecPreferences([h264]), [h264]);
      expect(desktopCodecPreferences([]), isEmpty);
    },
  );
}
