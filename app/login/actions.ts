'use server';

import { redirect } from 'next/navigation';
import { withActor } from '@/lib/db';
import { verifyPin } from '@/lib/auth';
import { startSession } from '@/lib/session';

export interface LoginState { error?: string }

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const code = String(form.get('login_code') ?? '').trim();
  const pin = String(form.get('pin') ?? '');

  if (!code || !pin) return { error: '로그인 번호와 비밀번호를 입력하십시오' };

  const row = await withActor(null, (db) =>
    db.one<{ id: string; pin_hash: string | null; is_active: boolean; can_login: boolean }>(
      `select id, pin_hash, is_active, can_login from app_user where login_code = $1`,
      [code],
    ),
  );

  // 없는 계정 · 비활성 · 로그인 불가(QP) · 비밀번호 불일치를 구분해서 알리지
  // 않는다. 어느 번호가 존재하는지 알려주지 않기 위함이다.
  const ok =
    !!row && row.is_active && row.can_login && (await verifyPin(pin, row.pin_hash));

  if (!ok) return { error: '로그인 번호 또는 비밀번호가 올바르지 않습니다' };

  await startSession(row.id);
  redirect('/');            // redirect는 예외를 던진다. try 안에 넣지 말 것.
}
