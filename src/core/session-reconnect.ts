/** A transport reconnect creates a new authenticated session; it never revives
 * an authorization room that an older server has already deleted. */
export class TransientConnectionError extends Error {}

export class SessionReconnect {
  private timer?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private epoch = 0;
  private working = false;
  private again = false;
  private count = 0;
  private running = false;
  get active() {
    return this.running;
  }

  constructor(
    private options: {
      attempt: () => Promise<void>;
      onStatus: (message: string) => void;
      onFailure: (error: Error) => void;
      windowMs?: number;
    },
  ) {}

  start() {
    if (this.running) {
      this.options.onStatus('网络连接已中断，正在重新连接（将建立新会话）…');
      if (this.working) this.again = true;
      else this.schedule();
      return;
    }
    this.running = true;
    this.count = 0;
    const epoch = ++this.epoch;
    this.options.onStatus('网络连接已中断，正在重新连接（将建立新会话）…');
    this.deadline = setTimeout(() => {
      if (epoch !== this.epoch || !this.running) return;
      this.cancel();
      this.options.onFailure(Error('自动重新连接已超时，请检查网络后重新连接'));
    }, this.options.windowMs ?? 60000);
    this.schedule();
  }

  private schedule() {
    if (!this.running || this.timer || this.working) return;
    const delay = Math.min(2000 * 2 ** this.count, 10000);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.attempt();
    }, delay);
  }

  private async attempt() {
    if (!this.running || this.working) return;
    const epoch = this.epoch;
    this.working = true;
    this.again = false;
    this.count++;
    this.options.onStatus(`正在重新连接（第 ${this.count} 次，将建立新会话）…`);
    try {
      await this.options.attempt();
      // Success here means connect-host was acknowledged. Keep the deadline
      // until the new peer reports ready, or another loss requests a retry.
    } catch (error) {
      if (epoch !== this.epoch || !this.running) return;
      if (error instanceof TransientConnectionError) {
        this.again = true;
        this.options.onStatus('网络连接未恢复，正在重试（将建立新会话）…');
      } else {
        this.cancel();
        this.options.onFailure(error instanceof Error ? error : Error(String(error)));
      }
    } finally {
      if (epoch === this.epoch) {
        this.working = false;
        if (this.again) this.schedule();
      }
    }
  }

  connected() {
    this.cancel();
  }
  online() {
    if (!this.running || this.working || this.count > 0) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    void this.attempt();
  }
  cancel() {
    this.epoch++;
    this.running = this.working = this.again = false;
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    this.timer = this.deadline = undefined;
  }
}
