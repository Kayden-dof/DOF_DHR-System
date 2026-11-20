// =============================================================================
// 33_lot_delete.mjs - 쓰지 않은 제조번호 지우기 (0151)
// 근거: 사용자 2026-11-20 «잘못넣었으면 어떻게 삭제 하는데??» (B261104-01 GM-26111002 · 형명 칸에
//       다른 제품 DX2402 가 떠서 잘못 붙음)
//
// 아무 기록도 가리키지 않는 제조번호는 생산관리자가 사유와 함께 지우고 감사추적에 남는지,
// 기록이 있는 번호 · 사유 없음 · 권한 없음은 막는지 본다.
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

async function grant(t, user, role) {
  await t.rows(
    `insert into user_role (user_id, role) select $1, $2::role_code
      where not exists (select 1 from user_role where user_id = $1 and role = $2::role_code)`, [user, role]);
}

async function prep(t) {
  const m = await master(t);
  const wo = await newWorkOrder(t, m);
  await t.setActor(m.admin);
  const lot = await t.val(`select cut_product_lot($1,$2,10,0)`, [wo.id, m.fin]);
  await t.setActor(null);
  const mgr = await t.newUser({ full_name: '생산관리자갑' });
  await grant(t, mgr, 'PROD_MGR');
  return { m, wo, lot, mgr };
}

const del = (t, user, lot, why = '형명을 잘못 고름') => asUser(t, user, () =>
  t.val(`select delete_unused_product_lot($1, $2)`, [lot, why]));

export default [

{
  id: 'LD-01', expect: '통과',
  name: '아무 기록도 없는 제조번호는 생산관리자가 사유와 함께 지우고 감사추적에 남는다',
  async run(t) {
    const { lot, mgr } = await prep(t);
    t.eq(await t.val(`select product_lot_used($1)`, [lot]), false, '쓰지 않은 번호');
    const no = await del(t, mgr, lot);
    t.ok(no, '지운 번호를 돌려준다');
    t.eq(await t.val(`select count(*)::int from product_lot where id = $1`, [lot]), 0, '지워졌다');
    t.ok(await t.val(
      `select count(*) > 0 from audit_log where table_name = 'product_lot' and record_id = $1 and action = 'DELETE'`,
      [lot]), '감사추적');
  },
},

{
  id: 'LD-02', expect: '거부',
  name: '기록이 있는 번호 · 사유 없음 · 생산관리자 아님',
  async run(t) {
    const { m, wo, lot, mgr } = await prep(t);
    await t.rejects(() => del(t, mgr, lot, ' '), { message: '왜 지우는지' });
    await t.rejects(() => del(t, m.qa, lot), { message: '생산관리자 또는 시스템관리자' });
    await grant(t, m.worker, 'WORKER');
    await asUser(t, m.worker, () => t.rows(
      `insert into process_record (work_order_id, product_lot_id, operation_id, day_no, work_date, worker_id)
       values ($1, $2, $3, 1, current_date, $4)`, [wo.id, lot, m.ops['WS-DX2401-08'], m.worker]));
    t.eq(await t.val(`select product_lot_used($1)`, [lot]), true, '쓴 번호');
    await t.rejects(() => del(t, mgr, lot), { message: '남은 기록이 있어' });
  },
},

];
