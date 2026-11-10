// =============================================================================
// 20_br_entry.mjs - 현장에서 적는 제조기록서 칸 (0132)
// 근거: 사용자 2026-11-10 «제조기록서 상에 체크와 적어야 하는 부분들은 모두
//       생산자가 체크 하거나 기록 할수 있도록 작업기록지에 기능 구현해줄것»
//
// 칸은 그 공정 기록의 작업자(또는 관리자)만 적고, 적은 사람 · 시각은 DB 가
// 정하며, 일차가 잠기면(S04) 더 바뀌지 않고, 지울 수 없다.
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

let DOC = null;
async function doc(t, m) {
  return (DOC ??= t.val(
    `insert into mfg_doc (product_code, op_code, kind, doc_no, title, revision, registered_by, form)
     values ('BE-TEST', 'WS-DX2401-03', 'BR', 'F706-BE-03', '시험 기록서', 'Rev.00', $1,
             '{"page":{"w":842,"h":595},"pages":[{"texts":[],"tables":[]}]}'::jsonb)
     returning id`, [m.admin]));
}

async function record(t, m) {
  const wo = await newWorkOrder(t, m);
  await t.setActor(m.admin);
  const pr = await t.val(
    `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id,
       started_at)
     values ($1,$2,1,current_date,$3, now()) returning id`,
    [wo.id, m.ops['WS-DX2401-03'], m.worker]);
  await t.setActor(null);
  return { wo, pr };
}

const put = (t, pr, d, field, value, by) => t.rows(
  `insert into br_entry (process_record_id, doc_id, field, value, entered_by)
   values ($1,$2,$3,$4,$5)
   on conflict (process_record_id, doc_id, field) do update set value = excluded.value`,
  [pr, d, field, value, by]);

export default [

{
  id: 'BE-01', expect: '통과',
  name: '작업자가 자기 기록의 칸을 적고 고친다 (적은 사람은 DB 가 정한다)',
  async run(t) {
    const m = await master(t);
    const d = await doc(t, m);
    const { pr } = await record(t, m);
    await asUser(t, m.worker, async () => {
      await put(t, pr, d, 'p0t1r2c3', '확인', m.admin);        // 남의 이름을 보내도
      await put(t, pr, d, 'p0t1r2c3', '09:20~09:40', m.admin);
    });
    const row = await t.rows(`select value, entered_by::text as by from br_entry where process_record_id = $1`, [pr]);
    t.eq(row.length, 1, '칸 한 줄');
    t.eq(row[0].value, '09:20~09:40', '고친 값');
    t.eq(row[0].by, m.worker, '적은 사람 = 세션 사용자');
    t.ok(await t.val(`select count(*) >= 2 from audit_log where table_name = 'br_entry'`), '감사추적');
  },
},

{
  id: 'BE-02', expect: '거부',
  name: '다른 작업자의 기록에 적음',
  async run(t) {
    const m = await master(t);
    const d = await doc(t, m);
    const { pr } = await record(t, m);
    await asUser(t, m.worker2, () => t.rejects(() => put(t, pr, d, 'p0t1r2c3', '확인', m.worker2),
      { message: '다른 사람의' }));
  },
},

{
  id: 'BE-03', expect: '거부',
  name: '일차가 잠긴 뒤에 칸을 적거나 고침 (S04)',
  async run(t) {
    const m = await master(t);
    const d = await doc(t, m);
    const { wo, pr } = await record(t, m);
    await asUser(t, m.worker, () => put(t, pr, d, 'p0t1r2c3', '확인', m.worker));
    await t.setActor(m.admin);
    await t.rows(`update process_record set ended_at = now() where id = $1`, [pr]);
    await t.rows(`select lock_day($1,1,$2)`, [wo.id, m.worker]);
    await t.setActor(null);
    await asUser(t, m.worker, async () => {
      await t.rejects(() => put(t, pr, d, 'p0t1r2c3', '', m.worker), { message: 'S04' });
      await t.rejects(() => put(t, pr, d, 'p0t1r3c3', '45', m.worker), { message: 'S04' });
    });
  },
},

{
  id: 'BE-04', expect: '거부',
  name: '칸 자리가 양식 꼴이 아님 · 칸을 지움',
  async run(t) {
    const m = await master(t);
    const d = await doc(t, m);
    const { pr } = await record(t, m);
    await asUser(t, m.worker, async () => {
      await t.rejects(() => put(t, pr, d, 'anything', 'x', m.worker), { message: 'br_entry_field_check' });
      await put(t, pr, d, 'p0t0r0c0', 'x', m.worker);
      await t.rejects(() => t.rows(`delete from br_entry where process_record_id = $1`, [pr]),
        { code: '42501' });
    });
  },
},

];
