// Extract the upstream signaling handlers without bringing in unrelated services.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const revision = 'c73983e543341c08ce9e4fb7c52446be50b6c6a2';
const check = process.argv.includes('--check');
const root = 'third_party/billd-desk-server/';
const records = [];
const hash = text => createHash('sha256').update(text).digest('hex');
const parse = file => ts.createSourceFile(file, fs.readFileSync(root + file, 'utf8').replace(/\r\n/g, '\n'), ts.ScriptTarget.Latest, true);
function retain(file, node, ast, name) { const text = node.getText(ast); records.push({ file, name, sha256: hash(text) }); return text; }
const file = 'src/config/websocket/index.ts', ast = parse(file), enumsFile = 'src/types/websocket.ts', enums = parse(enumsFile);
const types = retain(enumsFile, enums.statements.find(n => n.name?.text === 'WsMsgTypeEnum'), enums, 'WsMsgTypeEnum');
const emit = retain(file, ast.statements.find(n => n.name?.text === 'socketEmit'), ast, 'socketEmit');
const handlers = [];
const names = ['nativeWebRtcOffer', 'nativeWebRtcAnswer', 'nativeWebRtcCandidate'];
function visit(node) {
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'socket.on') {
    const name = node.expression.arguments[0].getText(ast);
    if (names.some(n => name === `WsMsgTypeEnum.${n}`)) handlers.push(retain(file, node, ast, name));
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (handlers.length !== 3) throw Error('Missing upstream signal handler');
const code = `${types}\n${emit}\nexport function registerRemoteSignals({ socket, prettierInfoLog = () => {} }) {\n${handlers.join('\n')}\n}\n`;
const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const output = `// GENERATED from billd-desk-server ${revision} (MIT).\n// edit extraction/adapters; verify with npm run upstream:check.\n${compiled}`;
const manifest = JSON.stringify({ repository: 'https://github.com/galaxy-s10/billd-desk-server', revision,
  policy: 'Original blocks with TypeScript types erased; auth, scoped rooms, legacy wire envelope and quiet logger supplied by WebDesk.',
  sources: [file, enumsFile].map(file => ({ file, sha256: hash(fs.readFileSync(root + file, 'utf8').replace(/\r\n/g, '\n')) })), blocks: records }, null, 2) + '\n';
for (const [file, text] of [['server/billd/signaling.mjs', output], ['docs/upstream-server-manifest.json', manifest]]) {
  if (check) { if (fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== text) throw Error(`Upstream server drift: ${file}`); }
  else { fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true }); fs.writeFileSync(file, text); }
}
console.log(`Verified ${records.length} upstream server blocks at ${revision}`);
