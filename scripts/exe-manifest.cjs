// Read the actual PE RT_MANIFEST resource, not a config file or loose XML.
const fs = require('node:fs');
function readManifest(file) {
  const bytes = fs.readFileSync(file);
  const pe = bytes.readUInt32LE(0x3c);
  if (bytes.toString('ascii', pe, pe + 4) !== 'PE\0\0') throw Error('Invalid PE executable');
  const optional = pe + 24;
  const directories = optional + (bytes.readUInt16LE(optional) === 0x20b ? 112 : 96);
  const resourceRva = bytes.readUInt32LE(directories + 16);
  const sections = optional + bytes.readUInt16LE(pe + 20);
  const offset = rva => {
    for (let i = 0; i < bytes.readUInt16LE(pe + 6); i++) {
      const section = sections + i * 40;
      const base = bytes.readUInt32LE(section + 12);
      if (rva >= base && rva < base + Math.max(bytes.readUInt32LE(section + 8), bytes.readUInt32LE(section + 16))) {
        return bytes.readUInt32LE(section + 20) + rva - base;
      }
    }
    throw Error('Invalid PE resource RVA');
  };
  const root = offset(resourceRva);
  let directory = root;
  for (let depth = 0; depth < 3; depth++) {
    const count = bytes.readUInt16LE(directory + 12) + bytes.readUInt16LE(directory + 14);
    let entry;
    for (let i = 0; i < count; i++) {
      const candidate = directory + 16 + i * 8;
      if (depth > 0 || bytes.readUInt32LE(candidate) === 24) { entry = candidate; break; }
    }
    if (entry === undefined) throw Error('Missing executable manifest');
    const target = bytes.readUInt32LE(entry + 4);
    if (depth < 2 && !(target & 0x80000000)) throw Error('Invalid manifest resource tree');
    directory = root + (target & 0x7fffffff);
  }
  const start = offset(bytes.readUInt32LE(directory));
  return bytes.toString('utf8', start, start + bytes.readUInt32LE(directory + 4));
}
function assertAdministrator(file) {
  if (!/<requestedExecutionLevel\s[^>]*level=["']requireAdministrator["']/.test(readManifest(file))) {
    throw Error('WebDesk.exe is missing the upstream requireAdministrator manifest');
  }
}
module.exports = { readManifest, assertAdministrator };
if (require.main === module) { assertAdministrator(process.argv[2]); console.log('Verified embedded requireAdministrator manifest'); }
