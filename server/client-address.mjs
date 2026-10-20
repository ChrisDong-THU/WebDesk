import { isIP } from 'node:net';

function normalize(address) {
  if (typeof address !== 'string' || address.includes('%') || !isIP(address)) return undefined;
  if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4) return address.slice(7);
  return isIP(address) === 6 ? new URL(`http://[${address}]/`).hostname.slice(1, -1) : address;
}

// Trust only an explicitly configured immediate proxy, never an arbitrary
// forwarding chain. The proxy must OVERWRITE X-Real-IP with its client's IP.
export function clientAddressResolver(trustedProxies = []) {
  const trusted = new Set(trustedProxies.map(address => {
    const normalized = normalize(address);
    if (!normalized) throw Error(`Invalid TRUSTED_PROXIES address: ${address}`);
    return normalized;
  }));
  return socket => {
    const peer = normalize(socket.handshake.address) ?? socket.handshake.address;
    const forwarded = normalize(socket.handshake.headers['x-real-ip']);
    return trusted.has(peer) && forwarded ? forwarded : peer;
  };
}
