// lib/auth.ts와 같은 형식으로 해시한다. 시드 스크립트가 TS를 거치지 않으므로
// 최소한만 옮겨 둔다. 형식이 어긋나면 로그인이 안 되니 함께 고칠 것.
import { randomBytes, scrypt as _scrypt } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt);
const N = 1 << 15, R = 8, P = 1, KEYLEN = 32;

export async function hashPin(pin) {
  const salt = randomBytes(16);
  const key = await scrypt(pin, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}
