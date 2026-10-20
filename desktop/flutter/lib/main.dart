import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:window_manager/window_manager.dart';
import 'package:tray_manager/tray_manager.dart';

import 'session/host_controller.dart';
import 'session/cleanup.dart';
import 'native/tray_menu.dart';
import 'ui/host_view.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await windowManager.ensureInitialized();
  // Windows signals ready-to-show after the first Flutter frame. Waiting for
  // it before runApp leaves a transparent native window indefinitely.
  runApp(const WebDeskApp());
  await windowManager.waitUntilReadyToShow(
    const WindowOptions(
      size: Size(860, 620),
      minimumSize: Size(600, 460),
      center: true,
      title: 'WebDesk',
      backgroundColor: background,
    ),
    () async {
      await windowManager.show();
      await windowManager.focus();
    },
  );
}

class WebDeskApp extends StatelessWidget {
  const WebDeskApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'WebDesk',
    debugShowCheckedModeBanner: false,
    theme: hostTheme(),
    home: const HostPage(),
  );
}

class HostPage extends StatefulWidget {
  const HostPage({super.key});
  @override
  State<HostPage> createState() => _HostPageState();
}

class _HostPageState extends State<HostPage> with WindowListener, TrayListener {
  final host = HostController();
  final address = TextEditingController();
  final trayMenu = TrayMenu(() => trayManager.popUpContextMenu());
  bool trayReady = false;
  String trayError = '';
  bool quitting = false;
  @override
  void initState() {
    super.initState();
    windowManager.addListener(this);
    trayManager.addListener(this);
    host.addListener(_changed);
    unawaited(
      host.load().then((_) {
        if (mounted) address.text = host.server;
      }),
    );
    unawaited(_tray().catchError(_trayFailed));
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  Future<void> _tray() async {
    await windowManager.setPreventClose(true);
    if (!mounted || quitting) return;
    await trayManager.setIcon('assets/webdesk.ico');
    if (!mounted || quitting) {
      await trayManager.destroy();
      return;
    }
    await trayManager.setToolTip('WebDesk');
    await trayManager.setContextMenu(
      Menu(
        items: [
          MenuItem(key: 'show', label: '打开 WebDesk'),
          MenuItem.separator(),
          MenuItem(key: 'exit', label: '退出 WebDesk'),
        ],
      ),
    );
    if (mounted && !quitting) trayReady = true;
  }

  void _trayFailed(Object error) {
    if (mounted && !quitting) {
      setState(() => trayError = '托盘操作失败：$error');
    }
  }

  @override
  void onWindowClose() {
    // If tray initialization failed, keep a reachable window instead of
    // hiding the only way the user can interact with the application.
    if (!quitting && trayReady) {
      unawaited(windowManager.hide().catchError(_trayFailed));
    }
  }

  @override
  void onTrayIconMouseDown() {
    unawaited(_show());
  }

  @override
  void onTrayIconRightMouseDown() {
    if (trayReady && !quitting) {
      unawaited(trayMenu.open().catchError(_trayFailed));
    }
  }

  Future<void> _show() async {
    if (quitting || !mounted) return;
    try {
      if (await windowManager.isMinimized()) await windowManager.restore();
      await windowManager.show();
      await windowManager.focus();
    } catch (error) {
      _trayFailed(error);
    }
  }

  @override
  void onTrayMenuItemClick(MenuItem item) {
    if (item.key == 'show') unawaited(_show());
    if (item.key == 'exit') unawaited(_quit());
  }

  Future<void> _quit() async {
    if (quitting) return;
    quitting = true;
    trayMenu.dispose();
    try {
      await cleanup({
        'remote session': host.disable,
        'tray': trayManager.destroy,
        'window': windowManager.destroy,
      });
    } catch (error) {
      stderr.writeln(error);
    } finally {
      exit(0);
    }
  }

  @override
  void dispose() {
    trayMenu.dispose();
    windowManager.removeListener(this);
    trayManager.removeListener(this);
    host.removeListener(_changed);
    host.dispose();
    address.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => HostView(
    address: address,
    enabled: host.enabled,
    busy: host.busy,
    connected: host.connected,
    connectingBrowser: host.connectingBrowser,
    device: host.device,
    password: host.password,
    error: [
      host.error,
      trayError,
    ].where((value) => value.isNotEmpty).join('\n'),
    onToggle: () => host.enabled ? host.disable() : host.enable(address.text),
    onRegenerate: host.regenerate,
    onCopy: () => Clipboard.setData(
      ClipboardData(
        text: 'WebDesk\n设备代码：${host.device}\n连接密码：${host.password}',
      ),
    ),
  );
}
