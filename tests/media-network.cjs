const dgram = require('node:dgram');
const { performance } = require('node:perf_hooks');

// A real UDP bottleneck, not DevTools' HTTP throttle or a sender bitrate cap.
// Each ICE candidate gets a private loopback proxy. The answer contains no
// browser candidates, so neither endpoint can nominate a direct bypass.
class MediaNetwork {
  constructor({ mbps = 1000, delayMs = 0, loss = 0, queueMs = 100 } = {}) {
    this.config = { mbps, delayMs, loss, queueMs };
    this.sockets = []; this.timers = new Set(); this.seed = 42;
    this.metrics = { forwardedBytes: 0, dropped: 0, packets: 0, maxQueueMs: 0, proxyPorts: [] };
  }
  random() { this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0; return this.seed / 2 ** 32; }
  async candidate(original) {
    const parts = original.candidate.split(' ');
    if (parts[2]?.toLowerCase() !== 'udp' || !/^\d+\.\d+\.\d+\.\d+$/.test(parts[4])) return null;
    const host = { address: parts[4], port: Number(parts[5]) };
    const socket = dgram.createSocket('udp4');
    await new Promise((resolve, reject) => { socket.once('error', reject); socket.bind(0, '0.0.0.0', resolve); });
    this.metrics.proxyPorts.push(socket.address().port);
    this.sockets.push(socket);
    let controller;
    const next = [0, 0];
    socket.on('message', (bytes, from) => {
      // A wildcard-bound native socket replies to a loopback peer with 127.0.0.1
      // even when its advertised ICE address is the LAN interface.
      const downstream = from.port === host.port;
      if (!downstream) controller = from;
      const to = downstream ? controller : host;
      if (!to) return;
      const direction = downstream ? 0 : 1;
      const now = performance.now(), { mbps, delayMs, loss, queueMs } = this.config;
      this.metrics.packets++;
      if (this.random() < loss || next[direction] - now > queueMs) { this.metrics.dropped++; return; }
      next[direction] = Math.max(now, next[direction]) + bytes.length * 8 / (mbps * 1000);
      this.metrics.maxQueueMs = Math.max(this.metrics.maxQueueMs, next[direction] - now);
      const timer = setTimeout(() => {
        this.timers.delete(timer); this.metrics.forwardedBytes += bytes.length;
        socket.send(bytes, to.port, to.address, () => {});
      }, Math.max(0, next[direction] - now + delayMs));
      this.timers.add(timer);
    });
    parts[5] = String(socket.address().port);
    return { ...original, candidate: parts.join(' ') };
  }
  close() { for (const t of this.timers) clearTimeout(t); this.timers.clear(); for (const s of this.sockets.splice(0)) s.close(); }
}
module.exports = { MediaNetwork };
