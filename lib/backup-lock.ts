import { randomBytes, scrypt as _scrypt, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { PASSPHRASE_MIN } from './backup-lock-const';

const scrypt = promisify(_scrypt) as (
  pw: string | Buffer, salt: string | Buffer, len: number, opts?: object,
) => Promise<Buffer>;

/* ---------------------------------------------------------------------------
   백업 파일에 자물쇠를 건다 (사용자 요청 2026-09-01)

   "외부에서 저 백업 파일을 가져가도 열지 못하도록"

   백업 한 파일에 이 회사의 제조기록 전부가 들어 있다. 그 파일이 메일에 잘못
   붙거나 USB 째로 없어지면, 서버를 아무리 잘 지켜도 소용이 없다. 그래서
   **파일 자체를 잠근다.**

   ── 어떻게 잠그는가 ────────────────────────────────────────────────────────
   암호는 그대로 열쇠가 되지 못한다. 사람이 정한 암호는 짧고 흔해서, 가져간
   사람이 사전을 돌리면 금방 맞춘다.

     scrypt      암호에서 열쇠를 만든다. 한 번 만드는 데 일부러 오래 걸리게
                 해서, 수백만 번 시도하는 길을 막는다 (로그인 PIN 과 같은 규율)
     AES-256-GCM 그 열쇠로 잠근다. GCM 은 잠그면서 **봉인도 함께 붙인다** -
                 한 글자라도 손대면 여는 순간 드러난다

   자물쇠를 열 수 있는 것은 암호를 아는 사람뿐이다. 이 시스템도, 이 서버도,
   DB 도 그 암호를 갖고 있지 않다. 어디에도 적어 두지 않는다.

   ── 그래서 암호를 잃으면 그 백업은 영원히 못 연다 ──────────────────────────
   이건 약점이 아니라 이 기능의 값이다. 뒷문을 두면 그 뒷문이 곧 유출 경로가
   된다. 다만 사람이 그 사실을 모른 채 지나가면 안 되므로 화면이 크게 말한다.

   ── 파일 짜임 ──────────────────────────────────────────────────────────────
     "DHRBAK1"        7바이트. 이 파일이 무엇인지 표시한다
     머리 길이         2바이트 (big endian)
     머리 (json)       kdf 값 · salt · iv. 암호는 들어 있지 않다
     봉인             16바이트 (GCM tag)
     잠긴 본문         원래의 gzip 그대로

   머리를 감추지 않는 이유: salt 와 iv 는 비밀이 아니다. 오히려 이것이 없으면
   암호를 아는 사람도 열 수 없다.
--------------------------------------------------------------------------- */

const MAGIC = Buffer.from('DHRBAK1', 'ascii');
const N = 1 << 15;   // 32768. lib/auth.ts 의 PIN 과 같은 비용
const R = 8;
const P = 1;

/** 사람이 정하는 암호의 최소 길이. 숫자 PIN 과 달리 글자를 쓸 수 있다 */
export { PASSPHRASE_MIN } from './backup-lock-const';

export class LockError extends Error {}

async function keyFrom(pass: string, salt: Buffer): Promise<Buffer> {
  return scrypt(pass, salt, 32, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
}

/** 잠근다. 들어오는 것은 이미 gzip 이고, 나가는 것은 잠긴 통이다 */
/* ---------------------------------------------------------------------------
   암호가 너무 뻔하면 자물쇠가 뜻을 잃는다 (4차 감사 G5)

   길이 검사 하나뿐이었다. 그 파일에는 pin_hash 를 포함한 전 표가 들어 있고,
   가져간 사람은 시간 제한 없이 사전을 돌린다. scrypt 가 한 번 여는 값을
   비싸게 만들지만, 암호가 'password' 면 한 번이면 된다.

   판정하지 않는다 (§1). 이건 제조 판정이 아니라 자물쇠의 최소 조건이다.
   흔한 것과 한 가지 글자만 쓴 것을 거른다. 그 이상은 사람이 정한다.
--------------------------------------------------------------------------- */
const TOO_COMMON = new Set([
  'password', 'passw0rd', '12345678', '123456789', '1234567890',
  'qwertyui', 'asdfghjk', 'abcd1234', 'a1234567', 'dof12345',
  '00000000', '11111111', 'backup12', 'admin123', 'dhrbackup',
]);

function weakWhy(pass: string): string | null {
  if (pass.length < PASSPHRASE_MIN) return `${PASSPHRASE_MIN}자 이상이어야 합니다`;
  if (TOO_COMMON.has(pass.toLowerCase())) return '너무 흔한 암호입니다';
  if (new Set(pass).size < 4) return '서로 다른 글자가 네 가지 이상이어야 합니다';
  if (/^[0-9]+$/.test(pass) && pass.length < 12) {
    return '숫자만 쓰려면 12자 이상이어야 합니다';
  }
  return null;
}

export async function lock(plain: Buffer, pass: string): Promise<Buffer> {
  const why = weakWhy(pass);
  if (why) throw new LockError(`파일 암호가 약합니다 - ${why}`);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await keyFrom(pass, salt);

  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  const tag = c.getAuthTag();

  const head = Buffer.from(JSON.stringify({
    v: 1, kdf: 'scrypt', N, r: R, p: P,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
  }), 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(head.byteLength);

  return Buffer.concat([MAGIC, len, head, tag, body]);
}

/** 잠긴 파일인가. 암호를 물어야 하는지 먼저 알아야 한다 */
export function isLocked(buf: Buffer): boolean {
  return buf.byteLength > MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

/** 연다. 암호가 틀리거나 파일에 손을 댔으면 여기서 걸린다 */
export async function unlock(buf: Buffer, pass: string): Promise<Buffer> {
  if (!isLocked(buf)) throw new LockError('잠긴 백업 파일이 아닙니다');
  if (!pass) throw new LockError('파일 암호를 입력하십시오');

  let head;
  let at;
  try {
    const hl = buf.readUInt16BE(MAGIC.length);
    at = MAGIC.length + 2;
    head = JSON.parse(buf.subarray(at, at + hl).toString('utf8'));
    at += hl;
  } catch {
    throw new LockError('파일 머리를 읽지 못했습니다. 파일이 손상되었습니다.');
  }
  if (head.v !== 1 || head.kdf !== 'scrypt') {
    throw new LockError('이 판의 자물쇠를 열 수 없습니다.');
  }

  const key = await scrypt(pass, Buffer.from(head.salt, 'base64'), 32,
    { N: head.N, r: head.r, p: head.p, maxmem: 64 * 1024 * 1024 });
  const tag = buf.subarray(at, at + 16);
  const body = buf.subarray(at + 16);

  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(head.iv, 'base64'));
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(body), d.final()]);
  } catch {
    /*
     * GCM 은 암호가 틀린 것과 파일에 손댄 것을 갈라 말해 주지 않는다. 가려
     * 말하려 들면 가져간 사람에게 단서를 주는 셈이라, 갈라 말하지 않는 편이
     * 맞다. 사람에게는 둘 다 "이 파일을 못 연다" 로 같다.
     */
    throw new LockError('암호가 맞지 않거나 파일에 손을 댔습니다.');
  }
}
