'use server';

import { redirect } from 'next/navigation';
import { withActor } from '@/lib/db';
import { verifyPin } from '@/lib/auth';
import { startSession } from '@/lib/session';

export interface LoginState { error?: string }

interface UserRow {
  id: string;
  pin_hash: string | null;
  is_active: boolean;
  can_login: boolean;
}

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const code = String(form.get('login_code') ?? '').trim();
  const pin = String(form.get('pin') ?? '');

  if (!code || !pin) return { error: '로그인 번호와 비밀번호를 입력하십시오' };

  let row: UserRow | undefined;
  try {
    row = await withActor(null, (db) =>
      db.one<UserRow>(
        `select id, pin_hash, is_active, can_login from app_user where login_code = $1`,
        [code],
      ),
    );
  } catch (e) {
    // 로그인 화면이 빈 500을 뱉으면 현장에서 손을 쓸 수 없다. 무엇이 막혔는지
    // 최소한은 보여 주고, 전체 내용은 서버 로그에 남긴다.
    console.error('[login] DB 조회 실패', e);
    const err = e as { code?: string; message?: string };
    return {
      error:
        `로그인을 처리할 수 없습니다 — 데이터베이스 오류 ` +
        `(${err.code ?? 'UNKNOWN'}: ${(err.message ?? '').slice(0, 120)}). ` +
        `관리자에게 문의하십시오.`,
    };
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
      error: `세션을 만들 수 없습니다 — ${(err.message ?? '').slice(0, 120)}`,
    };
  }

  redirect('/');            // redirect는 예외를 던진다. try 안에 넣지 말 것.
}
