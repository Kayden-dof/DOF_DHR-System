/* ---------------------------------------------------------------------------
   열람이 대장에 아무것도 남기지 않는가

     npm run view

   이 시스템에서 인쇄 화면을 여는 것은 쓰기다. 열람이 그 성질을 물려받으면
   "다시 보기" 를 누를 때마다 회차가 올라 앞 종이가 회수 대상이 된다.
   그러니 **대장 줄 수를 세어** 확인한다.
--------------------------------------------------------------------------- */
import pg from 'pg';
import { pgSsl } from './pgssl.mjs';
import { sessionCookie, visibleText } from './session-cookie.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3100';
const url = process.env.DATABASE_URL;
const c = new pg.Client({ connectionString: url, ssl: pgSsl(url, process.cwd()) });
await c.connect();
const rows = async (s, p = []) => (await c.query(s, p)).rows;
const one = async (s, p = []) => (await rows(s, p))[0];
const v = async (s, p = []) => Object.values(await one(s, p) ?? {})[0];

let bad = 0;
const ok = (cond, what, extra = '') => {
  if (!cond) bad++;
  console.log(`  ${cond ? '맞음' : '틀림'}  ${what}${extra ? ' · ' + extra : ''}`);
};

const who = Object.fromEntries((await rows(
  `select login_code, id from app_user where can_login`)).map((u) => [u.login_code, u.id]));
const MGR = sessionCookie(who['100200']);      // 생산관리자
const VIEW = sessionCookie(who['800100']);     // 경영열람 (읽기 전용)

/* 공정 기록이 있는 배치를 고른다. 이름을 박으면 다른 DB 에서 안 돈다 */
const woId = await v(
  `select pr.work_order_id from process_record pr
    where pr.product_lot_id is null
    group by pr.work_order_id order by count(*) desc limit 1`);
if (!woId) { console.error('공정 기록이 있는 배치가 없습니다'); process.exit(2); }
const day = await one(
  `select day_no, worker_id from process_record
    where work_order_id = $1 and product_lot_id is null order by day_no limit 1`, [woId]);

const logCount = () => v(`select count(*)::int from record_print`);
const get = async (path, ck) => {
  const r = await fetch(BASE + path, { headers: { cookie: ck }, redirect: 'manual' });
  return { status: r.status, text: visibleText(await r.text()).replace(/\s{2,}/g, ' ') };
};

/* ── 1. 발행은 대장에 남는다 (전과 같아야 한다) ───────────────────────── */
console.log('\n[1] 발행은 대장에 남는다');
{
  const before = await logCount();
  const r = await get(`/print/cover/${woId}`, MGR);
  const after = await logCount();
  ok(r.status === 200, '편철 표지 발행', `HTTP ${r.status}`);
  ok(after === before + 1, '대장이 한 줄 늘었다', `${before} → ${after}`);
}

/* ── 2. 열람은 대장에 남지 않는다 ────────────────────────────────────── */
console.log('\n[2] 열람은 대장에 남지 않는다');
const KINDS = [
  ['편철 표지',   `/print/cover/${woId}`],
  ['작업 지시서', `/print/work-order/${woId}`],
  ['라벨요청서',  `/print/label-request/${woId}`],
  ['제조기록서',  `/print/day-record/${woId}/${day.day_no}/${day.worker_id}`],
];
for (const [label, path] of KINDS) {
  const before = await logCount();
  const r = await get(`${path}?view=1`, MGR);
  const after = await logCount();
  ok(r.status === 200 && after === before, `${label} 열람`,
     `HTTP ${r.status} · 대장 ${before} → ${after}`);
  ok(r.text.includes('열람'), `${label} 에 열람 표시`);
  /*
   * 나간 적이 있는 양식만 "안 남는다" 를 낸다. 안 나간 것은 그렇다고 말하고
   * 내용을 그리지 않는다 - 처음에 이 갈래를 안 세워 헛경보를 냈다.
   */
  const issued = !r.text.includes('아직 발행된 적이 없습니다');
  ok(issued
      ? r.text.includes('인쇄 대장에 남지 않습니다')
      : !r.text.includes('서명'),
     `${label} · ${issued ? '안 남는다는 말' : '안 나간 것은 내용을 안 그린다'}`);
}

/* ── 3. 자료가 그대로면 그렇다고, 바뀌었으면 바뀌었다고 ──────────────── */
console.log('\n[3] 그때 자료와 견주는가');
{
  const r = await get(`/print/cover/${woId}?view=1`, MGR);
  ok(r.text.includes('그 종이에 찍힌 자료 그대로입니다')
     || r.text.includes('자료가 바뀌었습니다'), '견준 결과를 적는다');

  /*
   * 자료를 바꿔 놓고 다시 본다.
   *
   * 기록을 손으로 고치지 않는다 - 편철 표지는 일차별 **기록서 매수**를 담으므로
   * (§7), 제조기록서를 한 번 더 뽑으면 표지의 자료가 실제로 달라진다. 시스템이
   * 정상으로 하는 일로 바꾼다.
   */
  await get(`/print/day-record/${woId}/${day.day_no}/${day.worker_id}`, MGR);
  const r2 = await get(`/print/cover/${woId}?view=1`, MGR);
  ok(r2.text.includes('그 종이가 나간 뒤에 자료가 바뀌었습니다'), '바뀐 것을 짚는다');
}

/* ── 4. 읽기 전용 세션 - 발행은 막고 열람은 연다 ─────────────────────── */
console.log('\n[4] 경영열람 계정');
{
  const before = await logCount();
  const issue = await get(`/print/cover/${woId}`, VIEW);
  ok(issue.text.includes('권한') || issue.text.includes('발행'), '발행은 막힌다');
  ok(!issue.text.includes('편철 서류 목록'), '종이 내용이 안 나온다');

  const read = await get(`/print/cover/${woId}?view=1`, VIEW);
  const after = await logCount();
  ok(read.status === 200 && read.text.includes('열람'), '열람은 열린다',
     `HTTP ${read.status}`);
  ok(after === before, '경영열람이 대장을 건드리지 않았다', `${before} → ${after}`);
}

/* ── 5. 나간 적 없는 양식은 내용을 안 보여 준다 ──────────────────────── */
console.log('\n[5] 나간 적 없는 것');
{
  const fresh = await v(
    `select wo.id from work_order wo
      where not exists (select 1 from record_print rp
                         where rp.work_order_id = wo.id and rp.kind = 'COVER')
      limit 1`);
  if (!fresh) { console.log('  건너뜀  편철 표지를 안 뽑은 배치가 없습니다'); }
  else {
    const r = await get(`/print/cover/${fresh}?view=1`, MGR);
    ok(r.text.includes('아직 발행된 적이 없습니다'), '그렇다고 말한다');
    ok(!r.text.includes('편철 서류 목록'), '내용을 안 그린다');
  }
}

/* ── 6. 출하 승인 요청서 (0105) ──────────────────────────────────────── */
//
// 이 양식만 담긴 내용이 주소에 있었고 대장에 없었다. 그래서 열람이 안 됐고,
// 발행한 뒤에는 그 종이가 무엇을 요청했는지 시스템이 몰랐다.
console.log('\n[6] 출하 승인 요청서');
{
  const lots = await rows(
    `select pl.id, pl.lot_no, pl.qty_available
       from product_lot pl
      where pl.work_order_id = $1 and pl.qty_available > 0
      order by pl.lot_no limit 2`, [woId]);

  if (lots.length < 2) {
    console.log('  건너뜀  요청할 잔여가 둘 이상인 배치가 없습니다');
  } else {
    /* 두 로트를 담아 한 장 발행한다 */
    const selA = `${lots[0].id}:1,${lots[1].id}:2`;
    const a = await get(`/print/release-request/${woId}?sel=${selA}`, MGR);
    ok(a.status === 200, '두 로트를 담아 발행', `HTTP ${a.status}`);

    const seqA = await v(
      `select max(seq)::int from record_print
        where kind = 'RELEASE_REQUEST' and work_order_id = $1`, [woId]);
    const saved = await rows(
      `select l.product_lot_id, l.qty from record_print_lot l
         join record_print rp on rp.id = l.record_print_id
        where rp.kind = 'RELEASE_REQUEST' and rp.work_order_id = $1 and rp.seq = $2
        order by l.qty`, [woId, seqA]);
    ok(saved.length === 2, '담긴 내용이 대장에 남았다', `${saved.length}줄`);
    ok(Number(saved[0]?.qty) === 1 && Number(saved[1]?.qty) === 2, '수량이 그대로');

    /* 열람은 주소 없이 그 회차를 펼친다 */
    const before = await logCount();
    const r = await get(`/print/release-request/${woId}?view=${seqA}`, MGR);
    const after = await logCount();
    ok(r.status === 200 && after === before, '열람이 대장을 안 건드린다',
       `HTTP ${r.status} · ${before} → ${after}`);
    ok(r.text.includes(lots[0].lot_no) && r.text.includes(lots[1].lot_no),
       '담겼던 두 로트가 그대로 나온다');
    ok(r.text.includes('인쇄 대장에 남지 않습니다'), '열람이라고 말한다');

    /* 한 로트만 담아 **다른** 요청서를 낸다 */
    const b = await get(`/print/release-request/${woId}?sel=${lots[0].id}:1`, MGR);
    ok(b.status === 200, '다른 내용으로 한 장 더', `HTTP ${b.status}`);

    /*
     * 요청서 번호가 RR-{배치}-{회차} 이므로 회차가 오른 것은 **다른 종이**가
     * 나갔다는 뜻이다. 앞 종이를 회수 대상으로 세면 안 된다.
     */
    const stale = await v(
      `select newer_count::int from v_print_lookup
        where kind = 'RELEASE_REQUEST' and work_order_id = $1 and seq = $2`, [woId, seqA]);
    ok(Number(stale) === 0, '다른 요청서를 재출력으로 세지 않는다', `뒤에 ${stale}회`);

    /* 같은 내용을 다시 뽑으면 그건 재출력이다 */
    await get(`/print/release-request/${woId}?sel=${selA}`, MGR);
    const real = await v(
      `select newer_count::int from v_print_lookup
        where kind = 'RELEASE_REQUEST' and work_order_id = $1 and seq = $2`, [woId, seqA]);
    ok(Number(real) === 1, '같은 내용을 다시 뽑으면 재출력으로 센다', `뒤에 ${real}회`);
  }
}

/* ── 7. 담긴 내용은 고쳐 쓰지 못한다 ─────────────────────────────────── */
console.log('\n[7] 담긴 내용은 고쳐 쓰지 못한다');
{
  const line = await one(
    `select record_print_id, product_lot_id, qty from record_print_lot limit 1`);
  if (!line) { console.log('  건너뜀  담긴 줄이 없습니다'); }
  else {
    let blocked = false;
    await c.query('begin');
    try {
      await c.query('set local role app_role');
      await c.query(`select set_config('app.user_id', $1, true)`, [mgr]);
      await c.query(
        `update record_print_lot set qty = qty + 1
          where record_print_id = $1 and product_lot_id = $2`,
        [line.record_print_id, line.product_lot_id]);
      await c.query('commit');
    } catch { blocked = true; await c.query('rollback'); }
    ok(blocked, '수량 고쳐 쓰기가 막힌다');

    let delBlocked = false;
    await c.query('begin');
    try {
      await c.query('set local role app_role');
      await c.query(`select set_config('app.user_id', $1, true)`, [mgr]);
      await c.query(`delete from record_print_lot where record_print_id = $1`,
                    [line.record_print_id]);
      await c.query('commit');
    } catch { delBlocked = true; await c.query('rollback'); }
    ok(delBlocked, '지우기가 막힌다');
  }
}

await c.end();
console.log('\n' + '='.repeat(70));
console.log(bad === 0 ? '전부 맞음' : `${bad}건 어긋남`);
console.log('='.repeat(70));
process.exit(bad === 0 ? 0 : 1);
