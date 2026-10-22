import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:webdesk/protocol/quality.dart';
import 'package:webdesk/session/video_policy.dart';

void main() {
  test('Auto grows with output pixels and fps but stays bounded', () {
    final hd = videoBitrateLimit(const Quality(), 1920, 1080);
    final uhd = videoBitrateLimit(const Quality(), 3840, 2160);
    expect(hd, greaterThan(2500000));
    expect(uhd, greaterThan(hd));
    expect(uhd, lessThanOrEqualTo(32000000));
    expect(videoBitrateLimit(const Quality(), 7680, 4320), 32000000);
    expect(videoBitrateLimit(const Quality(fps: 30), 1920, 1080), lessThan(hd));
    expect(videoBitrateLimit(const Quality(height: 1080), 3840, 2160), hd);
    expect(videoBitrateLimit(const Quality(fps: 120), 1920, 1080), hd);
    expect(
      videoBitrateLimit(const Quality(height: 720, fps: 10), 1920, 1080),
      2000000,
    );
  });

  test(
    'explicit caps stay exact and Auto restores its ceiling after a low cap',
    () {
      final parameters = RTCRtpParameters(
        transactionId: 'current',
        encodings: [
          RTCRtpEncoding(
            ssrc: 42,
            rid: 'video',
            minBitrate: 0,
            scalabilityMode: '',
          ),
        ],
      );
      for (final cap in Quality.bitrates.where((b) => b > 0)) {
        configureVideoParameters(parameters, Quality(bitrate: cap), 3840, 2160);
        expect(parameters.encodings!.single.maxBitrate, cap * 1000);
      }
      configureVideoParameters(parameters, const Quality(), 3840, 2160);
      expect(parameters.encodings!.single.maxBitrate, greaterThan(16000000));
      expect(parameters.encodings!.single.minBitrate, isNull);
      expect(parameters.encodings!.single.scalabilityMode, isNull);
      expect(parameters.encodings!.single.ssrc, 42);
      expect(parameters.encodings!.single.rid, 'video');
      expect(parameters.transactionId, 'current');
    },
  );

  test(
    'desktop defaults preserve detail; motion and secure capture use their own limits',
    () {
      final parameters = RTCRtpParameters(encodings: [RTCRtpEncoding()]);
      configureVideoParameters(
        parameters,
        const Quality(height: 1080),
        3840,
        2160,
      );
      expect(
        parameters.degradationPreference,
        RTCDegradationPreference.MAINTAIN_RESOLUTION,
      );
      expect(parameters.encodings!.single.scaleResolutionDownBy, 2);
      configureVideoParameters(parameters, const Quality(fps: 120), 1920, 1080);
      expect(parameters.encodings!.single.maxFramerate, 60);
      configureVideoParameters(
        parameters,
        const Quality(contentHint: 'motion'),
        1920,
        1080,
      );
      expect(
        parameters.degradationPreference,
        RTCDegradationPreference.MAINTAIN_FRAMERATE,
      );
      configureVideoParameters(
        parameters,
        const Quality(height: 1080, fps: 120),
        3840,
        2160,
        secure: true,
      );
      expect(parameters.encodings!.single.scaleResolutionDownBy, 1);
      expect(parameters.encodings!.single.maxFramerate, 30);
      expect(
        parameters.encodings!.single.maxBitrate,
        videoBitrateLimit(const Quality(fps: 30), 1920, 1080),
      );
    },
  );

  test(
    'wire content hints survive other changes and reject invalid values',
    () {
      final quality = Quality.fromMap({
        'resolutionRatio': 1080,
        'maxFramerate': 30,
        'maxBitrate': 1000,
        'videoContentHint': 'text',
      });
      expect(quality.change('changeMaxBitrate', 4000).contentHint, 'text');
      expect(
        quality.change('changeVideoContentHint', 'motion').contentHint,
        'motion',
      );
      expect(
        () => quality.change('changeVideoContentHint', 'unknown'),
        throwsFormatException,
      );
    },
  );
}
