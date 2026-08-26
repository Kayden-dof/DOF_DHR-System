import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (
  pw: string | Buffer, salt: string | Buffer, len: number, opts?: object,
) => Promise<Buffer>;

/* ---------------------------------------------------------------------------
   숫자 비밀번호(PIN) 해시

   §4.1이 정한 로그인은 login_code + 숫자 PIN이다. 자릿수가 짧아 키 공간이
   작으므로 비용을 높인 scrypt를 쓴다. 사양 주석에 적힌 대로 "이석 시 로그아웃과
   계정 책임은 교육으로 관리"가 전제다.

   저장 형식:  scrypt$N$r$p$<salt-b64>$<hash-b64>
--------------------------------------------------------------------------- */

const N = 1 << 15;   // 32768
const R = 8;
const P = 1;
const KEYLEN = 32;

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pin, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPin(pin: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;                       // QP는 pin_hash가 null이다
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');

  let actual: Buffer;
  try {
    actual = await scrypt(pin, salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export { PIN_MIN_LENGTH } from './auth-const';
