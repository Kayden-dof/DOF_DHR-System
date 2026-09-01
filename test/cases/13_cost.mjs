// =============================================================================
// 13_cost.mjs · 공수와 설비 원가 (사용자 요청 2026-09-01 · 0076)
//
// 원가는 판정에 관여하지 않는다. 적합 · 부적합을 가르지 않고 작업을 막지 않고
// 종이에 찍히지도 않는다 (§1 의 경계 밖). 그래도 셈이 틀리면 경영 판단이
// 틀리므로 확인한다.
//
// ── 여기서 보는 것 ────────────────────────────────────────────────────────
//   · 시간당 감가상각비가 사양대로 나오는가
//   · 셋 중 하나라도 비면 값을 지어내지 않는가 (0 이 아니라 null)
//   · 공수 단가가 그 날짜 것으로 잡히는가
//   · 공수 단가를 고쳐 쓰거나 지울 수 없는가
//   · 시각이 비어 있는 기록을 조용히 빼지 않고 세는가
// =============================================================================

import { masterData as master, newWorkOrder } from '../fixtures.mjs';

/**
 * 기록 한 줄. 시각을 주면 그 시간만큼 일한 것이 된다.
 *
 * 날짜는 DB 에서 받아 온다. 지어 쓰면 발행일보다 앞선 작업일이 되어 구조
 * 불변식에 걸린다 (0052) - 그 규칙이 맞고, 시험이 맞춰야 한다.
 */
async function record(t, m, wo, { op, worker, day, hours, equip }) {
  const today = await t.val(`select (timezone('Asia/Seoul', now()))::date::text`);
  const start = `${today} 09:00:00+09`;
  const end = hours == null ? null
    : `${today} ${String(9 + hours).padStart(2, '0')}:00:00+09`;
  return t.val(
    `insert into process_record
       (work_order_id, operation_id, day_no, work_date, worker_id,
        equipment_id, started_at, ended_at)
     values ($1,$2,$3,$8::date,$4,$5,$6::timestamptz,$7::timestamptz)
     returning id`,
    [wo, op, day, worker, equip ?? null, start, end, today]);
}

export default [

{
  id: 'LC-01', expect: '확인',
  name: '시간당 감가상각비는 취득원가 · 내용연수 · 가동시간에서 나온다',
  async run(t) {
    await master(t);
    await t.rows(
      `insert into equipment (code, name, purchase_price, useful_life_months,
                              salvage_value, monthly_hours)
       values ('LC-EQ-1', '시험 설비', 12000000, 60, 0, 160)`);

    /* 12,000,000 / 60개월 / 160시간 = 1,250 */
    t.eq(Number(await t.val(`select equipment_hourly_cost('LC-EQ-1')`)), 1250,
         '취득원가 ÷ 내용연수 ÷ 기준 가동시간');

    /* 잔존가치는 빼고 나눈다 */
    await t.rows(`update equipment set salvage_value = 2400000 where code = 'LC-EQ-1'`);
    t.eq(Number(await t.val(`select equipment_hourly_cost('LC-EQ-1')`)), 1000,
         '잔존가치를 뺀 값으로 나눈다');
  },
},

{
  id: 'LC-02', expect: '확인',
  name: '상각 정보가 비면 0 이 아니라 모른다로 둔다',
  async run(t) {
    await master(t);
    await t.rows(
      `insert into equipment (code, name, purchase_price, useful_life_months, monthly_hours)
       values ('LC-EQ-2', '값이 빈 설비', 12000000, 60, null)`);

    /*
     * 0 은 "공짜" 라는 뜻이고 null 은 "아직 모른다" 다. 0 으로 채우면 그 설비를
     * 쓴 배치의 원가가 조용히 적게 나오고, 화면은 그것을 알릴 방법이 없다.
     */
    t.eq(await t.val(`select equipment_hourly_cost('LC-EQ-2')`), null,
         '가동시간이 비면 값이 없다');
    t.eq(await t.val(`select equipment_hourly_cost('없는-설비')`), null,
         '없는 설비는 값이 없다');
  },
},

{
  id: 'LC-03', expect: '확인',
  name: '공수 단가는 그 날짜에 적용되는 것을 쓴다',
  async run(t) {
    const m = await master(t);
    const ins = (rate, from) => t.rows(
      `insert into labour_rate (role, hourly_rate, effective_from, registered_by)
       values ('WORKER', $1, $2::date, $3)`, [rate, from, m.admin]);

    await ins(20000, '2026-01-01');
    await ins(25000, '2026-07-01');

    t.eq(Number(await t.val(`select labour_rate_at('WORKER','2026-06-30')`)), 20000,
         '적용일 전에는 옛 단가');
    t.eq(Number(await t.val(`select labour_rate_at('WORKER','2026-07-01')`)), 25000,
         '적용일부터 새 단가');
    t.eq(await t.val(`select labour_rate_at('WORKER','2025-12-31')`), null,
         '첫 적용일 전에는 단가가 없다');

    /* 잘못 넣었으면 바로잡는 줄을 하나 더 넣는다. 같은 날짜면 나중 것이 이긴다 */
    await ins(26000, '2026-07-01');
    t.eq(Number(await t.val(`select labour_rate_at('WORKER','2026-07-01')`)), 26000,
         '같은 날짜면 나중에 넣은 줄이 이긴다');
    t.eq(Number(await t.val(`select count(*)::int from labour_rate where role='WORKER'`)), 3,
         '고친 줄도 그대로 남는다');
  },
},

{
  id: 'LC-04', expect: '권한 거부',
  name: '공수 단가는 고쳐 쓰거나 지울 수 없다',
  async run(t) {
    const m = await master(t);
    await t.rows(
      `insert into labour_rate (role, hourly_rate, effective_from, registered_by)
       values ('WORKER', 20000, '2026-01-01', $1)`, [m.admin]);

    /*
     * §4.10 의 채번 규칙과 같은 규율이다. 응용에서 막는 것이 아니라 그쪽으로는
     * 길이 없다 - 화면을 고쳐도 뚫리지 않는다.
     */
    await t.asRole('app_role', async () => {
      await t.rejects(() => t.rows(`update labour_rate set hourly_rate = 1`),
                      { code: '42501' });
      await t.rejects(() => t.rows(`delete from labour_rate`), { code: '42501' });
    });
  },
},

{
  id: 'LC-05', expect: '확인',
  name: '시각이 비어 있는 기록을 조용히 빼지 않고 센다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);

    /*
     * 단가는 역할에 매긴다. 역할이 없는 계정이 한 기록은 공수가 0 이고,
     * v_batch_cost 의 no_rate_records 가 그것을 센다 - 화면이 그 수를 적는다.
     */
    await t.rows(`insert into user_role (user_id, role) values ($1, 'WORKER')
                  on conflict do nothing`, [m.worker]);
    /*
     * 적용일을 오늘로 둔다. 시험끼리 자료가 섞이므로(한 DB 를 이어 쓴다) 앞선
     * 시험이 넣은 단가가 더 나중 적용일이면 그것이 이긴다 - 실제로 그렇게 걸렸다.
     */
    await t.rows(
      `insert into labour_rate (role, hourly_rate, effective_from, registered_by)
       values ('WORKER', 30000, (timezone('Asia/Seoul', now()))::date, $1)`, [m.admin]);
    await t.rows(
      `insert into equipment (code, name, purchase_price, useful_life_months,
                              salvage_value, monthly_hours)
       values ('LC-EQ-3', '시험 설비', 9600000, 60, 0, 160)`);   /* 시간당 1,000 */

    await record(t, m, wo.id, { op: m.ops['WS-DX2401-01'], worker: m.worker, day: 1,
                                hours: 2, equip: 'LC-EQ-3' });
    await record(t, m, wo.id, { op: m.ops['WS-DX2401-02'], worker: m.worker, day: 2,
                                hours: null, equip: 'LC-EQ-3' });

    const [b] = await t.rows(
      `select pre_cut_labour, pre_cut_equip, untimed_records
         from v_batch_cost where work_order_id = $1`, [wo.id]);

    t.eq(Number(b.pre_cut_labour), 60000, '2시간 × 30,000');
    t.eq(Number(b.pre_cut_equip), 2000,   '2시간 × 1,000');
    t.eq(b.untimed_records, 1, '시각이 빈 기록을 센다');
  },
},

{
  id: 'LC-06', expect: '확인',
  name: '상각 정보가 없는 설비는 배치를 가로질러 겹쳐 세지 않는다',
  async run(t) {
    const m = await master(t);

    /*
     * v_batch_cost 의 no_equip_cost 는 "그 배치에서" 상각 정보가 없는 설비
     * 수다. 배치 안에서는 맞지만 배치를 가로질러 더하면 여러 배치에 쓴 설비가
     * 겹쳐 세어진다 - 실제로 설비 여섯 대가 여덟 대로 나왔다 (2026-09-01).
     *
     * 화면은 더하지 않고 한 번에 센다. 여기서 그 셈이 배치 수에 딸려 늘지
     * 않는지 확인한다.
     */
    await t.rows(
      `insert into equipment (code, name) values ('LC-EQ-X', '상각 정보 없는 설비')`);

    const today = await t.val(`select (timezone('Asia/Seoul', now()))::date::text`);
    for (const op of ['WS-DX2401-01', 'WS-DX2401-02']) {
      const wo = await newWorkOrder(t, m);
      await t.rows(
        `insert into process_record
           (work_order_id, operation_id, day_no, work_date, worker_id, equipment_id,
            started_at, ended_at)
         values ($1,$2,1,$3::date,$4,'LC-EQ-X',
                 ($3 || ' 09:00:00+09')::timestamptz, ($3 || ' 10:00:00+09')::timestamptz)`,
        [wo.id, m.ops[op], today, m.worker]);
    }

    /* 배치 둘이 같은 설비 하나를 썼다. 더하면 둘, 한 번에 세면 하나다 */
    const summed = Number(await t.val(
      `select sum(no_equip_cost)::int from v_batch_cost`));
    const counted = Number(await t.val(
      `select count(distinct equipment_id)::int from v_process_cost
        where equipment_id is not null and equip_rate is null`));

    t.ok(summed > counted, `더한 값(${summed})이 실제 대수(${counted})보다 커야 이 시험이 뜻을 갖는다`);
    t.eq(counted >= 1, true, '한 번에 세면 설비 수가 나온다');
  },
},

];
