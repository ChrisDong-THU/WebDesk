import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

// Shared visual values from the 0.4.x host's src/style.css.
const accent = Color(0xffb2ecd7);
const background = Color(0xff101416);
const muted = Color(0xff85918e);

ThemeData hostTheme() => ThemeData(
  brightness: Brightness.dark,
  useMaterial3: true,
  fontFamily: 'Segoe UI',
  fontFamilyFallback: const ['Microsoft YaHei'],
  scaffoldBackgroundColor: background,
  colorScheme: const ColorScheme.dark(
    primary: accent,
    surface: Color(0xff191f21),
    onSurface: Color(0xffe6ebed),
  ),
  textSelectionTheme: const TextSelectionThemeData(
    cursorColor: accent,
    selectionColor: Color(0x40b2ecd7),
  ),
);

/// Presentation only. Real and simulated hosts use the same widgets; this view
/// cannot start a service, connect to a server or capture the desktop by itself.
class HostView extends StatefulWidget {
  const HostView({
    super.key,
    required this.address,
    required this.enabled,
    required this.busy,
    required this.connected,
    required this.connectingBrowser,
    required this.device,
    required this.password,
    required this.error,
    required this.onToggle,
    required this.onCopy,
    required this.onRegenerate,
  });
  final TextEditingController address;
  final bool enabled, busy, connected, connectingBrowser;
  final String device, password, error;
  final VoidCallback onToggle;
  final Future<void> Function() onCopy;
  final VoidCallback onRegenerate;

  @override
  State<HostView> createState() => _HostViewState();
}

class _HostViewState extends State<HostView> {
  bool reveal = false, copied = false;
  String copyError = '';
  Timer? copyTimer;

  @override
  void didUpdateWidget(HostView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.enabled != widget.enabled ||
        oldWidget.password != widget.password) {
      reveal = copied = false;
      copyError = '';
      copyTimer?.cancel();
    }
  }

  @override
  void dispose() {
    copyTimer?.cancel();
    super.dispose();
  }

  Future<void> copy() async {
    try {
      await widget.onCopy();
      if (!mounted) return;
      setState(() {
        copied = true;
        copyError = '';
      });
      copyTimer?.cancel();
      copyTimer = Timer(const Duration(seconds: 2), () {
        if (mounted) setState(() => copied = false);
      });
    } catch (_) {
      if (mounted) setState(() => copyError = '复制失败，请重试');
    }
  }

  @override
  Widget build(BuildContext context) {
    final device = widget.device.replaceAllMapped(
      RegExp(r'(\d{3})(?=\d)'),
      (m) => '${m[1]} ',
    );
    final error = widget.error.isNotEmpty ? widget.error : copyError;
    return Scaffold(
      body: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0, -.2),
            radius: .8,
            colors: [Color(0x3523352d), Color(0x0023352d)],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 40),
                child: SizedBox(
                  height: 80,
                  child: Row(
                    children: [
                      SvgPicture.asset(
                        'assets/webdesk-icon.svg',
                        width: 32,
                        height: 32,
                      ),
                      const SizedBox(width: 11),
                      const Text(
                        'WebDesk',
                        style: TextStyle(
                          fontSize: 19,
                          fontWeight: FontWeight.w600,
                          letterSpacing: -.6,
                        ),
                      ),
                      const Spacer(),
                      const Text(
                        'Windows',
                        style: TextStyle(
                          fontSize: 11,
                          color: Color(0xff778580),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              Expanded(
                child: LayoutBuilder(
                  builder: (context, bounds) {
                    return SingleChildScrollView(
                      child: ConstrainedBox(
                        constraints: BoxConstraints(
                          minHeight: bounds.maxHeight,
                        ),
                        child: Padding(
                          padding: bounds.maxHeight < 460
                              ? const EdgeInsets.fromLTRB(24, 16, 24, 24)
                              : const EdgeInsets.fromLTRB(24, 32, 24, 100),
                          child: Center(
                            child: ConstrainedBox(
                              constraints: const BoxConstraints(maxWidth: 380),
                              child: Container(
                                key: const ValueKey('host-card'),
                                padding: const EdgeInsets.all(24),
                                decoration: BoxDecoration(
                                  color: const Color(0xff191f21),
                                  borderRadius: BorderRadius.circular(20),
                                  border: Border.all(
                                    color: const Color(0x0cffffff),
                                  ),
                                  boxShadow: const [
                                    BoxShadow(
                                      color: Color(0x24000000),
                                      blurRadius: 64,
                                      offset: Offset(0, 16),
                                    ),
                                  ],
                                ),
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Container(
                                      clipBehavior: Clip.antiAlias,
                                      decoration: BoxDecoration(
                                        color: const Color(0xff111719),
                                        borderRadius: BorderRadius.circular(12),
                                        border: Border.all(
                                          color: const Color(0x12ffffff),
                                        ),
                                      ),
                                      child: Column(
                                        mainAxisSize: MainAxisSize.min,
                                        children: widget.enabled
                                            ? [
                                                _FloatingField(
                                                  key: const ValueKey(
                                                    'device-field',
                                                  ),
                                                  label: '设备代码',
                                                  value: device,
                                                  mono: true,
                                                ),
                                                const Divider(
                                                  height: 1,
                                                  thickness: 1,
                                                  color: Color(0x0dffffff),
                                                ),
                                                _FloatingField(
                                                  key: const ValueKey(
                                                    'password-field',
                                                  ),
                                                  label: '连接密码',
                                                  value: widget.password,
                                                  secret: !reveal,
                                                  trailing: IconButton(
                                                    tooltip: reveal
                                                        ? '隐藏密码'
                                                        : '显示密码',
                                                    onPressed: () => setState(
                                                      () => reveal = !reveal,
                                                    ),
                                                    style: IconButton.styleFrom(
                                                      foregroundColor:
                                                          const Color(
                                                            0xff829297,
                                                          ),
                                                    ),
                                                    icon: _LineIcon(
                                                      reveal ? 'eyeOff' : 'eye',
                                                      size: 19,
                                                    ),
                                                  ),
                                                ),
                                              ]
                                            : [
                                                _FloatingField(
                                                  key: const ValueKey(
                                                    'server-field',
                                                  ),
                                                  label: '服务地址',
                                                  controller: widget.address,
                                                  enabled: !widget.busy,
                                                  onSubmitted: (_) {
                                                    if (!widget.busy) {
                                                      widget.onToggle();
                                                    }
                                                  },
                                                ),
                                              ],
                                      ),
                                    ),
                                    const SizedBox(height: 16),
                                    _BrowserStatus(
                                      enabled: widget.enabled,
                                      busy: widget.busy,
                                      connected: widget.connected,
                                      connecting: widget.connectingBrowser,
                                      hasError: widget.error.isNotEmpty,
                                    ),
                                    const SizedBox(height: 24),
                                    Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.center,
                                      children: [
                                        if (widget.enabled) ...[
                                          _RoundAction(
                                            label: copied ? '已复制' : '复制连接信息',
                                            icon: copied ? 'check' : 'copy',
                                            foreground: accent,
                                            fill: const Color(0x0ab2ecd7),
                                            border: const Color(0x1cb2ecd7),
                                            onPressed: copy,
                                          ),
                                          const SizedBox(width: 16),
                                        ],
                                        _RoundAction(
                                          label: widget.enabled
                                              ? '停止远程控制'
                                              : widget.busy
                                              ? '开启中'
                                              : '开启远程控制',
                                          icon: 'power',
                                          loading:
                                              widget.busy && !widget.enabled,
                                          foreground: widget.enabled
                                              ? const Color(0xffdea79b)
                                              : const Color(0xff1a3c32),
                                          fill: widget.enabled
                                              ? const Color(0x0cd79283)
                                              : accent,
                                          border: widget.enabled
                                              ? const Color(0x25d79283)
                                              : const Color(0x33d4f8e7),
                                          onPressed:
                                              widget.busy && !widget.enabled
                                              ? null
                                              : widget.onToggle,
                                        ),
                                        const SizedBox(width: 16),
                                        _RoundAction(
                                          label: '重新生成设备代码和密码',
                                          icon: 'refresh',
                                          foreground: accent,
                                          fill: const Color(0x0ab2ecd7),
                                          border: const Color(0x1cb2ecd7),
                                          onPressed: widget.busy
                                              ? null
                                              : widget.onRegenerate,
                                        ),
                                      ],
                                    ),
                                    if (error.isNotEmpty)
                                      Padding(
                                        padding: const EdgeInsets.only(top: 18),
                                        child: Semantics(
                                          liveRegion: true,
                                          child: Container(
                                            width: double.infinity,
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 14,
                                              vertical: 12,
                                            ),
                                            decoration: BoxDecoration(
                                              color: const Color(0x0bde8b7f),
                                              borderRadius:
                                                  BorderRadius.circular(8),
                                              border: Border.all(
                                                color: const Color(0x33df9288),
                                              ),
                                            ),
                                            child: Text(
                                              error,
                                              style: const TextStyle(
                                                fontSize: 12,
                                                height: 1.7,
                                                color: Color(0xffe5aea3),
                                              ),
                                            ),
                                          ),
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FloatingField extends StatefulWidget {
  const _FloatingField({
    super.key,
    required this.label,
    this.controller,
    this.value = '',
    this.secret = false,
    this.mono = false,
    this.enabled = true,
    this.trailing,
    this.onSubmitted,
  });
  final String label, value;
  final TextEditingController? controller;
  final bool secret, mono, enabled;
  final Widget? trailing;
  final ValueChanged<String>? onSubmitted;
  @override
  State<_FloatingField> createState() => _FloatingFieldState();
}

class _FloatingFieldState extends State<_FloatingField> {
  final focus = FocusNode();
  late final TextEditingController display;
  TextEditingController get controller => widget.controller ?? display;
  @override
  void initState() {
    super.initState();
    display = TextEditingController(text: widget.value);
    focus.addListener(changed);
    controller.addListener(changed);
  }

  void changed() {
    if (mounted) setState(() {});
  }

  @override
  void didUpdateWidget(_FloatingField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      (oldWidget.controller ?? display).removeListener(changed);
      controller.addListener(changed);
    }
    if (oldWidget.value != widget.value) display.text = widget.value;
  }

  @override
  void dispose() {
    controller.removeListener(changed);
    focus.dispose();
    display.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final floating = focus.hasFocus || controller.text.isNotEmpty;
    final duration = MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 180);
    return AnimatedContainer(
      duration: duration,
      height: 62,
      color: focus.hasFocus ? const Color(0x05b2ecd7) : Colors.transparent,
      child: Stack(
        children: [
          if (focus.hasFocus)
            const Positioned(
              left: 0,
              top: 0,
              bottom: 0,
              child: SizedBox(width: 3, child: ColoredBox(color: accent)),
            ),
          Positioned.fill(
            child: TextField(
              controller: controller,
              focusNode: focus,
              enabled: widget.enabled,
              readOnly: widget.controller == null,
              obscureText: widget.secret,
              enableSuggestions: false,
              autocorrect: false,
              keyboardType: TextInputType.url,
              onSubmitted: widget.onSubmitted,
              style: TextStyle(
                fontSize: widget.mono ? 19 : 16,
                height: 1.5,
                letterSpacing: widget.mono ? 2 : 0,
                fontFamily: widget.mono ? 'Consolas' : null,
                color: const Color(0xffe4ece8),
              ),
              decoration: InputDecoration(
                isDense: true,
                filled: false,
                contentPadding: EdgeInsets.fromLTRB(
                  18,
                  23,
                  widget.trailing != null ? 54 : 18,
                  7,
                ),
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                disabledBorder: InputBorder.none,
              ),
            ),
          ),
          AnimatedPositioned(
            duration: duration,
            curve: Curves.easeOut,
            left: 18,
            top: floating ? 7 : 21,
            child: IgnorePointer(
              child: AnimatedDefaultTextStyle(
                duration: duration,
                style: TextStyle(
                  fontFamily: 'Segoe UI',
                  fontFamilyFallback: const ['Microsoft YaHei'],
                  fontSize: floating ? 10 : 13,
                  height: 1.5,
                  color: focus.hasFocus ? accent : const Color(0xff8c9b9e),
                ),
                child: Text(widget.label),
              ),
            ),
          ),
          if (widget.trailing != null)
            Positioned(
              right: 10,
              top: 13,
              width: 36,
              height: 36,
              child: widget.trailing!,
            ),
        ],
      ),
    );
  }
}

class _BrowserStatus extends StatelessWidget {
  const _BrowserStatus({
    required this.enabled,
    required this.busy,
    required this.connected,
    required this.connecting,
    required this.hasError,
  });
  final bool enabled, busy, connected, connecting, hasError;
  @override
  Widget build(BuildContext context) {
    final text = connected
        ? '已连接'
        : hasError
        ? '连接异常'
        : connecting
        ? '正在连接'
        : busy
        ? '连接服务中'
        : enabled
        ? '等待连接'
        : '未开启';
    final color = connected
        ? accent
        : hasError
        ? const Color(0xffdea79b)
        : busy
        ? const Color(0xffe2c38d)
        : muted;
    return Semantics(
      liveRegion: true,
      label: '浏览器，$text',
      excludeSemantics: true,
      child: Container(
        key: const ValueKey('browser-status'),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: connected ? const Color(0x08b2ecd7) : const Color(0x03ffffff),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          children: [
            const _LineIcon('browser', size: 15, color: muted),
            const SizedBox(width: 8),
            const Text('浏览器', style: TextStyle(fontSize: 11, color: muted)),
            const Spacer(),
            Container(
              width: 5,
              height: 5,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 7),
            Text(text, style: TextStyle(fontSize: 11, color: color)),
          ],
        ),
      ),
    );
  }
}

class _RoundAction extends StatelessWidget {
  const _RoundAction({
    required this.label,
    required this.icon,
    required this.foreground,
    required this.fill,
    required this.border,
    required this.onPressed,
    this.loading = false,
  });
  final String label, icon;
  final Color foreground, fill, border;
  final VoidCallback? onPressed;
  final bool loading;
  @override
  Widget build(BuildContext context) => Tooltip(
    message: label,
    child: Semantics(
      label: label,
      button: true,
      enabled: onPressed != null,
      child: SizedBox(
        width: 52,
        height: 52,
        child: IconButton(
          onPressed: onPressed,
          style: IconButton.styleFrom(
            backgroundColor: fill,
            foregroundColor: foreground,
            disabledBackgroundColor: fill.withValues(alpha: .5),
            side: BorderSide(color: border),
            shape: const CircleBorder(),
            padding: EdgeInsets.zero,
          ),
          icon: loading
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 1.5,
                    color: Color(0xff1a3c32),
                  ),
                )
              : _LineIcon(icon, size: 21),
        ),
      ),
    ),
  );
}

// Same 24px outline paths as the web UI; no Material icon-style mismatch.
class _LineIcon extends StatelessWidget {
  const _LineIcon(this.name, {this.size = 21, this.color});
  final String name;
  final double size;
  final Color? color;
  static const paths = {
    'power': 'M12 2v10M6.5 5a9 9 0 1 0 11 0',
    'copy': 'M9 9h11v11H9V9ZM5 15H3V3h12v2',
    'check': 'm5 12 4 4L19 6',
    'refresh':
        'M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9',
    'eye':
        'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    'eyeOff':
        'm3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9 5.5c1-.3 2-.5 3-.5 6.5 0 10 7 10 7a21 21 0 0 1-3 4M6 6.5A23 23 0 0 0 2 12s3.5 7 10 7c1.8 0 3.5-.5 5-1.3',
    'browser':
        'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM3 8h18M6 5.5h.01M9 5.5h.01',
  };
  @override
  Widget build(BuildContext context) => SvgPicture.string(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><path d="${paths[name]}" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    width: size,
    height: size,
    excludeFromSemantics: true,
    colorFilter: ColorFilter.mode(
      color ?? IconTheme.of(context).color ?? accent,
      BlendMode.srcIn,
    ),
  );
}
