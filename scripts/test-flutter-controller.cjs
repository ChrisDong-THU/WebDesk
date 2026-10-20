// Browser half of the real Flutter integration test. Caption input travels
// through WebRTC and the installed native service, just like remote control.
const { app, BrowserWindow, ipcMain } = require('electron');
const { build } = require('esbuild');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'test-results/flutter-integration');
let window, finished = false, credentials, hostError;
fs.mkdirSync(out, { recursive: true });
app.whenReady().then(async () => {
  const { createSignalingServer } = await import('../server/index.mjs');
  const server = createSignalingServer();
  await new Promise(resolve => server.http.listen(44300, '127.0.0.1', resolve));
  const control = http.createServer(async (req, res) => {
    if (req.url === '/finished') { res.end(finished ? 'yes' : 'no'); return; }
    if (req.url === '/host' && req.method === 'POST') {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 4096) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
      const data = JSON.parse(Buffer.concat(chunks).toString());
      if (data.error) { hostError = data.error; console.error('Flutter host:', hostError); }
      else credentials = data;
      res.end('ok'); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => control.listen(44301, '127.0.0.1', resolve));
  await build({ entryPoints: [path.join(root, 'tests/flutter-controller.ts')], outfile: path.join(out, 'renderer.js'), bundle: true, platform: 'browser', format: 'iife' });
  fs.writeFileSync(path.join(out, 'preload.cjs'), "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('flutterTest',{credentials:()=>ipcRenderer.invoke('credentials'),probe:action=>ipcRenderer.invoke('probe',action),phase:value=>ipcRenderer.send('phase',value),report:value=>ipcRenderer.send('result',value)});");
  fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><title>Flutter integration</title><script defer src="renderer.js"></script>');
  ipcMain.handle('credentials', async () => {
    const deadline = Date.now() + 150000;
    while (!credentials && Date.now() < deadline) { if (hostError) throw Error(hostError); await new Promise(r => setTimeout(r, 100)); }
    if (!credentials) throw Error('Flutter did not register'); return credentials;
  });
  ipcMain.handle('probe', async (_event, action) => {
    if (!credentials?.pid || !['inspect', 'show', 'status', 'lock'].includes(action)) throw Error('Invalid probe');
    // The test host launches the probe at its own integrity level. A normal
    // browser process cannot send WM_GETTITLEBARINFOEX to an elevated window.
    const response = await fetch(`http://127.0.0.1:44302/${action}`, { signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok) throw Error(JSON.stringify(result));
    return result;
  });
  ipcMain.on('result', (_event, value) => {
    finished = true; fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(value, null, 2));
    console.log(JSON.stringify(value)); setTimeout(() => app.exit(value.ok ? 0 : 1), 2000);
  });
  ipcMain.on('phase', (_event, value) => {
    fs.writeFileSync(path.join(out, 'phase.json'), JSON.stringify({ phase: value, at: new Date().toISOString() }));
    console.log(`FLUTTER:phase ${value}`);
  });
  window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(out, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  window.webContents.on('console-message', (_e, _l, message) => { if (message.startsWith('FLUTTER:')) console.log(message); });
  await window.loadFile(path.join(out, 'index.html'));
  console.log('Flutter test controller listening on 127.0.0.1:44300 / 44301');
  setTimeout(() => { fs.writeFileSync(path.join(out, 'timeout.json'), JSON.stringify({ hostError })); app.exit(1); }, 240000);
}).catch(error => { console.error(error); app.exit(1); });
