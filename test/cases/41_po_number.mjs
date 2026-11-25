// =============================================================================
// 41_po_number.mjs - 발주번호도 채번 규칙으로 (0163)
// 근거: 사용자 2026-11-25 «발주번호 기준은 뭐야?» → «채번 규칙으로 (권고)»
//
// 발주가 채번 대상이 되고, 발주일 기준으로 그날의 순번이 붙는지 본다.
// =============================================================================

export default [

{
  id: 'PO-N1', expect: '통과',
  name: '발주번호는 발주일 기준으로 그날의 순번이 붙는다 (PO-{YY}{MM}{DD}-{SEQ:2})',
  async run(t) {
    const admin = await t.val(`select id from app_user limit 1`);
    await t.rows(
      `insert into numbering_rule (target, pattern, reset, seq_width, effective_from, registered_by)
       values ('PURCHASE_ORDER', 'PO-{YY}{MM}{DD}-{SEQ:2}', 'DAILY', 2, '2026-01-01', $1)`, [admin]);
    const next = (on) => t.val(`select next_number('PURCHASE_ORDER', null, $1::date)`, [on]);
    t.eq(await next('2026-09-23'), 'PO-260923-01', '9월 23일 첫 발주');
    t.eq(await next('2026-11-25'), 'PO-261125-01', '다른 날은 1 부터');
    t.eq(await next('2026-11-25'), 'PO-261125-02', '같은 날 둘째');
  },
},

];
