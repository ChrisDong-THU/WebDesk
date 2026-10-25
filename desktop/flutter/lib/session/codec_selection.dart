import '../protocol/quality.dart';

/// Capability negotiation and implementation fallback are separate decisions.
/// The initial order is a product preference, not a measured quality ranking.
/// Observe actual sender/receiver cost before trying another supported codec.
class CodecSelection {
  static const known = ['video/av1', 'video/vp9', 'video/h264', 'video/vp8'];
  Set<String> _local = {}, _remote = {};
  bool _hardwareH264 = false;
  String _preference = 'auto', _context = '', reason = '等待编码能力';
  List<String> _order = [];
  List<String> get order => List.unmodifiable(_order);
  List<String> get supported => known.where(_available.contains).toList();
  Set<String> get _available =>
      _remote.isEmpty ? _local : _local.intersection(_remote);
  final Set<String> _avoid = {};
  int switches = 0, attempts = 0, _bad = 0, _bandwidthBad = 0;
  DateTime? _settleUntil, _switchAt, _receiverAt;
  Map<String, dynamic> _receiver = {};
  String? _current, _pending;
  num? _frames;
  int cooldownMs(DateTime now) => _switchAt == null
      ? 0
      : (_switchAt!
                .add(const Duration(seconds: 45))
                .difference(now)
                .inMilliseconds)
            .clamp(0, 45000);

  void initialize(
    Iterable<String> capabilities,
    Quality quality,
    DateTime now, {
    required bool hardware,
  }) {
    _local = capabilities
        .map((s) => s.toLowerCase())
        .where(known.contains)
        .toSet();
    _hardwareH264 = hardware;
    configure(quality, now, force: true);
  }

  List<String> _prior(Quality quality) {
    // Software AV1/VP9 may preserve desktop detail with less bandwidth. For
    // motion/latency settings prefer a low-delay implementation, with actual
    // hardware availability as a prior rather than a guarantee of performance.
    final latency =
        quality.networkMode == 'low-latency' ||
        quality.contentHint == 'motion' ||
        quality.degradationPreference == 'maintain-framerate';
    final prior = latency
        ? (_hardwareH264
              ? ['video/h264', 'video/av1', 'video/vp9', 'video/vp8']
              : ['video/h264', 'video/vp8', 'video/vp9', 'video/av1'])
        : (_hardwareH264
              ? ['video/av1', 'video/h264', 'video/vp9', 'video/vp8']
              : ['video/av1', 'video/vp9', 'video/h264', 'video/vp8']);
    if (quality.codecPreference != 'auto') {
      final wanted = 'video/${quality.codecPreference.toLowerCase()}';
      return [wanted, ...prior.where((c) => c != wanted)];
    }
    return prior;
  }

  bool configure(Quality quality, DateTime now, {bool force = false}) {
    final previousOrder = _order.join(',');
    final context =
        '${quality.height}/${quality.fps}/${quality.bitrate}/${quality.contentHint}/${quality.networkMode}/${quality.degradationPreference}';
    if (!force &&
        context == _context &&
        _preference == quality.codecPreference) {
      return false;
    }
    _context = context;
    _preference = quality.codecPreference;
    _avoid.clear();
    _bad = _bandwidthBad = 0;
    _pending = null;
    _order = _prior(quality).where(_available.contains).toList();
    final wanted = 'video/${_preference.toLowerCase()}';
    reason = _preference == 'auto'
        ? (quality.networkMode == 'low-latency' ||
                  quality.contentHint == 'motion' ||
                  quality.degradationPreference == 'maintain-framerate'
              ? '自动：按延迟设置和可用实现选择，等待实测'
              : '自动：优先桌面细节和压缩效率，等待实测')
        : (_available.contains(wanted)
              ? '用户首选 $_preference'
              : '对端不支持首选 $_preference，使用协商后备');
    _settleUntil = now.add(const Duration(seconds: 6));
    return force || _order.join(',') != previousOrder;
  }

  /// Read only video rtpmap declarations. WebRTC still checks profile/fmtp and
  /// RTX associations; this list never fabricates support or rewrites SDP.
  void acceptAnswer(String sdp) {
    final result = <String>{};
    var video = false;
    for (final line in sdp.split(RegExp(r'\r?\n'))) {
      if (line.startsWith('m=')) {
        video = line.startsWith('m=video ') && !line.startsWith('m=video 0 ');
      }
      if (!video) continue;
      final match = RegExp(
        r'^a=rtpmap:\d+ (AV1|VP9|H264|VP8)/',
        caseSensitive: false,
      ).firstMatch(line);
      if (match != null) result.add('video/${match[1]!.toLowerCase()}');
    }
    if (result.isNotEmpty) {
      _remote = result;
      // Keep unsupported names out of future trial orders. Capability objects
      // still remain intact in the actual transceiver preferences.
      _order = _order.where(_available.contains).toList();
      if (_preference != 'auto') {
        reason = _available.contains('video/${_preference.toLowerCase()}')
            ? '用户首选 $_preference'
            : '对端不支持首选 $_preference，使用协商后备';
      }
    }
  }

  static double? number(Map stats, String key, {double max = double.infinity}) {
    final value = stats[key];
    return value is num && value.isFinite && value >= 0 && value <= max
        ? value.toDouble()
        : null;
  }

  void receiverFeedback(Map data, DateTime now) {
    if (_receiverAt != null &&
        now.difference(_receiverAt!).inMilliseconds < 750) {
      return;
    }
    final codec = data['codec'];
    if (codec is! String || !known.contains(codec.toLowerCase())) return;
    _receiver = {'codec': codec.toLowerCase()};
    for (final key in [
      'decodeMs',
      'fps',
      'jitterBufferMs',
      'freezes',
      'dropped',
    ]) {
      final value = number(
        data,
        key,
        max: key == 'fps'
            ? 240
            : key == 'decodeMs' || key == 'jitterBufferMs'
            ? 10000
            : 1e12,
      );
      if (value != null) _receiver[key] = value;
    }
    _receiverAt = now;
  }

  bool sample(Map<String, dynamic> stats, Quality quality, DateTime now) {
    final codec = stats['codec']?.toString().toLowerCase();
    if (codec == null || !_available.contains(codec)) return false;
    if (_current != codec) {
      if (_current != null) switches++;
      _current = codec;
      _frames = null;
      _bad = _bandwidthBad = 0;
      _settleUntil = now.add(const Duration(seconds: 6));
      if (_pending != null) {
        if (codec != _pending) {
          _avoid.add(_pending!);
          reason = '对端保留 $codec，暂停尝试 $_pending';
        }
        _pending = null;
      }
    }
    final frames = number(stats, 'framesEncoded');
    if (frames == null) {
      _bad = _bandwidthBad = 0;
      return false;
    }
    if (_frames != null && frames < _frames!) {
      captureChanged(now);
      _frames = frames;
      return false;
    }
    if (frames == _frames) {
      _bad = _bandwidthBad = 0;
      return false;
    }
    _frames = frames;
    if (_pending != null &&
        _switchAt != null &&
        now.difference(_switchAt!).inSeconds >= 10) {
      _avoid.add(_pending!);
      reason = '协商后仍使用 $codec，暂停尝试 $_pending';
      _pending = null;
    }
    if (now.isBefore(_settleUntil ?? now) || _preference != 'auto') {
      return false;
    }
    final fps = number(stats, 'fps'), encode = number(stats, 'encodeMs');
    if (fps == null || encode == null || fps < 1) return false;
    // Slow static screens aren't encoder saturation. Sender's CPU signal is
    // accepted independently; GPU readback is repaired by NativeTexturePolicy
    // before this policy runs, and must settle before a codec trial.
    final cpu =
        stats['qualityLimit'] == 'cpu' ||
        (fps >= quality.fps.clamp(1, 60) * .5 && fps * encode > 850);
    final feedback =
        _receiverAt != null &&
        now.difference(_receiverAt!).inSeconds <= 6 &&
        _receiver['codec'] == codec;
    final decode = feedback ? number(_receiver, 'decodeMs') : null;
    final receiverFps = feedback ? number(_receiver, 'fps') : null;
    final decodeBad =
        decode != null &&
        receiverFps != null &&
        receiverFps >= 5 &&
        decode * receiverFps > 850;
    _bad = cpu || decodeBad ? _bad + 1 : 0;
    final available = number(stats, 'availableBitrate');
    final loss = number(stats, 'packetLoss');
    final detail =
        quality.contentHint != 'motion' &&
        quality.networkMode != 'low-latency' &&
        quality.degradationPreference != 'maintain-framerate';
    final bandwidth =
        detail &&
        stats['qualityLimit'] == 'bandwidth' &&
        available != null &&
        available > 0 &&
        loss != null &&
        loss < .02;
    _bandwidthBad = bandwidth ? _bandwidthBad + 1 : 0;
    if ((_bad < 4 && _bandwidthBad < 6) ||
        cooldownMs(now) > 0 ||
        _avoid.length >= 3) {
      return false;
    }
    // Never change codecs just for packet loss: the existing congestion/quality
    // budgets own that case. Only try a more efficient format under sustained
    // clean-path bandwidth pressure, or another implementation under load.
    final candidates = _prior(quality)
        .where(
          (c) => c != codec && _available.contains(c) && !_avoid.contains(c),
        )
        .toList();
    if (_bad < 4) {
      final efficient = _available.contains('video/av1')
          ? 'video/av1'
          : 'video/vp9';
      candidates.removeWhere((c) => c != efficient);
    }
    if (candidates.isEmpty) {
      reason = '自动：保留当前编码，无可用且未受压的候选';
      return false;
    }
    // Candidates follow the user's objective and actual implementation prior.
    // This is a bounded trial, not an unobserved claim of better performance.
    final next = candidates.first;
    _avoid.add(codec);
    _pending = next;
    _order = [
      next,
      ..._prior(quality).where(
        (c) => c != next && _available.contains(c) && !_avoid.contains(c),
      ),
      ..._prior(
        quality,
      ).where((c) => c != next && _available.contains(c) && _avoid.contains(c)),
    ];
    reason = _bad >= 4
        ? (decodeBad ? '自动：接收端解码持续受压，尝试 $next' : '自动：编码持续受压，尝试 $next')
        : '自动：带宽持续受限，尝试 $next 保留细节';
    _bad = _bandwidthBad = 0;
    _switchAt = now;
    _settleUntil = now.add(const Duration(seconds: 6));
    attempts++;
    return true;
  }

  void captureChanged(DateTime now) {
    _bad = _bandwidthBad = 0;
    _frames = null;
    _settleUntil = now.add(const Duration(seconds: 6));
  }
}
