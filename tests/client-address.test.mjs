import test from 'node:test';
import assert from 'node:assert/strict';
import { clientAddressResolver } from '../server/client-address.mjs';

test('proxy trust normalizes IPs and rejects missing, malformed and chained headers', () => {
  const resolve = clientAddressResolver(['127.0.0.1', '0:0:0:0:0:0:0:1']);
  const socket = (address, real) => ({ handshake: { address, headers: { 'x-real-ip': real } } });
  assert.equal(resolve(socket('::ffff:127.0.0.1', '2001:0db8::1')), '2001:db8::1');
  assert.equal(resolve(socket('::1', '192.0.2.1')), '192.0.2.1');
  assert.equal(resolve(socket('192.0.2.3', '192.0.2.1')), '192.0.2.3');
  for (const value of [undefined, '', 'unknown', ['192.0.2.1'], '192.0.2.1, 192.0.2.2', '192.0.2.1:1234', 'fe80::1%eth0']) {
    assert.equal(resolve(socket('127.0.0.1', value)), '127.0.0.1');
  }
  assert.throws(() => clientAddressResolver(['*']), /Invalid/);
  assert.throws(() => clientAddressResolver(['127.0.0.0/8']), /Invalid/);
});
