type CaptureOptions = {
  state(): Promise<{ secure: boolean; width: number; height: number }>;
  frame(height: number): Promise<Uint8Array>;
  source(): Promise<string>;
  quality(): { height: number; fps: number };
  replace(stream: MediaStream): Promise<void>;
  onError?(error: unknown): void;
};
/** Keeps the RTC sender alive while Windows changes the input desktop.
 * Ordinary frames remain on Chromium's original capture path. Only recovery /
 * protected desktops use native JPEG frames; no screen data is persisted. */
export class HostCapture {
  private normal?: MediaStream;
  private fallback?: MediaStream;
  private current?: MediaStream;
  private canvas?: HTMLCanvasElement;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private retryAt = 0;
  private failedSince = 0;
  constructor(private options: CaptureOptions) {}
  private async open(source: string) {
    if (!source) throw Error('Screen source unavailable');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
      mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source },
    } as MediaTrackConstraints });
    if (this.stopped) { stream.getTracks().forEach(track => track.stop()); throw Error('Capture cancelled'); }
    const previous = this.normal; this.normal = stream;
    previous?.getTracks().forEach(track => track.stop());
    return stream;
  }
  private async show(stream: MediaStream) {
    if (this.stopped || stream === this.current) return;
    await this.options.replace(stream);
    if (!this.stopped) this.current = stream;
  }
  private async nativeFrame() {
    const height = Math.max(360, Math.min(4320, Math.round(this.options.quality().height)));
    const data = await this.options.frame(height);
    if (this.stopped) return;
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/jpeg' }));
    try {
      if (this.stopped) return;
      if (!this.canvas) this.canvas = document.createElement('canvas');
      const canvas = this.canvas;
      if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
      if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
      canvas.getContext('2d', { alpha: false })!.drawImage(bitmap, 0, 0);
      if (!this.fallback) this.fallback = canvas.captureStream(30);
      await this.show(this.fallback);
    } finally { bitmap.close(); }
  }
  async start(source: string) {
    const state = await this.options.state();
    if (this.stopped) return;
    if (!state.secure) {
      try { await this.show(await this.open(source)); }
      catch { if (!this.stopped) await this.nativeFrame(); }
    } else await this.nativeFrame();
    this.schedule(100);
  }
  private schedule(delay: number) { if (!this.stopped) this.timer = setTimeout(() => void this.tick(), delay); }
  private async tick() {
    let delay = 250;
    try {
      const state = await this.options.state();
      if (this.stopped) return;
      const track = this.normal?.getVideoTracks()[0];
      if (!state.secure && track?.readyState === 'live' && !track.muted) await this.show(this.normal!);
      else {
        if (!state.secure && Date.now() >= this.retryAt) {
          this.retryAt = Date.now() + 2000;
          try { await this.show(await this.open(await this.options.source())); }
          catch { /* Protected desktop transitions can temporarily deny capture. */ }
        }
        const replacement = this.normal?.getVideoTracks()[0];
        if (state.secure || !replacement || replacement.readyState !== 'live' || replacement.muted) {
          await this.nativeFrame();
          delay = 1000 / Math.max(1, Math.min(30, this.options.quality().fps));
        }
      }
      this.failedSince = 0;
    } catch (error) {
      if (!this.failedSince) this.failedSince = Date.now();
      if (!this.stopped && Date.now() - this.failedSince > 30000) { this.stop(); this.options.onError?.(error); return; }
      delay = 500;
    } finally { this.schedule(delay); }
  }
  stop() {
    this.stopped = true; clearTimeout(this.timer);
    this.normal?.getTracks().forEach(track => track.stop());
    this.fallback?.getTracks().forEach(track => track.stop());
    this.canvas = undefined;
  }
}
