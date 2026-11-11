'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';
import { CHECK_CYCLES, type CheckCycle } from '@/lib/equipment-check';

/* ---------------------------------------------------------------------------
   설비 기준정보

   설비는 지우지 않는다. 내려도 이미 적힌 기록의 코드는 그대로 남는다 - 그 기록은
   그때 그 설비로 작업한 사실이다. 내리면 현장 화면 타일에서만 빠진다.
--------------------------------------------------------------------------- */

async function admin() {
  const user = await requireUser();
  // 생산 품목 셋업은 생산관리자의 일이다 (사용자 지시 2026-08-27).
  // 계정 · 채번 · 공급자는 여전히 시스템관리자만 만진다.
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) throw new Error('생산관리자 또는 시스템관리자만 설비를 관리할 수 있습니다');
  return user;
}

const txt = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/*
 * 숫자 칸. 비어 있으면 null 이다 - 0 으로 채우지 않는다.
 *
 * 0 은 "공짜" 라는 뜻이고 null 은 "모른다" 다. 취득원가가 비었는데 0 으로
 * 넣으면 그 설비는 감가상각이 0원인 것으로 계산되어 원가가 조용히 적게 나온다.
 * 비어 있으면 상각비를 얹지 않고, 화면이 몇 대가 비었는지 적는다.
 */
const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim().replace(/,/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/* 구입 정보와 판 곳. 등록과 수정이 같은 목록을 쓴다 */
const BUY = [
  'purchased_on', 'purchase_price', 'useful_life_months', 'salvage_value',
  'monthly_hours', 'vendor_name', 'vendor_contact_name', 'vendor_phone',
  'vendor_email', 'vendor_site', 'vendor_address',
] as const;

const NUMERIC = new Set<string>([
  'purchase_price', 'useful_life_months', 'salvage_value', 'monthly_hours']);

function buyValues(form: FormData) {
  return BUY.map((k) => (NUMERIC.has(k) ? num(form.get(k)) : txt(form.get(k))));
}

/* 검교정 주기 (0126). 모르는 값이 오면 매년으로 둔다 - 지금까지의 뜻이 매년이었다 */
function cycle(form: FormData): CheckCycle {
  const v = String(form.get('check_cycle') ?? '');
  return CHECK_CYCLES.some((c) => c.code === v) ? (v as CheckCycle) : 'ANNUAL';
}

export async function saveEquipment(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const id = txt(form.get('id'));
    const name = txt(form.get('name'));
    const note = txt(form.get('note'));

    await withActor(me.id, async (db) => {
      if (id) {
        /*
         * 코드도 고칠 수 있다. 다만 한 번이라도 쓰인 설비는 DB 트리거가 막는다
         * (0031) - 기록에 코드가 문자열로 적혀 있어 바꾸면 그 기록이 가리키는
         * 대상이 사라지고, 기록은 되돌릴 수 없다. 오타 정정만 열어 둔 것이다.
         */
        const code = String(form.get('code') ?? '').trim();
        await db.rows(
          `update equipment
              set code = coalesce(nullif($5,''), code),
                  name = $2, note = $3, is_active = $4,
                  purchased_on = $6::date, purchase_price = $7,
                  useful_life_months = $8, salvage_value = $9, monthly_hours = $10,
                  vendor_name = $11, vendor_contact_name = $12, vendor_phone = $13,
                  vendor_email = $14, vendor_site = $15, vendor_address = $16,
                  check_cycle = $17, check_items = $18
            where id = $1`,
          [id, name, note, form.get('is_active') === 'on', code, ...buyValues(form),
           cycle(form), txt(form.get('check_items'))]);
      } else {
        await db.rows(
          `insert into equipment
             (code, name, note,
              purchased_on, purchase_price, useful_life_months, salvage_value,
              monthly_hours, vendor_name, vendor_contact_name, vendor_phone,
              vendor_email, vendor_site, vendor_address, check_cycle, check_items)
           values ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [txt(form.get('code')), name, note, ...buyValues(form),
           cycle(form), txt(form.get('check_items'))]);
      }
    });

    revalidatePath('/equipment');
    return { ok: true, message: id ? '설비를 고쳤습니다.' : '설비를 등록했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 밸리데이션 이력 등록.
 *
 * 서면 보고서가 근거다. 보고서 번호 없이는 등록되지 않는다 - 사용기간 이력이
 * 안정성 시험 보고서 번호를 요구하는 것과 같은 방식이다 (§4.2).
 * 이력은 고치거나 지우지 않는다. 잘못 넣었으면 바른 값을 다시 등록한다.
 */
export async function saveValidation(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const performedOn = String(form.get('performed_on') ?? '');
    const validUntil = String(form.get('valid_until') ?? '');
    const reportNo = txt(form.get('report_no'));
    /*
     * 공정 밸리데이션인가 계측기 교정인가 (GMP 점검 F4 · 2026-09-11).
     *
     * 전에는 한 표에 섞여 "이 저울의 교정이 유효한가" 를 물을 수 없었다.
     * 모르는 값이 오면 밸리데이션으로 둔다 - 그때까지 들어간 것이 전부
     * 밸리데이션이었으므로 그쪽이 안전한 기본값이다.
     */
    const kind = String(form.get('kind') ?? '') === 'CALIBRATION'
      ? 'CALIBRATION' : 'VALIDATION';
    const what = kind === 'CALIBRATION' ? '교정' : '밸리데이션';
    if (!reportNo) return { error: `${what} 보고서 번호를 입력하십시오` };

    await withActor(me.id, (db) =>
      db.rows(
        `insert into equipment_validation
           (equipment_id, performed_on, valid_until, report_no, note,
            registered_by, kind)
         values ($1,$2::date,$3::date,$4,$5,$6,$7::equipment_check_kind)`,
        [String(form.get('equipment_id') ?? ''), performedOn, validUntil,
         reportNo, txt(form.get('note')), me.id, kind]));

    revalidatePath('/equipment');
    revalidatePath('/equipment/plan');
    return { ok: true, message: `${what}을 등록했습니다. 만료 ${validUntil}` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 밸리데이션 · 교정 이력 한 줄을 지운다 (0124 뒤 · 사용자 2026-11-09 검교정 목록 갱신).
 *
 * 잘못 넣은 줄을 바른 값으로 다시 넣는 것만으로는 틀린 줄이 이력에 남아
 * «그날 했다» 는 거짓이 계속 보인다. 지운 줄은 감사추적에 이전 값 그대로 남는다.
 */
export async function deleteValidation(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const id = String(form.get('id') ?? '');
    const n = await withActor(me.id, (db) =>
      db.val<string>(`delete from equipment_validation where id = $1 returning report_no`, [id]),
      { reason: '설비 밸리데이션 이력 지우기' });
    revalidatePath('/equipment');
    revalidatePath('/equipment/plan');
    return n ? { ok: true, message: '이력 한 줄을 지웠습니다.' } : { error: '이미 지워진 줄입니다' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 공정에 설비를 걸거나 뗀다.
 *
 * 떼도 지우지 않는다 (§10). 앞으로 그 공정 화면에 그 타일이 나오지 않을 뿐이고,
 * 뗀 사실은 감사추적에 남는다. 이미 적힌 기록의 설비 코드는 건드리지 않는다 -
 * 그 기록은 그때 그 설비로 작업한 사실이다.
 */
export async function linkOperation(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const eq = String(form.get('equipment_id') ?? '');
    const op = String(form.get('operation_id') ?? '');
    const on = form.get('on') === '1';

    /*
     * 설비는 서면 대조 항목이다. 걸거나 떼면 그 제품표준서의 대조가 풀린다 (0134).
     * 풀렸으면 그 자리에서 말한다 - 모르고 지나가면 다음 지시 발행에서 막힌다.
     */
    const r = await withActor(me.id, async (db) => {
      const before = await db.one<{ dm: string; label: string; verified: boolean }>(
        `select dm.id as dm, coalesce(dm.product_code, i.code) || ' ' || dm.revision as label,
                dm.verified_at is not null as verified
           from dmr_operation o
           join device_master dm on dm.id = o.device_master_id
           join item i on i.id = dm.item_id
          where o.id = $1`, [op]);
      await db.rows(
        `insert into operation_equipment (operation_id, equipment_id, is_active)
         values ($1, $2, $3)
         on conflict (operation_id, equipment_id)
           do update set is_active = excluded.is_active`, [op, eq, on]);
      const after = before
        ? await db.val<boolean>(`select verified_at is not null from device_master where id = $1`, [before.dm])
        : null;
      return { label: before?.label ?? '', lost: !!before?.verified && after === false };
    });

    revalidatePath('/equipment');
    // 같은 연결을 제품표준서 작업대 두 화면도 보여 준다
    revalidatePath('/production/setup');
    revalidatePath('/settings/dmr');
    return {
      ok: true,
      message: (on ? '공정에 걸었습니다.' : '공정에서 뗐습니다.')
        + (r.lost ? ` ${r.label} 의 서면 대조 확인이 풀렸습니다. 제품표준서에서 다시 대조해야 작업 지시를 낼 수 있습니다.` : ''),
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
