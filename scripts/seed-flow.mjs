/* ---------------------------------------------------------------------------
   시연용 전 공정 진행

   seed-demo가 만든 기준정보 위에서 배치 하나를 끝까지 밀어 본다.
   화면을 눌러 만드는 것과 같은 문장을 같은 순서로 쓴다. 규칙을 우회하는
   경로는 쓰지 않는다. 인쇄 잠금(S04)도 그대로 걸리므로 순서를 지켜야 한다.

   운영 자료에는 쓰지 않는다. 로컬 시연 자료를 채우는 용도다.
--------------------------------------------------------------------------- */
import pg from 'pg';
import { createHash } from 'node:crypto';
import { pgSsl } from './pgssl.mjs';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL이 없습니다');

const client = new pg.Client({ connectionString: url, ssl: pgSsl(url, process.cwd()) });
await client.connect();

/** 화면과 같은 방식으로 행위자를 심는다. */
async function as(userId, fn) {
  await client.query('begin');
  try {
    await client.query('set local role app_role');
    await client.query(`select set_config('app.user_id', $1, true)`, [userId]);
    const r = await fn();
    await client.query('commit');
    return r;
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

const one = async (sql, p = []) => (await client.query(sql, p)).rows[0];
const val = async (sql, p = []) => Object.values((await one(sql, p)) ?? {})[0];
const all = async (sql, p = []) => (await client.query(sql, p)).rows;

const say = (s) => console.log(`  ${s}`);

/* -------------------------------------------------------------------------- */

const users = Object.fromEntries(
  (await all(`select login_code, id, full_name from app_user`))
    .map((u) => [u.login_code, u]));

const admin = users['000000'];
const mgrUser = users['100200'];
const w1 = users['200100'];
const w2 = users['200200'];

/** 진행할 배치를 찾는다. 없으면 화면과 같은 절차로 하나 발행한다. */
async function pickWorkOrder() {
  const found = await one(
    `select wo.id, wo.batch_no, wo.sheet_count, wo.device_master_id
       from work_order wo
      where wo.status in ('ISSUED','IN_PROCESS')
      order by wo.issued_at limit 1`);
  if (found) return found;

  const dm = await one(
    `select dm.id, dm.revision from device_master dm
      where dm.verified_at is not null order by dm.effective_from desc limit 1`);
  const raw = await one(
    `select ml.id from material_lot ml join item i on i.id = ml.item_id
      where i.type = 'RAW' and ml.status = 'AVAILABLE'
        and not exists (select 1 from work_order w where w.material_lot_id = ml.id)
      order by ml.received_at limit 1`);
  if (!dm || !raw) return null;

  // 발행자는 생산과 품질 두 사람이어야 한다 (work_order 검사 제약).
  const id = await as(mgrUser.id, async () => {
    const woNo = await val(`select next_number('WORK_ORDER')`);
    const batchNo = await val(`select next_number('BATCH')`);
    return val(
      `insert into work_order (wo_no, batch_no, device_master_id, dmr_revision,
                               material_lot_id, sheet_count, issued_by_prod, issued_by_qa)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [woNo, batchNo, dm.id, dm.revision, raw.id, 20, w1.id, mgrUser.id]);
  });
  return one(
    `select id, batch_no, sheet_count, device_master_id from work_order where id = $1`, [id]);
}

const wo = await pickWorkOrder();

if (!wo) {
  console.log('발행할 제품표준서나 원재료 로트가 없습니다. 기준정보를 먼저 넣으십시오.');
  await client.end();
  process.exit(0);
}
console.log(`배치 ${wo.batch_no}`);

const ops = await all(
  `select id, seq, code, name, after_cutting from dmr_operation
    where device_master_id = $1 order by seq`, [wo.device_master_id]);
const opBy = Object.fromEntries(ops.map((o) => [o.code.replace('-DX2401', ''), o]));

/** 공정 자재 구성표에서 쓸 로트를 찾는다. */
async function bomLots(opId) {
  return all(
    `select b.component_item_id, i.name, i.usage_uom, b.basis, b.qty_per_unit,
            (select ml.id from material_lot ml
              where ml.item_id = b.component_item_id and ml.status = 'AVAILABLE'
                and ml.qty_available > 0
              order by ml.expiry_date nulls last, ml.received_at limit 1) as lot_id
       from dmr_bom b join item i on i.id = b.component_item_id
      where b.operation_id = $1`, [opId]);
}

/** 시작 → 자재 → 마감. 화면의 세 단추와 같다. */
/*
 * 공정 시각이 앞으로 흐르게 한다. 모두 같은 시각으로 넣으면 앞 공정 종료보다 뒤
 * 공정 시작이 빨라져서 검토 지원이 전부 시각 모순으로 잡는다. 시연 자료가
 * 경고를 만들어 내면 진짜 경고가 묻힌다.
 */
let clock = 0;

async function runOp(actor, opCode, { day, lot = null, attempt = 1, units = 0, rotation = null } = {}) {
  const op = opBy[opCode];
  const startMin = 480 + clock * 40;   // 08:00 부터 40분 간격
  clock += 1;
  // 그 공정에 걸린 설비가 있으면 첫 번째를 적는다. 현장에서는 타일로 고른다.
  // 참조를 넣으면 종이에 찍힐 코드는 DB 가 그 시점 대장에서 떠 온다 (0032)
  const equip = await val(
    `select id from operation_equipment_list($1) limit 1`, [op.id]);

  const prId = await as(actor.id, async () => {
    const id = await val(
      `insert into process_record (work_order_id, product_lot_id, operation_id, attempt,
         day_no, work_date, worker_id, rotation_worker_id, equipment_ref, started_at)
       values ($1,$2,$3,$4,$5,(timezone('Asia/Seoul', now()))::date,$6,$7,$9,
               (timezone('Asia/Seoul', now()))::date + ($8 || ' minutes')::interval)
       returning id`,
      [wo.id, lot, op.id, attempt, day, actor.id, rotation, startMin, equip]);
    return id;
  });

  for (const b of await bomLots(op.id)) {
    if (!b.lot_id) continue;
    const qty = await val(`select required_qty($1,$2,$3,$4)`,
      [op.id, b.component_item_id, wo.sheet_count, units]);
    if (qty === null) continue;
    await as(actor.id, () =>
      client.query(
        `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
         values ($1,$2,$3,$4)`, [prId, b.lot_id, qty, actor.id]));
  }

  await as(actor.id, () =>
    client.query(
      `update process_record
          set ended_at = (timezone('Asia/Seoul', now()))::date + ($2 || ' minutes')::interval
        where id = $1`, [prId, startMin + 30]));
  await as(actor.id, () => client.query(`select complete_process($1)`, [prId]));
  say(`${op.code} ${op.name}${lot ? ' · 로트별' : ''} 마감`);
  return prId;
}

/** 일차 마감. 기록서를 인쇄하면 그 묶음이 잠긴다 (S04). */
async function closeDay(actor, day) {
  const payload = await all(
    `select pr.id, pr.day_no, o.code, pr.started_at, pr.ended_at
       from process_record pr join dmr_operation o on o.id = pr.operation_id
      where pr.work_order_id = $1 and pr.day_no = $2 and pr.worker_id = $3
      order by o.seq`, [wo.id, day, actor.id]);
  if (payload.length === 0) return;

  const hash = createHash('sha256')
    .update(JSON.stringify(payload)).digest('hex').slice(0, 12);   // 앱과 같게 소문자로 둔다

  await as(actor.id, async () => {
    const seq = await val(
      `select coalesce(max(seq),0) + 1 from record_print
        where kind='DAY_RECORD' and work_order_id=$1 and day_no=$2 and worker_id=$3`,
      [wo.id, day, actor.id]);
    await client.query(
      `insert into record_print (kind, work_order_id, day_no, worker_id, seq, data_hash, printed_by)
       values ('DAY_RECORD',$1,$2,$3,$4,$5,$6)`,
      [wo.id, day, actor.id, seq, hash, actor.id]);
    await client.query(
      `insert into day_lock (work_order_id, day_no, worker_id, locked_by)
       values ($1,$2,$3,$4) on conflict do nothing`,
      [wo.id, day, actor.id, actor.id]);
  });
  say(`${day}일차 ${actor.full_name} 마감 · 기록서 발행 (자료 식별자 ${hash})`);
}

/* --- 1일차. 재단 전 공정 ------------------------------------------------- */

console.log('\n[1일차] 재단 전 공정');

const open = await one(
  `select id from process_record where work_order_id=$1 and ended_at is null limit 1`, [wo.id]);
if (open) {
  await as(w1.id, () => client.query(`select complete_process($1)`, [open.id]));
  say('화면에서 시작해 둔 공정을 마감');
}

const doneCodes = new Set(
  (await all(
    `select o.code from process_record pr join dmr_operation o on o.id=pr.operation_id
      where pr.work_order_id=$1`, [wo.id])).map((r) => r.code.replace('-DX2401', '')));

for (const code of ['WS-01', 'WS-02', 'WS-03', 'WS-04']) {
  if (!doneCodes.has(code)) await runOp(w1, code, { day: 1 });
}

// WS-05 세척. pH 8 초과로 한 번 더 돌린 회차를 남긴다.
await runOp(w1, 'WS-05', { day: 1 });
await runOp(w1, 'WS-05', { day: 1, attempt: 2 });
say('WS-05 재세척 2회차 (pH 8 초과)');

// 같은 날 두 번째 작업자. 기록지가 따로 나오고 잠금도 따로 걸린다.
await runOp(w2, 'WS-06', { day: 1 });

await closeDay(w1, 1);
await closeDay(w2, 1);

/* --- 2일차. 검사와 재단 --------------------------------------------------- */

console.log('\n[2일차] 1차 반제품 검사와 재단');

await runOp(w1, 'PI-01', { day: 2 });
await runOp(w1, 'WS-07', { day: 2, rotation: w2.id });

const cuts = [
  { code: 'PD05050510', qty: 120, sample: 3 },
  { code: 'PD05100510', qty: 60, sample: 2 },
  { code: 'PD10100510', qty: 24, sample: 2 },
];
const lots = [];
for (const c of cuts) {
  const itemId = await val(`select id from item where code = $1`, [c.code]);
  const id = await as(mgrUser.id, () =>
    val(`select cut_product_lot($1,$2,$3,$4,(timezone('Asia/Seoul', now()))::date)`,
      [wo.id, itemId, c.qty, c.sample]));
  const lot = await one(`select id, lot_no, item_id, qty_produced, qty_available
                           from product_lot where id = $1`, [id]);
  lots.push(lot);
  say(`재단 ${c.code} → 제조번호 ${lot.lot_no} (생산 ${c.qty}, 샘플 ${c.sample})`);
}

await closeDay(w1, 2);

/* --- 3일차. 재단 이후 공정 ------------------------------------------------ */

console.log('\n[3일차] 포장과 검사');

for (const lot of lots) {
  await runOp(w2, 'WS-08', { day: 3, lot: lot.id, units: lot.qty_produced });
  await runOp(w2, 'PI-02', { day: 3, lot: lot.id, units: lot.qty_produced });
}
await as(mgrUser.id, () =>
  client.query(`update product_lot set status='PACKED' where id = any($1)`,
    [lots.map((l) => l.id)]));
await closeDay(w2, 3);

/* --- 멸균 위탁 ------------------------------------------------------------ */

console.log('\n[멸균] 외부 위탁');

const sb = await as(mgrUser.id, async () => {
  const no = await val(`select next_number('STERIL_BATCH')`);
  const id = await val(
    `insert into steril_batch (batch_no, request_no, vendor_name, registered_by)
     values ($1,$2,$3,$4) returning id`,
    [no, 'REQ-2608-01', '한국멸균서비스', mgrUser.id]);
  for (const l of lots) {
    await client.query(
      `insert into steril_batch_lot (steril_batch_id, product_lot_id, qty) values ($1,$2,$3)`,
      [id, l.id, l.qty_available]);
  }
  await client.query(
    `update steril_batch
        set shipped_at = (timezone('Asia/Seoul', now()))::date - 2,
            received_at = (timezone('Asia/Seoul', now()))::date,
            cert_no = 'STC-2608-0007'
      where id = $1`, [id]);
  return { id, no };
});
say(`멸균 배치 ${sb.no} 발송·회수 · 성적서 STC-2608-0007`);

console.log('\n[4일차] 멸균 기록과 완제품 검사');
for (const lot of lots) {
  await runOp(w1, 'WS-09', { day: 4, lot: lot.id, units: lot.qty_produced });
  await runOp(w1, 'FI-01', { day: 4, lot: lot.id, units: lot.qty_produced });
}
await closeDay(w1, 4);

/* --- 출하 승인과 출고 ------------------------------------------------------ */

console.log('\n[출하] 서면 승인 전사와 출고');

for (const lot of lots) {
  await as(mgrUser.id, () =>
    client.query(
      `update product_lot set release_approved_by = $2,
              release_approved_on = (timezone('Asia/Seoul', now()))::date,
              status = 'RELEASE_APPROVED'
        where id = $1`, [lot.id, '정품질']));
}
say('제품 로트 3건에 서면 승인자 정품질 기록');

const ship = lots[0];
await as(mgrUser.id, () =>
  client.query(
    `insert into shipment (product_lot_id, customer_name, qty, shipped_at, shipped_by,
                           release_request_no)
     values ($1,$2,$3,(timezone('Asia/Seoul', now()))::date,$4,$5)`,
    // 승인서 번호 없이는 출고가 기록되지 않는다 (0026). 시연 값은 1회차 형식
    [ship.id, '서울대학교병원', 40, mgrUser.id, 'RR-' + wo.batch_no + '-01']));
say(`출고 ${ship.lot_no} 40개 · 서울대학교병원`);

/* --- 재고 증감 ------------------------------------------------------------ */

console.log('\n[재고] 반납·폐기·용액 제조');

const naclLot = await one(
  `select ml.id, ml.lot_no from material_lot ml join item i on i.id = ml.item_id
    where i.code = 'RG-003' and ml.status='AVAILABLE' limit 1`);
if (naclLot) {
  await as(w1.id, () =>
    client.query(
      `insert into stock_movement (material_lot_id, type, qty, work_order_id,
                                   reason_code, reason_detail, registered_by)
       values ($1,'RETURN',$2,$3,$4,$5,$6)`,
      [naclLot.id, 1.5, wo.id, '계량오차', '계량 후 남은 분량을 원 로트로 되돌림', w1.id]));
  say(`반납 ${naclLot.lot_no} +1.5`);

  await as(w1.id, () =>
    client.query(
      `insert into stock_movement (material_lot_id, type, qty, work_order_id,
                                   reason_code, reason_detail, registered_by)
       values ($1,'DISPOSAL_WIP',$2,$3,$4,$5,$6)`,
      [naclLot.id, -0.5, wo.id, '오염', '용기 낙하로 오염', w1.id]));
  say(`공정 폐기 ${naclLot.lot_no} -0.5`);
}

const solution = await one(`select id, code from item where code = 'RG-005'`);
if (solution) {
  const ethanol = await one(
    `select ml.id from material_lot ml join item i on i.id=ml.item_id
      where i.code='RG-004' and ml.status='AVAILABLE' limit 1`);
  if (ethanol) {
    await as(w2.id, () =>
      client.query(
        `insert into stock_movement (material_lot_id, type, qty, reason_code,
                                     reason_detail, registered_by)
         values ($1,'SOLUTION',$2,$3,$4,$5)`,
        [ethanol.id, -2, '용액제조', '30% 에탄올 희석액 당일 제조', w2.id]));
    say('용액 제조로 에탄올 2 차감');
  }
}

/* -------------------------------------------------------------------------- */

console.log('\n요약');
console.table(await all(
  `select wo.batch_no, wo.status::text as status,
          (select count(*) from process_record where work_order_id=wo.id) as records,
          (select count(*) from product_lot where work_order_id=wo.id) as lots,
          (select count(*) from day_lock where work_order_id=wo.id) as locks
     from work_order wo where wo.id = $1`, [wo.id]));

await as(mgrUser.id, () =>
  client.query(`update work_order set status='DONE' where id=$1`, [wo.id]));

/* --- 진행 중인 배치 하나를 남긴다 ------------------------------------------ */

// 끝난 배치만 있으면 현황 화면이 통째로 비어 화면을 볼 수가 없다.
// 실제 운영도 늘 진행 중인 배치가 하나쯤 있다.
console.log('\n[진행 중] 두 번째 배치');

const wo2 = await pickWorkOrder();
if (wo2) {
  Object.assign(wo, wo2);   // runOp 가 참조하는 배치를 바꾼다
  say(`배치 ${wo2.batch_no} 발행`);
  await runOp(w1, 'WS-01', { day: 1 });
  await runOp(w1, 'WS-02', { day: 1 });

  // 마지막 공정은 마감하지 않고 남긴다. 현황의 "마감 안 된 공정"이 실제로 잡힌다.
  await as(w1.id, () =>
    client.query(
      `insert into process_record (work_order_id, operation_id, day_no, work_date,
                                   worker_id, started_at)
       values ($1,$2,1,(timezone('Asia/Seoul', now()))::date,$3, now() - interval '40 minutes')`,
      [wo2.id, opBy['WS-03'].id, w1.id]));
  say('WS-03 알칼리 처리 진행 중 (마감 전)');

  await as(mgrUser.id, () =>
    client.query(`update work_order set status='IN_PROCESS' where id=$1`, [wo2.id]));
}

await client.end();
