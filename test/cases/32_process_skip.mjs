// =============================================================================
// 32_process_skip.mjs - 제품 로트의 재단 이후 공정 건너뛰기 (0149)
// 근거: 사용자 2026-11-20 «멸균 선량 샘플같은건 멸균을 따로 안하니까 멸균 제조기록은 스킵
//       가능하도록 기능 부여해줘»
//
// 건너뛰면 그 (공정, 로트)에 기록을 시작하지 못하고, 취소하면 다시 기록할 수 있는지,
// 건너뛸 수 없는 것(재단 전 공정 · 남의 로트 · 이미 기록한 로트 · 사유 없음 · 두 번)은
// 막는지, 지우지 못하는지 본다.
// =============================================================================

import { masterData as master, newWorkOrder } from '../fixtures.mjs';

async function asUser(t, userId, fn) {
  await t.rows(`select set_config('app.user_id', $1, false)`, [userId ?? '']);
  try {
    return await t.asRole('app_role', fn);
  } finally {
    await t.rows(`select set_config('app.user_id', '', false)`);
  }
}

async function prep(t) {
  const m = await master(t);
  const wo = await newWorkOrder(t, m);
  await t.setActor(m.admin);
  const lot = await t.val(`select cut_product_lot($1,$2,10,0)`, [wo.id, m.fin]);
  await t.setActor(null);
  /* 작업자 역할을 직접 준다 - 앞 시험이 준 역할에 기대지 않는다 */
  await t.rows(`insert into user_role (user_id, role) select $1, 'WORKER'
                 where not exists (select 1 from user_role where user_id = $1 and role = 'WORKER')`, [m.worker]);
  return { m, wo, lot, steril: m.ops['WS-DX2401-09'] };
}

const skip = (t, m, wo, op, lot, why = '멸균 선량 샘플') => asUser(t, m.worker, () =>
  t.val(`select skip_operation($1, $2, $3, $4)`, [wo.id, op, lot, why]));

const start = (t, m, wo, op, lot) => asUser(t, m.worker, () => t.rows(
  `insert into process_record (work_order_id, product_lot_id, operation_id, day_no, work_date, worker_id)
   values ($1, $2, $3, 1, current_date, $4)`, [wo.id, lot, op, m.worker]));

export default [

{
  id: 'PS-01', expect: '통과',
  name: '멸균을 건너뛴 로트는 멸균 기록을 시작하지 못하고, 취소하면 기록한다',
  async run(t) {
    const { m, wo, lot, steril } = await prep(t);
    const id = await skip(t, m, wo, steril, lot);
    t.ok(id, '건너뛰기');
    await t.rejects(() => start(t, m, wo, steril, lot), { message: '건너뛰었습니다' });
    await asUser(t, m.worker, () => t.rows(`select unskip_operation($1, '잘못 건너뜀')`, [id]));
    t.ok(await t.val(`select cancelled_at is not null from process_skip where id = $1`, [id]), '취소가 남는다');
    await start(t, m, wo, steril, lot);
    t.eq(await t.val(
      `select count(*)::int from process_record where operation_id = $1 and product_lot_id = $2`,
      [steril, lot]), 1, '취소 뒤 기록');
  },
},

{
  id: 'PS-02', expect: '거부',
  name: '재단 전 공정 · 다른 배치 로트 · 이미 기록한 로트 · 사유 없음 · 두 번',
  async run(t) {
    const { m, wo, lot, steril } = await prep(t);
    await t.rejects(() => skip(t, m, wo, m.ops['WS-DX2401-05'], lot), { message: '재단 이후 공정이 아닙니다' });
    const other = await newWorkOrder(t, m);
    await t.rejects(() => skip(t, m, other, steril, lot), { message: '이 배치의 제품 로트가 아닙니다' });
    await t.rejects(() => skip(t, m, wo, steril, lot, '  '), { message: '왜 건너뛰는지' });
    const pack = m.ops['WS-DX2401-08'];
    await start(t, m, wo, pack, lot);
    await t.rejects(() => skip(t, m, wo, pack, lot), { message: '이미 기록했습니다' });
    await skip(t, m, wo, steril, lot);
    await t.rejects(() => skip(t, m, wo, steril, lot), { message: '이미 건너뛴' });
  },
},

{
  id: 'PS-03', expect: '거부',
  name: '건너뛰기는 지우지 못하고 응용 역할이 직접 쓰지 못한다',
  async run(t) {
    const { m, wo, lot, steril } = await prep(t);
    const id = await skip(t, m, wo, steril, lot);
    await t.rejects(() => t.rows(`delete from process_skip where id = $1`, [id]));
    await t.rejects(() => asUser(t, m.worker, () =>
      t.rows(`update process_skip set reason = 'x' where id = $1`, [id])));
  },
},

];
