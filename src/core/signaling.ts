export type RemoteSignal = { msgType: string; data: Record<string, any> };

/** ICE can arrive during setLocalDescription, before the peer sends its SDP. */
export class RemoteSignaling {
  private pending: RemoteSignal[] = [];
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private retiredGenerations = new Set<string>();

  constructor(
    private dispatch: (signal: RemoteSignal) => Promise<unknown>,
    private hasRemoteDescription: () => boolean,
    private remoteSdp: () => string | undefined = () => undefined,
  ) {}

  private generations() {
    return new Set(
      [...(this.remoteSdp()?.matchAll(/^a=ice-ufrag:(.+)\r?$/gm) ?? [])].map((match) => match[1].trim()),
    );
  }

  private candidateGeneration(signal: RemoteSignal): string | undefined {
    const candidate = signal.data.candidate;
    return (
      candidate?.usernameFragment ||
      /(?:^|\s)ufrag\s+(\S+)/.exec(
        typeof candidate === 'string' ? candidate : candidate?.candidate || '',
      )?.[1]
    );
  }

  private candidateState(signal: RemoteSignal): 'ready' | 'pending' | 'stale' {
    const generation = this.candidateGeneration(signal);
    // Once credentials rotate, an untagged delayed candidate cannot safely be
    // assigned to the new transport generation.
    if (!generation && this.retiredGenerations.size) return 'stale';
    if (generation && this.retiredGenerations.has(generation)) return 'stale';
    if (!this.hasRemoteDescription()) return 'pending';
    const current = this.generations();
    return generation && current.size && !current.has(generation) ? 'pending' : 'ready';
  }

  receive(signal: RemoteSignal): Promise<void> {
    const operation = this.queue.then(async () => {
      if (this.closed) return;
      if (signal.msgType === 'nativeWebRtcCandidate') {
        const state = this.candidateState(signal);
        if (state === 'stale') return;
        if (state === 'pending') {
          if (this.pending.length >= 256) throw Error('连接候选过多，请重新连接');
          this.pending.push(signal);
          return;
        }
      }
      const previous = this.generations();
      await this.dispatch(signal);
      if (signal.msgType !== 'nativeWebRtcCandidate') {
        const current = this.generations();
        for (const generation of previous)
          if (!current.has(generation)) this.retiredGenerations.add(generation);
        while (this.retiredGenerations.size > 8)
          this.retiredGenerations.delete(this.retiredGenerations.values().next().value!);
      }
      const pending = this.pending;
      this.pending = [];
      for (const candidate of pending) {
        if (this.closed) break;
        const state = this.candidateState(candidate);
        if (state === 'ready') await this.dispatch(candidate);
        else if (state === 'pending') this.pending.push(candidate);
      }
    });
    this.queue = operation.catch(() => {
      this.close();
    });
    return operation;
  }

  close() {
    this.closed = true;
    this.pending = [];
    this.retiredGenerations.clear();
  }
}
