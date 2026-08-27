'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';

async function admin() {
  const user = await requireUser();
  // 생산 품목 셋업은 생산관리자의 일이다 (사용자 지시 2026-08-27).
  // 계정 · 채번 · 공급자는 여전히 시스템관리자만 만진다.
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) throw new Error('생산관리자 또는 시스템관리자만 제품표준서를 관리할 수 있습니다');
  return user;
}

const path = (dm?: string) => {
  revalidatePath('/settings/dmr');
  if (dm) revalidatePath(`/settings/dmr/${dm}`);
};

/**
 * 제품 등록.
 *
 * 제품 하나를 만드는 데 폼 셋을 거쳐야 했다 - 품목(형명) 등록 → 표준서 개정
 * 추가 → 제품 코드 입력. 개념이 섞여 있어서 그렇다. 만드는 것(제품)과
 * 사들이는 것(자재 품목)은 다른 물건인데 같은 "품목 등록" 하나로 묶여 있었다
 * (사용자 지적).
 *
 * 제품 등록은 한 번에 끝낸다. 제품 코드 · 제품명 · 대표 형명 · 개정 표기를
 * 받아 형명(item)과 제품표준서(device_master)를 함께 만든다.
 *
 * 형명은 규격이다 (PD + 가로 + 세로 + 두께하한 + 두께상한). 제품 하나에 규격이
 * 여럿이고, 실제로 어느 규격이 나오는지는 재단에서 정해진다 (§3). 여기서 받는
 * 것은 그 제품을 대표하는 형명 하나이고, 나머지 규격은 완제품 형명 생성으로
 * 만든다.
 */
export async function createProduct(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const productCode = String(form.get('product_code') ?? '').trim();
    const productName = String(form.get('product_name') ?? '').trim();
    const revision = String(form.get('revision') ?? '').trim();
    const existing = String(form.get('item_id') ?? '').trim();
    const newCode = String(form.get('new_item_code') ?? '').trim();
    const newName = String(form.get('new_item_name') ?? '').trim();

    if (!productCode) return { error: '제품 코드를 입력하십시오' };
    if (!existing && !newCode) return { error: '대표 형명을 고르거나 새로 적으십시오' };

    await withActor(me.id, async (db) => {
      let itemId = existing;
      if (!itemId) {
        itemId = (await db.val<string>(
          `insert into item (code, name, type, purchase_uom, usage_uom, shelf_life_months)
           values ($1,$2,'FIN','EA','EA',12) returning id`,
          [newCode, newName || `${productName} ${newCode}`]))!;
      }
      await db.rows(
        `insert into device_master
           (item_id, revision, status, effective_from, product_code, product_name)
         values ($1,$2,'DRAFT',$3::date,$4,$5)`,
        [itemId, revision, String(form.get('effective_from') ?? '') || null,
         productCode, productName || null]);
    });

    path();
    return { ok: true,
      message: `${productCode} ${revision} 을 만들었습니다. 공정 흐름부터 넣으십시오.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function createDeviceMaster(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const revision = String(form.get('revision') ?? '').trim();
    await withActor(me.id, (db) =>
      db.rows(
        `insert into device_master (item_id, revision, status, effective_from)
         values ($1,$2,'DRAFT',$3::date)`,
        [String(form.get('item_id') ?? ''), revision,
         String(form.get('effective_from') ?? '') || null]));
    path();
    return { ok: true, message: `${revision} 개정을 만들었습니다. 공정과 자재 구성표를 넣으십시오.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 구조화 입력분을 서면 제품표준서와 대조했다는 확인.
 * 판정이 아니라 "옮겨 적은 것이 맞다"는 기록이다 (§4.3 verified_by).
 */
/**
 * 배치당 예상 생산수량 (계획 참고값).
 *
 * 발행된 작업 지시가 있어도 고칠 수 있다. 계획값이지 기록이 아니고, 이미 발행된
 * 지시서에는 아무 영향이 없다. 실제 수량은 재단에서 정해진다 (§3).
 */
export async function setExpectedUnits(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const raw = String(form.get('expected_units') ?? '').trim();
    const units = raw === '' ? null : Number(raw);
    if (units !== null && (!Number.isInteger(units) || units <= 0)) {
      return { error: '예상 생산수량은 1 이상의 정수이거나 비워 둡니다' };
    }
    await withActor(me.id, (db) =>
      db.rows(`update device_master set expected_units = $2 where id = $1`,
        [String(form.get('id') ?? ''), units]));
    revalidatePath('/production/setup');
    revalidatePath('/settings/dmr');
    return { ok: true, message: units === null
      ? '예상 생산수량을 비웠습니다.'
      : `배치당 예상 생산수량 ${units}개로 저장했습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 제품 코드 · 제품명.
 *
 * 최상위 관리 코드다 (DX2401). 완제품 형명(PD…)은 그 아래의 규격이므로
 * 화면과 인쇄물의 "제품" 자리에는 이 값이 나가야 한다. 비우면 형명으로
 * 떨어진다.
 */
export async function setProductCode(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const code = String(form.get('product_code') ?? '').trim() || null;
    const name = String(form.get('product_name') ?? '').trim() || null;
    await withActor(me.id, (db) =>
      db.rows(`update device_master set product_code = $2, product_name = $3 where id = $1`,
        [String(form.get('id') ?? ''), code, name]));
    revalidatePath('/production/setup');
    revalidatePath('/settings/dmr');
    revalidatePath('/production');
    revalidatePath('/equipment');
    return { ok: true, message: code ? `제품 코드를 ${code} 로 저장했습니다.` : '제품 코드를 비웠습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function verifyDeviceMaster(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const id = String(form.get('id') ?? '');
    await withActor(me.id, (db) =>
      db.rows(
        `update device_master set verified_by = $2, verified_at = now(), status = 'ACTIVE'
          where id = $1`, [id, me.id]));
    path(id);
    return {
      ok: true,
      message: '서면 대조를 확인했습니다. 이제 작업 지시 발행에서 고를 수 있습니다.',
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function addOperation(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const dm = String(form.get('device_master_id') ?? '');
    const code = String(form.get('code') ?? '').trim();
    await withActor(me.id, (db) =>
      db.rows(
        `insert into dmr_operation (device_master_id, seq, code, name, after_cutting)
         values ($1,$2,$3,$4,$5)`,
        [dm, Number(form.get('seq') ?? 0), code,
         String(form.get('name') ?? '').trim(),
         form.get('after_cutting') === 'on']));
    path(dm);
    return { ok: true, message: `${code} 공정을 추가했습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 공정 흐름 일괄 입력.
 *
 * 새 제품을 처음부터 등록할 때 공정을 하나씩 폼으로 넣으면 열두 번을 눌러야
 * 하고, 그러다 보면 순번이나 재단 이후 여부를 빠뜨린다. 흐름 전체를 한 번에
 * 적게 한다.
 *
 * 한 줄에 공정 하나. 구분자는 | 또는 탭이다.
 *   WS-DX2402-01 | NaCl 처리·세척
 *   WS-DX2402-08 | 포장(1·2차) | 재단이후
 *
 * 순번은 적힌 차례를 그대로 쓴다. 사람이 흐름을 적는 순서가 곧 공정 순서다.
 * 세 번째 칸에 "재단이후"(또는 after)가 있으면 재단 이후 공정이 된다.
 *
 * 한 줄이라도 어긋나면 아무것도 넣지 않는다. 절반만 들어간 공정 흐름은
 * 고치는 것보다 다시 넣는 편이 빠르고, 이 시스템에는 삭제가 없다.
 */
export async function addOperationsBulk(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const dm = String(form.get('device_master_id') ?? '');
    const raw = String(form.get('flow') ?? '');

    const rows: { seq: number; code: string; name: string; after: boolean }[] = [];
    const bad: string[] = [];
    let seq = Number(form.get('start_seq') ?? 1) || 1;

    for (const line of raw.split(new RegExp("\\r?\\n"))) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      // 구분자는 | 또는 탭. 엑셀에서 붙여 넣으면 탭으로 온다
      const cell = t.split(new RegExp("\\s*[\\|\\t]\\s*")).map((x) => x.trim());
      if (cell.length < 2 || !cell[0] || !cell[1]) { bad.push(t); continue; }
      const flag = (cell[2] ?? '').replace(/\s/g, '').toLowerCase();
      rows.push({
        seq: seq++, code: cell[0], name: cell[1],
        after: flag === '재단이후' || flag === 'after' || flag === 'y',
      });
    }

    if (bad.length > 0) {
      return { error: `읽을 수 없는 줄이 있습니다: ${bad.slice(0, 2).join(' / ')}` +
        (bad.length > 2 ? ` 외 ${bad.length - 2}줄` : '') };
    }
    if (rows.length === 0) return { error: '공정을 한 줄 이상 적으십시오' };

    // 한 트랜잭션이다. 한 줄이라도 거부되면 전부 되돌아간다
    await withActor(me.id, async (db) => {
      for (const r of rows) {
        await db.rows(
          `insert into dmr_operation (device_master_id, seq, code, name, after_cutting)
           values ($1,$2,$3,$4,$5)`, [dm, r.seq, r.code, r.name, r.after]);
      }
    });

    path(dm);
    return { ok: true, message: `공정 ${rows.length}개를 넣었습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 다른 제품표준서의 구조를 통째로 복사.
 *
 * 공정 · 자재 구성표 · 장입 구간 · 설비 연결까지 온다. 대조 확인은 오지
 * 않는다 - 복사된 표준서는 서면과 다시 대조해야 하고, 복사가 그 확인을
 * 대신하면 안 된다.
 */
export async function copyDmr(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const dst = String(form.get('device_master_id') ?? '');
    const src = String(form.get('source_id') ?? '');
    if (!src) return { error: '가져올 제품표준서를 고르십시오' };

    const n = await withActor(me.id, (db) =>
      db.val<number>(`select copy_dmr_structure($1,$2)`, [src, dst]));

    path(dst);
    return { ok: true,
      message: `공정 ${n}개와 자재 구성표 · 설비 연결을 가져왔습니다. 서면과 대조 확인을 다시 하십시오.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function addBom(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const dm = String(form.get('device_master_id') ?? '');
    const basis = String(form.get('basis') ?? 'SHEET_TIER');
    const per = String(form.get('qty_per_unit') ?? '').trim();

    if (basis === 'PER_UNIT' && per === '') {
      return { error: '제품 개수 기준은 1개당 소요량이 필요합니다' };
    }

    await withActor(me.id, (db) =>
      db.rows(
        `insert into dmr_bom (operation_id, component_item_id, basis, qty_per_unit)
         values ($1,$2,$3::qty_basis,$4)`,
        [String(form.get('operation_id') ?? ''), String(form.get('component_item_id') ?? ''),
         basis, basis === 'PER_UNIT' ? Number(per) : null]));
    path(dm);
    return {
      ok: true,
      message: basis === 'SHEET_TIER'
        ? '자재를 추가했습니다. 장입 구간별 소요량을 이어서 넣으십시오.'
        : '자재를 추가했습니다.',
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function addTier(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const dm = String(form.get('device_master_id') ?? '');
    const max = String(form.get('max_sheets') ?? '').trim();
    await withActor(me.id, (db) =>
      db.rows(
        `insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty)
         values ($1,$2,$3,$4)`,
        [String(form.get('dmr_bom_id') ?? ''), Number(form.get('min_sheets') ?? 1),
         max === '' ? null : Number(max), Number(form.get('qty') ?? 1)]));
    path(dm);
    return { ok: true, message: '장입 구간을 추가했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
