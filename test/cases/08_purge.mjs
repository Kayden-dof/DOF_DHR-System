// =============================================================================
// 07_purge.mjs - 시연 자료 비우기와 S03 의 좁은 문
// 근거: CLAUDE.md §1 "삭제 자체가 없다", §2 S03, §10 "예외 플래그 금지"
//       0049 demo_marker · 0050 purge_demo_data · 0051 only_demo_data
//
// 확인하려는 것은 하나다. 삭제로 가는 길이 "이 DB 에 지어낸 자료 말고는
// 아무것도 없다" 를 DB 스스로 증명할 수 있을 때만 열리는가.
//
// 실제로 자료를 비우므로 반드시 마지막에 돌린다. 앞 시험들의 픽스처가
// 사라진다.
// =============================================================================

const NIL = '00000000-0000-0000-0000-000000000000';

/**
 * 표시를 지금 시각으로 새로 남긴다. 시드 스크립트가 하는 일과 같다.
 *
 * 기준선(audit_before)도 함께 적는다 (4차 감사 D2). 그것이 없으면 증명이
 * 서지 않는다 - 표시 **앞에** 무엇이 있었는지 모르기 때문이다.
 *
 * 여기서는 "이 DB 에는 시연 자료 말고 없다" 를 만들어야 하므로 0 을 적는다.
 * 실제 시드 스크립트는 심기 직전의 max(audit_log.id) 를 적는다.
 */
async function mark(t, auditBefore = 0) {
  await t.rows(`insert into demo_marker (id, seeded_at, note, audit_before)
                values (true, now(), '시험', $1)
                on conflict (id) do update
                  set seeded_at = now(), audit_before = excluded.audit_before`,
               [auditBefore]);
}

export default [

{
  id: 'PRG-01', expect: '거부',
  name: '표시가 없으면 비우기가 거부된다',
  async run(t) {
    t.eq(await t.val(`select only_demo_data()`), false, '표시 없음 → 증명 불성립');
    await t.setActor(t.fx.admin);
    await t.rejects(() => t.val(`select purge_demo_data()`),
      { code: 'P0001', message: '시연 자료 표시가 없습니다' });
  },
},

{
  id: 'PRG-02', expect: '거부',
  name: '표시가 없으면 삭제가 그대로 막힌다 (S03 평시)',
  async run(t) {
    await t.rejects(() => t.rows(`delete from item`),
      { code: 'P0001', message: 'S03: 기록은 삭제할 수 없습니다' });
    await t.rejects(() => t.rows(`delete from work_order`),
      { code: 'P0001', message: 'S03: 기록은 삭제할 수 없습니다' });
  },
},

{
  id: 'PRG-03', expect: '거부',
  name: '표시 뒤에 기록이 쌓이면 증명이 깨진다',
  async run(t) {
    await mark(t);
    t.eq(await t.val(`select only_demo_data()`), true, '표시 직후에는 증명 성립');

    // 아무 기록이나 한 줄. 감사추적이 남으면 그것으로 충분하다.
    await t.newUser({ full_name: '표시이후계정' });
    t.eq(await t.val(`select only_demo_data()`), false, '기록이 쌓이면 증명 불성립');

    await t.setActor(t.fx.admin);
    await t.rejects(() => t.val(`select purge_demo_data()`),
      { code: 'P0001', message: '갈라낼 수 없으므로 비우지 않습니다' });
    await t.rejects(() => t.rows(`delete from item`),
      { code: 'P0001', message: 'S03: 기록은 삭제할 수 없습니다' });
  },
},

{
  id: 'PRG-04', expect: '거부',
  name: '증명이 서도 감사추적과 TRUNCATE 는 열리지 않는다',
  async run(t) {
    await mark(t);
    t.eq(await t.val(`select only_demo_data()`), true, '증명 성립');

    // 증명을 떠받치는 표다. 여기가 열리면 증명을 지어낼 수 있다.
    await t.rejects(() => t.rows(`delete from audit_log`),
      { code: 'P0001', message: 'S03: 기록은 삭제할 수 없습니다' });
    await t.rejects(() => t.exec(`truncate work_order cascade`),
      { code: 'P0001', message: 'S03: 기록은 삭제할 수 없습니다' });

    t.ok(await t.val(`select count(*)::int from audit_log`) > 0, '감사기록이 남아 있어야 한다');
  },
},

{
  id: 'PRG-05', expect: '거부',
  name: '시스템관리자가 아니면 비울 수 없다',
  async run(t) {
    await mark(t);
    const worker = await t.newUser({ full_name: '비우기시도작업자' });
    await t.rows(`insert into user_role (user_id, role) values ($1,'WORKER')`, [worker]);

    // 위 두 줄이 감사추적을 남겼으므로 표시를 다시 세워 증명을 성립시킨다.
    await mark(t);

    await t.setActor(worker);
    await t.rejects(() => t.val(`select purge_demo_data()`),
      { code: 'P0001', message: '시스템관리자만' });

    await t.setActor(null);
    await t.rejects(() => t.val(`select purge_demo_data()`),
      { code: 'P0001', message: '로그인 정보가 없습니다' });
  },
},

{
  id: 'PRG-06', expect: '통과',
  name: '증명이 서면 배치 기록만 비운다',
  async run(t) {
    await mark(t);
    const items   = await t.val(`select count(*)::int from item`);
    const users   = await t.val(`select count(*)::int from app_user`);
    const audits  = await t.val(`select count(*)::int from audit_log`);
    t.ok(items > 0 && users > 0 && audits > 0, '비우기 전 기준정보와 감사추적이 있어야 한다');

    await t.setActor(t.fx.admin);
    const msg = await t.resolves(() => t.val(`select purge_demo_data()`));
    t.ok(String(msg).includes('시연 자료를 비웠습니다'), `반환 문구: ${msg}`);

    // 배치에서 갈라져 나온 것은 전부 비었다
    for (const tbl of ['work_order', 'product_lot', 'process_record', 'material_issue',
                       'material_lot', 'stock_movement', 'record_print', 'day_lock',
                       'shipment', 'steril_batch']) {
      t.eq(await t.val(`select count(*)::int from ${tbl}`), 0, `${tbl} 가 비어야 한다`);
    }

    // 기준정보와 계정은 그대로다
    t.eq(await t.val(`select count(*)::int from item`),     items, '품목은 남는다');
    t.eq(await t.val(`select count(*)::int from app_user`), users, '계정은 남는다');

    // 감사추적은 줄지 않고, 비웠다는 사실이 한 줄 더 남는다
    t.ok(await t.val(`select count(*)::int from audit_log`) > audits,
         '감사추적은 줄지 않고 늘어야 한다');
    t.eq(await t.val(
      `select count(*)::int from audit_log
        where table_name = 'demo_marker' and action = 'PURGE'`), 1, '비운 사실이 남는다');
  },
},

{
  id: 'PRG-07', expect: '거부',
  name: '한 번 쓰면 문이 닫힌다',
  async run(t) {
    t.eq(await t.val(`select count(*)::int from demo_marker`), 0, '표시가 사라져야 한다');
    t.eq(await t.val(`select only_demo_data()`), false, '증명이 더는 서지 않는다');

    await t.setActor(t.fx.admin);
    await t.rejects(() => t.val(`select purge_demo_data()`),
      { code: 'P0001', message: '시연 자료 표시가 없습니다' });

    await t.rejects(() => t.rows(`delete from item`),
      { code: 'P0001', message: 'S03: 기록은 삭제할 수 없습니다' });
    await t.rejects(() => t.rows(`delete from audit_log`),
      { code: 'P0001', message: 'S03: 기록은 삭제할 수 없습니다' });
  },
},

{
  id: 'PRG-08', expect: '권한 거부',
  name: 'app_role 은 표시를 만들 수도 지울 수도 없다',
  async run(t) {
    /*
     * 문을 여는 것은 표시다. 응용이 표시를 스스로 세울 수 있으면 언제든
     * 문을 열 수 있고, 그러면 §10 이 금지하는 플래그와 같아진다.
     *
     * 함수 자체는 app_role 이 부를 수 있어야 한다 - 화면의 단추가 그 역할로
     * 돈다. 막는 일은 함수 안에서 한다 (표시 · 감사추적 · 시스템관리자).
     */
    await t.asRole('app_role', async () => {
      await t.rejects(() => t.rows(
        `insert into demo_marker (id, seeded_at) values (true, now())`), { code: '42501' });
      await t.rejects(() => t.rows(`update demo_marker set seeded_at = now()`), { code: '42501' });
      await t.rejects(() => t.rows(`delete from demo_marker`), { code: '42501' });
    });
  },
},

{
  id: 'PRG-09', expect: '거부',
  name: 'app_role 이 함수를 불러도 조건이 없으면 거부된다',
  async run(t) {
    await t.setActor(t.fx.admin);
    await t.asRole('app_role', () =>
      t.rejects(() => t.val(`select purge_demo_data()`),
        { code: 'P0001', message: '시연 자료 표시가 없습니다' }));
  },
},

{
  id: 'PRG-11', expect: '통과',
  name: '표시 앞에 기록이 있으면 증명이 서지 않는다 (4차 감사 D2)',
  async run(t) {
    /*
     * 전에는 증명이 "표시 뒤로 감사추적이 조용한가" 만 봤다. 표시가 자료보다
     * 뒤에 찍히므로 **실기록이 든 DB 에 표식을 찍으면 통과했고**, 그 순간
     * audit_log 를 뺀 전 표에서 DELETE 가 열렸다.
     *
     * 기준선보다 앞선 감사 줄이 하나라도 있으면 이 DB 에는 시연 이전의
     * 무언가가 있었다는 뜻이다.
     */
    const maxId = Number(await t.val(`select coalesce(max(id), 0) from audit_log`));
    /* 기준선을 지금 최대값으로 잡으면, 이미 있는 줄들이 전부 그 앞이 된다 */
    await mark(t, maxId);
    t.eq(await t.val(`select only_demo_data()`), false,
         '표시 앞에 기록이 있으면 증명이 서지 않아야 한다');
    await t.rejects(() => t.rows(`select purge_demo_data()`));
  },
},

{
  id: 'PRG-12', expect: '통과',
  name: '기준선이 없는 옛 표식으로는 증명이 서지 않는다',
  async run(t) {
    await t.rows(`insert into demo_marker (id, seeded_at, note, audit_before)
                  values (true, now(), '기준선 없음', null)
                  on conflict (id) do update
                    set seeded_at = now(), audit_before = null`);
    t.eq(await t.val(`select only_demo_data()`), false,
         '모르면 증명하지 않는다. 문은 닫히는 쪽이 안전하다');
    await t.rejects(() => t.rows(`select purge_demo_data()`));
  },
},

{
  id: 'PRG-10', expect: '권한 거부',
  name: '부적합 기록도 §5 의 보호를 받는다 (0051)',
  async run(t) {
    /*
     * 권한 검사는 행이 없어도 걸린다. 트리거는 행 단위라 빈 표에서는 돌지
     * 않으므로, 비운 뒤에 서는 이 자리에서는 권한 쪽만 본다.
     * 트리거 쪽은 행이 있는 동안 도는 NC-04 · WN-04 가 본다.
     */
    await t.asRole('app_role', async () => {
      await t.rejects(() => t.rows(`delete from product_nonconformity`), { code: '42501' });
      await t.rejects(() => t.rows(`delete from wip_nonconformity`),     { code: '42501' });
    });

    /* 감사 트리거가 하나뿐인지. 둘이면 한 번 쓸 때 감사기록이 두 줄 남는다 */
    t.eq(await t.val(
      `select count(*)::int from pg_trigger tg
         join pg_class c on c.oid = tg.tgrelid
        where c.relname = 'product_nonconformity'
          and not tg.tgisinternal and tg.tgname like '%audit%'`), 1, '감사 트리거는 하나다');
    t.ok(NIL, '');
  },
},

];
