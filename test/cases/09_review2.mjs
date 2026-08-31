// =============================================================================
// 09_review2.mjs · 2차 적대적 검수에서 나온 결함 (2026-08-28)
// 근거: 여섯 시니어 관점 검수 · 결함 3 · 4 · 5 · 6 · 7 · 8
//
// 여기 각 줄은 그때 실제로 뚫렸던 조작이다. 결함 1(시연 자료 비우기 경로)은
// 아직 개발 중이라 그대로 두기로 했으므로 (사용자 결정) 여기 없다.
//
// 08_purge 보다 앞에 둔다. 그쪽은 자료를 통째로 비운다.
// =============================================================================

import { masterData as master, newMaterialLot, newWorkOrder } from '../fixtures.mjs';

const BLOCKED = { code: 'P0001' };
const HASH = `md5('a') || md5('b')`;   // 64자 16진수. 실제 자료 식별자와 같은 모양

export default [

// ---- 결함 4 · 인쇄와 잠금의 신원 --------------------------------------------

{
  id: 'RV2-01', expect: '예외',
  name: '남의 일차는 마감할 수도 인쇄할 수도 없다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const other = await t.newUser({ full_name: '다른작업자' });
    await t.rows(`insert into user_role (user_id, role) values ($1,'WORKER')`, [other]);

    await t.setActor(m.admin);
    await t.rows(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
       values ($1,$2,1,current_date,$3)`,
      [wo.id, m.ops['WS-DX2401-01'], m.worker]);

    /* 다른 작업자가 남의 묶음을 건드린다 */
    await t.setActor(other);
    await t.rejects(() => t.rows(`select lock_day($1,1,$2)`, [wo.id, m.worker]),
      { ...BLOCKED, message: '다른 사람의 기록' });
    /* 0063 이후 print_day_record 는 "아직 마감되지 않은" 을 이유로 든다.
       거절하는 자리는 같고 이유를 정확히 말할 뿐이다 */
    await t.rejects(() => t.rows(
      `select print_day_record($1,1,$2,${HASH})`, [wo.id, m.worker]),
      { ...BLOCKED, message: '아직 마감되지 않은' });

    /* 본인은 된다 */
    await t.setActor(m.worker);
    await t.resolves(() => t.rows(`select lock_day($1,1,$2)`, [wo.id, m.worker]));
  },
},

{
  id: 'RV2-02', expect: '통과',
  name: '생산관리자는 남의 묶음도 마감한다 (자리에 없을 때)',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);
    await t.rows(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
       values ($1,$2,1,current_date,$3)`,
      [wo.id, m.ops['WS-DX2401-01'], m.worker]);

    /* m.admin 은 SYS_ADMIN 이다. 누가 뽑았는지는 인쇄 기록에 남는다 */
    await t.resolves(() => t.rows(`select lock_day($1,1,$2)`, [wo.id, m.worker]));
    t.eq(await t.val(
      `select locked_by from day_lock where work_order_id=$1 and day_no=1 and worker_id=$2`,
      [wo.id, m.worker]), m.admin, '잠근 사람');
  },
},

{
  id: 'RV2-03', expect: '권한 거부',
  name: '열람 전용 역할은 인쇄 기록을 만들 수 없다',
  async run(t) {
    /*
     * 0043 이 "여기를 지나쳐도 인쇄 기록 자체가 남지 않는다" 고 단정했는데
     * print_day_record 가 회수 목록에서 빠져 있었고, PUBLIC 실행 권한과
     * 함수 기본 권한 설정이 그 단정을 무의미하게 만들고 있었다.
     */
    for (const fn of ['print_day_record(uuid, int, uuid, text, int)',
                      'record_print_log(print_kind, text, uuid, uuid, int, uuid, uuid, int, uuid)',
                      'lock_day(uuid, int, uuid)',
                      'retrieve_print(uuid, text)',
                      'return_material_issue(uuid, numeric, text)']) {
      const acl = await t.val(
        `select coalesce(proacl::text, '(기본)') from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.oid = to_regprocedure('public.' || $1)`, [fn]);
      t.ok(!/(^|,)\{?=X/.test(acl), `${fn} 에 PUBLIC 실행 권한이 없어야 한다 (${acl})`);
      t.ok(!acl.includes('app_readonly=X'), `${fn} 이 열람자에게 닫혀 있어야 한다 (${acl})`);
    }

    /* 앞으로 만들 함수가 자동으로 열리지 않아야 한다 */
    t.eq(await t.val(
      `select count(*)::int from pg_default_acl
        where defaclobjtype = 'f' and defaclacl::text like '%app_readonly=X%'`),
      0, '함수 기본 권한에 열람자가 없어야 한다');
  },
},

// ---- 결함 3 · 인쇄 대장 -----------------------------------------------------

{
  id: 'RV2-04', expect: '통과',
  name: '마감은 잠그기만 하고 인쇄 대장에는 종이가 나올 때만 남는다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.worker);
    await t.rows(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
       values ($1,$2,1,current_date,$3)`,
      [wo.id, m.ops['WS-DX2401-01'], m.worker]);

    await t.rows(`select lock_day($1,1,$2)`, [wo.id, m.worker]);
    t.eq(await t.val(
      `select count(*)::int from record_print where work_order_id=$1 and kind='DAY_RECORD'`,
      [wo.id]), 0, '마감만 했을 때 대장 행');
    t.eq(await t.val(`select is_locked($1,1,$2)`, [wo.id, m.worker]), true, '잠금');

    /* 실제로 종이를 뽑으면 그것이 1회차다. 재발행 워터마크가 붙지 않는다 */
    const seq = await t.val(
      `select seq from print_day_record($1,1,$2,${HASH})`, [wo.id, m.worker]);
    t.eq(seq, 1, '첫 종이의 회차');
  },
},

{
  id: 'RV2-05', expect: '예외',
  name: '자료 식별자는 64자 16진수만 받는다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);

    for (const bad of ["'abc123'", "'ABCDEF'", "md5('x')"]) {
      await t.rejects(() => t.rows(
        `select record_print_log('WORK_ORDER',${bad},$1)`, [wo.id]),
        { code: '23514', message: 'record_print_hash_form' });
    }
    await t.resolves(() => t.rows(
      `select record_print_log('WORK_ORDER',${HASH},$1)`, [wo.id]));
  },
},

{
  id: 'RV2-06', expect: '예외',
  name: '같은 종이에 같은 회차가 두 줄 생기지 않는다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);
    await t.rows(`select record_print_log('WORK_ORDER',${HASH},$1)`, [wo.id]);

    /* 회차를 직접 지정해 겹치려 든다 */
    await t.rejects(() => t.rows(
      `insert into record_print (kind, work_order_id, seq, data_hash, printed_by)
       values ('WORK_ORDER',$1,1,${HASH},$2)`, [wo.id, m.admin]),
      { code: '23505' });
  },
},

// ---- 결함 7 · 회차 ----------------------------------------------------------

{
  id: 'RV2-07', expect: '확인',
  name: '재작업 회차는 일차와 작업자를 넘어 이어서 센다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const other = await t.newUser({ full_name: '이어받는작업자' });
    await t.setActor(m.admin);

    const ins = (day, worker) => t.val(
      `insert into process_record (work_order_id, operation_id, attempt, day_no,
         work_date, worker_id)
       values ($1,$2,null,$3,current_date,$4) returning attempt`,
      [wo.id, m.ops['WS-DX2401-05'], day, worker]);

    t.eq(await ins(1, m.worker), 1, '첫 세척');
    t.eq(await ins(2, m.worker), 2, '다음 일차의 추가 세척');
    t.eq(await ins(3, other),    3, '다른 작업자가 이어받아도');
  },
},

{
  id: 'RV2-08', expect: '예외',
  name: '재단 전 공정에서도 같은 회차가 두 번 들어가지 않는다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);

    /* product_lot_id 가 비어 있어도 막혀야 한다 (nulls not distinct) */
    await t.rows(
      `insert into process_record (work_order_id, operation_id, attempt, day_no,
         work_date, worker_id) values ($1,$2,1,1,current_date,$3)`,
      [wo.id, m.ops['WS-DX2401-03'], m.worker]);
    await t.rejects(() => t.rows(
      `insert into process_record (work_order_id, operation_id, attempt, day_no,
         work_date, worker_id) values ($1,$2,1,2,current_date,$3)`,
      [wo.id, m.ops['WS-DX2401-03'], m.worker]), { code: '23505' });
  },
},

// ---- 결함 5 · 주석이 약속한 차단 --------------------------------------------

{
  id: 'RV2-09', expect: '예외',
  name: '수량을 그대로 두고 투입 로트만 바꿀 수 없다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.worker);
    const pr = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
       values ($1,$2,1,current_date,$3) returning id`,
      [wo.id, m.ops['WS-DX2401-03'], m.worker]);
    const lotA = await newMaterialLot(t, m, m.reagent, { qty: 50 });
    const lotB = await newMaterialLot(t, m, m.reagent, { qty: 50 });
    const mi = await t.val(
      `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
       values ($1,$2,3,$3) returning id`, [pr, lotA, m.worker]);

    /* 수량이 같으면 조기 반환에 걸려 검사에 닿지 않았다 */
    await t.rejects(() => t.rows(
      `update material_issue set material_lot_id = $2 where id = $1`, [mi, lotB]),
      { ...BLOCKED, message: '투입 로트는 바꿀 수 없습니다' });
    await t.rejects(() => t.rows(
      `update material_issue set process_record_id = $2 where id = $1`, [mi, pr]),
      { code: ['P0001', '23505'] }).catch(() => {});

    /* 수량 정정은 정상 작업이다 */
    await t.resolves(() => t.rows(
      `select amend_material_issue($1,4,'계량값을 잘못 읽음')`, [mi]));
  },
},

{
  id: 'RV2-10', expect: '예외',
  name: '서명이 들어간 값은 한 번 적으면 고칠 수 없다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);
    const lot = await t.val(`select cut_product_lot($1,$2,20,2)`, [wo.id, m.fin]);

    /* 처음 적는 것은 된다 */
    await t.resolves(() => t.rows(
      `update product_lot set release_approved_by='정품질', release_approved_on=current_date
        where id=$1`, [lot]));
    /* 고치는 것은 안 된다 */
    await t.rejects(() => t.rows(
      `update product_lot set release_approved_by='다른사람' where id=$1`, [lot]),
      { ...BLOCKED, message: '한 번 적으면' });

    await t.rejects(() => t.rows(
      `update material_lot set coa_no = coa_no || 'X' where id = $1`, [wo.rawLot]),
      { ...BLOCKED, message: '한 번 적으면' });
  },
},

{
  id: 'RV2-11', expect: '예외',
  name: '회수 기록은 되돌릴 수 없다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);
    const rp = await t.val(
      `select id from record_print_log('WORK_ORDER',${HASH},$1)`, [wo.id]);
    await t.rows(`select retrieve_print($1,'오기 발견')`, [rp]);

    await t.rejects(() => t.rows(
      `update record_print set retrieved_at = null where id = $1`, [rp]),
      { ...BLOCKED, message: '회수 기록은 되돌릴 수 없습니다' });
  },
},

// ---- 결함 6 · 반납 ----------------------------------------------------------

{
  id: 'RV2-12', expect: '예외',
  name: '투입한 것보다 많이 반납할 수 없다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.worker);
    const pr = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
       values ($1,$2,1,current_date,$3) returning id`,
      [wo.id, m.ops['WS-DX2401-03'], m.worker]);
    const lot = await newMaterialLot(t, m, m.reagent, { qty: 50 });
    const mi = await t.val(
      `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
       values ($1,$2,2,$3) returning id`, [pr, lot, m.worker]);

    const left = () => t.val(`select qty_available from material_lot where id=$1`, [lot]);
    const before = Number(await left());

    await t.resolves(() => t.rows(`select return_material_issue($1,2,'중복 기입')`, [mi]));
    t.eq(Number(await left()), before + 2, '한 번 반납한 뒤 잔여');

    /* 두 번째는 누적을 세어 막는다. 전에는 몇 번이든 통과했다 */
    await t.rejects(() => t.rows(`select return_material_issue($1,2,'중복 기입')`, [mi]),
      { ...BLOCKED, message: '많이 반납할 수 없습니다' });
    t.eq(Number(await left()), before + 2, '거부된 뒤 잔여');
  },
},

{
  id: 'RV2-13', expect: '예외',
  name: '잠긴 묶음에는 반납도 걸리지 않는다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.worker);
    const pr = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
       values ($1,$2,1,current_date,$3) returning id`,
      [wo.id, m.ops['WS-DX2401-03'], m.worker]);
    const lot = await newMaterialLot(t, m, m.reagent, { qty: 50 });
    const mi = await t.val(
      `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
       values ($1,$2,2,$3) returning id`, [pr, lot, m.worker]);

    await t.rows(`select print_day_record($1,1,$2,${HASH})`, [wo.id, m.worker]);

    /* 0041 은 "잠금은 이미 트리거가 막고 있다" 고 적었으나 재고 증감에는 없었다 */
    await t.rejects(() => t.rows(`select return_material_issue($1,1,'중복 기입')`, [mi]),
      { ...BLOCKED, message: 'S04' });
  },
},

{
  id: 'RV2-14', expect: '통과',
  name: '이미 마감된 묶음은 남이라도 다시 뽑을 수 있다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const other = await t.newUser({ full_name: '검토자작업' });
    await t.rows(`insert into user_role (user_id, role) values ($1,'WORKER')`, [other]);

    await t.setActor(m.admin);
    await t.rows(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
       values ($1,$2,1,current_date,$3)`,
      [wo.id, m.ops['WS-DX2401-01'], m.worker]);

    /* 본인이 마감한다 */
    await t.setActor(m.worker);
    const [first] = await t.rows(
      `select seq from print_day_record($1,1,$2,${HASH})`, [wo.id, m.worker]);

    /*
     * 남이 다시 뽑는다. 재인쇄는 마감이 아니다 - 이미 잠겨 있어 잠글 것이 없고
     * 기록도 바뀌지 않는다. 막으면 검토자가 남의 기록지를 볼 길이 없다.
     */
    await t.setActor(other);
    const [again] = await t.rows(
      `select seq from print_day_record($1,1,$2,${HASH})`, [wo.id, m.worker]);

    if (Number(again.seq) !== Number(first.seq) + 1) {
      throw new Error(`재인쇄 회차가 오르지 않았습니다 (${first.seq} → ${again.seq})`);
    }

    /* 잠금은 처음 마감한 사람 것 그대로다. 재인쇄가 잠금을 바꾸지 않는다 */
    const [lock] = await t.rows(
      `select locked_by from day_lock
        where work_order_id=$1 and day_no=1 and worker_id=$2`, [wo.id, m.worker]);
    if (lock.locked_by !== m.worker) {
      throw new Error('재인쇄가 잠금 기록을 바꿨습니다');
    }

    /* 뽑은 사람은 남는다 */
    const [who] = await t.rows(
      `select printed_by from record_print
        where kind='DAY_RECORD' and work_order_id=$1 and day_no=1 and seq=$2`,
      [wo.id, again.seq]);
    if (who.printed_by !== other) {
      throw new Error('누가 뽑았는지가 남지 않았습니다');
    }
  },
},

{
  id: 'RV2-15', expect: '예외',
  name: '마감 전에는 여전히 남이 뽑을 수 없다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const other = await t.newUser({ full_name: '남작업자' });
    await t.rows(`insert into user_role (user_id, role) values ($1,'WORKER')`, [other]);

    await t.setActor(m.admin);
    await t.rows(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
       values ($1,$2,1,current_date,$3)`,
      [wo.id, m.ops['WS-DX2401-01'], m.worker]);

    await t.setActor(other);
    await t.rejects(() => t.rows(
      `select print_day_record($1,1,$2,${HASH})`, [wo.id, m.worker]),
      { ...BLOCKED, message: '아직 마감되지 않은' });
  },
},
];
