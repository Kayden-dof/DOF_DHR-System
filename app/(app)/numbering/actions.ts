'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   채번 규칙 관리 (§4.10 "관리 화면에서 정의하고")

   여기서 번호를 조합하지 않는다. 미리보기조차 preview_number()를 경유한다
   화면이 따로 치환하면 등록한 패턴과 실제 발행 번호가 어긋날 수 있고, 규칙은
   등록 후 수정이 불가능하므로 되돌릴 방법이 없다.
--------------------------------------------------------------------------- */

export interface Preview {
  first?: string;
  second?: string;
  error?: string;
}

/** 형식 미리보기. 순번 1회차와 2회차를 함께 돌려준다. 둘이 같으면 패턴에
 *  순번 토큰이 없다는 뜻이고, 그 규칙은 같은 번호만 계속 뱉는다. */
export async function previewPattern(pattern: string, seqWidth: number): Promise<Preview> {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN')) return { error: '권한이 없습니다' };
  if (!pattern.trim()) return {};

  try {
    return await withActor(user.id, async (db) => {
      const row = await db.one<{ first: string; second: string }>(
        `select preview_number($1, $2, 1) as first,
                preview_number($1, $2, 2) as second`,
        [pattern, seqWidth],
      );
      return { first: row?.first, second: row?.second };
    });
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function saveRule(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN')) return { error: '시스템관리자만 채번 규칙을 등록할 수 있습니다' };

  const target = String(form.get('target') ?? '');
  const pattern = String(form.get('pattern') ?? '').trim();
  const reset = String(form.get('reset') ?? 'YEARLY');
  const seqWidth = Number(form.get('seq_width') ?? 4);
  const effectiveFrom = String(form.get('effective_from') ?? '');
  const replacing = String(form.get('replacing') ?? '').trim();

  try {
    const issued = await withActor(user.id, async (db) => {
      // 교체는 한 트랜잭션에서 끝낸다. 내리고 등록하는 사이에 활성 규칙이 없는
      // 순간이 생기면 그 틈에 들어온 채번이 예외로 죽는다.
      if (replacing) {
        await db.rows(`update numbering_rule set is_active = false where id = $1`, [replacing]);
      }
      return db.one<{ id: string; pattern: string }>(
        `insert into numbering_rule
           (target, item_id, pattern, reset, seq_width, effective_from, registered_by)
         values ($1::numbering_target, null, $2, $3::reset_cycle, $4, $5::date, $6)
         returning id, pattern`,
        [target, pattern, reset, seqWidth, effectiveFrom, user.id],
      );
    });

    revalidatePath('/numbering');
    revalidatePath('/');
    return {
      ok: true,
      message: replacing
        ? `규칙을 교체했습니다. 새 패턴 ${issued?.pattern} - 순번은 이어집니다.`
        : `규칙을 등록했습니다. 패턴 ${issued?.pattern}`,
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function retireRule(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN')) return { error: '시스템관리자만 채번 규칙을 내릴 수 있습니다' };

  const id = String(form.get('id') ?? '');
  try {
    await withActor(user.id, (db) =>
      db.rows(`update numbering_rule set is_active = false where id = $1`, [id]),
    );
    revalidatePath('/numbering');
    revalidatePath('/');
    return {
      ok: true,
      message:
        '규칙을 내렸습니다. 이 대상은 새 규칙을 등록하기 전까지 채번할 수 없습니다.',
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
