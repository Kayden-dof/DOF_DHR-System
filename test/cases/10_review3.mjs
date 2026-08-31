// =============================================================================
// 10_review3.mjs · 3차 검수에서 나온 결함 (2026-08-31)
// 근거: 사각지대 세 갈래(응용 전수 · 사양 자체 · 장기 운용) 검수
//
// 결함 1 규격 표기 · 2 감사추적 비밀 · 3 원재료 차감 · 5 기준값 근거 ·
// 7 변경 사유. 4(NEXT_REDIRECT)는 응용 계층이라 여기서 볼 수 없다.
//
// 08_purge 보다 앞에 둔다. 그쪽은 자료를 통째로 비운다.
// =============================================================================

import { masterData as master, newMaterialLot, newWorkOrder } from '../fixtures.mjs';

const BLOCKED = { code: 'P0001' };

export default [

// ---- 결함 1 · 규격 표기 -----------------------------------------------------

{
  id: 'RV3-01', expect: '확인',
  name: '형명의 크기는 cm 그대로, 두께만 mm 로 환산한다',
  async run(t) {
    await master(t);
    /*
     * 품목 등록 화면이 "5x5 는 0505", "0.5~1.0mm 는 0510" 이라고 안내한다.
     * 크기와 두께는 단위가 다르다. 넉 달 동안 넷 다 10 으로 나누고 있었고,
     * 그 값이 라벨요청서와 출하 승인 요청서에 실려 나갔다.
     */
    t.eq(await t.val(`select cm_label('05')`), '5',   '05 → 5cm');
    t.eq(await t.val(`select cm_label('10')`), '10',  '10 → 10cm');
    t.eq(await t.val(`select mm_label('05')`), '0.5', '05 → 0.5mm');
    t.eq(await t.val(`select mm_label('10')`), '1.0', '10 → 1.0mm');

    t.eq(await t.val(`select spec_label('PD10152025')`),
         '10x15cm · 두께 2.0~2.5mm', '인쇄물이 쓰는 규격 문구');
    t.eq(await t.val(`select spec_label('RM-006')`), '', '형명이 아니면 빈 문구');
  },
},

// ---- 결함 2 · 감사추적에 비밀을 담지 않는다 ---------------------------------

{
  id: 'RV3-02', expect: '확인',
  name: '비밀번호 해시는 감사추적에 값으로 남지 않는다',
  async run(t) {
    const u = await t.newUser({ full_name: '비밀시험', pin_hash: 'scrypt$SECRETVALUE' });

    t.eq(await t.val(
      `select new_value->>'pin_hash' from audit_log
        where table_name='app_user' and record_id=$1 order by id desc limit 1`, [u]),
      '(감춤)', '등록 기록의 비밀번호');

    /*
     * 남의 비밀번호 초기화는 개발 계정만 할 수 있다 (0018). 앞선 시험이 세워
     * 둔 행위자가 남아 있으면 여기서 걸린다. 이 시험이 보려는 것은 그 규칙이
     * 아니라 감사추적에 값이 남는지이므로 행위자를 비운다.
     */
    await t.setActor(null);
    await t.rows(`update app_user set pin_hash='scrypt$ANOTHER' where id=$1`, [u]);
    const row = await t.one(
      `select old_value->>'pin_hash' o, new_value->>'pin_hash' n from audit_log
        where table_name='app_user' and record_id=$1 and action='UPDATE'
        order by id desc limit 1`, [u]);
    t.eq(row.o, '(감춤)', '변경 전 값');
    t.eq(row.n, '(감춤)', '변경 후 값');

    /* 키를 지우지 않는다. 지우면 바뀐 사실 자체가 사라진다 */
    t.eq(await t.val(
      `select (new_value ? 'pin_hash') from audit_log
        where table_name='app_user' and record_id=$1 order by id desc limit 1`, [u]),
      true, '키는 남는다');

    /* 화면이 지나는 가림 함수도 같은 답을 낸다 */
    t.eq(await t.val(
      `select audit_redact('{"pin_hash":"scrypt$X","full_name":"홍"}'::jsonb,'app_user')::text`),
      '{"pin_hash": "(감춤)", "full_name": "홍"}', '가림 함수');
  },
},

// ---- 결함 3 · 원재료 차감 ---------------------------------------------------

{
  id: 'RV3-03', expect: '확인',
  name: '배치를 발행하면 장입한 원재료가 재고에서 빠진다',
  async run(t) {
    const m = await master(t);
    const lot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const before = Number(await t.val(
      `select qty_available from material_lot where id=$1`, [lot]));

    await newWorkOrder(t, m, { rawLot: lot, sheets: 20 });

    t.eq(Number(await t.val(`select qty_available from material_lot where id=$1`, [lot])),
         before - 20, '발행 뒤 잔여');
    t.eq(await t.val(
      `select count(*)::int from stock_movement
        where material_lot_id=$1 and type='BATCH_LOAD'`, [lot]), 1, '장입 기록');
  },
},

{
  id: 'RV3-04', expect: '확인',
  name: '잔여가 모자라도 막지 않고 경고로 알린다',
  async run(t) {
    const m = await master(t);
    const lot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 5 });

    /* §2 는 재고 부족을 경고로 두었지 차단으로 두지 않았다 */
    const warns = await t.rows(`select kind from work_order_warnings($1, 20)`, [lot]);
    t.ok(warns.some((w) => w.kind === '재고 부족'), '재고 부족 경고');

    /* 그래도 발행은 된다. 실물이 먼저이고 장부가 뒤따른다 */
    await t.resolves(() => newWorkOrder(t, m, { rawLot: lot, sheets: 20 }));
    t.eq(Number(await t.val(`select qty_available from material_lot where id=$1`, [lot])),
         0, '잔여만큼만 빠진다');
  },
},

// ---- 결함 5 · 기준값에 근거를 붙인다 ----------------------------------------

{
  id: 'RV3-05', expect: '예외',
  name: '완제품 사용기간은 화면에서 바꿀 수 없다',
  async run(t) {
    const m = await master(t);
    await t.rejects(() => t.rows(
      `update item set shelf_life_months = 24 where id = $1`, [m.fin]),
      { ...BLOCKED, message: '사용기간 이력으로 등록' });

    /* 원재료는 그대로 바꾼다. 제품 유효기한을 만들지 않는다 */
    await t.resolves(() => t.rows(
      `update item set shelf_life_months = 6 where id = $1`, [m.raw]));
  },
},

{
  id: 'RV3-06', expect: '예외',
  name: '발효되지 않은 제품표준서로는 발행할 수 없다',
  async run(t) {
    const m = await master(t);
    const lot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510' });

    const mk = (rev, status, from, verified) => t.val(
      `insert into device_master (item_id, revision, status, effective_from,
                                  verified_by, verified_at)
       select item_id, $1, $2, $3::date, $4, $5
         from device_master where id = $6 returning id`,
      [rev, status, from, verified ? m.admin : null, verified ? new Date() : null, m.dm]);

    const issue = (dm) => t.val(
      `insert into work_order (wo_no, batch_no, device_master_id, dmr_revision,
         material_lot_id, sheet_count, issued_by_prod, issued_by_qa)
       values (next_number('WORK_ORDER'), next_number('BATCH'), $1, 'x', $2, 10, $3, $4)
       returning id`, [dm, lot, m.admin, m.qa]);

    const draft = await mk('Z-DRAFT', 'DRAFT',  '2020-01-01', true);
    const fut   = await mk('Z-FUT',   'ACTIVE', '2099-01-01', true);
    const unv   = await mk('Z-UNV',   'ACTIVE', '2020-01-01', false);
    const ok    = await mk('Z-OK',    'ACTIVE', '2020-01-01', true);

    await t.rejects(() => issue(draft), { ...BLOCKED, message: 'DRAFT상태' });
    await t.rejects(() => issue(fut),   { ...BLOCKED, message: '발효일' });
    await t.rejects(() => issue(unv),   { ...BLOCKED, message: '서면 대조 확인' });

    /* 셋 다 갖추면 통과한다 */
    await t.resolves(() => issue(ok));
  },
},

{
  id: 'RV3-07', expect: '확인',
  name: '유효기한의 근거가 종이에 적을 문구로 나온다',
  async run(t) {
    const m = await master(t);

    /* 이력이 없으면 품목 기본값을 썼다는 것이 드러나야 한다 */
    t.ok(String(await t.val(`select shelf_life_basis(null, $1)`, [m.fin]))
           .includes('품목 기본값'), '이력 없을 때');

    const h = await t.val(
      `insert into shelf_life_history (item_id, months, effective_from,
         study_report_no, approved_by)
       values ($1, 24, current_date, 'STB-2026-007', $2) returning id`, [m.fin, m.admin]);
    t.ok(String(await t.val(`select shelf_life_basis($1, $2)`, [h, m.fin]))
           .includes('STB-2026-007'), '이력이 있을 때 보고서 번호');
  },
},

// ---- 결함 7 · 감사추적에 왜 -------------------------------------------------

{
  id: 'RV3-08', expect: '확인',
  name: '기준정보를 바꾼 사유가 감사추적에 남는다',
  async run(t) {
    const m = await master(t);

    await t.rows(`select set_config('app.change_reason','정기 재평가 결과', false)`);
    await t.rows(`update supplier set status = 'SUSPENDED' where id = $1`, [m.supplier]);
    t.eq(await t.val(
      `select reason from audit_log where table_name='supplier' and record_id=$1
        order by id desc limit 1`, [m.supplier]),
      '정기 재평가 결과', '변경 사유');

    /* 등록에는 묻지 않는다. 만든 것 자체가 사유다 */
    const s2 = await t.val(
      `insert into supplier (code, name) values ('SUP-RSN','사유시험') returning id`);
    t.eq(await t.val(
      `select reason from audit_log where table_name='supplier' and record_id=$1
        order by id desc limit 1`, [s2]), null, '등록에는 사유가 없다');

    await t.rows(`select set_config('app.change_reason','', false)`);
    await t.rows(`update supplier set note = '사유 없이' where id = $1`, [m.supplier]);
    t.eq(await t.val(
      `select reason from audit_log where table_name='supplier' and record_id=$1
        order by id desc limit 1`, [m.supplier]), null, '사유가 비면 비운 채로 남는다');
  },
},

];
