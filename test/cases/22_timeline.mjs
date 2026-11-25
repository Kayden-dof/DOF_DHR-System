// =============================================================================
// 22_timeline.mjs - 공정 시간표 · 배치 계획 · 판에 묶인 문서 (0137)
// 근거: 사용자 2026-11-19 «DX2401 공정 타임라인 프로그램의 기능을 DHR 에 녹인다»
//       · «개정안을 Rev.01 지시에만»
//
// 시간표는 계획이라 서면 대조와 무관하다. 모양이 틀린 시간표는 DB 가 받지 않고,
// 개정본 복사가 함께 옮긴다. 배치 계획은 같은 판의 지시에만 이어진다.
// =============================================================================

import { masterData as master, newWorkOrder, newMaterialLot, reverify } from '../fixtures.mjs';
import { brFormOfRecord } from '../../lib/br-scope.ts';

const STEP = (id, extra = {}) => ({
  id, p: '01', n: `작업 ${id}`, k: 'work', s: 480, d: 30, mn: null, mx: null, a: [], m: '', ...extra,
});

async function freshDm(t, m, rev) {
  return t.val(
    `insert into device_master (item_id, revision, status) values ($1, $2, 'DRAFT') returning id`,
    [m.fin, rev]);
}

export default [

{
  id: 'TL-01', expect: '거부',
  name: '모양이 틀린 공정 시간표 (앞 작업이 없음 · 구분 · 소요 0 · 최소>최대 · 겹친 이름)',
  async run(t) {
    const m = await master(t);
    const dm = await freshDm(t, m, 'Rev.TL1');
    const put = (steps) => t.rows(
      `insert into dmr_timeline (device_master_id, steps, updated_by) values ($1, $2::jsonb, $3)`,
      [dm, JSON.stringify(steps), m.admin]);
    const bad = [
      [STEP('a', { a: ['zz'] })],
      [STEP('a', { a: ['a'] })],
      [STEP('a', { k: 'rest' })],
      [STEP('a', { d: 0 })],
      [STEP('a', { s: 10.5 })],
      [STEP('a', { mn: 60, mx: 30 })],
      [STEP('a', { p: '1' })],
      [STEP('a'), STEP('a')],
    ];
    for (const steps of bad) {
      await t.rejects(() => put(steps), { message: 'dmr_timeline_steps' });
    }
    await t.resolves(() => put([STEP('a'), STEP('b', { k: 'wait', a: ['a'], mn: 30, mx: 60, s: 510 })]));
  },
},

{
  id: 'TL-02', expect: '통과',
  name: '시간표를 고쳐도 서면 대조 확인은 그대로 · 감사추적 · 개정본 복사가 옮긴다',
  async run(t) {
    const m = await master(t);
    const before = await t.val(`select verified_at::text from device_master where id = $1`, [m.dm]);
    t.ok(before, '공용 표준서는 대조 확인된 판');
    await t.setActor(m.admin);
    await t.rows(
      `insert into dmr_timeline (device_master_id, steps, basis, updated_by)
       values ($1, $2::jsonb, '작업표준서 개정안 v5', $3)
       on conflict (device_master_id) do update set steps = excluded.steps`,
      [m.dm, JSON.stringify([STEP('a'), STEP('b', { a: ['a'], s: 510 })]), m.admin]);
    await t.setActor(null);
    t.eq(await t.val(`select verified_at::text from device_master where id = $1`, [m.dm]), before,
      '대조 확인이 풀리지 않는다');
    t.ok(await t.val(
      `select exists (select 1 from audit_log where table_name = 'dmr_timeline' and record_id = $1)`,
      [m.dm]), '감사추적');

    const src = await freshDm(t, m, 'Rev.TL2');
    await t.rows(
      `insert into dmr_operation (device_master_id, seq, code, name) values ($1, 1, 'WS-TL-01', '처리')`, [src]);
    await t.rows(
      `insert into dmr_timeline (device_master_id, steps, basis, updated_by) values ($1, $2::jsonb, '근거', $3)`,
      [src, JSON.stringify([STEP('x'), STEP('y', { a: ['x'] })]), m.admin]);
    const dst = await freshDm(t, m, 'Rev.TL3');
    await t.rows(`select copy_dmr_structure($1, $2)`, [src, dst]);
    t.eq(await t.val(`select jsonb_array_length(steps) from dmr_timeline where device_master_id = $1`, [dst]),
      2, '작업 두 개가 옮겨졌다');
    t.eq(await t.val(`select basis from dmr_timeline where device_master_id = $1`, [dst]), '근거', '근거');
  },
},

{
  id: 'TL-03', expect: '거부',
  name: '배치 계획에 다른 판의 제품표준서로 낸 작업 지시를 잇는다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const other = await freshDm(t, m, 'Rev.TL4');
    await t.rejects(() => t.rows(
      `insert into batch_plan (label, device_master_id, start_on, work_order_id, created_by)
       values ('B-TL-01', $1, current_date, $2, $3)`, [other, wo.id, m.admin]),
      { message: '판이 이 계획의 판과 다릅니다' });
    await t.resolves(() => t.rows(
      `insert into batch_plan (label, device_master_id, start_on, work_order_id, created_by)
       values ('B-TL-02', $1, current_date, $2, $3)`, [m.dm, wo.id, m.admin]));
    t.eq(await t.val(`select count(*)::int from work_calendar`), 1, '근무 달력은 한 줄');
  },
},

{
  id: 'TL-04', expect: '통과',
  name: '기록서 양식을 제품표준서 판에 묶는다 (현행이 아닌 개정안)',
  async run(t) {
    const m = await master(t);
    const dm = await freshDm(t, m, 'Rev.TL5');
    const id = await t.val(
      `insert into mfg_doc (product_code, op_code, kind, doc_no, title, revision, is_current,
                            device_master_id, registered_by)
       values ('TL-TEST', 'WS-TL-01', 'BR', 'F706-TL-01', '시험 양식', 'Rev.01', false, $1, $2)
       returning id`, [dm, m.admin]);
    t.eq(await t.val(`select device_master_id from mfg_doc where id = $1`, [id]), dm, '판');
  },
},

{
  id: 'TL-05', expect: '확인',
  name: '판에 묶인 기록서 양식이 있으면 그 판의 지시는 묶인 양식만, 다른 판은 현행 양식',
  async run(t) {
    const m = await master(t);
    const r00 = await freshDm(t, m, 'Rev.TL6');
    const r01 = await freshDm(t, m, 'Rev.TL7');
    const FORM = JSON.stringify({ page: { w: 842, h: 595 }, pages: [{ texts: [], tables: [] }] });
    const ins = (no, rev, cur, dm) => t.val(
      `insert into mfg_doc (product_code, op_code, kind, doc_no, title, revision, is_current,
                            device_master_id, form, registered_by)
       values ('TL-SC', 'WS-SC-01', 'BR', $1, '양식', $2, $3, $4, $5::jsonb, $6) returning id`,
      [no, rev, cur, dm, FORM, m.admin]);
    const old = await ins('F706-SC-01', 'Rev.00', true, null);
    const neu = await ins('F706-SC-01', 'Rev.01', false, r01);
    const pick = (dm) => t.rows(
      `select id from mfg_doc where product_code = 'TL-SC' and kind = 'BR' and form is not null
          and br_form_in_scope(device_master_id, is_current, $1) order by revision`, [dm]);
    t.eq((await pick(r00)).map((x) => x.id).join(), old, 'Rev.00 판은 현행 양식');
    t.eq((await pick(r01)).map((x) => x.id).join(), neu, 'Rev.01 판은 묶인 개정안 양식만');
  },
},

{
  id: 'TL-06', expect: '확인',
  name: '현장 칸 저장도 그 지시의 판이 쓰는 양식만 받는다 (묶인 개정안은 받고 범위 밖 현행 양식은 막는다)',
  async run(t) {
    /*
     * 운영 DX2401 Rev.01 이 이 모양이다 (2026-11-25): 공정마다 Rev.00 현행 양식(묶이지 않음)과
     * Rev.01 판에 묶인 개정안(현행 아님)이 함께 있다. 화면 · 관리 정정 · 인쇄는 br_form_in_scope 로
     * 개정안만 쓴다. 현장 저장 관문이 is_current 로 보면 개정안 칸은 막고, 화면에 없는 Rev.00
     * 양식 칸은 받아 서명 판정 없이 적는다 - 종이에 없는 값이 인쇄 자료의 br 에 들어간다.
     */
    const m = await master(t);
    const FORM = JSON.stringify({ page: { w: 842, h: 595 }, pages: [{ texts: [], tables: [] }] });
    const dmOf = async (rev) => {
      const dm = await t.val(
        `insert into device_master (item_id, revision, status, product_code, effective_from)
         values ($1, $2, 'DRAFT', 'TL-BR', current_date) returning id`, [m.fin, rev]);
      const op = await t.val(
        `insert into dmr_operation (device_master_id, seq, code, name, after_cutting)
         values ($1, 1, 'WS-TL-BR-01', '처리', false) returning id`, [dm]);
      await reverify(t, dm, m.admin);
      return { dm, op, rev };
    };
    const r00 = await dmOf('Rev.TL8');
    const r01 = await dmOf('Rev.TL9');
    const doc = (rev, cur, dm) => t.val(
      `insert into mfg_doc (product_code, op_code, kind, doc_no, title, revision, is_current,
                            device_master_id, form, registered_by)
       values ('TL-BR', 'WS-TL-BR-01', 'BR', 'F706-TL-BR-01', '양식', $1, $2, $3, $4::jsonb, $5)
       returning id`, [rev, cur, dm, FORM, m.admin]);
    const cur = await doc('Rev.00', true, null);
    const bound = await doc('Rev.01', false, r01.dm);

    const record = async (s) => {
      const raw = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
      const wo = await t.val(
        `insert into work_order (wo_no, batch_no, device_master_id, dmr_revision,
           material_lot_id, sheet_count, issued_by_prod, issued_by_qa)
         values (next_number('WORK_ORDER'), next_number('BATCH'), $1, $2, $3, 10, $4, $5)
         returning id`, [s.dm, s.rev, raw, m.admin, m.qa]);
      await t.setActor(m.worker);
      const pr = await t.val(
        `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id, started_at)
         values ($1, $2, 1, current_date, $3, now()) returning id`, [wo, s.op, m.worker]);
      await t.setActor(null);
      return pr;
    };
    const p01 = await record(r01);
    t.eq(await brFormOfRecord(t, p01, bound), true, 'Rev.01 지시: 판에 묶인 개정안 칸은 받는다');
    t.eq(await brFormOfRecord(t, p01, cur), false, 'Rev.01 지시: 화면에 없는 Rev.00 현행 양식 칸은 막는다');
    const p00 = await record(r00);
    t.eq(await brFormOfRecord(t, p00, cur), true, '묶인 양식이 없는 판: 현행 양식 칸은 받는다');
    t.eq(await brFormOfRecord(t, p00, bound), false, '묶인 양식이 없는 판: 다른 판에 묶인 양식 칸은 막는다');
  },
},

];
