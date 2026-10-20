import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:file_selector/file_selector.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:webdesk/tools/tool_channel.dart';

class Channel extends Fake implements RTCDataChannel {
  @override
  void Function(RTCDataChannelMessage)? onMessage;
  @override
  void Function(RTCDataChannelState)? onDataChannelState;
  final replies = <String, Completer<Map>>{};
  final received = <int>[];
  bool closed = false;
  Completer<void>? blockedSend;
  final sendStarted = Completer<void>();
  bool holdAcks = false;
  final heldAcks = <RTCDataChannelMessage>[];
  final fourWindows = Completer<void>();
  int nextId = 0;
  Future<Map> request(String operation, [Map data = const {}]) {
    final id = 'test-${nextId++}', reply = Completer<Map>();
    replies[id] = reply;
    onMessage!(
      RTCDataChannelMessage(
        jsonEncode({'id': id, 'operation': operation, 'data': data}),
      ),
    );
    return reply.future.timeout(const Duration(seconds: 5));
  }

  @override
  Future<void> send(RTCDataChannelMessage message) async {
    if (closed) throw StateError('closed');
    if (message.isBinary) {
      received.addAll(message.binary);
      return;
    }
    final value = jsonDecode(message.text) as Map;
    if (value.containsKey('reply')) {
      replies.remove(value['id'])?.complete(value);
    } else {
      if (blockedSend != null) {
        if (!sendStarted.isCompleted) sendStarted.complete();
        await blockedSend!.future;
        if (closed) throw StateError('closed while sending');
      }
      // Simulate the browser's ordered-write acknowledgements for downloads.
      final reply = RTCDataChannelMessage(
        jsonEncode({
          'id': value['id'],
          'reply': value['operation'] == 'file.ack' ? received.length : true,
        }),
      );
      if (holdAcks && value['operation'] == 'file.ack') {
        heldAcks.add(reply);
        if (heldAcks.length == 4 && !fourWindows.isCompleted) {
          fourWindows.complete();
        }
      } else {
        onMessage!(reply);
      }
    }
  }

  @override
  Future<void> close() async {
    closed = true;
  }
}

class Peer extends Fake implements RTCPeerConnection {
  final Channel channel;
  Peer(this.channel);
  @override
  Future<RTCDataChannel> createDataChannel(
    String label,
    RTCDataChannelInit init,
  ) async {
    expect(init.id, 42);
    expect(init.ordered, isTrue);
    return channel;
  }
}

void main() {
  late Directory root;
  late Channel channel;
  late ToolChannel tools;
  late File selected;
  setUp(() async {
    root = await Directory.systemTemp.createTemp('webdesk-tool-test-');
    selected = File('${root.path}/selected.bin');
    channel = Channel();
    tools = await ToolChannel.create(
      Peer(channel),
      downloadsDirectory: () async => root,
      selectFile: () async => XFile(selected.path),
    );
  });
  tearDown(() async {
    await tools.close();
    await root.delete(recursive: true);
  });
  Future<List<File>> partials() async => root
      .list(recursive: true)
      .where((file) => file.path.endsWith('.webdesk-part'))
      .cast<File>()
      .toList();

  test(
    'production uploads persist ordered chunks and commit only complete files',
    () async {
      expect(
        (await channel.request('file.begin', {
          'name': '../test.bin',
          'size': 4,
        }))['reply'],
        true,
      );
      channel.onMessage!(
        RTCDataChannelMessage.fromBinary(Uint8List.fromList([1, 2])),
      );
      expect((await channel.request('file.ack'))['reply'], 2);
      expect((await channel.request('file.end'))['error'], contains('不完整'));
      channel.onMessage!(
        RTCDataChannelMessage.fromBinary(Uint8List.fromList([3, 4])),
      );
      expect((await channel.request('file.end'))['error'], isNull);
      final files = await root
          .list(recursive: true)
          .where((file) => file is File)
          .cast<File>()
          .toList();
      expect(files, hasLength(1));
      expect(await files.single.readAsBytes(), [1, 2, 3, 4]);
      await tools.close();
      expect(await files.single.exists(), isTrue);
    },
  );
  test('abort and awaited session close remove incomplete files', () async {
    await channel.request('file.begin', {'name': 'partial.bin', 'size': 10});
    channel.onMessage!(
      RTCDataChannelMessage.fromBinary(Uint8List.fromList([1])),
    );
    await channel.request('file.abort');
    expect(await partials(), isEmpty);
    await channel.request('file.begin', {'name': 'next.bin', 'size': 10});
    channel.onMessage!(
      RTCDataChannelMessage.fromBinary(Uint8List.fromList([2])),
    );
    await tools.close();
    expect(await partials(), isEmpty);
    expect(channel.closed, isTrue);
  });
  test(
    'invalid chunks close the channel and cleanup without queue deadlock',
    () async {
      await channel.request('file.begin', {'name': 'oversize.bin', 'size': 1});
      channel.onMessage!(
        RTCDataChannelMessage.fromBinary(Uint8List.fromList([1, 2])),
      );
      await Future<void>.delayed(Duration.zero);
      await tools.close().timeout(const Duration(seconds: 5));
      expect(await partials(), isEmpty);
      expect(channel.closed, isTrue);
    },
  );
  test(
    'production downloads span multiple windows and retire selected handles',
    () async {
      final bytes = List.generate(
        ToolChannel.windowSize + 7,
        (index) => index % 251,
      );
      await selected.writeAsBytes(bytes);
      final selection = (await channel.request('file.select'))['reply'] as Map;
      expect(selection.containsKey('path'), isFalse);
      expect(
        (await channel.request('file.download', {
          'id': selection['id'],
        }))['error'],
        isNull,
      );
      expect(channel.received, bytes);
      expect(
        (await channel.request('file.download', {
          'id': selection['id'],
        }))['error'],
        contains('请选择'),
      );
    },
  );

  test(
    'downloads pipeline four bounded windows before awaiting acknowledgement',
    () async {
      final bytes = List.generate(
        ToolChannel.windowSize * 5 + 7,
        (i) => i % 251,
      );
      await selected.writeAsBytes(bytes);
      final selection = (await channel.request('file.select'))['reply'] as Map;
      channel.holdAcks = true;
      final downloading = channel.request('file.download', {
        'id': selection['id'],
      });
      await channel.fourWindows.future.timeout(const Duration(seconds: 5));
      expect(channel.received.length, ToolChannel.windowSize * 4);
      channel.holdAcks = false;
      for (final reply in channel.heldAcks) {
        channel.onMessage!(reply);
      }
      expect((await downloading)['error'], isNull);
      expect(channel.received, bytes);
    },
  );
  test(
    'disconnect during native send rejects pending replies without an unhandled error',
    () async {
      await selected.writeAsBytes([1, 2, 3]);
      final selection = (await channel.request('file.select'))['reply'] as Map;
      channel.blockedSend = Completer<void>();
      // The browser disappears, so no outer reply is expected.
      channel.onMessage!(
        RTCDataChannelMessage(
          jsonEncode({
            'id': 'disconnected-download',
            'operation': 'file.download',
            'data': {'id': selection['id']},
          }),
        ),
      );
      await channel.sendStarted.future.timeout(const Duration(seconds: 5));
      await tools.close().timeout(const Duration(seconds: 5));
      channel.blockedSend!.complete();
      await Future<void>.delayed(Duration.zero);
      expect(channel.closed, isTrue);
    },
  );

  test(
    'closing while a file picker is open does not wait for user interaction',
    () async {
      await tools.close();
      final picker = Completer<XFile?>();
      channel = Channel();
      tools = await ToolChannel.create(
        Peer(channel),
        downloadsDirectory: () async => root,
        selectFile: () => picker.future,
      );
      channel.onMessage!(
        RTCDataChannelMessage(
          jsonEncode({'id': 'picker', 'operation': 'file.select', 'data': {}}),
        ),
      );
      await Future<void>.delayed(Duration.zero);
      await tools.close().timeout(const Duration(seconds: 5));
      picker.complete(XFile(selected.path));
      await Future<void>.delayed(Duration.zero);
      expect(channel.closed, isTrue);
    },
  );
}
