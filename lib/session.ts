import { createHmac, timingSafeEqual } from 'node:crypto';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { withActor } from './db';
import type { RoleCode } from './roles';
import { isAdmin, isViewerOnly, isReadOnly, homePath, seatOf } from './roles';
import { screenAccess } from './access';
import { SESSION_COOKIE as COOKIE, PATH_HEADER } from './auth-const';
import { canOpen } from './access';

/* ---------------------------------------------------------------------------
   세션

   §4.1 "세션은 8시간 정도로 길게 유지한다."
   서명 쿠키 하나로 끝낸다. 세션 표를 만들면 사양에 없는 표가 늘어난다.

   매 요청마다 DB에서 계정을 다시 읽는다. is_active를 내리거나 can_login을
   끈 계정이 남은 쿠키로 계속 들어오면 안 된다.
--------------------------------------------------------------------------- */

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
  /** 가진 역할 전부. 저장하는 동작의 권한은 이것으로 본다 */
  roles: RoleCode[];
  /**
   * 화면을 가리는 역할 (lib/roles.ts seatOf · 사용자 요청 2026-11-20).
   *
   * 역할이 둘 이상인 계정이 로그인할 때 고른 역할 하나다. 그 밖에는 roles 와
   * 같다. 첫 화면 · 차림표 · 화면 문이 이것을 쓰고, 저장 권한은 roles 를 쓴다.
   */
  seat: RoleCode[];
  /** 역할을 아직 고르지 않았다. requireUser 가 고르는 창(/login)으로 보낸다 */
  pick: boolean;
  /**
   * 관리자가 이 사람에게 따로 정한 화면 (user_screen · 0116).
   *
   * 손댄 칸만 들어 있다. 없는 칸은 역할 기본값을 따르므로, 여기가 비어 있는
   * 것이 정상이고 그때는 지금까지와 똑같이 움직인다.
   */
  screens: ReadonlyMap<string, boolean>;
  /**
   * 이 세션을 발급한 시각(ms). 자리 비움 잠금이 "이 세션에서 잠갔는가" 를 가리는
   * 데 쓴다 - 다시 로그인하면 값이 바뀌므로 앞 세션의 잠금 표시가 따라오지 않는다.
   */
  issued_at: number;
  /**
   * 본인이 자동 잠금을 껐고 지금 관리 역할이 있다 (0153 · idle_lock_off()).
   * 화면은 이것을 바로 쓰지 말고 idleLockOff(user) 로 묻는다 - 앉은 역할까지 본다.
   */
  idle_lock_off: boolean;
  /** 본인이 고른 잠금 시간(분). 비어 있으면 기본값 (0157 · lib/idle-lock.ts lockMinutes) */
  idle_lock_desk_min: number | null;
  idle_lock_pad_min: number | null;
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
/*
 * r(고른 역할)도 함께 봉한다 (사용자 요청 2026-11-20). 서명 안에 두므로 손으로
 * 고칠 수 없고, 고쳐 봐야 가진 역할 밖으로는 넓어지지 않는다 (seatOf).
 * 역할을 고르지 않는 세션에는 r 를 싣지 않는다 - 옛 쿠키와 같은 모양이다.
 */
interface Seal { userId: string; issuedAt: number; expiresAt: number; role?: string }

function seal({ userId, issuedAt, expiresAt, role }: Seal): string {
  const body: Record<string, unknown> = { v: 1, u: userId, i: issuedAt, e: expiresAt };
  if (role !== undefined) body.r = role;
  const payload = b64(Buffer.from(JSON.stringify(body)));
  return `${payload}.${sign(payload)}`;
}

interface Claim { userId: string; issuedAt: number; expiresAt: number; role?: string }

function unseal(token: string | undefined): Claim | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      v: number; u: string; e: number; i?: number; r?: unknown;
    };
    if (data.v !== 1 || typeof data.u !== 'string') return null;
    if (!Number.isFinite(data.e) || data.e < Date.now()) return null;
    const issuedAt = Number.isFinite(data.i) ? (data.i as number)
      : data.e - MAX_AGE_SEC * 1000;
    return {
      userId: data.u, issuedAt, expiresAt: data.e,
      role: typeof data.r === 'string' ? data.r : undefined,
    };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
   쿠키만 보고 누구인지 짚는다 (0109 · 망 경계)

   문 앞에서 막힌 요청이 세션 쿠키를 들고 있으면 그것은 **우리가 서명한** 쿠키
   이므로 그 사람이다. 제조소 패드를 들고 밖으로 나간 경우가 여기 잡히고,
   그게 실제로 위험한 쪽이다.

   DB 를 읽지 않는다. 막힌 요청마다 계정을 조회하면 바깥에서 두드리는 만큼
   질의가 일어난다. 여기서 필요한 것은 "누구의 쿠키였는가" 하나뿐이고,
   이름은 화면이 그릴 때 붙인다.

   **검사를 따로 만들지 않는다** - 서명과 만료를 보는 자리는 unseal 하나다.
   두 벌로 두면 갈라지고, 갈라지면 한쪽이 먼저 낡는다 (§10).
--------------------------------------------------------------------------- */
export function peekSessionUser(token: string | undefined): string | null {
  try {
    return unseal(token)?.userId ?? null;
  } catch {
    /* 서명 열쇠가 없는 자리에서도 문은 서야 한다 */
    return null;
  }
}

/**
 * role: 역할이 둘 이상인 계정이면 빈 글자를 넘긴다 - "아직 고르지 않음" 이다.
 * 하나뿐이면 넘기지 않는다. 그 세션은 이 기능 전과 똑같다.
 */
export async function startSession(userId: string, role?: ''): Promise<void> {
  const now = Date.now();
  await putCookie(seal({ userId, issuedAt: now, expiresAt: now + MAX_AGE_SEC * 1000, role }),
                  MAX_AGE_SEC);
}

/**
 * 이 세션의 역할을 고른다 (로그인 직후 · 이름 옆 «역할 바꾸기»).
 *
 * 새 세션을 열지 않는다. 발급 시각과 만료를 그대로 두고 r 만 바꿔 다시 봉한다 -
 * 역할을 바꾼다고 여덟 시간이 다시 시작되면 안 되고, 자리 비움 잠금도 같은
 * 세션으로 알아야 한다 (issued_at).
 *
 * 가진 역할인지는 부르는 쪽이 방금 DB 에서 읽은 계정으로 확인한다.
 */
export async function chooseSeat(user: SessionUser, role: RoleCode): Promise<boolean> {
  if (!user.roles.includes(role)) return false;
  const jar = await cookies();
  const claim = unseal(jar.get(COOKIE)?.value);
  if (!claim || claim.userId !== user.id) return false;
  const left = Math.floor((claim.expiresAt - Date.now()) / 1000);
  if (left <= 0) return false;
  await putCookie(seal({ ...claim, role }), left);
  return true;
}

async function putCookie(value: string, maxAge: number): Promise<void> {
  const jar = await cookies();
  /*
   * sameSite 를 'strict' 로 둔다 (망 경계 2026-09-11).
   *
   * 'lax' 는 바깥 화면에서 이 주소로 넘어오는 이동에 쿠키를 함께 보낸다.
   * 남이 만든 화면이 우리 주소로 사람을 보내고 그 사람의 세션으로 무언가를
   * 하게 만드는 길이 거기서 열린다.
   *
   * 이 프로그램은 밖에서 들어오는 고리가 없다. 즐겨찾기와 홈 화면에서 여는
   * 것은 브라우저가 시작한 이동이라 'strict' 에서도 쿠키가 간다.
   */
  jar.set(COOKIE, value, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** 로그인 상태면 계정을, 아니면 null. 매 요청 DB를 다시 읽는다. */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  return readUser(token);
}

/*
 * 한 요청에 한 번만 읽는다 (최적화 2026-11-25).
 *
 * 레이아웃 · 화면 · 제목(generateMetadata) · 인쇄 문지기가 저마다 requireUser 를
 * 부르므로 같은 계정을 한 요청에 두세 번 읽고 있었다. 요청이 끝나면 버리므로
 * "매 요청 DB 를 다시 읽는다" 는 그대로다 - 역할을 거두면 다음 요청부터 막힌다.
 *
 * 쿠키 값을 열쇠로 둔다. 같은 요청 안에서 역할을 고르거나(chooseSeat) 로그아웃해
 * 쿠키가 바뀌면 열쇠가 달라 새로 읽는다.
 */
const readUser = cache(async (token: string): Promise<SessionUser | null> => {
  const claim = unseal(token);
  if (!claim) return null;

  return withActor(null, async (db) => {
    const row = await db.one<{
      id: string; login_code: string; full_name: string;
      is_developer: boolean; must_change_pin: boolean; roles: RoleCode[] | null;
      pin_changed_at: Date | null; screens: Record<string, boolean> | null;
      idle_lock_off: boolean;
      idle_lock_desk_min: number | null; idle_lock_pad_min: number | null;
    }>(
      `select u.id, u.login_code, u.full_name, u.is_developer, u.must_change_pin,
              u.pin_changed_at,
              /* 값과 역할을 함께 본다. 관리 역할을 거두면 다음 요청부터 다시 잠긴다 (0153) */
              idle_lock_off(u.id) as idle_lock_off,
              u.idle_lock_desk_min, u.idle_lock_pad_min,
              array_remove(array_agg(distinct r.role::text), null)::text[] as roles,
              /*
               * 계정별 화면 배정 (0116). is_open 이 null 인 칸은 역할 기본값으로
               * 되돌린 것이므로 여기 싣지 않는다 - 행은 남지만 판정은 기본값이다.
               */
              coalesce(jsonb_object_agg(s.path, s.is_open)
                         filter (where s.path is not null and s.is_open is not null),
                       '{}'::jsonb) as screens
         from app_user u
         left join user_role r on r.user_id = u.id
         left join user_screen s on s.user_id = u.id
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

    const roles = row.roles ?? [];
    return {
      ...row,
      issued_at: claim.issuedAt,
      roles,
      ...seatOf(roles, claim.role),
      screens: new Map(Object.entries(row.screens ?? {})),
    };
  });
});

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

  /*
   * 역할이 둘 이상인데 아직 고르지 않았다 (사용자 요청 2026-11-20). 고르는 창은
   * 로그인 화면 위에 뜬다. 주소를 바로 쳐서 그 창을 건너뛸 수 없게 여기서 보낸다.
   */
  if (user.pick) redirect('/login');

  /* -------------------------------------------------------------------------
     관리자가 닫아 둔 화면인가 (0116)

     차림표가 이미 못 여는 자리를 감춘다. 그런데 **보이지 않는 것과 못 여는
     것은 다른 일이다** - 주소를 알거나 즐겨찾기를 눌러 들어오면 감춘 것만으로는
     아무것도 막지 못한다. 그래서 같은 판정이 여기서 한 번 더 선다.

     비밀번호 검사와 같은 자리에 두는 까닭도 같다. 로그인을 확인하는 곳이
     하나뿐이므로, 앞으로 어떤 화면을 만들어도 이 문을 지나친다.

     경로는 미들웨어가 실어 준다 (proxy.ts). 그것이 없으면 - 미들웨어가 돌지
     않는 자리라면 - 막지 않는다. 문을 못 여는 것보다 열어 두는 쪽이 낫다:
     여기서 막는 것은 **보이는 범위**일 뿐이고, 할 수 있는 일은 저마다 제 문이
     따로 지킨다 (각 actions.ts 의 역할 확인 · app_readonly · S01~S05).

     ── 관리자가 **닫은** 칸만 본다 ──────────────────────────────────────
     역할 기본값으로 닫힌 화면은 여기서 건드리지 않는다. 그 자리는 화면마다
     제 방식이 있고 (권한 없음 안내를 그리거나 다른 화면으로 넘기거나), 권한
     매트릭스가 그 둘을 다른 것으로 적어 둔다 - 여기서 한꺼번에 넘겨 버리면
     "막힘" 이 전부 "내보냄" 이 되어 표가 거짓말이 된다 (npm run access 가
     그 자리에서 걸렸다).

     그래서 묻는 것은 하나다 - **관리자가 이 사람에게 이 칸을 닫았는가.**
  ------------------------------------------------------------------------- */
  const path = (await headers()).get(PATH_HEADER);
  if (path && user.screens.get(path) === false) redirect('/no-access');

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
   자동 잠금을 걸지 않는가 (0153 · 사용자 2026-11-20)

   DB 가 값과 관리 역할을 함께 본 결과(idle_lock_off)에, 이번에 앉은 역할을 한 번
   더 건다. 관리자 겸 작업자가 작업자로 앉았으면 그 세션은 현장 패드의 것이라
   늘 잠근다 - 여러 사람이 번갈아 쓰는 자리다.
--------------------------------------------------------------------------- */
export function idleLockOff(user: SessionUser): boolean {
  return user.idle_lock_off && isAdmin(user.seat);
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

/* ---------------------------------------------------------------------------
   화면 문지기 (0116)

   화면마다 제각기 들고 있던 역할 판정을 한 자리로 모은다. 전에는
   blocksReadOnly · blocksViewer · hasRole(...) 이 스무 곳에 흩어져 있어서,
   관리자가 계정별로 배정해도 화면이 제 역할 판정으로 다시 막았다.

   ── 막는 방식까지 여기서 고른다 ──────────────────────────────────────────
   못 여는 자리가 전부 같지 않다. 권한이 없는 사람에게는 그 자리에서 그렇다고
   말하고(Denied), 애초에 다른 화면에서 일하는 사람은 제 화면으로 보낸다 -
   작업자를 관리 화면에 세워 두고 안내문을 읽게 하는 것은 그 사람의 일이 아니다.

   그래서 내보낼 때는 여기서 곧바로 보내고, 막을 때만 true 를 돌려준다.
   부르는 자리는 `if (blocksScreen(user, '/…')) return <Denied … />` 한 줄이다.

   ── 이것이 정하는 것은 보이는 범위뿐이다 ─────────────────────────────────
   저장하는 동작은 저마다 제 문을 갖고 있고(각 actions.ts), 읽기 전용 세션은
   app_readonly 로 돌아 DB 가 쓰기를 거부하며, S01~S05 와 §2.1 불변식은 권한과
   무관하게 선다. 관리자가 화면을 열어 준다고 할 수 있는 일이 늘지 않는다.

   판정은 고른 역할(seat)로 한다 - 차림표(canOpen)와 같은 값이어야 차림표에
   없는 화면이 주소로는 열리는 일이 없다 (§4.12).
--------------------------------------------------------------------------- */
export function blocksScreen(user: SessionUser, path: string): boolean {
  const a = screenAccess(path, user.seat, user.screens);
  if (a === 'away') redirect(homePath(user.seat));
  return a !== 'open';
}
