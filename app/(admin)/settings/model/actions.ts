'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   형명 체계 (4차 감사 G1)

   0075 가 형명 규칙을 코드에서 빼 표로 옮겼다 (§2.0). 그런데 **그 표를 넣을
   화면이 저장소에 없었다.** 넣는 주체는 seed-demo 와 시험 fixture 둘뿐이라,
   빈 설치에서는 완제품 형명 생성이 아예 거부됐다. 0075 가 "첫 설정 차례표가
   그것을 짚는다" 고 적었는데 그 차례표 일곱 줄에 형명 체계가 없었다.

   §2.0 을 절반만 옮긴 상태였다. 나머지 절반을 여기서 옮긴다.

   ── 무엇을 정하는가 ────────────────────────────────────────────────────
   형명 한 줄이 종이의 규격 표기를 만든다. PD05050510 이 "5x5cm · 두께
   0.5~1.0mm" 가 되는 규칙이 이 표에 있다 (spec_label · 0075).

   그래서 이 표를 고치면 **과거 인쇄물의 해석까지 달라진다.** 감사 트리거를
   걸어 둔 이유가 그것이다 (0081). 여기서도 그 사실을 화면이 말한다.
--------------------------------------------------------------------------- */

async function admin() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN')) {
    throw new Error('시스템관리자만 형명 체계를 정할 수 있습니다');
  }
  return user;
}

const txt = (v: FormDataEntryValue | null) => String(v ?? '').trim();
const int = (v: FormDataEntryValue | null, label: string): number => {
  const raw = txt(v);
  if (raw === '') throw new Error(`${label}을(를) 입력하십시오`);
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${label}은(는) 정수로 적으십시오`);
  return n;
};

export async function saveScheme(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const name = txt(form.get('name'));
    const prefix = txt(form.get('prefix')).toUpperCase();
    const specPattern = txt(form.get('spec_pattern'));
    const namePattern = txt(form.get('name_pattern'));

    if (!name) return { error: '이름을 입력하십시오' };
    if (!prefix) return { error: '접두어를 입력하십시오 (예 PD)' };
    if (!/^[A-Z0-9]{1,8}$/.test(prefix)) {
      return { error: '접두어는 영문 대문자와 숫자 1~8자입니다' };
    }
    if (!specPattern.includes('{1}')) {
      return { error: '규격 문구에 {1} 같은 자리 표시가 있어야 합니다' };
    }

    const id = txt(form.get('id'));
    await withActor(me.id, (db) => (id
      ? db.rows(
          `update model_scheme
              set name = $2, prefix = $3, spec_pattern = $4, name_pattern = $5
            where id = $1`,
          [id, name, prefix, specPattern, namePattern || null])
      : db.rows(
          `insert into model_scheme (name, prefix, spec_pattern, name_pattern,
                                     is_active, registered_by)
           values ($1,$2,$3,$4,true,$5)`,
          [name, prefix, specPattern, namePattern || null, me.id])),
      { reason: id ? '형명 체계 수정' : '형명 체계 등록' });

    revalidatePath('/settings/model');
    revalidatePath('/settings/items');
    return { ok: true, message: id ? '형명 체계를 고쳤습니다.' : '형명 체계를 등록했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function saveSegment(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const schemeId = txt(form.get('scheme_id'));
    if (!schemeId) return { error: '어느 체계인지 골라 주십시오' };

    const seq = int(form.get('seq'), '자리 순번');
    const digits = int(form.get('digits'), '자릿수');
    const decimals = int(form.get('decimals'), '소수 자리');
    const divisor = txt(form.get('divisor')) || '1';
    const label = txt(form.get('label'));
    const role = txt(form.get('role')) || 'OTHER';

    if (digits < 1 || digits > 8) return { error: '자릿수는 1~8입니다' };
    if (!label) return { error: '이 자리가 무엇인지 적으십시오' };
    if (!/^[0-9]+(\.[0-9]+)?$/.test(divisor) || Number(divisor) === 0) {
      return { error: '나눌 값은 0 이 아닌 숫자입니다' };
    }

    await withActor(me.id, (db) => db.rows(
      `insert into model_segment (scheme_id, seq, digits, divisor, decimals, label, role)
       values ($1,$2,$3,$4::numeric,$5,$6,$7)
       on conflict (scheme_id, seq) do update
         set digits = excluded.digits, divisor = excluded.divisor,
             decimals = excluded.decimals, label = excluded.label, role = excluded.role`,
      [schemeId, seq, digits, divisor, decimals, label, role]),
      { reason: '형명 자리 정의' });

    revalidatePath('/settings/model');
    return { ok: true, message: `${seq}번 자리를 정했습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
