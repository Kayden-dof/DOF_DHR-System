/* ---------------------------------------------------------------------------
   열람이 대장에 아무것도 남기지 않는가

     npm run view

   대장에 쓰는 자리는 인쇄 단추 하나다 (2026-09-16). 화면을 여는 것은 - 발행할
   화면이든 열람이든 - 아무것도 남기지 않는다. 그 규율이 지켜지는지 **대장 줄
   수를 세어** 확인한다.

   전에는 여는 것이 곧 발행이었고, 그때 이 시험이 물은 것은 "열람만은 안 쓰는가"
   였다. 이제 묻는 것이 하나 늘었다 - **미리보기도 안 쓰는가.** 그 자리가
   무너지면 화면을 한 번 훑는 것만으로 대장이 부푼다. 실제로 그랬다 - 화면 훑기
   한 번이 아홉 줄을 남겼다.
--------------------------------------------------------------------------- */
import pg from 'pg';
import { pgSsl } from './pgssl.mjs';
import { sessionCookie, visibleText } from './session-cookie.mjs';
import { printOut, tickets } from './issue-print.mjs';

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

/* 품질책임자는 역할로 고른다 - 로그인 번호를 박으면 다른 제조소에서 안 돈다 */
const qpId = await v(
  `select u.id from app_user u join user_role r on r.user_id = u.id
    where r.role = 'QP' and u.can_login limit 1`);
const QP = qpId ? sessionCookie(qpId) : null;

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

/* 발행권을 긁으려면 태그가 벗겨지지 않은 원문이 필요하다 */
const raw = async (path, ck) =>
  (await fetch(BASE + path, { headers: { cookie: ck }, redirect: 'manual' })).text();

/* ── 1. 여는 것은 남지 않고, 단추가 남긴다 ───────────────────────────── */
console.log('\n[1] 여는 것은 남지 않고, 단추가 남긴다');
{
  const before = await logCount();
  const r = await get(`/print/cover/${woId}`, MGR);
  const opened = await logCount();
  ok(r.status === 200, '편철 표지 미리보기', `HTTP ${r.status}`);
  ok(opened === before, '화면을 열어도 대장이 그대로다', `${before} → ${opened}`);
  ok(r.text.includes('아직 발행되지 않았습니다'), '미발행이라고 종이에 적는다');

  /* 사람이 하는 것과 같은 순서 - 화면이 내준 발행권으로 발행한다 */
  const out = await printOut(BASE, `/print/cover/${woId}`, MGR);
  const after = await logCount();
  ok(out.issued.length === 1 && out.issued[0]?.ok === true, '인쇄 단추가 발행한다',
     out.issued[0]?.reason ?? '');
  ok(after === opened + 1, '그때 대장이 한 줄 는다', `${opened} → ${after}`);
  ok(out.issued[0]?.meta?.preview !== true, '발행된 것에는 미발행 표시가 없다');
}

/* ── 1-2. 발행권 없이는 대장에 닿지 못한다 ───────────────────────────── */
console.log('\n[1-2] 발행권 없이는 대장에 닿지 못한다');
{
  const post = async (body, ck = MGR, extra = {}) => {
    const r = await fetch(`${BASE}/print/issue`, {
      method: 'POST',
      headers: { cookie: ck, 'content-type': 'application/json', ...extra },
      body: JSON.stringify(body),
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  };

  let before = await logCount();
  let r = await post({ ticket: 'eyJrIjoiQ09WRVIifQ.ZGllIHNpZ25hdHVyZQ' });
  ok(r.json?.ok === false && (await logCount()) === before, '지어낸 발행권은 거부된다');

  before = await logCount();
  r = await post({});
  ok(r.json?.ok === false && (await logCount()) === before, '빈 요청은 거부된다');

  /* 열람 화면은 발행권을 내주지 않는다 - 거절하기 전에 줄 것이 없다 */
  ok(tickets(await raw(`/print/cover/${woId}?view=1`, MGR)).length === 0,
     '열람 화면에는 발행권이 실리지 않는다');

  /* 다른 자리에서 건너온 요청도 받지 않는다 */
  before = await logCount();
  const good = tickets(await raw(`/print/work-order/${woId}`, MGR))[0];
  r = await post({ ticket: good }, MGR, { origin: 'http://evil.example' });
  ok(r.status === 403 && (await logCount()) === before, '다른 출처에서는 발행되지 않는다',
     `HTTP ${r.status}`);
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
  const again = await printOut(
    BASE, `/print/day-record/${woId}/${day.day_no}/${day.worker_id}`, MGR);
  ok(again.issued[0]?.ok === true, '제조기록서를 한 번 더 뽑는다',
     again.issued[0]?.reason ?? '');
  const r2 = await get(`/print/cover/${woId}?view=1`, MGR);
  ok(r2.text.includes('그 종이가 나간 뒤에 자료가 바뀌었습니다'), '바뀐 것을 짚는다');
}

/* ── 4. 읽기 전용 세션 - 발행은 막고 열람은 연다 ─────────────────────── */
console.log('\n[4] 경영열람 계정');
{
  const before = await logCount();
  const issue = await get(`/print/cover/${woId}`, VIEW);
  ok(issue.text.includes('권한 없음'), '미리보기가 막힌다');
  ok(!issue.text.includes('편철 서류 목록'), '종이 내용이 안 나온다');

  const read = await get(`/print/cover/${woId}?view=1`, VIEW);
  const after = await logCount();
  ok(read.status === 200 && read.text.includes('열람'), '열람은 열린다',
     `HTTP ${read.status}`);
  ok(after === before, '경영열람이 대장을 건드리지 않았다', `${before} → ${after}`);
}

/* ── 4-2. 품질책임자 - 미리보기까지 들어온다 (사용자 지시 2026-09-16) ── */
//
// 종이에 이름이 오르는 사람이다. 그 종이가 나가기 전에 무엇이 담기는지 볼
// 자리가 있어야 한다. 다만 발행하지는 않는다 - 발행권이 실리지 않는다.
console.log('\n[4-2] 품질책임자');
if (!QP) {
  console.log('  건너뜀  품질책임자 계정이 없습니다');
} else {
  const before = await logCount();
  const r = await get(`/print/cover/${woId}`, QP);
  ok(r.status === 200 && !r.text.includes('권한 없음'), '미리보기가 열린다',
     `HTTP ${r.status}`);
  ok(r.text.includes('편철 서류 목록'), '종이 내용이 나온다');
  ok(r.text.includes('아직 발행되지 않았습니다'), '미발행이라고 적는다');
  ok(tickets(await raw(`/print/cover/${woId}`, QP)).length === 0,
     '발행권이 실리지 않는다');
  ok(r.text.includes('발행은 생산관리자가 합니다'), '누가 발행하는지 적는다');
  ok((await logCount()) === before, '대장을 건드리지 않았다',
     `${before} → ${await logCount()}`);
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
    const a = await printOut(BASE, `/print/release-request/${woId}?sel=${selA}`, MGR);
    ok(a.status === 200 && a.issued[0]?.ok === true, '두 로트를 담아 발행',
       `HTTP ${a.status}${a.issued[0]?.reason ? ' · ' + a.issued[0].reason : ''}`);

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
    const b = await printOut(BASE, `/print/release-request/${woId}?sel=${lots[0].id}:1`, MGR);
    ok(b.status === 200 && b.issued[0]?.ok === true, '다른 내용으로 한 장 더',
       `HTTP ${b.status}`);

    /*
     * 요청서 번호가 RR-{배치}-{회차} 이므로 회차가 오른 것은 **다른 종이**가
     * 나갔다는 뜻이다. 앞 종이를 회수 대상으로 세면 안 된다.
     */
    const stale = await v(
      `select newer_count::int from v_print_lookup
        where kind = 'RELEASE_REQUEST' and work_order_id = $1 and seq = $2`, [woId, seqA]);
    ok(Number(stale) === 0, '다른 요청서를 재출력으로 세지 않는다', `뒤에 ${stale}회`);

    /* 같은 내용을 다시 뽑으면 그건 재출력이다 */
    await printOut(BASE, `/print/release-request/${woId}?sel=${selA}`, MGR);
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

/* ── 8. 화면의 보기가 실제로 어딘가로 가는가 ─────────────────────────── */
//
// 여기까지는 전부 주소를 직접 쳐서 확인했다. 그래서 **화면의 보기 단추가 죽어
// 있어도 다 통과했다** - 실제로 죽어 있었다. 배치 상세가 work_order_id 를 거르는
// 데만 쓰고 뽑지 않아 viewHref 가 전부 null 을 냈고, 인쇄 이력 여섯 줄이 통째로
// "보기 없음" 이었다 (2026-09-09).
//
// 사람이 누르는 자리에서 확인한다.
console.log('\n[8] 화면의 보기');
{
  const b = await get(`/production/${woId}`, MGR);
  const dead = (b.text.match(/보기 없음/g) ?? []).length;
  const live = (b.text.match(/보기/g) ?? []).length - dead;
  ok(dead === 0, '배치 상세에 죽은 보기가 없다', `"보기 없음" ${dead}개`);
  ok(live > 0, '배치 상세에 살아 있는 보기가 있다', `${live}개`);

  /* 그 주소가 실제로 열리는가 - 링크가 있다고 열리는 것은 아니다 */
  const m = b.text.match(/보기/) ? await rows(
    `select id, kind::text as kind, seq, work_order_id, day_no, worker_id,
            material_lot_id, equipment_id
       from v_print_lookup where work_order_id = $1 limit 1`, [woId]) : [];
  if (m.length) {
    const p = m[0];
    const path = p.kind === 'DAY_RECORD'
      ? `/print/day-record/${p.work_order_id}/${p.day_no}/${p.worker_id}?view=${p.seq}`
      : `/print/${p.kind === 'COVER' ? 'cover'
          : p.kind === 'WORK_ORDER' ? 'work-order'
          : p.kind === 'LABEL_REQUEST' ? 'label-request'
          : 'release-request'}/${p.work_order_id}?view=${p.seq}`;
    const r = await get(path, MGR);
    ok(r.status === 200 && r.text.includes('열람'), '그 주소가 열린다', `HTTP ${r.status}`);
  }

  const h = await v(
    `select short_hash from v_print_lookup where work_order_id = $1 limit 1`, [woId]);
  const f = await get(`/trace/verify?q=${h.slice(0, 6)}`, MGR);
  ok(f.text.includes('그 회차 펼쳐 보기'), '인쇄물 조회에도 펼쳐 보기가 있다');
}

/* ── 9. 같은 자료를 두 번 읽어도 요약값이 같은가 ─────────────────────── */
//
// 재단 이후 공정은 제품 로트마다 한 줄씩이라 (공정, 회차) 가 동점이 된다.
// 차례가 흔들리면 아무것도 안 바뀐 종이를 두고 "값이 다릅니다" 가 뜬다 (§8.5).
console.log('\n[9] 나간 종이가 그때와 같다고 하는가');
{
  const papers = await rows(
    `select work_order_id, day_no, worker_id, seq from v_print_lookup
      where kind = 'DAY_RECORD' order by printed_at`);
  let same = 0; let changed = 0;
  for (const p of papers) {
    const r = await get(
      `/print/day-record/${p.work_order_id}/${p.day_no}/${p.worker_id}?view=${p.seq}`, MGR);
    if (r.text.includes('그 종이에 찍힌 자료 그대로입니다')) same += 1;
    else if (r.text.includes('자료가 바뀌었습니다')) changed += 1;
  }
  ok(changed === 0 && same === papers.length,
     '제조기록서 전부가 그때 자료 그대로다', `그대로 ${same} · 바뀜 ${changed}`);
}

await c.end();
console.log('\n' + '='.repeat(70));
console.log(bad === 0 ? '전부 맞음' : `${bad}건 어긋남`);
console.log('='.repeat(70));
process.exit(bad === 0 ? 0 : 1);
