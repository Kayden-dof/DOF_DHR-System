// =============================================================================
// 29_solution_br_entry.mjs - PBS 제조기록서를 원액 로트에 적는다 (0145)
// 근거: 사용자 2026-11-20 «PBS 제조기록서는 어디에 써야 할까..» → «원액 제조 때 (권고)»
//
// 원액 로트에만 적히는지, 누가 · 언제를 DB 가 정하는지, 지워지지 않는지, 칸 자리를 바꿀 수
// 없는지 본다. 시연 자료 비우기가 이 표를 아는지는 08_purge 가 본다.
// =============================================================================

import { masterData as master, newMaterialLot } from '../fixtures.mjs';
import { solutionItem } from './16_solution.mjs';

async function asUser(t, userId, fn) {
  await t.rows(`select set_config('app.user_id', $1, false)`, [userId ?? '']);
  try {
    return await t.asRole('app_role', fn);
  } finally {
    await t.rows(`select set_config('app.user_id', '', false)`);
  }
}

/* 원액 로트 하나 (make_solution_lot · 시약 두 로트에서 3 · 2) 와 양식 하나 */
async function setup(t, m) {
  const item = await solutionItem(t);
  const a = await newMaterialLot(t, m, m.reagent, { qty: 10 });
  const b = await newMaterialLot(t, m, m.reagent2, { qty: 10 });
  await t.setActor(m.admin);
  const lot = await t.val(
    `select make_solution_lot($1, '2026-11-05'::date, 5, array[$2,$3]::uuid[], array[3,2]::numeric[], null)`,
    [item, a, b]);
  const doc = await t.val(
    `insert into mfg_doc (product_code, op_code, kind, doc_no, title, revision, registered_by)
     values ('DX2401', 'WS-DX2401-03', 'BR', $1, '알칼리 처리 별첨(시험 원액 제조) 제조기록서', 'Rev.00', $2)
     returning id`, [`F706-T${Date.now() % 100000}-03-01`, m.admin]);
  await t.setActor(null);
  return { lot, doc, raw: a };
}

const put = (t, actor, lot, doc, field, value) => asUser(t, actor, () => t.rows(
  `insert into solution_br_entry (material_lot_id, doc_id, field, value, entered_by)
   values ($1, $2, $3, $4, $5)
   on conflict (material_lot_id, doc_id, field) do update set value = excluded.value`,
  [lot, doc, field, value, actor]));

export default [

{
  id: 'SB-01', expect: '통과',
  name: '원액 로트에 PBS 제조기록서 칸을 적는다 · 누가 · 언제는 DB 가 · 감사추적',
  async run(t) {
    const m = await master(t);
    const { lot, doc } = await setup(t, m);
    await put(t, m.admin, lot, doc, 'p0t2r5c3', '5');
    const r = await t.rows(
      `select value, entered_by::text as by from solution_br_entry where material_lot_id = $1 and field = 'p0t2r5c3'`,
      [lot]);
    t.eq(r[0], { value: '5', by: m.admin }, '적은 값 · 적은 사람');
    await put(t, m.admin, lot, doc, 'p0t2r5c3', '5.1');
    t.eq(await t.val(`select value from solution_br_entry where material_lot_id = $1 and field = 'p0t2r5c3'`, [lot]),
      '5.1', '고친 값');
    t.ok(await t.val(
      `select exists (select 1 from audit_log where table_name = 'solution_br_entry' and action = 'UPDATE')`),
      '감사추적');
  },
},

{
  id: 'SB-02', expect: '거부',
  name: '원액이 아닌 로트에는 적지 못한다 · 지우지 못한다 · 칸 자리를 바꾸지 못한다',
  async run(t) {
    const m = await master(t);
    const { lot, doc, raw } = await setup(t, m);
    await t.rejects(() => put(t, m.admin, raw, doc, 'p0t2r5c3', '5'), { message: '원액 로트에만' });
    await put(t, m.admin, lot, doc, 'p0t2r6c3', '300');
    await t.rejects(() => asUser(t, m.admin, () => t.rows(
      `delete from solution_br_entry where material_lot_id = $1`, [lot])), {});
    await t.rejects(() => asUser(t, m.admin, () => t.rows(
      `update solution_br_entry set field = 'p0t2r7c3' where material_lot_id = $1 and field = 'p0t2r6c3'`, [lot])),
      { message: '자리는 바꿀 수 없습니다' });
  },
},

];
