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
    if (!existing && !newCode) return { error: '대표 형명을 선택하거나 새로 입력하십시오' };

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
           (item_id, revision, status, effective_from, product_code, product_name,
            license_no)
         values ($1,$2,'DRAFT',$3::date,$4,$5,$6)`,
        [itemId, revision, String(form.get('effective_from') ?? '') || null,
         productCode, productName || null,
         String(form.get('license_no') ?? '').trim() || null]);
    });

    path();
    return { ok: true,
      message: `${productCode} ${revision} 을(를) 등록했습니다. 공정 흐름부터 입력하십시오.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function createDeviceMaster(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const revision = String(form.get('revision') ?? '').trim();
    const txt = (k: string) => String(form.get(k) ?? '').trim() || null;

    /*
     * 제품 코드를 만들 때 함께 받는다 (사용자 요청 2026-09-01).
     *
     * 전에는 "대상 형명"(PD05050510)만 묻고 제품 코드는 만든 뒤 따로 넣게 되어
     * 있었다. 그런데 제품은 DX2401 이고 형명은 그 아래 규격이다 (0031). 묻는
     * 순서가 뒤집혀 있었던 셈이다.
     *
     * 형명은 그대로 받는다. 채번과 소요량이 거기 매여 있다 (0031).
     */
    await withActor(me.id, (db) =>
      db.rows(
        `insert into device_master
           (item_id, revision, status, effective_from, product_code, product_name, note)
         values ($1,$2,'DRAFT',$3::date,$4,$5,$6)`,
        [String(form.get('item_id') ?? ''), revision,
         String(form.get('effective_from') ?? '') || null,
         txt('product_code'), txt('product_name'), txt('note')]));
    path();
    return { ok: true, message: `${revision} 개정을 등록했습니다. 공정과 자재 구성표를 입력하십시오.` };
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
 * 공정이 보통 몇 일차에 오는가.
 *
 * 참고값이다. 실제 일차는 현장이 정하고 이 값이 그것을 제약하지 않는다.
 * 비우면 아무 데도 나오지 않는다 - 모르면 적지 않는 것이 맞다.
 */
export async function setTypicalDay(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const raw = String(form.get('typical_day') ?? '').trim();
    const day = raw === '' ? null : Number(raw);
    if (day !== null && (!Number.isInteger(day) || day < 1)) {
      return { error: '일차는 1 이상의 정수이거나 비워 둡니다' };
    }
    const dm = String(form.get('device_master_id') ?? '');
    await withActor(me.id, (db) =>
      db.rows(`update dmr_operation set typical_day = $2 where id = $1`,
        [String(form.get('id') ?? ''), day]));
    path(dm);
    revalidatePath('/work');
    return { ok: true, message: day === null ? '일차를 비웠습니다.' : `보통 ${day}일차로 저장했습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 완제품검사 시료 채취 기준.
 *
 * 생산 수량 구간별 시료 수와 그 근거를 받는다. 구간도 수량도 검사기준서가
 * 정하고 여기서는 옮겨 적을 뿐이다. 근거 없는 숫자는 아무도 믿지 않는다 (§6).
 */
export async function addSampleTier(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const dm = String(form.get('id') ?? '');
    const min = Number(form.get('min_qty') ?? 0);
    const rawMax = String(form.get('max_qty') ?? '').trim();
    const max = rawMax === '' ? null : Number(rawMax);
    const qty = Number(form.get('sample_qty') ?? 0);

    if (!Number.isInteger(min) || min < 1) {
      return { error: '구간 시작은 1 이상의 정수입니다' };
    }
    if (max !== null && (!Number.isInteger(max) || max < min)) {
      return { error: '구간 끝은 시작보다 크거나 같아야 합니다. 상한이 없으면 비워 둡니다' };
    }
    if (!Number.isInteger(qty) || qty < 0) {
      return { error: '시료 수는 0 이상의 정수입니다' };
    }

    await withActor(me.id, (db) =>
      db.rows(
        `insert into sample_plan (device_master_id, min_qty, max_qty, sample_qty, registered_by)
         values ($1,$2,$3,$4,$5)
         on conflict (device_master_id, min_qty)
           do update set max_qty = excluded.max_qty, sample_qty = excluded.sample_qty`,
        [dm, min, max, qty, me.id]));

    revalidatePath('/production/setup');
    revalidatePath('/settings/dmr');
    revalidatePath('/work');
    return { ok: true, message:
      `${min}~${max ?? ''}개 구간의 시료 수를 ${qty}개로 저장했습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/** 시료 채취 기준의 근거 문구. 어느 검사기준서의 어느 표를 옮겼는가. */
export async function setSampleBasis(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const basis = String(form.get('sample_basis') ?? '').trim() || null;
    await withActor(me.id, (db) =>
      db.rows(`update device_master set sample_basis = $2 where id = $1`,
        [String(form.get('id') ?? ''), basis]));
    revalidatePath('/production/setup');
    revalidatePath('/settings/dmr');
    revalidatePath('/work');
    return { ok: true, message: basis === null
      ? '근거 문구를 비웠습니다.'
      : '근거 문구를 저장했습니다.' };
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
    /*
     * 허가 번호도 여기서 고친다 (0095). 발행 뒤에는 DB 가 막는다 - 라벨에
     * 찍히는 값이라 바꾸면 이미 나간 배치의 라벨요청서가 다른 번호를 낸다.
     * 변경허가는 새 개정본으로 간다.
     */
    const license = String(form.get('license_no') ?? '').trim() || null;
    await withActor(me.id, (db) =>
      db.rows(
        `update device_master
            set product_code = $2, product_name = $3, license_no = $4
          where id = $1`,
        [String(form.get('id') ?? ''), code, name, license]),
      { reason: '제품 코드 · 제품명 · 허가 번호 기재' });
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
      message: '서면 대조를 확인했습니다. 이제 작업 지시 발행에서 선택할 수 있습니다.',
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
        `insert into dmr_operation (device_master_id, seq, code, name, after_cutting, typical_day)
         values ($1,$2,$3,$4,$5,$6)`,
        [dm, Number(form.get('seq') ?? 0), code,
         String(form.get('name') ?? '').trim(),
         form.get('after_cutting') === 'on',
         Number(form.get('typical_day') ?? 0) || null]));
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
 *   WS-DX2402-08 | 포장(1·2차) | 재단이후 | 3
 *
 * 순번은 적힌 차례를 그대로 쓴다. 사람이 흐름을 적는 순서가 곧 공정 순서다.
 * 세 번째 칸에 "재단이후"(또는 after)가 있으면 재단 이후 공정이 된다.
 * 네 번째 칸은 보통 몇 일차에 하는 공정인지다. 참고값이라 비워도 된다.
 *
 * 한 줄이라도 어긋나면 아무것도 넣지 않는다. 절반만 들어간 공정 흐름은
 * 고치는 것보다 다시 넣는 편이 빠르고, 이 시스템에는 삭제가 없다.
 */
export async function addOperationsBulk(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const dm = String(form.get('device_master_id') ?? '');
    const raw = String(form.get('flow') ?? '');

    const rows: {
      seq: number; code: string; name: string; after: boolean; day: number | null;
    }[] = [];
    const bad: string[] = [];
    let seq = Number(form.get('start_seq') ?? 1) || 1;

    for (const line of raw.split(new RegExp("\\r?\\n"))) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      // 구분자는 | 또는 탭. 엑셀에서 붙여 넣으면 탭으로 온다
      const cell = t.split(new RegExp("\\s*[\\|\\t]\\s*")).map((x) => x.trim());
      if (cell.length < 2 || !cell[0] || !cell[1]) { bad.push(t); continue; }
      const flag = (cell[2] ?? '').replace(/\s/g, '').toLowerCase();
      // 네 번째 칸은 보통 일차. 숫자가 아니면 없는 것으로 둔다
      const day = Number((cell[3] ?? '').trim());
      rows.push({
        seq: seq++, code: cell[0], name: cell[1],
        after: flag === '재단이후' || flag === 'after' || flag === 'y',
        day: Number.isInteger(day) && day > 0 ? day : null,
      });
    }

    if (bad.length > 0) {
      return { error: `읽을 수 없는 줄이 있습니다: ${bad.slice(0, 2).join(' / ')}` +
        (bad.length > 2 ? ` 외 ${bad.length - 2}줄` : '') };
    }
    if (rows.length === 0) return { error: '공정을 한 줄 이상 입력하십시오' };

    // 한 트랜잭션이다. 한 줄이라도 거부되면 전부 되돌아간다
    await withActor(me.id, async (db) => {
      for (const r of rows) {
        await db.rows(
          `insert into dmr_operation
             (device_master_id, seq, code, name, after_cutting, typical_day)
           values ($1,$2,$3,$4,$5,$6)`,
          [dm, r.seq, r.code, r.name, r.after, r.day]);
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
    if (!src) return { error: '가져올 제품표준서를 선택하십시오' };

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
        ? '자재를 추가했습니다. 장입 구간별 소요량을 이어서 입력하십시오.'
        : '자재를 추가했습니다.',
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/* ---------------------------------------------------------------------------
   적어 넣은 것을 고친다 (5차 감사 A3)

   전에는 공정도 자재 구성표도 **추가만** 되었다. 공정 코드를 잘못 치거나
   소요량을 잘못 넣으면 개정본을 새로 만들어 처음부터 다시 넣는 수밖에 없었다.
   0084 는 "발행 전에는 전부 열려 있다. 오기 정정이 정상 작업이다" 라고
   적었는데, DB 가 연 문을 화면이 안 냈다.

   발행 뒤에는 DB 가 막는다 (0089). 화면도 같은 조건으로 폼을 내지 않는다
   (`editable = wo_count === 0`). 두 층이 같은 것을 말한다.

   판정하지 않는다. 무엇이 옳은 소요량인지 정하지 않고 고쳐 쓸 자리를 낼
   뿐이며, 이전 값은 감사추적에 남는다 (§5).
--------------------------------------------------------------------------- */
export async function updateOperation(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const dm = String(form.get('device_master_id') ?? '');
    const id = String(form.get('id') ?? '');
    const code = String(form.get('code') ?? '').trim();
    const name = String(form.get('name') ?? '').trim();
    const seq = Number(form.get('seq') ?? 0);

    if (!id) return { error: '어느 공정인지 알 수 없습니다' };
    if (!code) return { error: '공정 코드를 입력하십시오' };
    if (!name) return { error: '공정 이름을 입력하십시오' };
    if (!Number.isInteger(seq) || seq < 1) return { error: '순번은 1 이상의 정수입니다' };

    await withActor(me.id, (db) =>
      db.rows(
        `update dmr_operation
            set code = $2, name = $3, seq = $4, after_cutting = $5, typical_day = $6
          where id = $1`,
        [id, code, name, seq, form.get('after_cutting') === 'on',
         Number(form.get('typical_day') ?? 0) || null]),
      { reason: '제품표준서 공정 정정' });

    path(dm);
    return { ok: true, message: `${code} 공정을 고쳤습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function updateBom(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const dm = String(form.get('device_master_id') ?? '');
    const id = String(form.get('id') ?? '');
    const basis = String(form.get('basis') ?? 'SHEET_TIER');
    const per = String(form.get('qty_per_unit') ?? '').trim();

    if (!id) return { error: '어느 자재인지 알 수 없습니다' };
    if (basis === 'PER_UNIT' && per === '') {
      return { error: '제품 개수 기준은 1개당 소요량이 필요합니다' };
    }
    if (basis === 'PER_UNIT' && !(Number(per) > 0)) {
      return { error: '1개당 소요량은 0보다 커야 합니다' };
    }

    await withActor(me.id, (db) =>
      db.rows(
        `update dmr_bom set basis = $2::qty_basis, qty_per_unit = $3 where id = $1`,
        [id, basis, basis === 'PER_UNIT' ? Number(per) : null]),
      { reason: '제품표준서 자재 구성표 정정' });

    path(dm);
    return {
      ok: true,
      message: basis === 'SHEET_TIER'
        ? '자재를 고쳤습니다. 장입 구간별 소요량을 확인하십시오.'
        : '자재를 고쳤습니다.',
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function updateTier(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const dm = String(form.get('device_master_id') ?? '');
    const id = String(form.get('id') ?? '');
    const max = String(form.get('max_sheets') ?? '').trim();
    const min = Number(form.get('min_sheets') ?? 0);
    const qty = Number(form.get('qty') ?? 0);

    if (!id) return { error: '어느 구간인지 알 수 없습니다' };
    if (!Number.isInteger(min) || min < 1) return { error: '구간 하한은 1 이상의 정수입니다' };
    if (!(qty > 0)) return { error: '소요량은 0보다 커야 합니다' };

    await withActor(me.id, (db) =>
      db.rows(
        `update dmr_bom_tier set min_sheets = $2, max_sheets = $3, qty = $4 where id = $1`,
        [id, min, max === '' ? null : Number(max), qty]),
      { reason: '제품표준서 장입 구간 정정' });

    path(dm);
    return { ok: true, message: '장입 구간을 고쳤습니다.' };
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

/**
 * 개정 사유 (비고).
 *
 * 서면 제품표준서에 적힌 개정 사유를 옮겨 적는다. 시스템이 무엇이 바뀌었는지
 * 계산하지 않는다 (§1). 서명이 든 값이 아니므로 고쳐 쓸 수 있고, 고친 사실은
 * 감사추적에 남는다.
 */
export async function setDmrNote(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const note = String(form.get('note') ?? '').trim() || null;
    await withActor(me.id, (db) =>
      db.rows(`update device_master set note = $2 where id = $1`,
        [String(form.get('id') ?? ''), note]),
      { reason: '제품표준서 개정 사유 기재' });
    path();
    return { ok: true, message: note ? '개정 사유를 적었습니다.' : '개정 사유를 비웠습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 배치 장입 장수 범위와 멸균 발송 박스 수량 (M5-1 · §2.0).
 *
 * 전에는 `check (sheet_count between 1 and 30)` 으로 표 정의에 박혀 있었다.
 * 30 은 DX2401 의 값이지 프로그램의 성질이 아니다. 다른 품목을 올리려면
 * 개발자를 다시 불러야 했다.
 *
 * DDL 에는 바깥 울타리(`> 0`)만 남기고 실제 범위는 여기서 정한다 (0069).
 */
export async function setDmrLimits(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const num = (k: string) => {
      const v = String(form.get(k) ?? '').trim();
      if (v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    };
    const lo = num('sheet_min');
    const hi = num('sheet_max');
    if (lo !== null && hi !== null && lo > hi) {
      return { error: '하한이 상한보다 클 수 없습니다' };
    }
    await withActor(me.id, (db) =>
      db.rows(
        `update device_master
            set sheet_min = $2, sheet_max = $3, steril_box_qty = $4
          where id = $1`,
        [String(form.get('id') ?? ''), lo, hi, num('steril_box_qty')]),
      { reason: '제품표준서 장입 범위 · 멸균 박스 수량 변경' });
    path();
    return { ok: true, message: '장입 범위를 저장했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
