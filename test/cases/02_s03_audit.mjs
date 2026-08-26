// =============================================================================
// 02_s03_audit.mjs - S03 삭제 금지 · 감사추적 시험
// 근거: CLAUDE.md §2 (S03), §5 S03, §8.1
//       "우회 경로도 테스트한다. app_role로 delete 직접 실행 → 거부되어야 한다"
// =============================================================================

const NIL = '00000000-0000-0000-0000-000000000000';

// 시험용 채번 규칙. item_id를 난수로 줘 다른 시험의 규칙과 겹치지 않게 한다.
let ruleSeq = 0;
async function throwawayRule(t, target) {
  ruleSeq += 1;
  const item = await t.val(
    `insert into item (code, name, type, purchase_uom, usage_uom)
     values ($1, $2, 'REAGENT', 'EA', 'EA') returning id`,
    [`S03T-${String(ruleSeq).padStart(3, '0')}`, `S03시험품목${ruleSeq}`]);
  return await t.val(
    `insert into numbering_rule (target, item_id, pattern, reset, effective_from, registered_by)
     values ($1, $2, 'TMP-{SEQ:3}', 'NEVER', current_date, $3) returning id`,
    [target, item, t.fx.admin]);
}

export default [

// ---- 권한 회수 (app_role) ---------------------------------------------------

{
  id: 'S03-01', expect: '권한 거부',
  name: 'app_role의 audit_log DELETE',
  async run(t) {
    await t.asRole('app_role', () =>
      t.rejects(() => t.rows(`delete from audit_log`), { code: '42501' }));
  },
},

{
  id: 'S03-02', expect: '권한 거부',
  name: 'app_role의 app_user DELETE',
  async run(t) {
    await t.asRole('app_role', () =>
      t.rejects(() => t.rows(`delete from app_user`), { code: '42501' }));
  },
},

{
  id: 'S03-03', expect: '권한 거부',
  name: 'app_role의 numbering_rule DELETE',
  async run(t) {
    await t.asRole('app_role', () =>
      t.rejects(() => t.rows(`delete from numbering_rule`), { code: '42501' }));
  },
},

{
  id: 'S03-04', expect: '권한 거부',
  name: 'app_role의 numbering_counter 직접 접근 (§4.10 미노출)',
  async run(t) {
    await t.asRole('app_role', async () => {
      await t.rejects(() => t.rows(`select * from numbering_counter`),      { code: '42501' });
      await t.rejects(() => t.rows(`update numbering_counter set last_seq = 0`), { code: '42501' });
      await t.rejects(() => t.rows(`delete from numbering_counter`),        { code: '42501' });
    });
  },
},

{
  id: 'S03-05', expect: '권한 거부',
  name: 'app_role의 audit_log INSERT (감사기록 위조)',
  async run(t) {
    await t.asRole('app_role', () =>
      t.rejects(() => t.rows(
        `insert into audit_log (table_name, record_id, action)
         values ('app_user', $1, 'FORGED')`, [NIL]), { code: '42501' }));
  },
},

{
  id: 'S03-06', expect: '권한 거부',
  name: 'app_role의 audit_log UPDATE',
  async run(t) {
    await t.asRole('app_role', () =>
      t.rejects(() => t.rows(`update audit_log set action = 'ALTERED'`), { code: '42501' }));
  },
},

// ---- 우회 경로 (소유자 · 슈퍼유저) ------------------------------------------

{
  id: 'S03-07', expect: '거부',
  name: '소유자 권한의 audit_log DELETE (권한 검사 우회)',
  async run(t) {
    await t.rejects(() => t.rows(`delete from audit_log`),
      { code: 'P0001', message: 'S03: 기록은 삭제할 수 없습니다' });
  },
},

{
  id: 'S03-08', expect: '거부',
  name: '소유자 권한의 audit_log TRUNCATE (DELETE 권한과 무관한 경로)',
  async run(t) {
    await t.rejects(() => t.exec(`truncate audit_log`),
      { code: 'P0001', message: 'S03: 기록은 삭제할 수 없습니다' });
  },
},

{
  id: 'S03-09', expect: '거부',
  name: '소유자 권한의 audit_log UPDATE (사양 보강)',
  async run(t) {
    await t.rejects(() => t.rows(`update audit_log set action = 'ALTERED'`),
      { code: 'P0001', message: '감사기록은 수정할 수 없습니다' });
  },
},

{
  id: 'S03-10', expect: '거부',
  name: '소유자 권한의 numbering_rule DELETE / TRUNCATE',
  async run(t) {
    await throwawayRule(t, 'DEVIATION');
    await t.rejects(() => t.rows(`delete from numbering_rule`),
      { code: 'P0001', message: 'S03: 기록은 삭제할 수 없습니다' });

    // 단독 TRUNCATE는 numbering_counter의 FK가 먼저 막는다 (0A000).
    await t.rejects(() => t.exec(`truncate numbering_rule`), { code: ['0A000', 'P0001'] });

    // FK 방어가 통하지 않는 두 경로(CASCADE, 다중 표 지정)에서
    // 차단 트리거가 실제로 도달하는지 확인한다. 여기서 뚫리면 표를 통째로
    // 비울 수 있다.
    await t.rejects(() => t.exec(`truncate numbering_rule cascade`),
      { code: 'P0001', message: 'S03: 기록은 삭제할 수 없습니다' });
    await t.rejects(() => t.exec(`truncate numbering_rule, numbering_counter`),
      { code: 'P0001', message: 'S03: 기록은 삭제할 수 없습니다' });
  },
},

{
  id: 'S03-11', expect: '거부',
  name: '소유자 권한의 numbering_counter DELETE (번호 재사용 경로)',
  async run(t) {
    const rule = await throwawayRule(t, 'STERIL_BATCH');
    await t.rows(`insert into numbering_counter (rule_id, cycle_key, last_seq)
                  values ($1, 'NEVER', 7)`, [rule]);
    await t.rejects(() => t.rows(`delete from numbering_counter`),
      { code: 'P0001', message: 'S03: 기록은 삭제할 수 없습니다' });
    await t.rejects(() => t.exec(`truncate numbering_counter`),
      { code: 'P0001', message: 'S03: 기록은 삭제할 수 없습니다' });
  },
},

// ---- 변경 이력 --------------------------------------------------------------

{
  id: 'S03-12', expect: '확인',
  name: 'app_user UPDATE 후 audit_log에 이전 값이 남는지',
  async run(t) {
    const u = await t.newUser({ full_name: '변경전이름' });
    await t.rows(`update app_user set full_name = '변경후이름' where id = $1`, [u]);

    const a = await t.one(
      `select action, old_value ->> 'full_name' as old_name,
                      new_value ->> 'full_name' as new_name
         from audit_log
        where table_name = 'app_user' and record_id = $1 and action = 'UPDATE'
        order by id desc limit 1`, [u]);

    t.ok(a, 'UPDATE 감사기록이 있어야 한다');
    t.eq(a.old_name, '변경전이름', 'old_value.full_name');
    t.eq(a.new_name, '변경후이름', 'new_value.full_name');
  },
},

{
  id: 'S03-13', expect: '확인',
  name: 'audit_log.actor_id가 app.user_id와 일치',
  async run(t) {
    const actor  = await t.newUser();
    const target = await t.newUser();
    await t.setActor(actor);
    await t.rows(`update app_user set is_active = false where id = $1`, [target]);
    await t.setActor(null);

    const a = await t.one(
      `select actor_id from audit_log
        where table_name = 'app_user' and record_id = $1 and action = 'UPDATE'
        order by id desc limit 1`, [target]);
    t.eq(a.actor_id, actor, 'actor_id');
  },
},

{
  id: 'S03-14', expect: '확인',
  name: 'user_role 감사: id 컬럼이 없는 표의 record_id (사양 보강)',
  async run(t) {
    const u = await t.newUser();
    await t.rows(`insert into user_role (user_id, role) values ($1,'WORKER')`, [u]);

    const a = await t.one(
      `select record_id, action, new_value ->> 'role' as role
         from audit_log
        where table_name = 'user_role' and record_id = $1
        order by id desc limit 1`, [u]);
    t.ok(a, 'user_role INSERT 감사기록이 있어야 한다');
    t.eq(a.record_id, u,        'record_id는 user_id');
    t.eq(a.action,   'INSERT',  'action');
    t.eq(a.role,     'WORKER',  'new_value.role');
  },
},

{
  id: 'S03-15', expect: '확인',
  name: 'user_role 회수(DELETE) 이력 보존 (사양 보강)',
  async run(t) {
    const u = await t.newUser();
    await t.rows(`insert into user_role (user_id, role) values ($1,'PROD_MGR')`, [u]);
    await t.rows(`delete from user_role where user_id = $1 and role = 'PROD_MGR'`, [u]);

    const a = await t.one(
      `select action, old_value ->> 'role' as role, new_value
         from audit_log
        where table_name = 'user_role' and record_id = $1 and action = 'DELETE'
        order by id desc limit 1`, [u]);
    t.ok(a, '회수 감사기록이 있어야 한다');
    t.eq(a.role,      'PROD_MGR', 'old_value.role');
    t.eq(a.new_value, null,       'new_value');
  },
},

{
  id: 'S03-16', expect: '확인',
  name: 'numbering_rule 등록이 감사기록에 남는지',
  async run(t) {
    const rule = await throwawayRule(t, 'WORK_ORDER');
    const a = await t.one(
      `select action, new_value ->> 'pattern' as pattern
         from audit_log
        where table_name = 'numbering_rule' and record_id = $1
        order by id desc limit 1`, [rule]);
    t.ok(a, '규칙 등록 감사기록이 있어야 한다');
    t.eq(a.action,  'INSERT',      'action');
    t.eq(a.pattern, 'TMP-{SEQ:3}', 'new_value.pattern');
  },
},

{
  id: 'S03-17', expect: '통과',
  name: 'app_role의 정상 기록 작성과 감사 트리거 동작 (security definer)',
  async run(t) {
    const id = await t.asRole('app_role', () => t.resolves(() => t.val(
      `insert into app_user (login_code, full_name, pin_hash)
       values ('7777', 'app_role작성', '$h$') returning id`)));

    t.eq(await t.val(
      `select count(*)::int from audit_log
        where table_name = 'app_user' and record_id = $1 and action = 'INSERT'`, [id]),
      1, 'app_role이 쓴 기록도 감사된다');
  },
},

{
  id: 'S03-18', expect: '거부',
  name: 'app_user · user_role TRUNCATE (감사 없이 비우는 경로)',
  async run(t) {
    // 이 두 표는 DELETE가 허용된다. 그러나 TRUNCATE는 행 트리거를 타지 않아
    // 감사기록 없이 비울 수 있으므로 막혀 있어야 한다.
    await t.rejects(() => t.exec(`truncate user_role`),
      { code: 'P0001', message: 'S03: 기록은 삭제할 수 없습니다' });
    await t.rejects(() => t.exec(`truncate app_user cascade`),
      { code: 'P0001', message: 'S03: 기록은 삭제할 수 없습니다' });

    t.ok(await t.val(`select count(*)::int from app_user`) > 0, '계정이 남아 있어야 한다');
    t.ok(await t.val(`select count(*)::int from audit_log`) > 0, '감사기록이 남아 있어야 한다');
  },
},

];
