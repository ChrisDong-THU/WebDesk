import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:webdesk/ui/host_view.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const captureKey = ValueKey('capture');
  final export = Platform.environment['WEBDESK_UI_EXPORT'];

  setUpAll(() async {
    // Optional screenshots use installed Windows fonts, not Flutter's test font.
    if (export == null) return;
    for (final font in {
      'Segoe UI': 'segoeui.ttf',
      'Microsoft YaHei': 'msyh.ttc',
      'Consolas': 'consola.ttf',
    }.entries) {
      final bytes = await File(
        '${Platform.environment['SystemRoot']}/Fonts/${font.value}',
      ).readAsBytes();
      await (FontLoader(
        font.key,
      )..addFont(Future.value(ByteData.sublistView(bytes)))).load();
    }
  });

  Future<void> show(
    WidgetTester tester, {
    bool enabled = false,
    bool busy = false,
    bool connected = false,
    bool connecting = false,
    String error = '',
    Size size = const Size(860, 620),
    VoidCallback? toggle,
    Future<void> Function()? copy,
    VoidCallback? regenerate,
    TextEditingController? address,
  }) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = size;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller =
        address ?? TextEditingController(text: 'https://120.55.241.162');
    if (address == null) addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: hostTheme(),
        home: RepaintBoundary(
          key: captureKey,
          child: HostView(
            address: controller,
            enabled: enabled,
            busy: busy,
            connected: connected,
            connectingBrowser: connecting,
            device: '123456789',
            password: 'DemoOnly123456789',
            error: error,
            onToggle: toggle ?? () {},
            onCopy: copy ?? () async {},
            onRegenerate: regenerate ?? () {},
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 300));
    expect(tester.takeException(), isNull);
  }

  Future<void> screenshot(WidgetTester tester, String name) async {
    if (export == null) return;
    await tester.runAsync(() async {
      final boundary = tester.renderObject<RenderRepaintBoundary>(
        find.byKey(captureKey),
      );
      final image = await boundary.toImage(pixelRatio: 2);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      File('$export/$name.png').writeAsBytesSync(bytes!.buffer.asUint8List());
      image.dispose();
    });
  }

  testWidgets('disabled layout floats the address label on focus', (
    tester,
  ) async {
    final address = TextEditingController();
    addTearDown(address.dispose);
    var toggles = 0;
    await show(tester, address: address, toggle: () => toggles++);
    expect(find.text('未开启'), findsOneWidget);
    expect(find.text('Windows 被控端'), findsNothing);
    expect(find.text('开启远程控制'), findsNothing);
    final before = tester.getTopLeft(find.text('服务地址')).dy;
    await tester.tap(find.byType(TextField));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    expect(tester.getTopLeft(find.text('服务地址')).dy, lessThan(before));
    await tester.enterText(find.byType(TextField), 'http://127.0.0.1:4300');
    await tester.tap(find.byTooltip('开启远程控制'));
    expect(toggles, 1);
    expect(tester.getSize(find.byKey(const ValueKey('host-card'))).width, 380);
  });

  testWidgets(
    'browser status reflects media connection, not just host enablement',
    (tester) async {
      await show(tester);
      await screenshot(tester, 'disabled');
      await show(tester, enabled: true);
      expect(find.text('等待连接'), findsOneWidget);
      expect(find.text('已连接'), findsNothing);
      await screenshot(tester, 'waiting');
      await show(tester, enabled: true, busy: true, connecting: true);
      expect(find.text('正在连接'), findsOneWidget);
      await show(tester, enabled: true, connected: true);
      expect(find.text('已连接'), findsOneWidget);
      expect(find.text('等待连接'), findsNothing);
      await screenshot(tester, 'connected');
      await show(tester, enabled: true);
      expect(find.text('等待连接'), findsOneWidget);
    },
  );

  testWidgets('copy, stop and regenerate are separate actions in order', (
    tester,
  ) async {
    var copies = 0, stops = 0, regenerations = 0;
    await show(
      tester,
      enabled: true,
      copy: () async {
        copies++;
      },
      toggle: () => stops++,
      regenerate: () => regenerations++,
    );
    final password = find.descendant(
      of: find.byKey(const ValueKey('password-field')),
      matching: find.byType(EditableText),
    );
    expect(tester.widget<EditableText>(password).obscureText, isTrue);
    await tester.tap(find.byTooltip('显示密码'));
    await tester.pump();
    expect(tester.widget<EditableText>(password).obscureText, isFalse);
    await tester.tap(find.byTooltip('复制连接信息'));
    await tester.pump();
    expect(copies, 1);
    expect(find.byTooltip('已复制'), findsOneWidget);
    await tester.tap(find.byTooltip('停止远程控制'));
    expect(stops, 1);
    expect(
      tester.getCenter(find.byTooltip('重新生成设备代码和密码')).dx,
      greaterThan(tester.getCenter(find.byTooltip('停止远程控制')).dx),
    );
    await tester.tap(find.byTooltip('重新生成设备代码和密码'));
    expect(regenerations, 1);
    await show(tester);
    await show(tester, enabled: true);
    expect(tester.widget<EditableText>(password).obscureText, isTrue);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
    'busy disables repeated start; errors fit and scroll at minimum window size',
    (tester) async {
      var toggles = 0;
      var regenerations = 0;
      await show(
        tester,
        busy: true,
        toggle: () => toggles++,
        regenerate: () => regenerations++,
      );
      await tester.tap(find.byTooltip('开启中'));
      expect(toggles, 0);
      await tester.tap(find.byTooltip('重新生成设备代码和密码'));
      expect(regenerations, 0);
      expect(find.text('连接服务中'), findsOneWidget);
      await show(
        tester,
        enabled: true,
        error: '无法连接服务器，正在重试',
        size: const Size(600, 460),
      );
      expect(find.text('连接异常'), findsOneWidget);
      await tester.ensureVisible(find.text('无法连接服务器，正在重试'));
      expect(tester.takeException(), isNull);
      await screenshot(tester, 'error-small');
    },
  );
}
