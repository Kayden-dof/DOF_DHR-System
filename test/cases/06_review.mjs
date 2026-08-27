// =============================================================================
// 06_review.mjs · 검토 지원 (§8.5)
//
// 산술로 판정되는 것만 잡는다. 잡아야 할 것을 잡는지와, 잡지 말아야 할 것을
// 잡지 않는지를 같은 무게로 본다. 멀쩡한 배치에서 하나라도 나오면 그 표시가
// 곧 무시된다.
// =============================================================================

import { masterData as master, newMaterialLot, newWorkOrder } from '../fixtures.mjs';

/** 시약을 정량대로 넣고 정상 마감한 공정 하나. */
async function goodOp(t, m, wo, opts = {}) {
  const op = opts.op ?? m.ops['WS-DX2401-03'];
  const lot = opts.lot ?? await newMaterialLot(t, m, m.reagent, { qty: 20 });
  const pr = await t.val(
    `insert into process_record (work_order_id, operation_id, day_no, work_date,
       worker_id, started_at, ended_at)
     values ($1,$2,$3,current_date,$4,
             current_date + interval '8 hours', current_date + interval '9 hours')
     returning id`,
    [wo.id, op, opts.day ?? 1, m.worker]);
  await t.rows(
    `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
     values ($1,$2,$3,$4)`,
    [pr, lot, await t.val(`select required_qty($1,$2,$3,0)`,
      [op, m.reagent, wo.sheets ?? 20]), m.admin]);
  return { pr, lot };
}

const flags = (t, wo) => t.rows(`select kind, detail from review_flags($1)`, [wo.id]);

export default [

{
  id: 'RV-01', expect: '확인',
  name: '멀쩡한 배치에서는 아무것도 표시하지 않는다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    await t.setActor(m.admin);
    await goodOp(t, m, wo);

    const rows = await flags(t, wo);
    t.eq(rows.length, 0, `표시 항목 (${rows.map((r) => r.detail).join(' / ')})`);
  },
},

{
  id: 'RV-02', expect: '확인',
  name: '시각 역전을 잡는다 (시작이 종료보다 늦음)',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    await t.setActor(m.admin);
    const { pr } = await goodOp(t, m, wo);

    await t.rows(
      `update process_record
          set started_at = current_date + interval '9 hours 20 minutes',
              ended_at   = current_date + interval '8 hours 50 minutes'
        where id = $1`, [pr]);

    const rows = await flags(t, wo);
    const hit = rows.find((r) => r.kind === '시각 모순');
    if (!hit) throw new Error('시각 모순을 잡지 못했다');
    if (!hit.detail.includes('역전')) {
      throw new Error(`사실을 그대로 적어야 한다: ${hit.detail}`);
    }
  },
},

{
  id: 'RV-03', expect: '확인',
  name: '구간 이탈을 잡는다 (시약 기입량이 구간과 다름)',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    await t.setActor(m.admin);
    const { pr, lot } = await goodOp(t, m, wo);

    // 20장이면 2통인데 1통만 넣은 것으로 고친다
    await t.rows(`update material_issue set qty = 1 where process_record_id = $1`, [pr]);

    const rows = await flags(t, wo);
    if (!rows.some((r) => r.kind === '구간 이탈')) {
      throw new Error(`구간 이탈을 잡지 못했다 (${rows.map((r) => r.kind).join(',')})`);
    }
    t.eq(typeof lot, 'string', '자재 로트');
  },
},

{
  id: 'RV-04', expect: '확인',
  name: '반납이 불출보다 크면 잡는다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    await t.setActor(m.admin);
    const { lot } = await goodOp(t, m, wo);

    await t.rows(
      `insert into stock_movement (material_lot_id, type, qty, work_order_id,
                                   reason_code, registered_by)
       values ($1,'RETURN',$2,$3,'계량오차',$4)`,
      [lot, 99, wo.id, m.admin]);

    const rows = await flags(t, wo);
    if (!rows.some((r) => r.kind === '수량 불일치' && r.detail.includes('반납이 더 큼'))) {
      throw new Error(`반납 초과를 잡지 못했다 (${rows.map((r) => r.detail).join(' / ')})`);
    }
  },
},

{
  id: 'RV-05', expect: '확인',
  name: '사유로 넘어간 자재를 표시한다 (S05 예외)',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    await t.setActor(m.admin);

    const pr = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date,
         worker_id, no_material_reason)
       values ($1,$2,1,current_date,$3,'해당 공정 미실시') returning id`,
      [wo.id, m.ops['WS-DX2401-03'], m.worker]);
    await t.rows(`select complete_process($1)`, [pr]);

    const rows = await flags(t, wo);
    if (!rows.some((r) => r.kind === '기입 누락' && r.detail.includes('해당 공정 미실시'))) {
      throw new Error('사유로 넘어간 항목을 표시하지 않았다');
    }
  },
},

{
  id: 'RV-07', expect: '확인',
  name: '설비 사용일에 유효한 밸리데이션이 없으면 잡는다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    await t.setActor(m.admin);

    const eq = await t.val(
      `insert into equipment (code, name) values ('TV-01','시험 설비') returning id`);

    // 사용일을 덮지 못하는 이력 하나 (작년에 만료)
    await t.rows(
      `insert into equipment_validation
         (equipment_id, performed_on, valid_until, report_no, registered_by)
       values ($1, current_date - 400, current_date - 30, 'VAL-OLD', $2)`,
      [eq, m.admin]);

    const { pr } = await goodOp(t, m, wo);
    await t.rows(`update process_record set equipment_id = 'TV-01' where id = $1`, [pr]);

    const rows = await flags(t, wo);
    const hit = rows.find((r) => r.kind === '기한 경과');
    if (!hit) throw new Error(`설비 기한 경과를 잡지 못했다 (${rows.map((r) => r.kind).join(',')})`);
    if (!hit.detail.includes('TV-01') || !hit.detail.includes('유효한 밸리데이션 없음')) {
      throw new Error(`사실을 그대로 적어야 한다: ${hit.detail}`);
    }

    // 사용일을 덮는 이력을 등록하면 사라진다. 잡지 말아야 할 것을 잡지 않는다
    await t.rows(
      `insert into equipment_validation
         (equipment_id, performed_on, valid_until, report_no, registered_by)
       values ($1, current_date - 10, current_date + 355, 'VAL-NEW', $2)`,
      [eq, m.admin]);
    const after = await flags(t, wo);
    if (after.some((r) => r.kind === '기한 경과')) {
      throw new Error('유효한 이력이 있는데도 계속 잡는다');
    }
  },
},

{
  id: 'EQ-01', expect: '확인',
  name: '설비 코드를 바꿔도 지난 기록은 그때 코드를 그대로 유지한다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    await t.setActor(m.admin);

    const eq = await t.val(
      `insert into equipment (code, name) values ('EQ-T1','시험 설비') returning id`);

    // 응용은 참조만 넣는다. 종이에 찍힐 코드는 DB 가 그 시점 대장에서 떠 온다
    const { pr } = await goodOp(t, m, wo);
    await t.rows(`update process_record set equipment_ref = $2 where id = $1`, [pr, eq]);
    // 갱신 경로에는 스냅숏 트리거가 없으므로 새 기록으로 확인한다
    const pr2 = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date,
         worker_id, equipment_ref, started_at, ended_at)
       values ($1,$2,9,current_date,$3,$4,
               current_date + interval '8 hours', current_date + interval '9 hours')
       returning id`, [wo.id, m.ops['WS-DX2401-04'], m.worker, eq]);
    t.eq(await t.val(`select equipment_id from process_record where id = $1`, [pr2]),
         'EQ-T1', '스냅숏 자동 기입');

    // 대장 코드를 바꾼다. 참조가 신원을 들고 있으므로 막히지 않는다
    await t.rows(`update equipment set code = 'EQ-T9' where id = $1`, [eq]);

    // 지난 기록의 스냅숏은 그대로다. 종이에 찍힌 값과 어긋나지 않는다
    t.eq(await t.val(`select equipment_id from process_record where id = $1`, [pr2]),
         'EQ-T1', '코드 변경 후에도 스냅숏 불변');

    // 그런데도 설비로는 계속 이어진다. 사용 기록이 끊기지 않는다.
    // 위에서 참조를 붙인 기록이 둘이다 (pr · pr2)
    t.eq(Number(await t.val(
      `select count(*)::int from v_process_equipment where equipment_id = $1`, [eq])),
      2, '참조로 이어지는 기록');
  },
},

{
  id: 'RV-06', expect: '확인',
  name: '판정 문구를 쓰지 않는다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    await t.setActor(m.admin);
    const { pr } = await goodOp(t, m, wo);
    await t.rows(
      `update process_record set ended_at = started_at - interval '1 hour' where id = $1`, [pr]);

    const rows = await flags(t, wo);
    const banned = ['적합', '부적합', '합격', '불합격', '이상 없음', '검토 완료', '오류', '위반'];
    for (const r of rows) {
      for (const w of banned) {
        if (r.detail.includes(w)) {
          throw new Error(`판정 문구 "${w}" 가 들어 있다: ${r.detail}`);
        }
      }
    }
    if (rows.length === 0) throw new Error('표시 항목이 있어야 하는 상황인데 비었다');
  },
},

];
