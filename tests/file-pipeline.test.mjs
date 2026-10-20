import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
await build({ entryPoints: ['src/core/tools.ts'], outfile: 'test-results/file-pipeline.mjs', bundle: true, platform: 'node', format: 'esm' });
const { DesktopTools } = await import('../test-results/file-pipeline.mjs');

class Channel extends EventTarget {
  readyState = 'open'; bufferedAmount = 0; held = []; hold = false;
  acknowledgements = new Set(); bytes = 0;
  send(raw) {
    if (typeof raw === 'string') {
      const message = JSON.parse(raw);
      if (message.operation === 'file.ack') this.other.acknowledgements.add(message.id);
      if (this.acknowledgements.delete(message.id) && this.hold) { this.held.push(raw); return; }
    } else this.bytes += raw.byteLength;
    queueMicrotask(() => this.other.onmessage?.({ data: raw }));
  }
  release() { this.hold = false; this.held.splice(0).forEach(raw => this.send(raw)); }
  close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); this.onclose?.(); }
}
function fixture(t) {
  const a = new Channel(), b = new Channel(); a.other = b; b.other = a;
  const bytes = [], operations = [], progress = [];
  const sender = new DesktopTools({ createDataChannel: () => a }, 'controller', { onProgress: item => progress.push(item.bytes) });
  const receiver = new DesktopTools({ createDataChannel: () => b }, 'host', { native: async (op, data) => {
    operations.push(op);
    if (op === 'file.begin') return { id: 'file' };
    if (op === 'file.write') bytes.push(Buffer.from(data.bytes));
    if (op === 'file.end') return { size: Buffer.concat(bytes).length };
  } });
  t.after(() => { sender.close(); receiver.close(); });
  return { a, b, sender, receiver, bytes, operations, progress };
}
const source = bytes => ({ name: 'test.bin', size: bytes.length, read: async (offset, length) => Uint8Array.from(bytes.subarray(offset, offset + length)).buffer });
async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error('Timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
test('sender pipelines four windows, caps unacknowledged bytes and commits identical data', async t => {
  const f = fixture(t);
  f.b.hold = true;
  const data = Buffer.alloc(5 * 256 * 1024 + 7);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  const sending = f.sender.sendFile(source(data));
  await until(() => f.b.held.length === 4);
  assert.equal(f.a.bytes, 1024 * 1024);
  assert.equal(f.operations.includes('file.end'), false);
  assert.deepEqual(f.progress, []);
  f.b.release();
  assert.equal((await sending).size, data.length);
  assert.deepEqual(Buffer.concat(f.bytes), data);
  assert.equal(f.progress.at(-1), data.length);
  assert.equal(f.operations.filter(op => op === 'file.end').length, 1);
});
test('disconnect rejects all outstanding windows and aborts the incomplete file', async t => {
  const f = fixture(t); f.b.hold = true;
  const sending = f.sender.sendFile(source(Buffer.alloc(2 * 1024 * 1024)));
  const rejected = assert.rejects(sending, /连接已结束|断开/);
  await until(() => f.b.held.length === 4);
  f.sender.close(); f.receiver.close();
  await rejected;
  await until(() => f.operations.includes('file.abort'));
  assert.equal(f.operations.includes('file.end'), false);
});
test('bad cumulative acknowledgement aborts instead of committing', async t => {
  const f = fixture(t); f.b.hold = true;
  const sending = f.sender.sendFile(source(Buffer.alloc(2 * 1024 * 1024)));
  const rejected = assert.rejects(sending, /校验失败/);
  await until(() => f.b.held.length === 4);
  const first = JSON.parse(f.b.held[0]); first.reply--;
  f.b.held[0] = JSON.stringify(first); f.b.release();
  await rejected;
  assert.equal(f.operations.includes('file.abort'), true);
  assert.equal(f.operations.includes('file.end'), false);
});
