// Read-only target analysis. Generated evidence and derived sources stay in .tools.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parse } from '@vue/compiler-sfc';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.tools/rea-analysis');
const node = path.join(root, '.tools/rea-runtime/node-v24.11.0-win-x64/node.exe');
const cli = path.join(root, '.tools/rea/node_modules/rea-agents/scripts/rea.mjs');
const revisions = {
  client: '61be620eb35b0004dc66c296f0fdd8c62700b1b9',
  server: 'c73983e543341c08ce9e4fb7c52446be50b6c6a2',
};
const client = path.join(root, `.tools/rea-targets/billd-desk-${revisions.client}`);
const server = path.join(root, `.tools/rea-targets/billd-desk-server-${revisions.server}`);
for (const item of [node, cli, client, server]) {
  if (!fs.existsSync(item)) throw new Error(`Missing ${item}; see docs/billd-desk-rea-analysis.md`);
}
fs.mkdirSync(output, { recursive: true });
const temp = path.join(output, 'temp');
fs.mkdirSync(temp, { recursive: true });
const env = { ...process.env, TEMP: temp, TMP: temp };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const writeJson = (file, value) =>
  fs.writeFileSync(path.join(output, file), JSON.stringify(value, null, 2) + '\n');
function invoke(label, args) {
  const stdout = fs.openSync(path.join(output, `${label}.json`), 'w');
  const stderr = fs.openSync(path.join(output, `${label}.stderr.log`), 'w');
  let result;
  console.log(`REA: ${label}`);
  try {
    result = spawnSync(node, [cli, ...args, '--format', 'json', '--full-output'], {
      cwd: root,
      env,
      stdio: ['ignore', stdout, stderr],
      windowsHide: true,
    });
  } finally {
    fs.closeSync(stdout);
    fs.closeSync(stderr);
  }
  if (result.error) throw result.error;
  const envelope = JSON.parse(fs.readFileSync(path.join(output, `${label}.json`), 'utf8'));
  if (result.status !== 0 || !envelope.ok)
    throw new Error(`${label} failed; inspect its JSON and stderr log`);
  return envelope.data;
}

// Derived scripts preserve original line numbers and record every source digest.
// They are analysis inputs, not recovered release artifacts or runnable app builds.
const stage = fs.mkdtempSync(path.join(output, 'derived-client-'));
const clientPaths = [
  'package.json',
  'electron-main/index.ts',
  'electron-main/preload.ts',
  'src/event.ts',
  'src/constant.ts',
  'src/types/websocket.ts',
  'src/hooks/use-rtcParams.ts',
  'src/hooks/use-websocket.ts',
  'src/hooks/use-ipcRendererSend.ts',
  'src/hooks/webrtc/remoteDesk.ts',
  'src/utils/index.ts',
  'src/utils/network/webRTC.ts',
  'src/utils/network/websocket.ts',
  'src/store/app/index.ts',
  'src/store/network/index.ts',
];
const provenance = [];
for (const relative of clientPaths) {
  const bytes = fs.readFileSync(path.join(client, relative));
  const dest = path.join(stage, relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes);
  provenance.push({
    source: relative,
    derived: relative,
    sha256: sha256(bytes),
    transform: 'byte-identical-copy',
  });
}
for (const relative of ['src/views/remote/index.vue', 'src/views/webrtc/index.vue']) {
  const bytes = fs.readFileSync(path.join(client, relative));
  const source = bytes.toString('utf8');
  const { descriptor, errors } = parse(source, { filename: relative });
  if (errors.length) throw new Error(`${relative}: ${errors.join('; ')}`);
  const blocks = [descriptor.script, descriptor.scriptSetup].filter(Boolean);
  if (blocks.length !== 1) throw new Error(`${relative}: expected exactly one script block`);
  const block = blocks[0];
  const derived = relative + '.ts';
  const text = source.slice(0, block.loc.start.offset).replace(/[^\r\n]/g, ' ') + block.content;
  const dest = path.join(stage, derived);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
  provenance.push({
    source: relative,
    derived,
    sha256: sha256(bytes),
    derived_sha256: sha256(text),
    transform: 'Vue script only; whitespace prefix preserves source lines',
    script_start_line: block.loc.start.line,
  });
}
writeJson('derived-provenance.json', {
  revision: revisions.client,
  original_root: client,
  derived_root: stage,
  files: provenance,
});
const clientEvidence = invoke('billd-desk-derived', ['analyze-javascript-application', stage]);
const serverPaths = [
  'package.json',
  'src/types/websocket.ts',
  'src/config/websocket/index.ts',
  'src/config/websocket/handleMsg.ts',
  'src/config/websocket/live-redis.controller.ts',
  'src/controller/deskUser.controller.ts',
  'src/service/deskUser.service.ts',
];
const serverEvidence = invoke('billd-desk-server-focused', [
  'analyze-javascript-application',
  server,
  ...serverPaths.flatMap((file) => ['--source-path', file]),
]);
const handler = clientEvidence.normalized_result.graph.nodes.find(
  (n) =>
    n.kind === 'ipc-handler' &&
    n.observations.some((o) => o.properties?.channel_expression === 'IPC_EVENT.keyboardPressKey'),
);
if (!handler) throw new Error('Expected keyboardPressKey IPC handler was not observed');
const traceInput = path.join(output, 'keyboard-trace-input.json');
writeJson('keyboard-trace-input.json', {
  application: clientEvidence,
  seed: { kind: 'node-id', value: handler.node_id },
  direction: 'incoming',
});
const trace = invoke('keyboard-trace', ['trace-application-feature', traceInput]);
function compact(evidence) {
  const normalized = evidence.normalized_result;
  const graph = normalized.graph;
  return {
    evidence_id: evidence.evidence_id,
    subject: evidence.subject,
    statistics: normalized.statistics,
    summary: normalized.summary,
    graph_node_kinds: graph.nodes.reduce(
      (counts, n) => ({ ...counts, [n.kind]: (counts[n.kind] || 0) + 1 }),
      {},
    ),
    graph_edges: graph.edges.length,
    semantic_coverage: normalized.semantic_graph?.coverage.status,
    semantic_unknowns: normalized.semantic_graph?.unknowns.length,
    limitations: evidence.limitations,
  };
}
writeJson('summary.json', {
  rea_version: '6.7.0',
  revisions,
  scope: 'Static selected upstream sources, with line-preserving derived Vue scripts. No target execution.',
  client: compact(clientEvidence),
  server: compact(serverEvidence),
  keyboard_trace: {
    evidence_id: trace.evidence_id,
    summary: trace.normalized_result.summary,
    coverage: trace.normalized_result.coverage,
    limitations: trace.limitations,
  },
});
console.log(`Evidence saved to ${output}`);
