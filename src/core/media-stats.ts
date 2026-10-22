/** Interval receiver metrics. RTT is transport latency, not input-to-picture latency. */
export class ReceiverMediaStats {
  private previous?: Record<string, any>;
  sample(reports: RTCStatsReport) {
    const video = [...reports.values()].filter(r => r.type === 'inbound-rtp' && (r.kind ?? r.mediaType) === 'video')
      .sort((a, b) => (b.bytesReceived ?? 0) - (a.bytesReceived ?? 0))[0];
    if (!video) { this.previous = undefined; return undefined; }
    const before = this.previous;
    this.previous = { ...video };
    const same = before && before.id === video.id && before.codecId === video.codecId && video.timestamp > before.timestamp;
    const delta = (key: string): number | undefined => same && Number.isFinite(video[key]) && Number.isFinite(before[key]) && video[key] >= before[key]
      ? video[key] - before[key] : undefined;
    const perFrame = (time: string, frames: string) => {
      const duration = delta(time), count = delta(frames);
      return duration !== undefined && count !== undefined && count > 0 ? duration * 1000 / count : undefined;
    };
    const bytes = delta('bytesReceived');
    return {
      fps: video.framesPerSecond ?? 0, width: video.frameWidth ?? 0, height: video.frameHeight ?? 0,
      codec: reports.get(video.codecId)?.mimeType?.replace('video/', '') ?? '',
      bitrate: bytes !== undefined ? bytes * 8 / (video.timestamp - before!.timestamp) : 0,
      decodeMs: perFrame('totalDecodeTime', 'framesDecoded'),
      jitterBufferMs: perFrame('jitterBufferDelay', 'jitterBufferEmittedCount'),
      freezes: delta('freezeCount'), dropped: delta('framesDropped'),
    };
  }
}
