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
export async function previewPattern(
  pattern: string, seqWidth: number, itemCode?: string | null,
): Promise<Preview> {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) return { error: '권한이 없습니다' };
  if (!pattern.trim()) return {};

  try {
    return await withActor(user.id, async (db) => {
      const row = await db.one<{ first: string; second: string }>(
        `select preview_number($1, $2, 1, $3) as first,
                preview_number($1, $2, 2, $3) as second`,
        [pattern, seqWidth, itemCode || null],
      );
      return { first: row?.first, second: row?.second };
    });
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function saveRule(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    return { error: '생산관리자 또는 시스템관리자만 채번 규칙을 등록할 수 있습니다' };
  }

  const target = String(form.get('target') ?? '');
  const pattern = String(form.get('pattern') ?? '').trim();
  const reset = String(form.get('reset') ?? 'YEARLY');
  const seqWidth = Number(form.get('seq_width') ?? 4);
  const effectiveFrom = String(form.get('effective_from') ?? '');
  // 빈 문자열은 "공통 규칙"이다. 품목을 고르지 않은 것과 고를 수 없는 것을
  // 같게 다룬다 - null 이 곧 공통이라는 뜻이다 (§4.10)
  const itemId = String(form.get('item_id') ?? '').trim() || null;
  /*
   * 품목 종류별 규칙 (0097). 자재 로트 접두어가 원자재 R · 포장재 P · 시약 M
   * 으로 갈리는데, 품목마다 규칙을 만들면 규칙이 품목 수만큼 생긴다.
   * 품목과 종류는 함께 지정할 수 없다 (numbering_rule_scope).
   */
  const itemType = String(form.get('item_type') ?? '').trim() || null;

  try {
    const done = await withActor(user.id, async (db) => {
      /*
       * 무엇을 교체하는지는 서버가 범위로 정한다. 같은 (대상, 품목, 종류)의 활성
       * 규칙만 내린다 - 그 범위에 활성 규칙이 있으면 교체이고, 없으면 그냥 등록이다.
       *
       * 전에는 화면이 내릴 규칙의 식별자(replacing)를 실어 보냈고 서버는 범위를
       * 묻지 않고 그것을 내렸다. 카드가 보여 주던 것은 품목이 비어 있는 첫 활성
       * 규칙이라 공통 규칙이거나 원자재 · 포장재 규칙이었고, 원액 유형 규칙을 넣는
       * 순간 그 규칙이 함께 내려갔다. 내린 규칙은 되살릴 수 없고(DB 가 막는다),
       * 그 종류의 로트는 번호 접두어가 바뀌거나 규칙이 없어진다. 화면이 보낸 값을
       * 믿지 않는다 - 그런 칸은 이제 읽지도 않는다.
       *
       * `is not distinct from` 인 까닭은 공통 규칙이 품목 · 종류가 둘 다 null 이기
       * 때문이다. 같은 범위의 활성 규칙은 유일 색인이 하나로 묶는다.
       *
       * 내리고 등록하는 것은 한 트랜잭션이다. 사이에 활성 규칙이 없는 순간이 생기면
       * 그 틈에 들어온 채번이 예외로 죽는다.
       */
      const retired = await db.rows<{ id: string }>(
        `update numbering_rule set is_active = false
          where target = $1::numbering_target and is_active
            and item_id is not distinct from $2::uuid
            and item_type is not distinct from $3::item_type
          returning id`,
        [target, itemId, itemType],
      );
      const issued = await db.one<{ id: string; pattern: string }>(
        `insert into numbering_rule
           (target, item_id, item_type, pattern, reset, seq_width, effective_from,
            registered_by)
         values ($1::numbering_target, $7::uuid, $8::item_type, $2, $3::reset_cycle,
                 $4, $5::date, $6)
         returning id, pattern`,
        [target, pattern, reset, seqWidth, effectiveFrom, user.id, itemId, itemType],
      );
      return { issued, replaced: retired.length > 0 };
    });

    revalidatePath('/settings/numbering');
    revalidatePath('/');
    /* 문구는 서버가 실제로 내린 것으로 정한다 */
    return {
      ok: true,
      message: done.replaced
        ? `규칙을 교체했습니다. 새 패턴 ${done.issued?.pattern} - 순번은 이어집니다.`
        : `규칙을 등록했습니다. 패턴 ${done.issued?.pattern}`,
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function retireRule(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    return { error: '생산관리자 또는 시스템관리자만 채번 규칙을 내릴 수 있습니다' };
  }

  const id = String(form.get('id') ?? '');
  try {
    const [r] = await withActor(user.id, (db) =>
      db.rows<{ item_id: string | null; item_type: string | null }>(
        `update numbering_rule set is_active = false where id = $1
         returning item_id, item_type::text as item_type`, [id]),
    );
    revalidatePath('/settings/numbering');
    revalidatePath('/');
    /* 품목별 · 종류별 규칙을 내리면 그 품목은 공통 규칙으로 돌아간다. 채번이 멈추는 것은 공통 규칙뿐이다 */
    return {
      ok: true,
      message: r?.item_id || r?.item_type
        ? '규칙을 내렸습니다. 해당 품목은 이제 공통 규칙으로 번호를 받습니다.'
        : '규칙을 내렸습니다. 이 대상은 새 규칙을 등록하기 전까지 채번할 수 없습니다.',
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
