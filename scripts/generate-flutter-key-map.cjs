const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results/flutter-protocol.cjs');
fs.mkdirSync(path.dirname(output), { recursive: true });
buildSync({ entryPoints: [path.join(root, 'electron-main/native-protocol.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: output });
const { encodeInput } = require(output);
const keys = [];
for (let key = 0; key < 256; key++) {
  try {
    const bytes = encodeInput('keyboardPressKey', { requestId: 'generate', data: { key: [key] } }, { width: 1, height: 1 });
    if (bytes) keys.push(`  ${key}: [${bytes.readInt32LE(5)}, ${bytes.readInt32LE(13)}],`);
  } catch (error) { if (error.message !== 'Unsupported Windows key') throw error; }
}
fs.writeFileSync(path.join(root, 'desktop/flutter/lib/protocol/key_map.dart'), '// Generated from the pinned nut.js Key enum and WebDesk Win32 mapping.\n// Regenerate with scripts/generate-flutter-key-map.cjs.\nconst windowsKeys = <int, List<int>>{\n' + keys.join('\n') + '\n};\n');
