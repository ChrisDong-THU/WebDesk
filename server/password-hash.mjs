import { scrypt } from 'node:crypto';

// Leave libuv worker capacity for file/DNS work and bound retained credentials.
export function createPasswordHasher({ concurrency = 2, queueLimit = 16 } = {}) {
  let active = 0;
  const waiting = [];
  function next() {
    if (active >= concurrency || !waiting.length) return;
    const { password, salt, resolve, reject } = waiting.shift();
    active++;
    const complete = (error, hash) => {
      active--;
      error ? reject(error) : resolve(hash);
      next();
    };
    try { scrypt(password, salt, 32, complete); }
    catch (error) { complete(error); }
  }
  return (password, salt) => new Promise((resolve, reject) => {
    if (active >= concurrency && waiting.length >= queueLimit) {
      reject(Error('认证请求繁忙，请稍后重试')); return;
    }
    waiting.push({ password, salt, resolve, reject });
    next();
  });
}
