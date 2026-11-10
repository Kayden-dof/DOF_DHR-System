// =============================================================================
// 19_br_form.mjs - 제조기록서 양식 모양 (0130)
// 근거: 사용자 2026-11-10 «제조기록서 모양으로 맞추라고 했던거 같은데»
//
// 양식 모양은 제조기록서(BR) 문서에만 붙고, 쪽 배열이 있어야 한다. 모양을
// 바꾸면 감사추적에 남는다.
// =============================================================================

import { masterData as master } from '../fixtures.mjs';

const FORM = { page: { w: 842, h: 595 }, pages: [{ texts: [], tables: [] }] };

async function doc(t, m, kind, no) {
  return t.val(
    `insert into mfg_doc (product_code, op_code, kind, doc_no, title, revision, registered_by)
     values ('BF-TEST', 'WS-BF-01', $1, $2, '시험 문서', 'Rev.00', $3) returning id`,
    [kind, no, m.admin]);
}

export default [

{
  id: 'BF-01', expect: '거부',
  name: '작업표준서에 양식 모양 · 쪽 배열이 없는 모양',
  async run(t) {
    const m = await master(t);
    const ws = await doc(t, m, 'WS', 'WS-BF-01');
    await t.rejects(() => t.rows(`update mfg_doc set form = $2::jsonb where id = $1`,
      [ws, JSON.stringify(FORM)]), { message: 'mfg_doc_form_br' });
    const br = await doc(t, m, 'BR', 'F706-BF-01');
    await t.rejects(() => t.rows(`update mfg_doc set form = '{"page":{}}'::jsonb where id = $1`, [br]),
      { message: 'mfg_doc_form_br' });
  },
},

{
  id: 'BF-02', expect: '통과',
  name: '제조기록서에 양식 모양을 붙이면 감사추적에 남는다',
  async run(t) {
    const m = await master(t);
    const br = await doc(t, m, 'BR', 'F706-BF-02');
    await t.setActor(m.admin);
    await t.rows(`update mfg_doc set form = $2::jsonb where id = $1`, [br, JSON.stringify(FORM)]);
    await t.setActor(null);
    t.eq(await t.val(`select jsonb_array_length(form -> 'pages') from mfg_doc where id = $1`, [br]), 1, '쪽 수');
    t.ok(await t.val(
      `select exists (select 1 from audit_log where table_name = 'mfg_doc'
                       and record_id = $1 and action = 'UPDATE')`, [br]), '감사추적');
  },
},

];
