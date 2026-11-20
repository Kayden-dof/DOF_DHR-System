// =============================================================================
// 36_flag_returns.mjs - 구간 이탈은 반납을 뺀 양으로 본다 (0154)
// 근거: 사용자 2026-11-20 B261104-01 염화나트륨 292.2 g · 293 g 중 292.2 g 반납 → 기록서는 293 g 인데
//       확인해 볼 항목은 «585 g 기입» 으로 짚었다.
// =============================================================================

import { masterData as master, newMaterialLot, newWorkOrder } from '../fixtures.mjs';

const flags = (t, wo) => t.rows(`select kind, detail from review_flags($1)`, [wo.id]);

export default [

{
  id: 'FR-01', expect: '통과',
  name: '정량을 두 번 넣으면 구간 이탈, 한 줄을 전량 반납하면 사라진다',
  async run(t) {
    const m = await master(t);
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
    await t.setActor(m.admin);
    const op = m.ops['WS-DX2401-03'];
    const lot = await newMaterialLot(t, m, m.reagent, { qty: 20 });
    const need = await t.val(`select required_qty($1,$2,20,0)`, [op, m.reagent]);
    const pr = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id, started_at, ended_at)
       values ($1,$2,1,current_date,$3, current_date + interval '8 hours', current_date + interval '9 hours')
       returning id`, [wo.id, op, m.worker]);
    const issue = () => t.val(
      `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
       values ($1,$2,$3,$4) returning id`, [pr, lot, need, m.admin]);
    await issue();
    const second = await issue();
    t.ok((await flags(t, wo)).some((r) => r.kind === '구간 이탈'), '두 번 넣으면 구간 이탈');

    /* 반납은 그 투입을 적은 사람이 한다 */
    await t.setActor(null);
    await t.rows(`update material_issue set issued_by = $2 where id = $1`, [second, m.worker]);
    await t.setActor(m.worker);
    await t.rows(`select return_material_issue($1, $2, '두 번 기록함')`, [second, need]);
    const after = await flags(t, wo);
    t.eq(after.filter((r) => r.kind === '구간 이탈').length, 0,
      `반납을 빼면 정량 (${after.map((r) => r.detail).join(' / ')})`);
    await t.setActor(null);
  },
},

];
