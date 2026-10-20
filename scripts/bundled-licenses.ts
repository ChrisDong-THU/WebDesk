import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/** Keep notices for modules actually emitted, even when node_modules is not shipped. */
export function bundledLicenses(filename: string): Plugin {
  return {
    name: 'webdesk-bundled-licenses',
    generateBundle(_options, bundle) {
      const packages = new Map<string, { directory: string; manifest: any }>();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const [id, module] of Object.entries(chunk.modules)) {
          if (!module.renderedLength || !id.includes('node_modules') || id.startsWith('\0')) continue;
          // Some packages put a second, stale package.json in build/esm. The
          // installed package boundary is immediately after node_modules.
          const normalized = id.split('?')[0].replaceAll('\\', '/');
          const start = normalized.lastIndexOf('/node_modules/') + '/node_modules/'.length;
          const parts = normalized.slice(start).split('/');
          const name = parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join('/');
          const directory = normalized.slice(0, start) + name;
          const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
          packages.set(`${manifest.name}@${manifest.version}`, { directory, manifest });
        }
      }
      if (!packages.size) return;
      const text = [...packages].sort(([a], [b]) => a.localeCompare(b)).map(([name, { directory, manifest }]) => {
        const files = fs.readdirSync(directory).filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name) && fs.statSync(path.join(directory, name)).isFile());
        let license = files.map(file => fs.readFileSync(path.join(directory, file), 'utf8')).join('\n\n');
        if (!license && manifest.name === '@nut-tree-fork/shared' && manifest.license === 'Apache-2.0') {
          license = 'Copyright dry Software UG (haftungsbeschraenkt). Apache-2.0.\nFull Apache License text is included in THIRD_PARTY_NOTICES.md.';
        }
        if (!license) this.error(`Missing bundled license text: ${name}`);
        return `${name} (${manifest.license || 'see text'})\n${'='.repeat(60)}\n${license}`;
      }).join('\n\n');
      this.emitFile({ type: 'asset', fileName: filename, source: text });
    },
  };
}
