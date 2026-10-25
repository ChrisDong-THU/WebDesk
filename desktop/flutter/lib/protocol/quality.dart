class Quality {
  const Quality({
    this.height = 4320,
    this.fps = 60,
    this.bitrate = 0,
    this.contentHint = 'detail',
    this.degradationPreference = 'auto',
    this.networkMode = 'auto',
    this.codecPreference = 'auto',
  });
  final int height;
  final int fps;
  final int bitrate;
  final String contentHint;
  final String degradationPreference;
  final String networkMode;
  final String codecPreference;
  static const codecs = ['auto', 'H264', 'AV1', 'VP9', 'VP8'];
  static const degradations = [
    'auto',
    'balanced',
    'maintain-framerate',
    'maintain-resolution',
    'disabled',
  ];
  static const networks = ['auto', 'low-latency'];
  static const heights = [360, 720, 1080, 1440, 2160, 4320];
  static const rates = [10, 20, 30, 60];
  static const bitrates = [0, 1000, 2000, 4000, 8000, 16000];
  factory Quality.fromMap(Map value) {
    int integer(String key) {
      final item = value[key];
      if (item is! int) throw FormatException('无效的画质参数：$key');
      return item;
    }

    String text(String key) {
      final item = value[key];
      if (item is! String) throw FormatException('无效的画质参数：$key');
      return item;
    }

    return Quality(
      height: integer('resolutionRatio'),
      fps: integer('maxFramerate'),
      bitrate: integer('maxBitrate'),
      contentHint: text('videoContentHint'),
      degradationPreference: text('degradationPreference'),
      networkMode: text('networkMode'),
      codecPreference: text('codecPreference'),
    ).validated();
  }

  Map<String, Object> toMap() => {
    'resolutionRatio': height,
    'maxFramerate': fps,
    'maxBitrate': bitrate,
    'videoContentHint': contentHint,
    'degradationPreference': degradationPreference,
    'networkMode': networkMode,
    'codecPreference': codecPreference,
  };

  Quality validated() {
    if (!heights.contains(height) ||
        !rates.contains(fps) ||
        !bitrates.contains(bitrate) ||
        !['', 'detail', 'text', 'motion'].contains(contentHint) ||
        !degradations.contains(degradationPreference) ||
        !networks.contains(networkMode) ||
        !codecs.contains(codecPreference)) {
      throw const FormatException('无效的画质设置');
    }
    return this;
  }

  Quality change(String type, dynamic value) {
    const fields = {
      'changeResolutionRatio': 'resolutionRatio',
      'changeMaxFramerate': 'maxFramerate',
      'changeMaxBitrate': 'maxBitrate',
      'changeVideoContentHint': 'videoContentHint',
      'changeDegradationPreference': 'degradationPreference',
      'changeNetworkMode': 'networkMode',
      'changeVideoCodec': 'codecPreference',
    };
    final field = fields[type];
    if (field == null) throw const FormatException('未知的画质设置');
    return Quality.fromMap({...toMap(), field: value});
  }
}
