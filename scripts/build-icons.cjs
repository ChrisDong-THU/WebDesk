// Rasterize the shared SVG with Chromium, preserving its theme color and geometry.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    const svg = fs.readFileSync(path.join(__dirname, '../src/assets/webdesk-icon.svg'), 'utf8');
    await window.loadURL('data:text/html,<html></html>');
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const images = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image();
      image.src = ${JSON.stringify('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))};
      await image.decode();
      const icons = ${JSON.stringify(sizes)}.map(size => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(image, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      });
      return { icons };
    })()`);
    const output = path.join(__dirname, '../build/icons');
    fs.mkdirSync(output, { recursive: true });
    const buffers = images.icons.map((data, index) => {
      const png = Buffer.from(data, 'base64');
      fs.writeFileSync(path.join(output, `webdesk-${sizes[index]}.png`), png);
      return png;
    });
    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    sizes.forEach((size, index) => {
      const entry = 6 + index * 16;
      header[entry] = header[entry + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(buffers[index].length, entry + 8); header.writeUInt32LE(offset, entry + 12);
      offset += buffers[index].length;
    });
    fs.writeFileSync(path.join(output, 'webdesk.ico'), Buffer.concat([header, ...buffers]));
    console.log(`Generated ICO and PNG icons: ${sizes.join(', ')} px`);
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
