// Deterministic extraction, not a reimplementation. Every retained block is
// read from the pinned upstream Git tree and recorded with a source hash.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const revision = '61be620eb35b0004dc66c296f0fdd8c62700b1b9';
const check = process.argv.includes('--check');
const records = [];
// The pinned source snapshot makes this version independently buildable,
// including from a source archive without the parent repository's Git history.
const source = file => fs.readFileSync(path.join('third_party/billd-desk', file), 'utf8').replace(/\r\n/g, '\n');
function parse(file) { const raw = source(file); const text = file.endsWith('.vue') ? raw.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1] : raw; return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); }
function block(file, name) {
  const ast = parse(file);
  const node = ast.statements.find(n => n.name?.text === name || n.declarationList?.declarations.some(d => d.name.getText(ast) === name));
  if (!node) throw Error(`${file}: ${name}`);
  return record(file, name, node.getText(ast));
}
function record(file, name, code) { records.push({ file, name, sha256: createHash('sha256').update(code).digest('hex') }); return code; }
function withoutDebugLogs(code) {
  const ast = ts.createSourceFile('adapter.ts', code, ts.ScriptTarget.Latest, true);
  const ranges = [];
  function visit(node) {
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
        node.expression.expression.getText(ast) === 'console.log') {
      ranges.push([node.getStart(ast), node.end]); return;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const [start, end] of ranges.reverse()) code = code.slice(0, start) + code.slice(end);
  return code.replace(/^[\t ]+$/gm, '');
}
function write(file, text) {
  const result = '// @ts-nocheck\n// GENERATED from billd-desk ' + revision + ' (MIT).\n// Run npm run upstream:check; edit extraction/adapters, not this file.\n' + text + '\n';
  if (check) { if (fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== result) throw Error(`Upstream drift: ${file}`); }
  else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, result); }
}
const utilsFile = 'src/utils/index.ts', hostFile = 'src/views/remote/index.vue', controlFile = 'src/views/webrtc/index.vue';
write('src/billd/utils.ts', "import { computeBox } from 'billd-utils';\n" + ['handlConstraints', 'setVideoTrackContentHints', 'setAudioTrackContentHints', 'createNullVideo', 'videoFullBox'].map(n => block(utilsFile, n)).join('\n'));
write('src/billd/enums.ts', ['LiveLineEnum', 'LiveRenderEnum', 'MediaTypeEnum'].map(n => block('src/interface.ts', n)).concat(['WsMsgTypeEnum', 'BilldDeskBehaviorEnum', 'WsConnectStatusEnum'].map(n => block('src/types/websocket.ts', n))).join('\n'));
write('src/billd/events.ts', block('src/event.ts', 'IPC_EVENT'));
write('src/billd/keys.ts', "import { Key } from '@nut-tree-fork/shared/dist/lib/enums/key.enum';\n" + block('src/constant.ts', 'NUT_KEY_MAP'));
write('src/billd/params.ts', "import { ref } from 'vue';\nimport { MediaTypeEnum } from './enums';\n" + block('src/hooks/use-rtcParams.ts', 'useRTCParams'));
write('src/billd/stores.ts', "import { defineStore } from 'pinia';\nimport { LiveLineEnum, LiveRenderEnum } from './enums';\n" + block('src/store/app/index.ts', 'useAppStore') + '\n' + block('src/store/network/index.ts', 'useNetworkStore'));
let rtc = block('src/utils/network/webRTC.ts', 'WebRTCClass').replace('export class', 'class');
// Deployment adapters: authenticated ICE servers and reliable input ordering.
const iceStart = rtc.indexOf('const iceServers = this.isSRS');
const iceEnd = rtc.indexOf('this.peerConnection = new RTCPeerConnection', iceStart);
rtc = rtc.slice(0, iceStart) + 'const iceServers = this.isSRS ? [] : environment.iceServers;\n      ' + rtc.slice(iceEnd);
const channelOptions = /('MessageChannel',\s*)\{[\s\S]*?\}/;
if (!channelOptions.test(rtc)) throw Error('Missing upstream MessageChannel options');
rtc = rtc.replace(channelOptions, '$1{ ordered: true }');
rtc = withoutDebugLogs(rtc);
write('src/billd/webRTC.ts', "import { getRandomString } from 'billd-utils';\nimport { LiveLineEnum, MediaTypeEnum, WsMsgTypeEnum } from './enums';\nexport function createWebRTCClass(environment) {\nconst useAppStore = () => environment.appStore;\nconst useNetworkStore = () => environment.networkStore;\n" + rtc + '\nreturn WebRTCClass;\n}');
write('src/billd/remoteDesk.ts', "import { ref } from 'vue';\nimport { getRandomString } from 'billd-utils';\nimport { useRTCParams } from './params';\nimport { WsMsgTypeEnum } from './enums';\nexport function createRemoteDesk(environment) {\nconst { WebRTCClass } = environment;\nconst useAppStore = () => environment.appStore;\nconst useNetworkStore = () => environment.networkStore;\n" + block('src/hooks/webrtc/remoteDesk.ts', 'useWebRtcRemoteDesk').replace('export const', 'const') + '\nreturn useWebRtcRemoteDesk();\n}');

// Retain the three original remote-desktop signaling handlers. The unrelated
// live-streaming branches of the offer handler are excluded by AST selection.
const signalAst = parse('src/hooks/use-websocket.ts');
const signalInit = signalAst.statements.find(n => n.declarationList?.declarations.some(d => d.name.getText(signalAst) === 'useWebsocket')).declarationList.declarations[0].initializer.body.statements.find(n => n.name?.text === 'initReceive');
const signalBlocks = [];
for (const statement of signalInit.body.statements) {
  const call = statement.expression;
  if (!ts.isCallExpression(call ?? {}) || call.expression.getText(signalAst) !== 'ws.socketIo.on') continue;
  const event = call.arguments[0].getText(signalAst);
  if (!['nativeWebRtcOffer', 'nativeWebRtcAnswer', 'nativeWebRtcCandidate'].some(n => event === 'WsMsgTypeEnum.' + n)) continue;
  let code = statement.getText(signalAst);
  if (event.endsWith('nativeWebRtcOffer')) {
    const callback = call.arguments[1];
    const branch = callback.body.statements.find(n => ts.isIfStatement(n) && n.expression.getText(signalAst) === 'data.isRemoteDesk');
    const body = record('src/hooks/use-websocket.ts', 'remote-offer branch', branch.getText(signalAst));
    code = `ws.socketIo.on(${event}, async (data) => {\n${body}\n});`;
  } else record('src/hooks/use-websocket.ts', event, code);
  signalBlocks.push(code);
}
write('src/billd/receive.ts', "import { createNullVideo } from './utils';\nimport { WsMsgTypeEnum } from './enums';\nexport function registerRemoteReceivers(environment) {\nconst { ws, networkStore, roomId, mySocketId, deskUserUuid, remoteDeskUserUuid, webRtcRemoteDesk, updateWebRtcRemoteDeskConfig } = environment;\nconst userStream = { value: undefined }, canvasVideoStream = { value: undefined };\n" + signalBlocks.join('\n') + '\n}');

const hostAst = parse(hostFile);
const inputWatch = hostAst.statements.find(n => n.expression && ts.isCallExpression(n.expression) && n.expression.expression.getText(hostAst) === 'watch' && n.getText(hostAst).includes('item.cbDataChannel.onmessage'));
write('src/billd/host.ts', "import { watch } from 'vue';\nimport { handlConstraints as upstreamConstraints, setVideoTrackContentHints, setAudioTrackContentHints, createNullVideo } from './utils';\nimport { WsMsgTypeEnum } from './enums';\nexport function createHostPage(environment) {\nconst { appStore, networkStore, anchorStream, currentMaxBitrate, currentMaxFramerate, currentResolutionRatio, currentVideoContentHint, currentAudioContentHint, rtc, roomId, mySocketId, cacheStore, webRtcRemoteDesk, updateWebRtcRemoteDeskConfig, handleRtcBilldDeskBehavior } = environment;\nconst handlConstraints = environment.applyConstraints || upstreamConstraints;\nconst WINDOW_ID_ENUM = { remote: 1 };\n" + ['handleDesktopStream', 'handleRTC'].map(n => block(hostFile, n)).join('\n') + '\n' + record(hostFile, 'data-channel watch', inputWatch.getText(hostAst)) + '\nreturn { handleDesktopStream, handleRTC };\n}');

const controllerNames = ['handleMouseWheel', 'handleKeyDown', 'handleKeyUp', 'handleKeyCombination', 'handleDoublelclick', 'handleContextmenu', 'handleMouseDown', 'handleMouseMove', 'handleMouseUp'];
const controlAst = parse(controlFile);
const settingNames = ['currentMaxBitrate', 'currentMaxFramerate', 'currentResolutionRatio', 'currentVideoContentHint'];
const settingWatches = settingNames.map(name => {
  const node = controlAst.statements.find(n => n.expression && ts.isCallExpression(n.expression) && n.expression.expression.getText(controlAst) === 'watch' && n.expression.arguments[0]?.getText(controlAst) === `() => ${name}.value`);
  if (!node) throw Error(`Missing setting watcher: ${name}`);
  return record(controlFile, `${name} watch`, node.getText(controlAst));
});
write('src/billd/settings.ts', "import { watch } from 'vue';\nimport { getRandomString } from 'billd-utils';\nimport { WsMsgTypeEnum } from './enums';\nexport function registerControllerSettings(environment) {\nconst { networkStore, receiverId, roomId, currentMaxBitrate, currentMaxFramerate, currentResolutionRatio, currentVideoContentHint } = environment;\n" + settingWatches.join('\n') + '\n}');
write('src/billd/controller.ts', "import { getRandomString } from 'billd-utils';\nimport { NUT_KEY_MAP } from './keys';\nimport { BilldDeskBehaviorEnum, WsMsgTypeEnum } from './enums';\nconst ENGLISH_LETTER = 'abcdefghijklmnopqrstuvwxyz'.split('');\nexport function createControllerPage(environment) {\nconst { networkStore, receiverId, mySocketId, roomId, isWatchMode } = environment;\nlet clickTimer;\nlet isLongClick = false;\n" + controllerNames.map(n => withoutDebugLogs(block(controlFile, n))).join('\n') + '\nreturn { ' + controllerNames.join(', ') + ', dispose: () => clearTimeout(clickTimer) };\n}');

// Renderer-to-Electron dispatch is the original hook, including coordinate
// conversion and separate input channels. Only its environment is injected.
write('src/billd/ipc.ts', "import { getRandomString, openToTarget } from 'billd-utils';\nimport { IPC_EVENT } from './events';\nimport { BilldDeskBehaviorEnum } from './enums';\nexport function createInputDispatch(environment) {\nconst { ipcRenderer, ipcRendererSend, ipcRendererInvoke } = environment;\nconst useAppStore = () => environment.appStore;\n" + block('src/hooks/use-ipcRendererSend.ts', 'useIpcRendererSend').replace('export const', 'const') + '\nreturn useIpcRendererSend();\n}');

const nativeAst = parse('electron-main/index.ts');
const nativeBlocks = [];
const allowed = ['mouseScrollDown', 'mouseScrollUp', 'mouseScrollLeft', 'mouseScrollRight', 'mouseSetPosition', 'mouseMove', 'mouseDrag', 'keyboardType', 'keyboardPressKey', 'keyboardReleaseKey', 'mousePressButtonLeft', 'mouseReleaseButtonLeft', 'mouseDoubleClick', 'mouseLeftClick', 'mouseRightClick', 'getScreenStream', 'getPrimaryDisplaySize', 'scaleFactor'];
function visit(node) {
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
    const call = node.expression, name = call.expression.getText(nativeAst);
    if (['ipcMain.on', 'ipcMain.handle'].includes(name) && allowed.some(n => call.arguments[0]?.getText(nativeAst) === 'IPC_EVENT.' + n)) nativeBlocks.push(record('electron-main/index.ts', call.arguments[0].getText(nativeAst), node.getText(nativeAst)));
  }
  ts.forEachChild(node, visit);
}
visit(nativeAst);
if (nativeBlocks.length !== allowed.length) throw Error('Missing native handler');
write('electron-main/billd/handlers.ts', "import { IPC_EVENT } from '../../src/billd/events';\nexport function registerNativeHandlers(environment) {\nconst { ipcMain, nutjs, windowMap, winWebContentsSend, desktopCapturer, screen, platform } = environment;\n" + nativeBlocks.join('\n') + '\n}');
const manifest = JSON.stringify({ revision, policy: 'Source blocks are hashed before deterministic adapters: authenticated ICE, reliable ordered input, and removal of controller/WebRTC console.log calls. Wrapper code supplies dependencies and deployment interfaces.', blocks: records }, null, 2) + '\n';
if (check) { if (fs.readFileSync('third_party/billd-desk/manifest.json','utf8').replace(/\r\n/g, '\n') !== manifest) throw Error('Manifest drift'); }
else fs.writeFileSync('third_party/billd-desk/manifest.json', manifest);
console.log(`Verified ${records.length} upstream blocks at ${revision}`);
