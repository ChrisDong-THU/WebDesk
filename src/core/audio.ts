/** User-gesture playback plus acknowledged remote capture, scoped to one peer. */
export class RemoteAudio {
  enabled = false;
  private closed = false;
  constructor(private video: HTMLVideoElement, private request: (enabled: boolean) => Promise<unknown>) {}

  async setEnabled(enabled: boolean) {
    if (this.closed) throw Error('连接已结束');
    // Start playback inside the click gesture, before waiting for the network.
    this.video.muted = !enabled;
    if (!enabled) this.enabled = false;
    try {
      if (enabled) await this.video.play();
      const reply = await this.request(enabled);
      if (this.closed) return;
      if (reply !== enabled) throw Error('远程端未确认声音设置，请更新客户端');
      this.enabled = enabled;
    } catch (error) {
      this.video.muted = this.closed || !this.enabled;
      throw error;
    }
  }

  close() { this.closed = true; this.enabled = false; this.video.muted = true; }
}
