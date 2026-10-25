const { app, BrowserWindow, ipcMain } = require('electron');
const { build } = require('esbuild');
const fs = require('node:fs'),
  path = require('node:path');
const out = path.resolve(__dirname, '../test-results/browser-video-codecs');
let window, watchdog;
app.setPath('userData', path.join(out, 'profile'));
app
  .whenReady()
  .then(async () => {
    fs.mkdirSync(out, { recursive: true });
    await build({
      entryPoints: [path.resolve(__dirname, '../tests/browser-video-codecs.ts')],
      outfile: path.join(out, 'renderer.js'),
      bundle: true,
      platform: 'browser',
      format: 'iife',
    });
    fs.writeFileSync(
      path.join(out, 'preload.cjs'),
      "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('codecTest',{done:result=>ipcRenderer.send('codec-test-done',result)});",
    );
    fs.writeFileSync(
      path.join(out, 'index.html'),
      '<!doctype html><title>Offline video codec negotiation</title><script defer src="renderer.js"></script>',
    );
    ipcMain.once('codec-test-done', (_event, result) => {
      clearTimeout(watchdog);
      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result));
      app.exit(result.ok ? 0 : 1);
    });
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(out, 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
        offscreen: true,
      },
    });
    watchdog = setTimeout(() => {
      console.error('Offline codec negotiation timed out');
      app.exit(1);
    }, 30000);
    await window.loadFile(path.join(out, 'index.html'));
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
