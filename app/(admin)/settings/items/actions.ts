'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import { ITEM_TYPES, type FormState } from '@/lib/forms';

async function admin() {
  const user = await requireUser();
  // 생산 품목 셋업은 생산관리자의 일이다 (사용자 지시 2026-08-27).
  // 계정 · 채번 · 공급자는 여전히 시스템관리자만 만진다.
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) throw new Error('생산관리자 또는 시스템관리자만 기준정보를 관리할 수 있습니다');
  return user;
}

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : Number(s);
};

export async function createItem(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const code = String(form.get('code') ?? '').trim();
    const name = String(form.get('name') ?? '').trim();

    await withActor(me.id, (db) =>
      db.rows(
        `insert into item (code, name, type, purchase_uom, usage_uom, conversion,
                           min_stock, lead_days, shelf_life_months)
         values ($1,$2,$3::item_type,$4,$5,$6,$7,$8,$9)`,
        [code, name,
         String(form.get('type') ?? 'REAGENT'),
         String(form.get('purchase_uom') ?? '').trim(),
         String(form.get('usage_uom') ?? '').trim(),
         num(form.get('conversion')) ?? 1,
         num(form.get('min_stock')),
         num(form.get('lead_days')),
         num(form.get('shelf_life_months'))],
      ),
    );
    revalidatePath('/settings/items');
    return { ok: true, message: `${code} ${name} 품목을 등록했습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/* ---------------------------------------------------------------------------
   품목 붙여넣기 (사용자 요청 2026-09-10)

   한 건씩 넣으면 등록에 성공할 때마다 창이 닫히고, 유형과 단위가 기본값으로
   돌아간다. 처음 세울 때 품목이 스무 종 안팎이라 그 반복이 그대로 셋업
   시간이 된다.

   공정 흐름 적기와 같은 방식이다 - 구분자는 `|` 또는 탭이라 엑셀에서 그대로
   붙여 넣을 수 있고, 한 줄이라도 어긋나면 아무것도 넣지 않는다.

   ── 완제품은 받지 않는다 ────────────────────────────────────────────────
   §10 이 "완제품 62종을 손으로 등록" 을 금지한다. 형명은 형명 체계에서
   규칙으로 만든다. 여기서 받아 주면 그 규칙을 건너뛰는 길이 된다.
--------------------------------------------------------------------------- */
export async function bulkItems(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const raw = String(form.get('items') ?? '');

    const rows: { code: string; name: string; type: string;
                  purchase: string; usage: string; conv: number }[] = [];
    const bad: string[] = [];
    const fin: string[] = [];

    for (const line of raw.split(new RegExp("\\r?\\n"))) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const cell = t.split(new RegExp("\\s*[\\|\\t]\\s*")).map((x) => x.trim());
      if (cell.length < 3 || !cell[0] || !cell[1] || !cell[2]) { bad.push(t); continue; }

      // 유형은 화면에 적힌 한글로도, 코드로도 받는다
      const type = ITEM_TYPES.find(
        (x) => x.label === cell[2] || x.code === cell[2].toUpperCase());
      if (!type) { bad.push(t); continue; }
      if (type.code === 'FIN') { fin.push(cell[0]); continue; }

      // 단위를 안 적으면 EA, 환산을 안 적으면 1. 대부분이 그렇다
      const purchase = (cell[3] || 'EA').trim();
      const usage = (cell[4] || 'EA').trim();
      const conv = Number(cell[5] ?? '1');
      if (!Number.isFinite(conv) || conv <= 0) { bad.push(t); continue; }

      rows.push({ code: cell[0], name: cell[1], type: type.code, purchase, usage, conv });
    }

    if (fin.length > 0) {
      return { error: `완제품은 여기서 등록하지 않습니다 (${fin.slice(0, 3).join(' · ')}` +
        `${fin.length > 3 ? ' 외' : ''}). 형명 체계에서 규칙으로 만드십시오.` };
    }
    if (bad.length > 0) {
      return { error: `읽을 수 없는 줄이 있습니다: ${bad.slice(0, 2).join(' / ')}` +
        (bad.length > 2 ? ` 외 ${bad.length - 2}줄` : '') };
    }
    if (rows.length === 0) return { error: '품목을 한 줄 이상 입력하십시오' };

    // 한 트랜잭션이다. 한 줄이라도 거부되면 전부 되돌아간다
    await withActor(me.id, async (db) => {
      for (const r of rows) {
        await db.rows(
          `insert into item (code, name, type, purchase_uom, usage_uom, conversion)
           values ($1,$2,$3::item_type,$4,$5,$6)`,
          [r.code, r.name, r.type, r.purchase, r.usage, r.conv],
        );
      }
    });

    revalidatePath('/settings/items');
    return { ok: true, message: `품목 ${rows.length}종을 등록했습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function updateItem(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const id = String(form.get('id') ?? '');
    await withActor(me.id, async (db) => {
      /*
       * 단위와 환산 계수는 **로트가 하나라도 들어오면 잠근다** (사용자 요청
       * 2026-09-10).
       *
       * 등록할 때만 받고 뒤로는 못 고치게 두었더니, 셋업에서 단위를 잘못
       * 넣으면 빠져나올 길이 없었다 - 지울 수도 없고(S03) 고칠 수도 없어
       * 비활성으로 내리고 새 코드로 다시 만드는 수밖에 없었다.
       *
       * 그렇다고 아무 때나 열 수는 없다. 재고 · 불출 · 단가가 전부 사용
       * 단위 기준의 숫자로 적혀 있어서(§4.2), 로트가 있는 품목의 단위를
       * 바꾸면 **이미 적힌 숫자의 뜻이 바뀐다.** 그것은 적힌 사실을 고쳐
       * 쓰는 일이다 (§2.1).
       *
       * 그래서 제품표준서가 "지시가 나가면 잠근다" 로 가른 것과 같은 자리에
       * 선을 긋는다 - 로트 0건이면 열고, 하나라도 있으면 닫는다.
       */
      const locked = ((await db.val<number>(
        `select count(*)::int from material_lot where item_id = $1`, [id])) ?? 0) > 0;

      const uom = (k: string) => {
        if (locked) return null;
        const v = String(form.get(k) ?? '').trim();
        return v === '' ? null : v;
      };
      const conv = (() => {
        if (locked) return null;
        const n = num(form.get('conversion'));
        return n !== null && Number.isFinite(n) && n > 0 ? n : null;
      })();

      await db.rows(
        /*
         * 기본 공급자 (6차 감사 N7). 사양 §4.2 에 있는 열인데 화면에 칸이
         * 없었고 아무도 읽지 않았다 - 발주 화면이 공급자를 미리 골라 주지
         * 않아, 살 때마다 어디서 사는지를 사람이 다시 떠올려야 했다.
         */
        `update item set name = $2, min_stock = $3, lead_days = $4,
                         shelf_life_months = $5, is_active = $6,
                         default_supplier_id = $7,
                         purchase_uom = coalesce($8, purchase_uom),
                         usage_uom    = coalesce($9, usage_uom),
                         conversion   = coalesce($10, conversion)
          where id = $1`,
        [id, String(form.get('name') ?? '').trim(),
         num(form.get('min_stock')), num(form.get('lead_days')),
         num(form.get('shelf_life_months')), form.get('is_active') === 'on',
         String(form.get('default_supplier_id') ?? '').trim() || null,
         uom('purchase_uom'), uom('usage_uom'), conv],
      );
    });
    revalidatePath('/settings/items');
    return { ok: true, message: '품목을 수정했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/* ---------------------------------------------------------------------------
   완제품 형명 생성 (§4.2)

   "62개를 손으로 등록하지 말 것." 크기와 두께 구간을 받아 조합으로 만든다.
   크기·두께 목록은 제품표준서에서 오는 값이라 코드에 박지 않는다.
--------------------------------------------------------------------------- */
export interface GenResult extends FormState {
  rows?: { item_code: string; item_name: string; was_created: boolean }[];
}

const codes = (v: FormDataEntryValue | null) =>
  String(v ?? '')
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/* ---------------------------------------------------------------------------
   만들기 전에 무엇이 나오는지 보여 준다 (0100)

   화면이 스스로 조합하지 않는다. 크기 목록과 구간 목록을 곱하는 것은 여기서도
   두 줄이지만, **자리 수 검사와 이름 짓기가 함께 붙어 있다.** 그것을 화면이
   다시 쓰면 같은 셈이 두 곳에 생기고 §10 이 적은 대로 복제는 갈라진다 -
   규격 문구가 실제로 그렇게 갈라져 라벨 업체에 10배 작은 치수가 나갔다.

   `preview_finished_items()` 는 `generate_finished_items()` 와 같은 셈을 쓴다.
   미리보기가 보여 준 것과 실제로 만들어지는 것이 어긋날 자리가 없다.

   아무것도 만들지 않으므로 읽기 전용이다.
--------------------------------------------------------------------------- */
export interface PreviewRow {
  item_code: string; item_name: string; spec: string;
  size_part: string; band_part: string; already: boolean;
}
export type PreviewResult = { rows?: PreviewRow[]; error?: string };

export async function previewFinished(form: FormData): Promise<PreviewResult> {
  try {
    const me = await admin();
    const sizes = codes(form.get('sizes'));
    const bands = codes(form.get('bands'));
    const prefix = String(form.get('prefix') ?? '').trim();
    const scheme = String(form.get('scheme_id') ?? '').trim();

    if (sizes.length === 0 || bands.length === 0) {
      return { error: '크기와 구간을 각각 하나 이상 입력하십시오' };
    }
    if (!prefix) return { error: '이름 앞머리를 적으십시오' };
    if (!scheme) return { error: '어느 형명 체계로 만들지 고르십시오' };

    const rows = await withActor(me.id, (db) =>
      db.rows<PreviewRow>(
        `select * from preview_finished_items($1::text[], $2::text[], '{}'::text[], $3, $4)`,
        [sizes, bands, prefix, scheme]), { readOnly: true });
    return { rows };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function generateFinished(_p: GenResult, form: FormData): Promise<GenResult> {
  try {
    const me = await admin();
    const sizes = codes(form.get('sizes'));
    const bands = codes(form.get('bands'));
    const exclude = codes(form.get('exclude'));

    if (sizes.length === 0 || bands.length === 0) {
      return { error: '크기와 두께 구간을 각각 하나 이상 입력하십시오' };
    }

    /*
     * 앞머리에 기본값을 두지 않는다 (5차 감사 B4). DX2401 은 이 제조소의
     * 품목 코드이지 프로그램의 성질이 아니다 (§2.0).
     */
    const prefix = String(form.get('prefix') ?? '').trim();
    if (!prefix) return { error: '이름 앞머리를 적으십시오' };

    const scheme = String(form.get('scheme_id') ?? '').trim();
    if (!scheme) return { error: '어느 형명 체계로 만들지 고르십시오' };

    const rows = await withActor(me.id, (db) =>
      db.rows<{ item_code: string; item_name: string; was_created: boolean }>(
        `select * from generate_finished_items($1::text[], $2::text[], $3::text[], $4, $5, $6)`,
        [sizes, bands, exclude, prefix,
         Number(form.get('shelf_months') ?? 12) || 12, scheme],
      ),
    );

    const made = rows.filter((r) => r.was_created).length;
    revalidatePath('/settings/items');
    return {
      ok: true,
      rows,
      message: `조합 ${rows.length}종 중 ${made}종을 새로 등록했습니다. ` +
               `나머지 ${rows.length - made}종은 이미 있어 건드리지 않았습니다.`,
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
