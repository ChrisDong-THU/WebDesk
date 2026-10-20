/** WebDesk additions, using Electron clipboard/dialog and streamed file I/O. */
import { app, clipboard, dialog, type BrowserWindow } from 'electron';
import { open, mkdir, mkdtemp, unlink, rename, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CHUNK_SIZE, MAX_FILE_SIZE } from '../shared/tools';

type Stored = { id: string; name: string; size: number; path: string; partial?: string; handle?: FileHandle; bytes: number; complete: boolean; selected?: boolean };
export class NativeTools {
  private sessionId = '';
  private files = new Map<string, Stored>();
  private queue: Promise<unknown> = Promise.resolve();
  private selecting = false;
  constructor(private window: BrowserWindow, private downloadRoot = () => path.join(app.getPath('downloads'), 'WebDesk')) {}
  async start(sessionId: string) { await this.stop(); this.sessionId = sessionId; }
  invoke(sessionId: string, operation: string, data: any = {}) {
    if (!sessionId || sessionId !== this.sessionId) return Promise.reject(Error('远程会话已结束'));
    if (operation === 'file.select') {
      if (this.selecting) return Promise.reject(Error('请完成当前文件选择'));
      this.selecting = true;
      return this.perform(sessionId, operation, data).finally(() => { this.selecting = false; });
    }
    const task = this.queue.then(async () => {
      if (sessionId !== this.sessionId) throw Error('远程会话已结束');
      return this.perform(sessionId, operation, data);
    });
    this.queue = task.catch(() => {}); return task;
  }
  private async perform(sessionId: string, operation: string, data: any) {
    const active = () => { if (this.sessionId !== sessionId) throw Error('远程会话已结束'); };
    if (operation === 'clipboard.read') return clipboard.readText().slice(0, 65536);
    if (operation === 'clipboard.write') {
      if (typeof data.text !== 'string' || data.text.length > 65536) throw Error('剪贴板文字不能超过 64K 字符');
      clipboard.writeText(data.text); return;
    }
    if (operation === 'file.select') {
      if (this.files.size >= 100) throw Error('本次会话文件数量已达上限，请重新连接');
      // Native dialog is shown on the captured desktop and can be operated by
      // the controller. Paths never cross the network; only opaque IDs do.
      const result = await dialog.showOpenDialog(this.window, { title: '选择要发送到浏览器的文件', properties: ['openFile'], securityScopedBookmarks: false });
      active(); if (result.canceled || !result.filePaths[0]) return null;
      const filename = result.filePaths[0];
      const handle = await open(filename, 'r');
      try {
        const stat = await handle.stat(); active();
        if (!stat.isFile() || stat.size > MAX_FILE_SIZE) throw Error('请选择不超过 2 GB 的文件');
        const file: Stored = { id: randomUUID(), name: path.basename(filename), path: filename, size: stat.size, handle, bytes: 0, complete: true, selected: true };
        this.files.set(file.id, file); return this.info(file);
      } catch (error) { await handle.close(); throw error; }
    }
    if (operation === 'file.begin') {
      if (this.files.size >= 100 || [...this.files.values()].some(file => !file.complete)) throw Error('文件接收正忙');
      if (typeof data.name !== 'string' || !Number.isSafeInteger(data.size) || data.size < 0 || data.size > MAX_FILE_SIZE) throw Error('无效文件');
      // Each transfer has a fresh directory; no overwrite or path traversal.
      const name = data.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 180);
      if (!name || /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(name)) throw Error('Windows 不支持此文件名');
      const root = this.downloadRoot(); await mkdir(root, { recursive: true });
      const directory = await mkdtemp(path.join(root, 'receive-')); active();
      const filename = path.join(directory, name), partial = filename + '.webdesk-part';
      const handle = await open(partial, 'wx');
      const file: Stored = { id: randomUUID(), name, size: data.size, path: filename, partial, handle, bytes: 0, complete: false };
      this.files.set(file.id, file); active(); return this.info(file);
    }
    const file = this.files.get(data?.id);
    if (!file) throw Error('文件不存在或已失效');
    if (operation === 'file.info') { if (!file.selected) throw Error('请选择远程文件'); return this.info(file); }
    if (operation === 'file.read') {
      if (!file.selected || !file.handle || !Number.isSafeInteger(data.offset) || data.offset < 0 || !Number.isInteger(data.length) || data.length < 1 || data.length > CHUNK_SIZE || data.offset + data.length > file.size) throw Error('无效读取');
      const buffer = Buffer.alloc(data.length);
      const { bytesRead } = await file.handle.read(buffer, 0, buffer.length, data.offset);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead);
    }
    if (operation === 'file.write') {
      if (file.complete || !file.handle || !(data.bytes instanceof Uint8Array) || !data.bytes.length || data.bytes.length > CHUNK_SIZE || file.bytes + data.bytes.length > file.size) throw Error('无效文件块');
      let offset = 0;
      while (offset < data.bytes.length) { const { bytesWritten } = await file.handle.write(data.bytes, offset, data.bytes.length - offset); if (!bytesWritten) throw Error('磁盘写入失败'); offset += bytesWritten; }
      file.bytes += data.bytes.length; return;
    }
    if (operation === 'file.end') {
      if (file.complete || file.bytes !== file.size || !file.handle || !file.partial) throw Error('文件不完整');
      await file.handle.sync(); await file.handle.close(); file.handle = undefined;
      active(); await rename(file.partial, file.path); file.partial = undefined; file.complete = true;
      return { ...this.info(file), location: '下载 / WebDesk' };
    }
    if (operation === 'file.abort' || operation === 'file.release') {
      await this.dispose(file); this.files.delete(file.id); return;
    }
    throw Error('不支持的 Windows 操作');
  }
  private info(file: Stored) { return { id: file.id, name: file.name, size: file.size }; }
  private async dispose(file: Stored) { await file.handle?.close().catch(() => {}); file.handle = undefined; if (file.partial) await unlink(file.partial).catch(() => {}); }
  async stop() {
    this.sessionId = '';
    // Revoke authorization immediately. The native picker may still be open;
    // its completion checks the session before exposing or reading any file.
    await this.queue;
    await Promise.all([...this.files.values()].map(file => this.dispose(file)));
    this.files.clear();
  }
}
