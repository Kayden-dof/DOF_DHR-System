// =============================================================================
// 11_deviation.mjs · 일탈 대장 (2026-08-31)
// 근거: CLAUDE.md §9.1 "번호만 나가는 상태로 운영에 들어가지 않는다"
//       §1 시스템은 판정하지 않는다 · §2.1 적힌 사실은 고쳐 쓰지 않는다
//
// 대장이 지켜야 하는 것은 셋이다.
//   하나, 번호를 잃지 않는다 (채번을 지나고 겹치지 않는다)
//   둘,   서면 근거 없이 닫히지 않는다
//   셋,   닫힌 것은 되돌아가지 않는다
// =============================================================================

import { masterData as master } from '../fixtures.mjs';

const BLOCKED = { code: 'P0001' };
const CHECK   = { code: '23514' };   // check 제약 위반
const UNIQUE  = { code: '23505' };

/*
 * 일탈 채번 규칙을 시험이 스스로 세운다.
 *
 * 앞선 채번 시험이 품목 토큰이 든 DEVIATION 규칙을 활성인 채로 남겨 두는 일이
 * 있다. on conflict do nothing 으로 넣으면 그 규칙이 그대로 남아 품목을 요구한다.
 * 쓰던 규칙을 내리고 새 규칙을 올린다 - 기존 행을 고치지 않는다 (§4.10).
 */
async function withRule(t, m) {
  await t.setActor(m.admin);
  await t.rows(`update numbering_rule set is_active = false where target = 'DEVIATION'`);
  await t.rows(
    `insert into numbering_rule (target, pattern, reset, seq_width, effective_from, registered_by)
     values ('DEVIATION', 'DV-{YY}-{SEQ:3}', 'YEARLY', 3, current_date, $1)`, [m.admin]);
}

const openOne = (t, m) => t.rows(
  `insert into deviation (deviation_no, occurred_on, title, registered_by)
   values (next_number('DEVIATION'), current_date, '세척 시간이 표준보다 짧았다', $1)
   returning id, deviation_no`, [m.admin]);

export default [

{
  id: 'DV-01', expect: '통과',
  name: '일탈 번호는 채번 규칙을 지나 만들어진다',
  async run(t) {
    const m = await master(t);
    await withRule(t, m);

    const [a] = await openOne(t, m);
    const [b] = await openOne(t, m);

    if (!/^DV-\d{2}-\d{3}$/.test(a.deviation_no)) {
      throw new Error(`번호 형식이 규칙과 다릅니다 (${a.deviation_no})`);
    }
    if (a.deviation_no === b.deviation_no) {
      throw new Error('같은 번호가 두 번 나왔습니다');
    }
  },
},

{
  id: 'DV-02', expect: '예외',
  name: '같은 일탈 번호를 두 번 적을 수 없다',
  async run(t) {
    const m = await master(t);
    await withRule(t, m);
    const [a] = await openOne(t, m);

    await t.rejects(() => t.rows(
      `insert into deviation (deviation_no, occurred_on, title, registered_by)
       values ($1, current_date, '겹치는 번호', $2)`, [a.deviation_no, m.admin]),
      UNIQUE);
  },
},

{
  id: 'DV-03', expect: '예외',
  name: '서면 보고서 번호 없이 종결할 수 없다',
  async run(t) {
    const m = await master(t);
    await withRule(t, m);
    const [a] = await openOne(t, m);

    /*
     * 그 문서가 판정이고 대장은 그것을 가리킬 뿐이다 (§1). 가리킬 것이 없는
     * 종결은 대장에 적힐 이유가 없다.
     */
    await t.rejects(() => t.rows(
      `update deviation set closed_on = current_date where id = $1`, [a.id]), CHECK);

    await t.rejects(() => t.rows(
      `update deviation set closed_on = current_date, report_no = 'DR-001',
              outcome = '재세척 후 규격 내' where id = $1`, [a.id]), CHECK);
  },
},

{
  id: 'DV-04', expect: '통과',
  name: '서면 근거를 갖추면 종결된다',
  async run(t) {
    const m = await master(t);
    await withRule(t, m);
    const [a] = await openOne(t, m);

    await t.rows(
      `update deviation
          set report_no = 'DR-2026-001', outcome = '재세척 후 규격 내. 제품 영향 없음',
              approved_by = '정품질책임', approved_on = current_date,
              closed_on = current_date
        where id = $1`, [a.id]);

    const [v] = await t.rows(
      `select is_open, report_no from v_deviation where id = $1`, [a.id]);
    if (v.is_open !== false) throw new Error('종결이 반영되지 않았습니다');
    if (v.report_no !== 'DR-2026-001') throw new Error('보고서 번호가 다릅니다');
  },
},

{
  id: 'DV-05', expect: '예외',
  name: '종결은 되돌릴 수 없고 고쳐 쓸 수 없다',
  async run(t) {
    const m = await master(t);
    await withRule(t, m);
    const [a] = await openOne(t, m);

    await t.rows(
      `update deviation
          set report_no = 'DR-2026-002', outcome = '설비 교정 후 재가동',
              approved_by = '정품질책임', approved_on = current_date, closed_on = current_date
        where id = $1`, [a.id]);

    /* 되돌리기 */
    await t.rejects(() => t.rows(
      `update deviation set closed_on = null where id = $1`, [a.id]), BLOCKED);
    /* 고쳐 쓰기 */
    await t.rejects(() => t.rows(
      `update deviation set report_no = 'DR-2026-999' where id = $1`, [a.id]), BLOCKED);
    await t.rejects(() => t.rows(
      `update deviation set approved_by = '다른사람' where id = $1`, [a.id]), BLOCKED);
  },
},

{
  id: 'DV-06', expect: '통과',
  name: '경위와 관련 대상은 조사 중에 채울 수 있다',
  async run(t) {
    const m = await master(t);
    await withRule(t, m);
    const [a] = await openOne(t, m);

    /*
     * 조사하면서 밝혀지는 것이 있다. 이것까지 막으면 대장 밖의 종이에 적히고,
     * 그러면 대장이 대장 노릇을 못 한다.
     */
    await t.rows(
      `update deviation set detail = '유량계 눈금이 어긋나 있었다' where id = $1`, [a.id]);
  },
},

{
  id: 'DV-07', expect: '예외',
  name: '일탈 번호와 발생일은 고쳐 쓸 수 없다',
  async run(t) {
    const m = await master(t);
    await withRule(t, m);
    const [a] = await openOne(t, m);

    await t.rejects(() => t.rows(
      `update deviation set deviation_no = 'DV-99-999' where id = $1`, [a.id]), BLOCKED);
    await t.rejects(() => t.rows(
      `update deviation set occurred_on = current_date - 30 where id = $1`, [a.id]), BLOCKED);
  },
},

{
  id: 'DV-08', expect: '권한 거부',
  name: '일탈 기록도 지울 수 없다 (S03)',
  async run(t) {
    const m = await master(t);
    await withRule(t, m);
    const [a] = await openOne(t, m);

    await t.asRole('app_role', async () => {
      await t.rejects(() => t.rows(`delete from deviation where id = $1`, [a.id]),
        { code: '42501' });
    });
  },
},

{
  id: 'DV-09', expect: '확인',
  name: '등록과 종결이 감사추적에 남는다',
  async run(t) {
    const m = await master(t);
    await withRule(t, m);
    const [a] = await openOne(t, m);
    await t.rows(
      `update deviation
          set report_no = 'DR-2026-003', outcome = '영향 없음',
              approved_by = '정품질책임', approved_on = current_date, closed_on = current_date
        where id = $1`, [a.id]);

    const [n] = await t.rows(
      `select count(*)::int as n from audit_log
        where table_name = 'deviation' and record_id = $1`, [a.id]);
    if (Number(n.n) < 2) {
      throw new Error(`등록과 종결이 남아야 합니다 (실제 ${n.n}건)`);
    }
  },
},

{
  id: 'DV-10', expect: '예외',
  name: '아직 오지 않은 날은 받지 않는다',
  async run(t) {
    const m = await master(t);
    await withRule(t, m);

    /*
     * 0064 는 하한만 걸었다 - 승인일과 종결일이 발생일보다 앞설 수 없다.
     * 상한이 없어 다음 달에 일어난 일탈이 그대로 들어갔다 (0065).
     * 공정 기록의 작업일에는 0052 가 이미 같은 것을 걸어 두었다.
     */
    await t.rejects(() => t.rows(
      `insert into deviation (deviation_no, occurred_on, title, registered_by)
       values (next_number('DEVIATION'), current_date + 1, '내일 일어날 일', $1)`,
      [m.admin]), { ...BLOCKED, message: '아직 오지 않은 날' });

    const [a] = await openOne(t, m);
    await t.rejects(() => t.rows(
      `update deviation
          set report_no='DR-9', outcome='앞당겨 적음', approved_by='정품질책임',
              approved_on = current_date + 1, closed_on = current_date
        where id = $1`, [a.id]), { ...BLOCKED, message: '아직 오지 않은 날' });

    /* 오늘은 받는다 */
    await t.resolves(() => t.rows(
      `update deviation
          set report_no='DR-10', outcome='당일 종결', approved_by='정품질책임',
              approved_on = current_date, closed_on = current_date
        where id = $1`, [a.id]));
  },
},

];
