class Quality {
  const Quality({
    this.height = 4320,
    this.fps = 60,
    this.bitrate = 0,
    this.contentHint = 'detail',
  });
  final int height;
  final int fps;
  final int bitrate;
  final String contentHint;
  static const heights = [360, 720, 1080, 1440, 2160, 4320];
  static const rates = [10, 20, 30, 60, 120];
  static const bitrates = [0, 1000, 2000, 4000, 8000, 16000];
  factory Quality.fromMap(Map value) => Quality(
    height: value['resolutionRatio'] as int,
    fps: value['maxFramerate'] as int,
    bitrate: value['maxBitrate'] as int,
    contentHint: value['videoContentHint'] as String? ?? 'detail',
  ).validated();
  Quality validated() {
    if (!heights.contains(height) ||
        !rates.contains(fps) ||
        !bitrates.contains(bitrate) ||
        !['', 'detail', 'text', 'motion'].contains(contentHint)) {
      throw const FormatException('无效的画质设置');
    }
    return this;
  }

  Quality change(String type, dynamic value) => Quality(
    height: type == 'changeResolutionRatio' ? value as int : height,
    fps: type == 'changeMaxFramerate' ? value as int : fps,
    bitrate: type == 'changeMaxBitrate' ? value as int : bitrate,
    contentHint: type == 'changeVideoContentHint'
        ? value as String
        : contentHint,
  ).validated();
}
