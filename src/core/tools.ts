/** WebDesk additions. Reliable SCTP channel, separate from billd's input channel. */
import { CHUNK_SIZE, MAX_FILE_SIZE } from '../../shared/tools';
export { CHUNK_SIZE, MAX_FILE_SIZE } from '../../shared/tools';
const WINDOW_SIZE = 256 * 1024;
const PIPELINE_WINDOWS = 4;
export type FileInfo = { id: string; name: string; size: number };
export type FileSink = { write(data: Uint8Array): Promise<void>; close(): Promise<unknown>; abort(): Promise<void> };
export type FileSource = { name: string; size: number; read(offset: number, length: number): Promise<ArrayBuffer> };
export type ToolsOptions = {
  native?: (operation: string, data?: any) => Promise<any>;
  onProgress?: (value: { name: string; bytes: number; total: number; direction: 'send' | 'receive' }) => void;
};

export class DesktopTools {
  readonly channel: RTCDataChannel;
  private pending = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private queue = Promise.resolve();
  private queuedBytes = 0;
  private sending = false;
  private closed = false;
  private incoming?: { meta: FileInfo; sink: FileSink; bytes: number };
  private preparedSink?: FileSink;
  constructor(pc: RTCPeerConnection, private role: 'host' | 'controller', private options: ToolsOptions = {}) {
    // Negotiated ID avoids the upstream ondatachannel handler, which owns the
    // MessageChannel. No offer/answer or media track is replaced.
    this.channel = pc.createDataChannel('WebDesk tools v2', { negotiated: true, id: 42, ordered: true });
    this.channel.binaryType = 'arraybuffer';
    this.channel.bufferedAmountLowThreshold = 64 * 1024;
    this.channel.onclose = () => this.close();
    this.channel.onerror = () => this.close();
    this.channel.onmessage = event => {
      const size = typeof event.data === 'string' ? event.data.length * 2 : event.data.byteLength;
      this.queuedBytes += size;
      if (this.queuedBytes > 2 * 1024 ** 2) { this.close(); return; }
      this.queue = this.queue.then(() => this.receive(event.data)).catch(() => this.close()).finally(() => { this.queuedBytes -= size; });
    };
  }
  private json(value: unknown) {
    if (this.closed || this.channel.readyState !== 'open') throw Error('工具通道未就绪，请确认两端均已更新');
    this.channel.send(JSON.stringify(value));
  }
  request(operation: string, data: any = {}, timeout = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('操作超时，请确认远程端版本或重试')); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.json({ id, operation, data }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  private async receive(raw: string | ArrayBuffer) {
    if (this.closed) return;
    if (typeof raw !== 'string') {
      const item = this.incoming;
      if (!item || raw.byteLength > CHUNK_SIZE || item.bytes + raw.byteLength > item.meta.size) throw Error('Invalid file chunk');
      await item.sink.write(new Uint8Array(raw));
      item.bytes += raw.byteLength;
      this.options.onProgress?.({ name: item.meta.name, bytes: item.bytes, total: item.meta.size, direction: 'receive' });
      return;
    }
    if (raw.length > 700000) throw Error('Message too large');
    const message = JSON.parse(raw);
    if (typeof message.id !== 'string' || message.id.length > 64) throw Error('Invalid request');
    if ('reply' in message) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) pending.reject(Error(message.error)); else pending.resolve(message.reply);
      return;
    }
    // Requests may themselves send files and wait for replies. Do not block the
    // ordered receive queue with them; file begin/ack/end remain serialized.
    if (['file.begin', 'file.ack', 'file.end', 'file.abort'].includes(message.operation)) await this.respond(message);
    else void this.respond(message);
  }
  private async respond(message: any) {
    try { const result = await this.handle(message.operation, message.data); if (!this.closed) this.json({ id: message.id, reply: result ?? null }); }
    catch (error) { if (!this.closed) this.json({ id: message.id, reply: null, error: error instanceof Error ? error.message : '操作失败' }); }
  }
  private async handle(operation: string, data: any): Promise<any> {
    if (operation === 'ping') return { version: 2 };
    if (operation === 'file.begin') {
      if (this.incoming) throw Error('已有文件正在接收');
      if (!data || typeof data.name !== 'string' || data.name.length > 255 || !Number.isSafeInteger(data.size) || data.size < 0 || data.size > MAX_FILE_SIZE) throw Error('文件无效或超过 2 GB');
      let sink: FileSink;
      if (this.role === 'host') {
        const file = await this.native('file.begin', data);
        sink = { write: bytes => this.native('file.write', { id: file.id, bytes }), close: () => this.native('file.end', { id: file.id }),
          // Cleanup remains callable after the transport has been revoked.
          abort: () => this.options.native!('file.abort', { id: file.id }) };
      } else {
        if (!this.preparedSink) throw Error('请先选择本地保存位置');
        sink = this.preparedSink; this.preparedSink = undefined;
      }
      if (this.closed) { await sink.abort(); throw Error('连接已结束'); }
      this.incoming = { meta: data, sink, bytes: 0 };
      return true;
    }
    if (operation === 'file.ack') return this.incoming?.bytes;
    if (operation === 'file.end') {
      const item = this.incoming;
      if (!item || item.bytes !== item.meta.size) throw Error('文件大小不完整');
      const result = await item.sink.close(); this.incoming = undefined; return result;
    }
    if (operation === 'file.abort') { await this.incoming?.sink.abort(); this.incoming = undefined; return; }
    if (this.role !== 'host') throw Error('不支持的操作');
    if (operation === 'file.download') {
      const meta: FileInfo = await this.native('file.info', data);
      try { return await this.sendFile({ ...meta, read: (offset, length) => this.native('file.read', { id: meta.id, offset, length }) }); }
      finally { await this.native('file.release', { id: meta.id }); }
    }
    if (['file.select', 'clipboard.read', 'clipboard.write'].includes(operation)) return this.native(operation, data);
    throw Error('不支持的操作');
  }
  private native(operation: string, data?: any): Promise<any> {
    if (this.closed || !this.options.native) return Promise.reject(Error('Windows 工具未就绪'));
    return this.options.native(operation, data);
  }
  async sendFile(file: FileSource): Promise<any> {
    if (this.sending) throw Error('请等待当前文件传输完成');
    if (file.size > MAX_FILE_SIZE) throw Error('单个文件不能超过 2 GB');
    this.sending = true;
    let begun = false;
    try {
      await this.request('file.begin', { name: file.name, size: file.size }); begun = true;
      const confirmations: Promise<void>[] = [];
      let failed: Error | undefined;
      const confirmed = async () => { await confirmations.shift(); if (failed) throw failed; };
      let offset = 0;
      while (offset < file.size) {
        const end = Math.min(offset + WINDOW_SIZE, file.size);
        while (offset < end) {
          if (failed) throw failed;
          const bytes = await file.read(offset, Math.min(CHUNK_SIZE, end - offset));
          if (!bytes.byteLength || bytes.byteLength > Math.min(CHUNK_SIZE, end - offset)) throw Error('文件读取失败');
          await this.drain(); this.channel.send(bytes); offset += bytes.byteLength;
        }
        const expected = offset;
        // Observe rejections immediately, even while reading the next window.
        // ACK confirms ordered writes; file.end is the durable commit boundary.
        confirmations.push(this.request('file.ack').then(bytes => {
          if (bytes !== expected) throw Error('文件传输校验失败');
          this.options.onProgress?.({ name: file.name, bytes: expected, total: file.size, direction: 'send' });
        }).catch(error => { failed ??= error; }));
        if (confirmations.length >= PIPELINE_WINDOWS) await confirmed();
      }
      while (confirmations.length) await confirmed();
      return await this.request('file.end');
    } catch (error) { if (begun && !this.closed) await this.request('file.abort').catch(() => {}); throw error; }
    finally { this.sending = false; }
  }
  private drain(): Promise<void> {
    if (this.closed || this.channel.readyState !== 'open') return Promise.reject(Error('文件传输已断开'));
    if (this.channel.bufferedAmount < WINDOW_SIZE) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = (error?: Error) => { clearTimeout(timer); this.channel.removeEventListener('bufferedamountlow', low); this.channel.removeEventListener('close', closed); error ? reject(error) : resolve(); };
      const low = () => done(), closed = () => done(Error('文件传输已断开'));
      const timer = setTimeout(() => done(Error('文件发送超时')), 30000);
      this.channel.addEventListener('bufferedamountlow', low); this.channel.addEventListener('close', closed);
    });
  }
  async download(file: FileInfo, sink: FileSink) {
    if (this.preparedSink || this.incoming) throw Error('已有文件正在接收');
    this.preparedSink = sink;
    try { await this.request('file.download', { id: file.id }, 6 * 60 * 60 * 1000); }
    catch (error) { await sink.abort().catch(() => {}); throw error; }
    finally { this.preparedSink = undefined; }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(Error('连接已结束')); }
    this.pending.clear();
    void this.queue.finally(async () => { await this.incoming?.sink.abort().catch(() => {}); await this.preparedSink?.abort().catch(() => {}); this.incoming = undefined; this.preparedSink = undefined; });
    this.channel.close();
  }
}
