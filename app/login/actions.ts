'use server';

import { redirect } from 'next/navigation';
import { withActor } from '@/lib/db';
import { verifyPin } from '@/lib/auth';
import { startSession } from '@/lib/session';
import { withActor as _w } from '@/lib/db';
import { homePath, type RoleCode } from '@/lib/roles';

export interface LoginState { error?: string }

interface UserRow {
  id: string;
  pin_hash: string | null;
  is_active: boolean;
  can_login: boolean;
  roles: RoleCode[] | null;
}

/* 로그인 화면은 공개 URL이다. 원본 오류 문구를 그대로 올리면 접속 계정명이나
   내부 구성이 드러난다. 코드만 남기고 사람이 조치할 수 있는 문장으로 바꾼다.
   전체 내용은 console.error 로 서버 로그에만 남는다. */
const DB_FAILURE: Record<string, string> = {
  '28P01': '데이터베이스 비밀번호가 올바르지 않습니다',
  '28000': '데이터베이스 접속이 거부되었습니다',
  '42501': '데이터베이스 권한이 부족합니다',
  '3D000': '데이터베이스를 찾을 수 없습니다',
  '53300': '데이터베이스 연결 수가 한도를 넘었습니다',
  ECONNREFUSED: '데이터베이스에 연결할 수 없습니다',
  ETIMEDOUT: '데이터베이스 응답이 없습니다',
  ENOTFOUND: '데이터베이스 주소를 찾을 수 없습니다',
  SELF_SIGNED_CERT_IN_CHAIN: '데이터베이스 인증서를 검증할 수 없습니다',
};

function dbFailureMessage(e: unknown): string {
  const code = (e as { code?: string }).code ?? 'UNKNOWN';
  const why = DB_FAILURE[code] ?? '데이터베이스 오류가 발생했습니다';
  return `로그인을 처리할 수 없습니다 - ${why} (${code}). 관리자에게 문의하십시오.`;
}

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const code = String(form.get('login_code') ?? '').trim();
  const pin = String(form.get('pin') ?? '');

  if (!code || !pin) return { error: '로그인 번호와 비밀번호를 입력하십시오' };

  let row: UserRow | undefined;
  try {
    row = await withActor(null, (db) =>
      db.one<UserRow>(
        `select u.id, u.pin_hash, u.is_active, u.can_login,
                array_remove(array_agg(r.role::text order by r.role), null)::text[] as roles
           from app_user u
           left join user_role r on r.user_id = u.id
          where u.login_code = $1
          group by u.id`,
        [code],
      ),
    );
  } catch (e) {
    // 로그인 화면이 빈 500을 뱉으면 현장에서 손을 쓸 수 없다. 무엇이 막혔는지
    // 최소한은 보여 주고, 전체 내용은 서버 로그에 남긴다.
    console.error('[login] DB 조회 실패', e);
    return { error: dbFailureMessage(e) };
  }

  // 없는 계정 · 비활성 · 로그인 불가(QP) · 비밀번호 불일치를 구분해서 알리지
  // 않는다. 어느 번호가 존재하는지 알려주지 않기 위함이다.
  const ok = !!row && row.is_active && row.can_login && (await verifyPin(pin, row.pin_hash));
  if (!ok || !row) return { error: '로그인 번호 또는 비밀번호가 올바르지 않습니다' };

  try {
    await startSession(row.id);
  } catch (e) {
    console.error('[login] 세션 생성 실패', e);
    const err = e as { message?: string };
    return {
      error: `세션을 만들 수 없습니다 - ${(err.message ?? '').slice(0, 120)}`,
    };
  }

  // 관리자면 관리 화면, 작업자면 현장 화면으로 간다.
  // redirect는 예외를 던진다. try 안에 넣지 말 것.
  redirect(homePath(row.roles ?? []));
}
