export type RemoteSignal = { msgType: string; data: Record<string, any> };

/** ICE can arrive during setLocalDescription, before the peer sends its SDP. */
export class RemoteSignaling {
  private pending: RemoteSignal[] = [];
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private dispatch: (signal: RemoteSignal) => Promise<unknown>,
    private hasRemoteDescription: () => boolean) {}

  receive(signal: RemoteSignal): Promise<void> {
    const operation = this.queue.then(async () => {
      if (this.closed) return;
      if (signal.msgType === 'nativeWebRtcCandidate' && !this.hasRemoteDescription()) {
        if (this.pending.length >= 256) throw Error('连接候选过多，请重新连接');
        this.pending.push(signal);
        return;
      }
      await this.dispatch(signal);
      while (!this.closed && this.hasRemoteDescription() && this.pending.length) {
        await this.dispatch(this.pending.shift()!);
      }
    });
    this.queue = operation.catch(() => { this.close(); });
    return operation;
  }

  close() { this.closed = true; this.pending = []; }
}
