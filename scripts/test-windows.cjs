const { app, BrowserWindow, desktopCapturer, ipcMain, screen, session } = require('electron');
const { build } = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const publicServer = process.env.WEBDESK_TEST_SERVER;
const nativeRecovery = process.env.WEBDESK_TEST_NATIVE === '1';
if (process.env.WEBDESK_TEST_NO_PROXY === '1') app.commandLine.appendSwitch('no-proxy-server');
const output = path.join(root, 'test-results', nativeRecovery ? 'native-windows' : publicServer ? 'public-remote' : 'windows');
fs.mkdirSync(output, { recursive: true });
let window;
let stage = 'Electron startup';
const timeout = setTimeout(() => { console.error(`Windows smoke test timed out (${stage})`); app.exit(1); }, publicServer ? 90000 : nativeRecovery ? 60000 : 30000);
app.whenReady().then(async () => {
  try {
    if (process.env.WEBDESK_TEST_NO_PROXY === '1') await session.defaultSession.setProxy({ mode: 'direct' });
    if (process.platform !== 'win32') throw Error('This test requires Windows');
    // Also verifies the upstream native module can load in the pinned Electron ABI.
    const nutjs = require('@nut-tree-fork/nut-js');
    await nutjs.mouse.getPosition();
    const { createSignalingServer } = await import('../server/index.mjs');
    const server = createSignalingServer();
    server.io.engine.on('connection_error', error => console.error('Signaling handshake:', error.message, 'origin:', error.req?.headers.origin));
    await new Promise(resolve => server.http.listen(0, '127.0.0.1', resolve));
    const serverUrl = publicServer || `http://127.0.0.1:${server.http.address().port}`;
    if (publicServer && !publicServer.startsWith('https://')) throw Error('Public testing requires HTTPS');
    await build({ entryPoints: [path.join(root, 'tests/windows-renderer.ts')], outfile: path.join(output, 'renderer.js'), bundle: true, platform: 'browser', format: 'iife' });
    fs.writeFileSync(path.join(output, 'preload.cjs'), "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('smoke',{source:()=>ipcRenderer.invoke('source'),report:result=>ipcRenderer.send('report',result)});");
    let worker, forcedSecure = false;
    if (nativeRecovery) {
      await build({ entryPoints: [path.join(root, 'electron-main/windows-desktop.ts')], outfile: path.join(output, 'desktop.cjs'), bundle: true, platform: 'node', format: 'cjs' });
      const { WindowsDesktop } = require(path.join(output, 'desktop.cjs'));
      worker = new WindowsDesktop(() => {}, error => console.error(error)); await worker.start();
      ipcMain.handle('native-state', () => ({ ...worker.state, secure: forcedSecure || worker.state.secure }));
      ipcMain.handle('native-frame', (_event, height) => worker.frame(height));
      ipcMain.handle('native-source', async () => (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }))[0].id);
      ipcMain.handle('force-secure', (_event, value) => { forcedSecure = value; });
      fs.writeFileSync(path.join(output, 'preload.cjs'), "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('smoke',{source:()=>ipcRenderer.invoke('source'),forceSecure:value=>ipcRenderer.invoke('force-secure',value),report:result=>ipcRenderer.send('report',result)});contextBridge.exposeInMainWorld('webdesk',{desktopState:()=>ipcRenderer.invoke('native-state'),desktopFrame:(_session,height)=>ipcRenderer.invoke('native-frame',height),desktopSource:()=>ipcRenderer.invoke('native-source')});");
      app.on('will-quit', () => worker.stop());
    }
    fs.writeFileSync(path.join(output, 'index.html'), '<!doctype html><title>WebDesk smoke test</title><script defer src="renderer.js"></script>');
    await build({ entryPoints: [path.join(root, 'electron-main/billd-boundary.ts')], outfile: path.join(output, 'native.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron', '@nut-tree-fork/nut-js'] });
    const { NativeBoundary } = require(path.join(output, 'native.cjs'));
    let native;
    ipcMain.handle('source', async () => ({ ...await native.capture('smoke'), nativeDesktop: nativeRecovery, serverUrl, forceRelay: !!publicServer, turnTransport: process.env.WEBDESK_TEST_TURN || 'udp' }));
    ipcMain.on('report', (_event, result) => {
      fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result)); clearTimeout(timeout); worker?.stop(); app.exit(result.ok ? 0 : 1);
    });
    window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(output, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    native = new NativeBoundary(window, error => console.error(String(error)));
    window.webContents.on('console-message', (_event, _level, message) => {
      if (message.startsWith('SMOKE:')) { stage = message.slice(6); console.log(message); }
    });
    await window.loadFile(path.join(output, 'index.html'));
  } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
});
