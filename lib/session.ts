import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { withActor } from './db';
import type { RoleCode } from './roles';
import { isViewerOnly, isReadOnly } from './roles';

/* ---------------------------------------------------------------------------
   세션

   §4.1 "세션은 8시간 정도로 길게 유지한다."
   서명 쿠키 하나로 끝낸다. 세션 표를 만들면 사양에 없는 표가 늘어난다.

   매 요청마다 DB에서 계정을 다시 읽는다. is_active를 내리거나 can_login을
   끈 계정이 남은 쿠키로 계속 들어오면 안 된다.
--------------------------------------------------------------------------- */

const COOKIE = 'dhr_session';
const MAX_AGE_SEC = 8 * 60 * 60;

export type { RoleCode } from './roles';
export { ROLE_LABEL } from './roles';

export interface SessionUser {
  id: string;
  login_code: string;
  full_name: string;
  is_developer: boolean;
  /** 만든 사람이 비밀번호를 아는 상태. 본인이 바꾸기 전에는 다른 화면으로 가지 않는다 */
  must_change_pin: boolean;
  roles: RoleCode[];
}

function secret(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET이 없거나 너무 짧습니다 (32자 이상)');
  }
  return Buffer.from(s, 'utf8');
}

const b64 = (b: Buffer) => b.toString('base64url');

function sign(payload: string): string {
  return b64(createHmac('sha256', secret()).update(payload).digest());
}

/*
 * i(발급 시각)를 함께 봉한다. 비밀번호가 바뀐 시각보다 먼저 발급된 세션을
 * 거부하기 위해서다 (0068). 세션 표를 만들지 않고 같은 일을 한다.
 *
 * 옛 쿠키에는 i 가 없다. 그때는 e 에서 유효 시간을 빼 발급 시각으로 삼는다 -
 * 이 변경으로 지금 일하는 사람이 튕겨 나가면 안 된다.
 */
function seal(userId: string): string {
  const now = Date.now();
  const payload = b64(
    Buffer.from(JSON.stringify({ v: 1, u: userId, i: now, e: now + MAX_AGE_SEC * 1000 })),
  );
  return `${payload}.${sign(payload)}`;
}

interface Claim { userId: string; issuedAt: number }

function unseal(token: string | undefined): Claim | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      v: number; u: string; e: number; i?: number;
    };
    if (data.v !== 1 || typeof data.u !== 'string') return null;
    if (!Number.isFinite(data.e) || data.e < Date.now()) return null;
    const issuedAt = Number.isFinite(data.i) ? (data.i as number)
      : data.e - MAX_AGE_SEC * 1000;
    return { userId: data.u, issuedAt };
  } catch {
    return null;
  }
}

export async function startSession(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, seal(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SEC,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** 로그인 상태면 계정을, 아니면 null. 매 요청 DB를 다시 읽는다. */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const claim = unseal(jar.get(COOKIE)?.value);
  if (!claim) return null;

  return withActor(null, async (db) => {
    const row = await db.one<{
      id: string; login_code: string; full_name: string;
      is_developer: boolean; must_change_pin: boolean; roles: RoleCode[] | null;
      pin_changed_at: Date | null;
    }>(
      `select u.id, u.login_code, u.full_name, u.is_developer, u.must_change_pin,
              u.pin_changed_at,
              array_remove(array_agg(r.role::text order by r.role), null)::text[] as roles
         from app_user u
         left join user_role r on r.user_id = u.id
        where u.id = $1 and u.is_active and u.can_login
        group by u.id`,
      [claim.userId],
    );
    if (!row) return null;

    /*
     * 비밀번호가 바뀐 뒤에 발급된 세션만 살린다 (0068).
     *
     * 어깨너머로 여섯 자리를 본 사람이 있을 때, "비밀번호를 바꾸세요" 가 실제로
     * 그 사람을 끊어야 한다. 전에는 그가 쥔 세션이 여덟 시간 더 살아 있었다.
     *
     * pin_changed_at 이 null 이면 언제 바꿨는지 모르는 것이므로 거부하지 않는다.
     * 이 열이 생기기 전부터 있던 계정이다.
     */
    if (row.pin_changed_at && claim.issuedAt < row.pin_changed_at.getTime()) return null;

    return { ...row, roles: row.roles ?? [] };
  });
}

/* ---------------------------------------------------------------------------
   로그인 확인

   ── 비밀번호 검사를 왜 여기서 하는가 ──────────────────────────────────────
   처음에는 사무 화면과 현장 화면의 layout 두 곳에 두었다. 그런데 인쇄 화면은
   그 둘 중 어느 쪽에도 속하지 않아서 검사가 빠졌고, 남이 정해 준 비밀번호로
   들어온 사람이 정본 종이를 뽑을 수 있었다 (2차 검수 결함 4).

   흩어 두면 새 화면을 만들 때마다 빠뜨린다. 로그인을 확인하는 자리가 하나뿐
   이므로 여기에 둔다. 앞으로 어떤 화면을 만들어도 지나칠 수 없다.

   /password 자신은 이 검사를 건너뛰어야 한다. 그 화면에서 바꾸는 것이므로
   여기서 막으면 아무도 바꿀 수 없다. 그쪽은 currentUser() 를 직접 쓴다.
--------------------------------------------------------------------------- */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.must_change_pin) redirect('/password');
  return user;
}

/** 비밀번호 화면 전용. 바꾸기 전이어도 들어와야 하므로 그 검사를 하지 않는다. */
export async function requireUserForPasswordChange(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

export function hasRole(user: SessionUser, ...roles: RoleCode[]): boolean {
  return roles.some((r) => user.roles.includes(r));
}

/* ---------------------------------------------------------------------------
   열람자 차단

   열람자에게 열어 둔 화면은 셋뿐이다 (경영 현황 · 생산 · 감사추적). 나머지는
   운영하는 사람의 화면이라 주소를 직접 쳐도 들어가지 못하게 한다.

   화면마다 hasRole 을 늘어놓는 대신 이 한 줄을 쓴다. 새 화면을 만들 때
   빠뜨리기 쉬운 쪽은 "막는 것"이므로, 막는 쪽을 짧게 만들어 둔다.

   세션이 DB 에서도 읽기 전용이라 (app_readonly · 0043) 여기를 지나쳐도 쓰기는
   일어나지 않는다. 이건 화면을 깔끔히 하려는 것이지 마지막 방어선이 아니다.
--------------------------------------------------------------------------- */
/* ---------------------------------------------------------------------------
   본인인지 다시 묻는다 (사용자 요청 2026-09-01)

   로그인은 "이 자리에 앉을 자격" 을 확인한다. 그런데 세션이 여덟 시간이라,
   되돌릴 수 없는 조작 앞에서는 그것만으로 모자란다 - 자리를 비운 사이에
   누가 눌렀는지 로그인은 답하지 못한다.

   백업 내려받기와 복구가 그런 조작이다. 앞의 것은 이 회사의 기록 전부를 한
   파일로 내보내고, 뒤의 것은 지금 있는 기록을 통째로 갈아 끼운다.

   ── 무한정 찔러 볼 수 있으면 뜻이 없다 ────────────────────────────────────
   로그인 화면이 쓰는 잠금을 그대로 쓴다 (0022). 15분 안에 다섯 번 틀리면
   10분 잠긴다. 여기만 따로 세면 그 문이 곧 자릿수를 알아내는 창구가 된다.
--------------------------------------------------------------------------- */
export interface Reauth { ok: boolean; error?: string }

export async function reauth(user: SessionUser, pin: string): Promise<Reauth> {
  if (!pin) return { ok: false, error: '본인 비밀번호를 입력하십시오' };

  const { withActor } = await import('./db');
  const { verifyPin } = await import('./auth');

  const locked = await withActor(user.id, (db) =>
    db.val<number>('select login_lock_seconds($1)', [user.login_code]));
  if ((locked ?? 0) > 0) {
    return { ok: false, error: `여러 번 틀렸습니다. ${Math.ceil((locked ?? 0) / 60)}분 뒤에 다시 하십시오` };
  }

  const hash = await withActor(user.id, (db) =>
    db.val<string>('select pin_hash from app_user where id = $1', [user.id]));

  if (!await verifyPin(pin, hash ?? null)) {
    await withActor(user.id, (db) => db.rows('select login_fail($1)', [user.login_code]));
    return { ok: false, error: '본인 비밀번호가 맞지 않습니다' };
  }
  await withActor(user.id, (db) => db.rows('select login_ok($1)', [user.login_code]));
  return { ok: true };
}

export function blocksViewer(user: SessionUser): boolean {
  return isViewerOnly(user.roles);
}

/* ---------------------------------------------------------------------------
   쓰기 화면을 막는다

   열람자와 품질책임자 둘 다 아무것도 쓰지 않는다. 자재 입고 · 출하 · 일탈
   등록처럼 조작이 있는 화면은 둘 다 막는다.

   기준정보 조회 화면(제품표준서 · 품목 · 공급자)은 blocksViewer 를 그대로 쓴다.
   품질책임자는 들어가고 열람자는 막힌다 - 대표가 볼 것은 숫자이지 기준이
   아니다 (사용자 지시).

   막는 것은 화면의 예의이고, 실제 차단은 DB 다. 읽기 전용 세션은 app_readonly
   로 돌아 쓰기 함수의 실행 권한이 없다 (0053).
--------------------------------------------------------------------------- */
export function blocksReadOnly(user: SessionUser): boolean {
  return isReadOnly(user.roles);
}

/* ---------------------------------------------------------------------------
   이 세션이 쓸 수 있는가

   막느냐 마느냐가 아니라, 화면에 쓰기 단추를 그릴 것이냐를 묻는다.

   열람자와 품질책임자가 같이 보는 화면이 늘면서(설비 · 공급자 · 사용자 ·
   채번 규칙) 화면마다 다른 잣대를 쓰고 있었다. isViewerOnly 로 가린 곳은
   품질책임자에게 단추가 그대로 보였고, 눌러도 DB 에서 막혀 아무 일도
   일어나지 않았다. 죽은 단추는 없느니만 못하다.

   잣대를 하나로 둔다 - 쓰지 못하는 세션이면 그리지 않는다.
--------------------------------------------------------------------------- */
export function canWrite(user: SessionUser): boolean {
  return !isReadOnly(user.roles);
}
