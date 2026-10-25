import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

await build({
  entryPoints: ['src/core/media-diagnostics.ts'],
  outfile: 'test-results/media-diagnostics.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
});
const { formatHostMediaDiagnostics } = await import('../test-results/media-diagnostics.mjs');

test('diagnostics describe actual implementation, selection and unknown measurements', () => {
  const missing = formatHostMediaDiagnostics({ encodeMs: NaN });
  assert.match(missing, /编码器：未报告/);
  assert.match(missing, /编码耗时：未报告/);
  assert.doesNotMatch(missing, /NaN|undefined|旧客户端/);
  const actual = formatHostMediaDiagnostics({
    encoder: 'libaom',
    encodeMs: 6.2,
    backend: 'dxgi',
    codecPreference: 'auto',
    codecDecision: '保持 AV1',
    codecOrder: ['video/av1', 'video/h264'],
    codecSwitches: 2,
    codecCooldownMs: 1201,
  });
  assert.match(actual, /编码器：libaom/);
  assert.match(actual, /编码设置：自动/);
  assert.match(actual, /选择原因：保持 AV1/);
  assert.match(actual, /切换冷却：2 s/);
});
