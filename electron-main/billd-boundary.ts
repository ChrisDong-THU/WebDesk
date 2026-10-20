/** Authenticated IPC boundary. Native input operations live in billd/handlers. */
import { app, desktopCapturer, screen, type BrowserWindow } from 'electron';
import { registerNativeHandlers } from './billd/handlers';
import { randomUUID } from 'node:crypto';
import type { CaptureSource, NativeCommand } from '../shared/desktop';
import type { WindowsDesktop } from './windows-desktop';
// The installed application requires WindowsDesktop. Keep the upstream input
// backend available for source development without loading or shipping it.
type LegacyInput = typeof import('@nut-tree-fork/nut-js');
let legacy: LegacyInput | undefined;
function legacyInput(): LegacyInput {
  if (app.isPackaged) throw Error('Windows desktop worker unavailable');
  return legacy ??= require('@nut-tree-fork/nut-js');
}
const nutjs = new Proxy({} as LegacyInput, { get: (_target, key: keyof LegacyInput) => legacyInput()[key] });
const inputChannels = new Set(['mouseScrollDown', 'mouseScrollUp', 'mouseScrollLeft', 'mouseScrollRight',
  'mouseSetPosition', 'mouseMove', 'mouseDrag', 'keyboardType', 'keyboardPressKey', 'keyboardReleaseKey',
  'mousePressButtonLeft', 'mouseReleaseButtonLeft', 'mouseDoubleClick', 'mouseLeftClick', 'mouseRightClick']);

export class NativeBoundary {
  private sessionId = '';
  private handlers = new Map<string, (event: unknown, command: NativeCommand) => any>();
  private replies = new Map<string, (result: any) => void>();
  private pending = new Set<Promise<unknown>>();
  private keys = new Set<number>();
  private leftPressed = false;
  private inputWorker?: WindowsDesktop;
  constructor(window: BrowserWindow, private onError: (error: unknown) => void, private worker: () => WindowsDesktop | undefined = () => undefined) {
    registerNativeHandlers({
      // Registration is intercepted, not the original operation bodies. Only
      // the narrow authenticated command entrypoint is exposed in preload.
      ipcMain: {
        on: (channel: string, callback: any) => this.handlers.set(channel, callback),
        handle: (channel: string, callback: any) => this.handlers.set(channel, callback),
      },
      nutjs, windowMap: new Map([[1, window]]), desktopCapturer, screen, platform: process.platform,
      winWebContentsSend: (result: any) => {
        const reply = this.replies.get(result.requestId);
        if (reply) { this.replies.delete(result.requestId); reply(result); }
        else if (result.code !== 0) onError(Error('Windows 输入失败'));
      },
    });
  }
  async capture(sessionId: string): Promise<CaptureSource> {
    await this.stop(); this.sessionId = sessionId;
    const requestId = randomUUID();
    const result = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { this.replies.delete(requestId); reject(Error('屏幕枚举超时')); }, 10000);
      this.replies.set(requestId, data => { clearTimeout(timer); resolve(data); });
      Promise.resolve(this.handlers.get('getScreenStream')!(null, { requestId, data: { windowId: 1 } })).catch(error => {
        clearTimeout(timer); this.replies.delete(requestId); reject(error);
      });
    });
    if (this.sessionId !== sessionId || result.code !== 0 || !result.data?.stream?.id) throw Error('屏幕采集已取消');
    const command = { requestId, data: { windowId: 1 } };
    const size = await this.handlers.get('getPrimaryDisplaySize')!(null, command);
    const scale = await this.handlers.get('scaleFactor')!(null, command);
    return { sourceId: result.data.stream.id, name: result.data.stream.name,
      width: size.data.width, height: size.data.height, scaleFactor: scale.data.scaleFactor };
  }
  send(sessionId: string, channel: string, command: NativeCommand) {
    if (!sessionId || this.sessionId !== sessionId) return;
    if (channel === 'webdesk:release') { void this.release(); return; }
    if (!inputChannels.has(channel)) return;
    const data = command?.data;
    if (!data || typeof command.requestId !== 'string' || command.requestId.length > 128) return;
    if (channel.startsWith('mouseScroll') && (!Number.isFinite(data.amount) || data.amount <= 0 || data.amount > 10000)) return;
    if (['mouseMove', 'mouseDrag', 'mouseSetPosition'].includes(channel) && (![data.x, data.y].every(Number.isFinite) || Math.abs(data.x) > 100000 || Math.abs(data.y) > 100000)) return;
    if (channel.startsWith('keyboard') && (!Array.isArray(data.key) || data.key.length > 8 || !data.key.every((k: unknown) => Number.isInteger(k) && Number(k) >= 0 && Number(k) <= 255))) return;
    if (this.pending.size > 200) { void this.stop(); this.onError(Error('输入积压，远程控制已停止')); return; }
    if (channel === 'keyboardPressKey') data.key.forEach((key: number) => this.keys.add(key));
    if (channel === 'keyboardReleaseKey') data.key.forEach((key: number) => this.keys.delete(key));
    if (channel === 'mousePressButtonLeft') this.leftPressed = true;
    if (channel === 'mouseReleaseButtonLeft') this.leftPressed = false;
    // Independent dispatch, as in the upstream ipcMain listeners. No serial
    // input queue, delta conversion or nut.js delay override.
    const desktop = this.worker();
    this.inputWorker = desktop;
    const task = (desktop ? desktop.input(channel, command) : Promise.resolve(this.handlers.get(channel)!(null, { ...command, data: { ...data, windowId: 1 } }))).catch(this.onError);
    this.pending.add(task); void task.finally(() => this.pending.delete(task));
  }
  async release() {
    await Promise.allSettled([...this.pending]);
    const desktop = this.inputWorker || this.worker();
    if (desktop) await desktop.release().catch(() => {});
    else {
      for (const key of this.keys) { try { await nutjs.keyboard.releaseKey(key); } catch (error) { this.onError(error); } }
      if (this.leftPressed) { try { await nutjs.mouse.releaseButton(nutjs.Button.LEFT); } catch (error) { this.onError(error); } }
    }
    this.inputWorker = undefined;
    this.keys.clear(); this.leftPressed = false;
  }
  async stop() { this.sessionId = ''; await this.release(); }
}
