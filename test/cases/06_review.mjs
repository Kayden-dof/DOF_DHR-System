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
  id: 'DM-01', expect: '확인',
  name: '제품표준서 구조를 통째로 복사한다 (공정 · 자재 · 구간 · 설비)',
  async run(t) {
    const m = await master(t);
    await t.setActor(m.admin);

    const item = await t.val(
      `insert into item (code,name,type,purchase_uom,usage_uom)
       values ('ZZ-COPY-TEST','시험 신제품','FIN','EA','EA') returning id`);
    const dst = await t.val(
      `insert into device_master (item_id,revision,status,effective_from)
       values ($1,'Rev.01','ACTIVE',current_date) returning id`, [item]);

    const before = Number(await t.val(
      `select count(*)::int from dmr_operation where device_master_id = $1`, [m.dm]));
    t.ok(before > 0, '원본에 공정이 있다');

    const n = Number(await t.val(`select copy_dmr_structure($1,$2)`, [m.dm, dst]));
    t.eq(n, before, '복사된 공정 수');

    t.eq(Number(await t.val(
      `select count(*)::int from dmr_bom b join dmr_operation o on o.id = b.operation_id
        where o.device_master_id = $1`, [dst])),
      Number(await t.val(
      `select count(*)::int from dmr_bom b join dmr_operation o on o.id = b.operation_id
        where o.device_master_id = $1`, [m.dm])), '자재 구성표도 함께');

    // 대조 확인은 오지 않는다. 복사가 확인을 대신하면 안 된다
    t.eq(await t.val(`select verified_at from device_master where id = $1`, [dst]),
         null, '대조 확인 미복사');

    // 이미 공정이 있으면 거부한다. 덮어쓰면 무엇이 지워졌는지 알 수 없다
    await t.rejects(() => t.rows(`select copy_dmr_structure($1,$2)`, [m.dm, dst]),
      { code: 'P0001', message: '이미 공정이 있습니다' });
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


{
  id: 'CT-01', expect: '확인',
  name: '재단 공정은 이름이 아니라 구조로 찾는다 (재단 이전 가운데 마지막)',
  async run(t) {
    const m = await master(t);
    await t.setActor(m.admin);

    const cut = await t.val(`select cut_operation_id($1)`, [m.dm]);
    t.ok(!!cut, '재단 공정을 찾았다');

    const row = await t.one(
      `select o.seq, o.after_cutting from dmr_operation o where o.id = $1`, [cut]);
    t.eq(row.after_cutting, false, '재단 자체는 재단 이전 공정이다');

    // 이 공정보다 뒤에 있는 재단 이전 공정이 없어야 한다
    t.eq(Number(await t.val(
      `select count(*)::int from dmr_operation
        where device_master_id = $1 and not after_cutting and seq > $2`, [m.dm, row.seq])),
      0, '재단 뒤에 오는 재단 이전 공정');
  },
},

{
  id: 'CT-02', expect: '예외',
  name: '재단 공정을 시작하지 않은 사람은 재단 결과를 적을 수 없다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });

    // 작업자로 들어가되 재단 공정 기록은 만들지 않는다
    await t.setActor(m.worker);
    await t.rejects(
      () => t.rows(`select cut_product_lot_field($1,$2,$3,$4,current_date)`,
        [wo.id, m.fin, 10, 1]),
      { code: 'P0001', message: '재단 공정을 시작한 뒤에' });
    await t.setActor(null);
  },
},

{
  id: 'CT-03', expect: '확인',
  name: '재단 공정을 시작한 사람은 그 자리에서 제조번호를 부여한다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });

    const cut = await t.val(`select cut_operation_id($1)`, [m.dm]);
    await t.setActor(m.worker);
    await t.rows(
      `insert into process_record (work_order_id, operation_id, day_no, work_date,
         worker_id, started_at)
       values ($1,$2,1,current_date,$3,now())`, [wo.id, cut, m.worker]);

    const lot = await t.val(
      `select cut_product_lot_field($1,$2,$3,$4,current_date)`, [wo.id, m.fin, 10, 2]);
    t.ok(!!lot, '제품 로트가 생겼다');

    const pl = await t.one(
      `select lot_no, qty_produced, qty_sample, qty_available, expiry_date
         from product_lot where id = $1`, [lot]);
    t.ok(!!pl.lot_no, '제조번호가 붙었다');
    t.eq(pl.qty_available, 8, '샘플을 뺀 출하 가능 수량');
    t.ok(!!pl.expiry_date, '유효기한이 그 자리에서 고정된다');
  },
},

{
  id: 'RV-08', expect: '확인',
  name: '표시 문구는 공정을 코드가 아니라 이름으로 부른다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    const op = m.ops['WS-DX2401-03'];

    // 시작이 종료보다 늦은 기록 하나
    await t.rows(
      `insert into process_record (work_order_id, operation_id, day_no, work_date,
         worker_id, started_at, ended_at)
       values ($1,$2,1,current_date,$3,
               current_date + interval '9 hours', current_date + interval '8 hours')`,
      [wo.id, op, m.worker]);

    const rows = await flags(t, wo);
    const hit = rows.find((r) => r.kind === '시각 모순');
    if (!hit) throw new Error('시각 역전을 잡지 못했다');

    const name = await t.val(`select name from dmr_operation where id = $1`, [op]);
    if (!hit.detail.includes(name)) {
      throw new Error(`공정 이름 "${name}" 이 없다: ${hit.detail}`);
    }
  },
},


{
  id: 'SP-01', expect: '확인',
  name: '시료 수는 생산 수량 구간이 정한다 (장입 구간과 같은 모양)',
  async run(t) {
    const m = await master(t);
    await t.setActor(m.admin);

    /*
     * 표준서를 따로 세운다. 공용 표준서에 구간을 덮어쓰면 이 시험이 다른
     * 시험의 자료를 바꾸고, 이 시스템에는 삭제가 없어 되돌릴 수도 없다.
     */
    const item = await t.val(
      `insert into item (code,name,type,purchase_uom,usage_uom)
       values ('ZZ-SP-TIER','시료 구간 시험','FIN','EA','EA') returning id`);
    const dm = await t.val(
      `insert into device_master (item_id,revision,status,effective_from)
       values ($1,'Rev.01','ACTIVE',current_date) returning id`, [item]);

    for (const [lo, hi, n] of [[1, 50, 3], [51, 150, 5], [151, null, 8]]) {
      await t.rows(
        `insert into sample_plan (device_master_id, min_qty, max_qty, sample_qty, registered_by)
         values ($1,$2,$3,$4,$5)`, [dm, lo, hi, n, m.admin]);
    }

    t.eq(await t.val(`select required_sample($1,$2)`, [dm, 1]),   3, '1개');
    t.eq(await t.val(`select required_sample($1,$2)`, [dm, 50]),  3, '50개');
    t.eq(await t.val(`select required_sample($1,$2)`, [dm, 51]),  5, '51개');
    t.eq(await t.val(`select required_sample($1,$2)`, [dm, 150]), 5, '150개');
    t.eq(await t.val(`select required_sample($1,$2)`, [dm, 151]), 8, '151개');
    t.eq(await t.val(`select required_sample($1,$2)`, [dm, 900]), 8, '상한 없는 구간');
  },
},

{
  id: 'SP-02', expect: '확인',
  name: '구간이 없으면 안내하지 않는다 (임의로 정하지 않는다)',
  async run(t) {
    const m = await master(t);
    await t.setActor(m.admin);

    const item = await t.val(
      `insert into item (code,name,type,purchase_uom,usage_uom)
       values ('ZZ-SP-NONE','구간 없는 제품','FIN','EA','EA') returning id`);
    const dm = await t.val(
      `insert into device_master (item_id,revision,status,effective_from)
       values ($1,'Rev.01','ACTIVE',current_date) returning id`, [item]);

    t.eq(await t.val(`select required_sample($1,$2)`, [dm, 40]), null,
         '구간 미등록이면 null');
  },
},

{
  id: 'SP-03', expect: '권한 거부',
  name: 'app_role의 sample_plan DELETE',
  async run(t) {
    await t.asRole('app_role', () =>
      t.rejects(() => t.rows(`delete from sample_plan`), { code: '42501' }));
  },
},


{
  id: 'AM-01', expect: '확인',
  name: '투입 수량을 정정하면 재고가 차액만큼 돌아온다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    const lot = await newMaterialLot(t, m, m.reagent, { qty: 10 });

    await t.setActor(m.worker);
    const pr = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date,
         worker_id, started_at)
       values ($1,$2,1,current_date,$3,now()) returning id`,
      [wo.id, m.ops['WS-DX2401-03'], m.worker]);
    const mi = await t.val(
      `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
       values ($1,$2,4,$3) returning id`, [pr, lot, m.worker]);

    t.eq(Number(await t.val(
      `select qty_available from material_lot where id = $1`, [lot])), 6, '불출 뒤 잔여');

    await t.rows(`select amend_material_issue($1,$2,$3)`, [mi, 1.5, '계량값을 잘못 읽음']);

    t.eq(Number(await t.val(
      `select qty_available from material_lot where id = $1`, [lot])), 8.5, '정정 뒤 잔여');
    t.eq(Number(await t.val(`select qty from material_issue where id = $1`, [mi])), 1.5, '투입 수량');
    t.eq(await t.val(`select amend_reason from material_issue where id = $1`, [mi]),
         '계량값을 잘못 읽음', '정정 사유');

    // 원래 값이 감사추적에 남는다. 지우지 않고 덧적는다 (§1)
    t.ok(Number(await t.val(
      `select count(*)::int from audit_log
        where table_name = 'material_issue' and record_id = $1 and action = 'UPDATE'`, [mi])) > 0,
      '변경 이력');
    await t.setActor(null);
  },
},

{
  id: 'AM-02', expect: '예외',
  name: '남이 적은 투입은 정정할 수 없다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    const lot = await newMaterialLot(t, m, m.reagent, { qty: 10 });

    const pr = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date,
         worker_id, started_at)
       values ($1,$2,1,current_date,$3,now()) returning id`,
      [wo.id, m.ops['WS-DX2401-03'], m.worker]);
    const mi = await t.val(
      `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
       values ($1,$2,4,$3) returning id`, [pr, lot, m.worker]);

    const other = await t.newUser();
    await t.setActor(other);
    await t.rejects(
      () => t.rows(`select amend_material_issue($1,$2,$3)`, [mi, 1, '계량값을 잘못 읽음']),
      { code: 'P0001', message: '자기가 적은 투입만' });
    await t.setActor(null);
  },
},

{
  id: 'AM-03', expect: '예외',
  name: '수량을 0 으로 만들어 없앤 셈 칠 수 없다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    const lot = await newMaterialLot(t, m, m.reagent, { qty: 10 });

    await t.setActor(m.worker);
    const pr = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date,
         worker_id, started_at)
       values ($1,$2,1,current_date,$3,now()) returning id`,
      [wo.id, m.ops['WS-DX2401-03'], m.worker]);
    const mi = await t.val(
      `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
       values ($1,$2,4,$3) returning id`, [pr, lot, m.worker]);

    await t.rejects(
      () => t.rows(`select amend_material_issue($1,$2,$3)`, [mi, 0, '중복 기입']),
      { code: 'P0001', message: '반납으로 기록' });
    await t.setActor(null);
  },
},

{
  id: 'AM-04', expect: '확인',
  name: '반납하면 투입 줄은 남고 재고만 돌아온다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    const lot = await newMaterialLot(t, m, m.reagent, { qty: 10 });

    await t.setActor(m.worker);
    const pr = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date,
         worker_id, started_at)
       values ($1,$2,1,current_date,$3,now()) returning id`,
      [wo.id, m.ops['WS-DX2401-03'], m.worker]);
    const mi = await t.val(
      `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
       values ($1,$2,3,$3) returning id`, [pr, lot, m.worker]);

    await t.rows(`select return_material_issue($1,$2,$3)`, [mi, 3, '중복 기입']);

    t.eq(Number(await t.val(
      `select qty_available from material_lot where id = $1`, [lot])), 10, '반납 뒤 잔여');
    // 줄은 그대로 있다. 지우지 않는다
    t.eq(Number(await t.val(`select qty from material_issue where id = $1`, [mi])), 3, '투입 줄');
    t.eq(Number(await t.val(
      `select count(*)::int from stock_movement
        where material_lot_id = $1 and type = 'RETURN'`, [lot])), 1, '반납 기록');
    await t.setActor(null);
  },
},


{
  id: 'SN-01', expect: '확인',
  name: '출고 순번은 시료 다음 번호부터 시작한다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    await t.setActor(m.admin);
    const lot = await t.val(
      `select cut_product_lot($1,$2,$3,$4,current_date)`, [wo.id, m.fin, 40, 2]);

    t.eq(await t.val(`select next_unit_seq($1)`, [lot]), 3, '시료 2개 다음');

    await t.rows(
      `insert into shipment (product_lot_id, customer_name, qty, shipped_at, shipped_by,
                             release_request_no, unit_from, unit_to)
       values ($1,'A병원',10,current_date,$2,'RR-1',3,12)`, [lot, m.admin]);

    t.eq(await t.val(`select next_unit_seq($1)`, [lot]), 13, '나간 범위 다음');
    await t.setActor(null);
  },
},

{
  id: 'SN-02', expect: '예외',
  name: '같은 개체를 두 곳으로 내보낼 수 없다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    await t.setActor(m.admin);
    const lot = await t.val(
      `select cut_product_lot($1,$2,$3,$4,current_date)`, [wo.id, m.fin, 40, 2]);

    await t.rows(
      `insert into shipment (product_lot_id, customer_name, qty, shipped_at, shipped_by,
                             release_request_no, unit_from, unit_to)
       values ($1,'A병원',10,current_date,$2,'RR-1',3,12)`, [lot, m.admin]);

    await t.rejects(
      () => t.rows(
        `insert into shipment (product_lot_id, customer_name, qty, shipped_at, shipped_by,
                               release_request_no, unit_from, unit_to)
         values ($1,'B병원',5,current_date,$2,'RR-2',10,14)`, [lot, m.admin]),
      { code: 'P0001', message: '겹칩니다' });
    await t.setActor(null);
  },
},

{
  id: 'SN-03', expect: '예외',
  name: '시료 번호는 출고할 수 없고, 로트 범위도 넘지 못한다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    await t.setActor(m.admin);
    const lot = await t.val(
      `select cut_product_lot($1,$2,$3,$4,current_date)`, [wo.id, m.fin, 40, 2]);

    await t.rejects(
      () => t.rows(
        `insert into shipment (product_lot_id, customer_name, qty, shipped_at, shipped_by,
                               release_request_no, unit_from, unit_to)
         values ($1,'A병원',2,current_date,$2,'RR-1',1,2)`, [lot, m.admin]),
      { code: 'P0001', message: '시료' });

    await t.rejects(
      () => t.rows(
        `insert into shipment (product_lot_id, customer_name, qty, shipped_at, shipped_by,
                               release_request_no, unit_from, unit_to)
         values ($1,'A병원',5,current_date,$2,'RR-1',38,42)`, [lot, m.admin]),
      { code: 'P0001', message: '개까지입니다' });
    await t.setActor(null);
  },
},

{
  id: 'SN-04', expect: '예외',
  name: '순번 범위와 출고 수량이 어긋나면 거부한다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    await t.setActor(m.admin);
    const lot = await t.val(
      `select cut_product_lot($1,$2,$3,$4,current_date)`, [wo.id, m.fin, 40, 2]);

    await t.rejects(
      () => t.rows(
        `insert into shipment (product_lot_id, customer_name, qty, shipped_at, shipped_by,
                               release_request_no, unit_from, unit_to)
         values ($1,'A병원',7,current_date,$2,'RR-1',3,12)`, [lot, m.admin]),
      { code: 'P0001', message: '출고 수량' });
    await t.setActor(null);
  },
},


{
  id: 'VW-01', expect: '권한 거부',
  name: 'app_readonly는 어떤 표에도 쓰지 못한다',
  async run(t) {
    for (const sql of [
      `insert into supplier (code, name) values ('ZZ-VW','시험')`,
      `update item set name = 'x' where true`,
      `insert into material_lot (item_id, lot_no, supplier_id, supplier_lot_no,
                                 coa_no, coa_date, received_at, registered_by,
                                 qty_received, qty_available)
       select id, 'ZZ', id, 'x', 'c', current_date, now(), id, 1, 1 from item limit 1`,
      `update work_order set sheet_count = 1 where true`,
    ]) {
      await t.asRole('app_readonly', () =>
        t.rejects(() => t.rows(sql), { code: '42501' }));
    }
  },
},

{
  id: 'VW-02', expect: '권한 거부',
  name: 'app_readonly는 채번도 인쇄 기록도 부르지 못한다',
  async run(t) {
    await t.asRole('app_readonly', () =>
      t.rejects(() => t.rows(`select next_number('WORK_ORDER')`), { code: '42501' }));
    await t.asRole('app_readonly', () =>
      t.rejects(() => t.rows(`select complete_process(gen_random_uuid())`), { code: '42501' }));
  },
},

{
  id: 'VW-03', expect: '확인',
  name: 'app_readonly는 읽기는 된다',
  async run(t) {
    await t.asRole('app_readonly', async () => {
      const n = await t.val(`select count(*)::int from item`);
      t.ok(Number(n) >= 0, '품목을 읽는다');
      await t.rows(`select * from v_lot_genealogy limit 1`);
      await t.rows(`select * from audit_log limit 1`);
    });
  },
},

{
  id: 'VW-04', expect: '확인',
  name: '열람자 역할이 등록되어 있다',
  async run(t) {
    const has = await t.val(
      `select exists (select 1 from pg_enum e
                       join pg_type ty on ty.oid = e.enumtypid
                      where ty.typname = 'role_code' and e.enumlabel = 'VIEWER')`);
    t.eq(has, true, 'VIEWER');

    await t.setActor(t.fx?.admin ?? null);
    const u = await t.newUser();
    await t.rows(`insert into user_role (user_id, role) values ($1,'VIEWER')`, [u]);
    t.eq(Number(await t.val(
      `select count(*)::int from user_role where user_id = $1 and role = 'VIEWER'`, [u])), 1,
      '역할 부여');
    await t.setActor(null);
  },
},


{
  id: 'BD-01', expect: '확인',
  name: '개체 번호로 시료 · 출고 · 없는 번호를 가른다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    await t.setActor(m.admin);
    const lot = await t.val(
      `select cut_product_lot($1,$2,$3,$4,current_date)`, [wo.id, m.fin, 40, 2]);
    const lotNo = await t.val(`select lot_no from product_lot where id = $1`, [lot]);

    await t.rows(
      `insert into shipment (product_lot_id, customer_name, qty, shipped_at, shipped_by,
                             release_request_no, unit_from, unit_to)
       values ($1,'A병원',10,current_date,$2,'RR-1',3,12)`, [lot, m.admin]);

    const at = async (n) => (await t.rows(
      `select standing, customer_name from find_unit($1)`, [`${lotNo}-${n}`]))[0];

    t.eq((await at('001')).standing, '완제품검사 시료', '1번');
    t.eq((await at('005')).standing, '출고됨', '5번');
    t.eq((await at('005')).customer_name, 'A병원', '간 곳');
    t.eq((await at('020')).standing, '재고', '20번');
    t.eq((await at('900')).standing, '이 제조번호에 없는 번호', '900번');

    // 제조번호만 적어도 찾는다
    const whole = (await t.rows(`select standing from find_unit($1)`, [lotNo]))[0];
    t.eq(whole.standing, '제조번호 전체', '순번 없이');

    // 없는 제조번호는 빈 결과
    t.eq((await t.rows(`select * from find_unit('ZZ-NONE-001')`)).length, 0, '없는 번호');
    await t.setActor(null);
  },
},

{
  id: 'BD-02', expect: '확인',
  name: '달별 생산 · 출고 · 재작업이 한 줄에 모인다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    await t.setActor(m.admin);
    await t.val(`select cut_product_lot($1,$2,$3,$4,current_date)`, [wo.id, m.fin, 40, 2]);

    const row = (await t.rows(
      `select produced, sampled from v_output_monthly
        where month = date_trunc('month', current_date)::date`))[0];
    t.ok(Number(row.produced) >= 40, '생산');
    t.ok(Number(row.sampled) >= 2, '시료');
    await t.setActor(null);
  },
},


{
  id: 'NC-01', expect: '확인',
  name: '발생 = 재작업 + 특채 + 불량. 살아난 만큼 불량이 줄어든다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    await t.setActor(m.admin);
    const lot = await t.val(
      `select cut_product_lot($1,$2,$3,$4,current_date)`, [wo.id, m.fin, 100, 2]);

    const nc = (qty, outcome, extra = '') => t.rows(
      `insert into product_nonconformity
         (product_lot_id, qty, outcome, reason_code, registered_by ${extra ? ', approved_by, approved_on' : ''})
       values ($1,$2,$3::nc_outcome,'외관 불량',$4 ${extra ? ", '정품질', current_date" : ''})`,
      [lot, qty, outcome, m.admin]);

    await nc(6, 'REWORK');
    await nc(3, 'CONCESSION', 'y');
    await nc(2, 'SCRAP');

    const q = (await t.rows(
      `select rework, concession, scrap from v_lot_quality where product_lot_id = $1`, [lot]))[0];
    t.eq(Number(q.rework), 6, '재작업');
    t.eq(Number(q.concession), 3, '특채');
    t.eq(Number(q.scrap), 2, '불량');

    // 불량만 출하 가능 수량을 깎는다. 재작업과 특채는 제품으로 나간다
    t.eq(Number(await t.val(
      `select qty_available from product_lot where id = $1`, [lot])), 96, '출하 가능');
    await t.setActor(null);
  },
},

{
  id: 'NC-02', expect: '예외',
  name: '특채는 서면 승인자 없이 기록되지 않는다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    await t.setActor(m.admin);
    const lot = await t.val(
      `select cut_product_lot($1,$2,$3,$4,current_date)`, [wo.id, m.fin, 40, 2]);

    await t.rejects(
      () => t.rows(
        `insert into product_nonconformity
           (product_lot_id, qty, outcome, reason_code, registered_by)
         values ($1,5,'CONCESSION','외관 불량',$2)`, [lot, m.admin]),
      { code: '23514' });
    await t.setActor(null);
  },
},

{
  id: 'NC-03', expect: '예외',
  name: '있는 수량보다 많이 불량으로 적을 수 없다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    await t.setActor(m.admin);
    const lot = await t.val(
      `select cut_product_lot($1,$2,$3,$4,current_date)`, [wo.id, m.fin, 10, 2]);

    await t.rejects(
      () => t.rows(
        `insert into product_nonconformity
           (product_lot_id, qty, outcome, reason_code, registered_by)
         values ($1,20,'SCRAP','외관 불량',$2)`, [lot, m.admin]),
      { code: 'P0001', message: '많이 폐기할 수 없습니다' });
    await t.setActor(null);
  },
},

{
  id: 'NC-04', expect: '권한 거부',
  name: '부적합 기록도 지워지지 않는다',
  async run(t) {
    await t.asRole('app_role', () =>
      t.rejects(() => t.rows(`delete from product_nonconformity`), { code: '42501' }));
  },
},

];
