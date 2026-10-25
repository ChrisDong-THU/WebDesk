const { app, BrowserWindow } = require('electron');
const path = require('node:path'),
  fs = require('node:fs');
const out = path.resolve(__dirname, '../test-results/codec-ui');
app.setPath('userData', path.join(out, 'profile'));
app
  .whenReady()
  .then(async () => {
    fs.mkdirSync(out, { recursive: true });
    const { build } = await import('vite');
    await build({
      configFile: path.resolve(__dirname, '../tests/ui-preview.config.ts'),
      base: './',
      build: { outDir: path.join(out, 'dist'), emptyOutDir: true },
    });
    const window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: { contextIsolation: true, sandbox: true, offscreen: true },
    });
    await window.loadFile(path.join(out, 'dist/index.html'));
    const results = [];
    for (const width of [1280, 768, 390]) {
      window.setSize(width, 800);
      await new Promise((resolve) => setTimeout(resolve, 60));
      results.push(
        await window.webContents.executeJavaScript(`(async () => {
      const trigger = document.querySelector('[role="combobox"][aria-label="实时编码首选（非强制）"]');
      if (!trigger || trigger.disabled || !trigger.textContent.includes('自动')) throw Error('Auto codec select missing/disabled');
      const rect = trigger.getBoundingClientRect();
      if (rect.left < 0 || rect.right > innerWidth + 1) throw Error('Codec select overflows viewport');
      trigger.click(); await new Promise(resolve => setTimeout(resolve, 0));
      const list = document.getElementById(trigger.getAttribute('aria-controls'));
      const options = [...list.querySelectorAll('[role="option"]')];
      const labels = options.map(option => option.textContent.trim());
      if (JSON.stringify(labels) !== JSON.stringify(['自动','H264 首选','AV1 首选','VP9 首选','VP8 首选'])) throw Error('Codec options are not neutral/manual preferences');
      options[2].click(); await new Promise(resolve => setTimeout(resolve, 0));
      if (!trigger.textContent.includes('AV1 首选')) throw Error('Manual model update failed');
      trigger.click(); await new Promise(resolve => setTimeout(resolve, 0));
      options[0].click(); await new Promise(resolve => setTimeout(resolve, 0));
      if (!trigger.textContent.includes('自动')) throw Error('Return to Auto failed');
      return { width: innerWidth, labels, manualAndAuto: true, visible: true };
    })()`),
      );
    }
    fs.writeFileSync(path.join(out, 'toolbar.png'), (await window.webContents.capturePage()).toPNG());
    await window.loadFile(path.join(out, 'dist/index.html'), { query: { picker: 'cancel' } });
    const fileCancellation = await window.webContents.executeJavaScript(`(async () => {
      const tick = () => new Promise(resolve => setTimeout(resolve, 0));
      document.querySelector('#trigger-files').click(); await tick();
      const receive = [...document.querySelectorAll('.file-action')].find(button => button.textContent.includes('接收到本机'));
      if (!receive) throw Error('Receive file action missing');
      for (let attempt = 0; attempt < 2; attempt++) {
        if (receive.disabled) throw Error('File selection remained busy after cancellation');
        receive.click(); await tick();
        if (!receive.disabled) throw Error('Pending file picker was not marked busy');
        await new Promise(resolve => setTimeout(resolve, 100));
        if (receive.disabled || document.querySelector('.selected-file')) throw Error('Cancelled selection did not reset');
      }
      document.querySelector('#trigger-files').click(); await tick();
      if (document.querySelector('#trigger-files').getAttribute('aria-expanded') !== 'false') throw Error('File panel cannot close after cancellation');
      return { attempts: 2, busyReset: true, panelClosable: true };
    })()`);
    const result = { ok: true, results, fileCancellation };
    fs.writeFileSync(path.join(out, 'ui-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
