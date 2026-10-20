const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'native/windows/bin');
fs.mkdirSync(output, { recursive: true });
const compiler = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const env = { ...process.env }; delete env.LIB;
execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+', '/warnaserror+', '/r:System.ServiceProcess.dll', '/r:System.Drawing.dll', `/out:${path.join(output, 'WebDeskNative.exe')}`, ...['Win32', 'Wire', 'Service', 'Worker', 'Relay'].map(name => path.join(root, `native/windows/${name}.cs`))], { stdio: 'inherit', windowsHide: true, env });
