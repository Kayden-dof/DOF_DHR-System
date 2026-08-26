import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { withActor } from './db';
import type { RoleCode } from './roles';

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

function seal(userId: string): string {
  const payload = b64(
    Buffer.from(JSON.stringify({ v: 1, u: userId, e: Date.now() + MAX_AGE_SEC * 1000 })),
  );
  return `${payload}.${sign(payload)}`;
}

function unseal(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      v: number; u: string; e: number;
    };
    if (data.v !== 1 || typeof data.u !== 'string') return null;
    if (!Number.isFinite(data.e) || data.e < Date.now()) return null;
    return data.u;
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
  const userId = unseal(jar.get(COOKIE)?.value);
  if (!userId) return null;

  return withActor(null, async (db) => {
    const row = await db.one<{
      id: string; login_code: string; full_name: string;
      is_developer: boolean; roles: RoleCode[] | null;
    }>(
      `select u.id, u.login_code, u.full_name, u.is_developer,
              array_remove(array_agg(r.role::text order by r.role), null)::text[] as roles
         from app_user u
         left join user_role r on r.user_id = u.id
        where u.id = $1 and u.is_active and u.can_login
        group by u.id`,
      [userId],
    );
    if (!row) return null;
    return { ...row, roles: row.roles ?? [] };
  });
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

export function hasRole(user: SessionUser, ...roles: RoleCode[]): boolean {
  return roles.some((r) => user.roles.includes(r));
}
