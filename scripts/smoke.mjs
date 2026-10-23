/* ---------------------------------------------------------------------------
   화면 훑기 시험

     node --env-file=.env.local scripts/smoke.mjs [http://localhost:3100]

   실제 자료가 들어 있는 상태에서 전 화면을 한 번씩 연다. 규칙 시험(test/run.mjs)이
   DB 계층을 보장하고, 이 시험은 그 위의 화면이 실제로 그려지는지를 본다.
   집계 문장의 오류처럼 자료가 있어야만 드러나는 결함을 여기서 잡는다.

   세션 쿠키는 앱과 같은 서명 규칙으로 직접 만든다.
--------------------------------------------------------------------------- */
import pg from 'pg';
import { pgSsl } from './pgssl.mjs';
import { sessionCookie as session } from './session-cookie.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3100';
const url = process.env.DATABASE_URL;

const db = new pg.Client({ connectionString: url, ssl: pgSsl(url, process.cwd()) });
await db.connect();
const rows = async (sql) => (await db.query(sql)).rows;

const ids = {
  wo: (await rows(`select id from work_order order by issued_at limit 1`))[0]?.id,
  /*
   * 고른 배치에 속한 로트를 고른다. 아무 로트나 집으면 출하 승인 요청서가
   * "그 배치의 로트가 아니다" 로 404 가 된다 - 화면이 맞게 구는 것이고
   * 고르는 쪽이 틀린 것이다.
   */
  lot: (await rows(
    `select pl.id from product_lot pl
       join work_order wo on wo.id = pl.work_order_id
      order by wo.issued_at, pl.lot_no limit 1`))[0]?.id,
  /*
   * 입고 로트만 고른다. 원액 로트 번호는 L 로 시작해 번호순으로는 맨 앞에 서므로,
   * 거르지 않으면 이 훑기의 "자재" 경로가 어느 날 조용히 원액 로트로 바뀐다.
   * 원액은 아래에서 따로 열어 본다.
   */
  mat: (await rows(
    `select id from material_lot where made_on is null order by lot_no limit 1`))[0]?.id,
  day: (await rows(
    `select work_order_id, day_no, worker_id from process_record order by day_no limit 1`))[0],
  eq: (await rows(`select id from equipment order by code limit 1`))[0]?.id,
};

/*
 * 원액 로트 하나 (사내 제조 · material_lot.made_on 이 있는 로트).
 *
 * 세 화면(자재 목록 · 자재 추적 · 자재 라벨)이 공급자를 안쪽 결합으로 묶고 있으면
 * 공급자가 없는 원액 로트는 **오류 없이 빠진다.** 목록에서는 한 줄이 없고,
 * 추적과 라벨은 없는 로트라며 404 를 낸다. 위의 훑기는 입고 로트만 고르므로
 * (ids.mat) 그 구멍을 한 번도 밟지 않았다.
 */
const sol = (await rows(
  `select ml.id, ml.lot_no, to_char(ml.made_on, 'YYYY-MM-DD') as made_on
     from material_lot ml where ml.made_on is not null
    order by ml.lot_no limit 1`))[0];
const solInputs = sol ? await rows(
  `select material_lot_id, material_lot_no, item_code from v_solution_input
    where solution_lot_id = '${sol.id}' order by material_lot_no`) : [];
const userIds = Object.fromEntries(
  (await rows(`select login_code, id from app_user`)).map((u) => [u.login_code, u.id]));

/* ---------------------------------------------------------------------------
   훑을 계정이 없으면 그 자리에서 멈춘다 (4차 감사 A4)

   전에는 없는 계정으로 session(undefined) 를 만들었다. 서명은 성한데 사용자
   항목이 빠진 쿠키가 나오고, 앱이 그것을 거부해 307 로 로그인 화면에 넘긴다.
   그런데 307 을 통과로 세고 있었으므로 **전 경로가 통과로 찍혔다.**

   빈 DB 에는 시연 계정이 없다. 그래서 §8.0 이 "새 설치 검사가 §2.0 을 묻는
   유일한 자리" 라고 적은 그 훑기가 화면을 한 장도 그려 보지 않은 채
   "전 화면 통과" 를 찍고 있었다.

   빈 DB 는 이관이 심는 계정으로 훑는다. 밖에서 지정할 수 있게 둔다.
--------------------------------------------------------------------------- */
const ADMIN_CODE = process.env.SMOKE_ADMIN_CODE || '100200';
const WORKER_CODE = process.env.SMOKE_WORKER_CODE || '200100';

/*
 * 원액 확인은 기본으로 **필요하다.** 원액 로트가 없으면 실패한다.
 *
 * 건너뛰는 길은 하나뿐이고 소리 내어 건너뛴다 - SMOKE_SOLUTION=- . 원액 로트가
 * 아직 있을 수 없는 단계(빈 설치, 기준정보만 심은 직후)에서 쓴다. 현장 훑기를
 * SMOKE_WORKER_CODE=- 로 건너뛰는 것과 같은 꼴이다. 건너뛴 훑기는 원액을 확인한
 * 적이 없으므로 끝줄이 그 사실을 다시 적는다 - 통과 근거로 쓰이지 않게.
 */
const SKIP_SOLUTION = process.env.SMOKE_SOLUTION === '-';

const NEEDED = { [ADMIN_CODE]: '관리자 훑기' };
if (WORKER_CODE !== '-') NEEDED[WORKER_CODE] = '현장 훑기';

/* ---------------------------------------------------------------------------
   localhost 만 훑는다 (4차 감사 C3)

   전에는 까닭이 대장이었다 - 인쇄 화면을 여는 것이 곧 발행이라, 다른 서버를
   가리키면 그쪽 대장에 나가지 않은 종이가 쌓였다. 이제 여는 것은 아무것도
   남기지 않으므로(2026-09-16) 그 까닭은 사라졌다.

   그래도 막는다. 이 훑기는 남의 세션 쿠키를 지어내 전 화면을 두드리는 도구다.
   운영을 가리킬 일이 없고, 가리켜서 좋을 일도 없다.
--------------------------------------------------------------------------- */
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE)) {
  console.error('이 훑기는 세션을 지어내 전 화면을 두드립니다.');
  console.error(`  대상: ${BASE}`);
  console.error('');
  console.error('localhost 가 아닌 곳을 가리킬 수 없습니다.');
  await db.end();
  process.exit(2);
}

const printBefore = Number((await rows('select count(*)::int n from record_print'))[0].n);

const missing = Object.entries(NEEDED).filter(([code]) => !userIds[code]);
if (missing.length) {
  console.error('훑을 계정이 없습니다. 이 상태로는 화면을 그려 볼 수 없습니다.');
  for (const [code, what] of missing) console.error(`  ${code}  ${what}`);
  await db.end();
  process.exit(2);
}
await db.end();

/* 끝에서 대장을 다시 세려면 연결이 하나 더 있어야 한다 */
const db2 = new pg.Client({ connectionString: url, ssl: pgSsl(url, process.cwd()) });
await db2.connect();

/* --- 훑을 경로 ------------------------------------------------------------ */

const ADMIN = [
  '/', '/production', '/production/setup', '/production/deviation', '/material', '/material/items', '/material/orders', '/material/stock',
  '/material/movement', '/shipping', '/shipping/steril', '/shipping/ship',
  '/trace', '/trace/verify', '/board', '/board/cost',
  '/settings', '/settings/brand', '/settings/numbering', '/settings/items', '/settings/model', '/settings/suppliers',
  '/settings/product', '/settings/dmr', '/equipment', '/settings/users', '/settings/backup', '/settings/access', '/settings/audit',
  ids.wo && `/production/${ids.wo}`,
  ids.wo && `/print/work-order/${ids.wo}`,
  ids.wo && `/print/day-record/${ids.wo}/all`,
  ids.wo && `/print/label-request/${ids.wo}`,
  ids.wo && `/print/cover/${ids.wo}`,
  ids.mat && `/print/label/${ids.mat}`,
  ids.eq && `/print/equipment-log/${ids.eq}`,
  ids.lot && ids.wo && `/print/release-request/${ids.wo}?sel=${ids.lot}:1`,
  ids.lot && `/trace/product/${ids.lot}`,
  ids.wo && `/trace/batch/${ids.wo}`,
  ids.mat && `/trace/material/${ids.mat}`,
  ids.day && `/print/day-record/${ids.day.work_order_id}/${ids.day.day_no}/${ids.day.worker_id}`,

  /*
   * 열람 (0103). 위 인쇄 경로가 이미 한 번씩 뽑아 놓았으므로 여기서는 나간
   * 회차가 있다. **대장 줄 수는 늘지 않아야 한다** - 아래 셈이 그것을 센다.
   */
  ids.wo && `/print/work-order/${ids.wo}?view=1`,
  ids.wo && `/print/cover/${ids.wo}?view=1`,
  ids.wo && `/print/label-request/${ids.wo}?view=1`,
  ids.mat && `/print/label/${ids.mat}?view=1`,
  ids.eq && `/print/equipment-log/${ids.eq}?view=1`,
  ids.day && `/print/day-record/${ids.day.work_order_id}/${ids.day.day_no}/${ids.day.worker_id}?view=1`,
].filter(Boolean);

const WORKER = ['/work', ids.wo && `/work/${ids.wo}`].filter(Boolean);

/* --- 실행 ----------------------------------------------------------------- */

let bad = 0;

/* ---------------------------------------------------------------------------
   화면이 실제로 그려졌는가

   200 만으로는 아무것도 모른다. 화면이 던지면 app/error.tsx 가 받아 200 으로
   응답하고, 그 오류 화면은 클라이언트 부품이라 첫 HTML 에 실리지도 않는다.
   그래서 완전히 깨진 화면이 "통과 200" 으로 나온다.

   실제로 그랬다. 화면 첫 줄에 throw 를 넣고 돌렸더니 "전 화면 통과" 라고
   했다 (2026-09-01). 하루 종일 이 출력을 근거로 삼고 있었다.

   ── 왜 문구로 찾지 않는가 ─────────────────────────────────────────────────
   전에는 영어 오류 문구 세 개를 찾았다. 이 앱의 오류 화면은 한국어라 걸리지
   않았다. 문구 목록은 문구를 고쳐 쓰는 순간 낡고, 그때 다시 눈이 먼다.

   던진 오류는 React Flight 흐름에 :E{"digest":…} 봉투로 실려 온다. 그것을
   본다. 성한 화면 여덟에서 헛불이 나지 않는 것을 확인했다.
--------------------------------------------------------------------------- */
const RENDER_ERROR = /:E\{\\?"digest\\?":/;

/* ---------------------------------------------------------------------------
   껍데기만 200으로 나가는 화면

   위의 봉투는 **서버 렌더가 던졌을 때**만 실린다. 그런데 이 앱에는 200 을
   내면서 본문이 통째로 비는 길이 하나 더 있다 - 클라이언트 부품이 서버에서
   그려지다 실패하면 React 는 그 자리를 비워 두고 브라우저에게 미룬다. 응답은
   200 이고 봉투도 없다. 브라우저가 하이드레이션에서 같은 곳에 다시 부딪혀
   그제야 죽는다.

   실제로 그랬다 (2026-09-01 · 공급자 화면). 사용자가 "화면 죽어있네" 라고
   알려 주기까지 이 도구는 그 화면을 통과라고 적고 있었다. 두 번째다 - 앞선
   것은 아예 아무것도 못 보던 때다.

   그래서 **본문에 제목이 있는지** 본다. PageShell 과 PrintFrame 이 모든 화면에
   h1 을 그린다. 껍데기(머리줄 · 차림표 · 바닥글)에는 h1 이 없다. 스크립트를
   떼어 내고 h1 이 없으면 그 화면은 자료를 하나도 내보내지 못한 것이다.

   ── 왜 글자 수로 재지 않는가 ──────────────────────────────────────────────
   "본문이 짧으면 실패" 로 하면 비어 있는 것이 정상인 화면(등록된 것이 없는
   목록)에서 헛불이 난다. h1 은 자료가 없어도 그려지므로 그 구분이 선다.
--------------------------------------------------------------------------- */
const SCRIPTS = /<script[\s\S]*?<\/script>/g;
const HAS_TITLE = /<h1[\s>]/;

/* ---------------------------------------------------------------------------
   달력 날짜가 Date 로 건너간 자국

   이 앱의 **달력 날짜**(유효기한 · 승인 만료 · 제조일)는 처음부터 끝까지
   'YYYY-MM-DD' 글자다 (lib/kst). Date 하나가 섞이면 글자로 알고 자르는 자리에서
   던진다. lib/db.ts 가 date 열을 글자로 받게 해 두었으나, 그 계층을 거치지 않는
   길이 새로 나면 다시 열린다.

   ── 시각은 Date 여도 된다 ─────────────────────────────────────────────────
   timestamptz(acted_at · verified_at 같은 것)는 시각이고 Date 가 맞다. fmtDateTime
   이 Asia/Seoul 로 못 박아 그리므로 보는 사람의 시간대와 무관하다. 그래서 흐름에
   실린 Date 를 전부 잡으면 성한 화면 둘이 걸린다 - 실제로 걸렸고, 그런 검사는
   곧 무시당한다.

   ── 그래서 자정만 본다 ────────────────────────────────────────────────────
   달력 날짜가 Date 가 되면 한국 자정, 곧 15:00:00.000Z 로 정확히 떨어진다. 진짜
   시각이 밀리초까지 그 값일 일은 없다. 그 하나만 본다.
--------------------------------------------------------------------------- */
const DATE_CROSSED = /\$D\d{4}-\d{2}-\d{2}T15:00:00\.000Z/;

async function sweep(label, cookie, paths, expectAway = new Set()) {
  console.log(`\n${label}`);
  for (const p of paths) {
    let status = 0; let note = '';
    try {
      const r = await fetch(`${BASE}${p}`, { headers: { cookie }, redirect: 'manual' });
      status = r.status;
      const body = r.status === 200 ? await r.text() : '';
      if (RENDER_ERROR.test(body)) {
        note = '화면이 그려지다 던졌다';
      } else if (/A server error occurred|application error|Internal Server Error/i.test(body)) {
        note = '서버 오류 화면';
      } else if (body && !HAS_TITLE.test(body.replace(SCRIPTS, ''))) {
        note = '껍데기만 나갔다 (본문에 제목이 없다)';
      } else if (DATE_CROSSED.test(body)) {
        note = '달력 날짜가 Date 로 건너갔다 (글자여야 한다)';
      }
    } catch (e) {
      note = e.message;
    }
    /*
     * 307 은 통과가 아니다 (4차 감사 A4).
     *
     * "화면이 섰다" 와 "로그인으로 밀려났다" 는 다른 결과다. 307 이면 본문이
     * 없으므로 제목 검사도 오류봉투 검사도 날짜자국 검사도 전부 건너뛰어진다.
     * 그것을 통과로 세면 아무것도 안 본 것이 통과가 된다.
     */
    const away = status === 307 || status === 308;
    const ok = expectAway.has(p) ? away : (status === 200 && !note);
    if (!ok) bad++;
    console.log(`  ${ok ? (away ? '넘김' : '통과') : '실패'}  ${String(status).padEnd(4)} ${p}`
      + `${note ? `  ${note}` : ''}`
      + `${!ok && away ? '  로그인으로 밀려났다 (화면을 그려 보지 못했다)' : ''}`);
  }
}

const mgrCookie = session(userIds[ADMIN_CODE]);
await sweep('관리자 화면', mgrCookie, ADMIN);

if (WORKER_CODE === '-') {
  console.log('\n현장 화면\n  건너뜀 - 훑을 작업자 계정이 지정되지 않았습니다');
} else {
  const workerCookie = session(userIds[WORKER_CODE]);
  await sweep('현장 화면', workerCookie, WORKER);
}

/* ---------------------------------------------------------------------------
   원액 로트가 세 화면에서 보이는가

   원액 로트는 공급자 · 성적서 칸이 비어 있다 (material_lot_source). 이 화면들이
   공급자를 안쪽 결합으로 묶으면 그 로트가 소리 없이 빠진다. 없는 것을 있다고
   말하지도, 있는 것을 없다고 말하지도 않게 - 실제 원액 로트 하나로 세 주소를
   열어 번호가 그려지는지 본다.

   원액 로트가 하나도 없으면 **건너뛰지 않고 실패한다.** 건너뛰면 이 구멍이 다시
   열려도 통과가 찍힌다 (실패가 아니라 침묵이 되는 길). npm run save 가 원액
   제조 화면을 사람처럼 채워 원액 로트를 세우고, npm run seed:flow 도 배치를
   흘리며 원액을 만든다.

   원액 로트가 아직 있을 수 없는 단계(빈 설치, 기준정보만 심은 직후)에서는
   SMOKE_SOLUTION=- 로 건너뛸 수 있다. 건너뛰되 소리 내어 건너뛰고, 끝줄에도 그 사실이
   다시 적힌다 - 원액을 확인하지 않은 훑기가 통과 근거로 읽히지 않게.

   원액으로만 쓰인 시약 로트가 없는 것도 **같은 이유로 실패다.** 그 로트의 추적
   화면이 직접 투입 없음이라고 말하는지는 이 훑기가 아니면 아무도 묻지 않는다.

   읽기만 한다. POST 도 쓰기도 없다 (라벨은 미리보기라 대장에 닿지 않는다 -
   바로 아래 대장 줄 수 셈이 그것을 지킨다).
--------------------------------------------------------------------------- */
{
  console.log('\n원액 로트');
  const mark = (ok, label, note = '') => {
    if (!ok) bad++;
    console.log(`  ${ok ? '통과' : '실패'}  ${label}${note ? `  ${note}` : ''}`);
  };

  if (SKIP_SOLUTION) {
    console.log('  원액 확인 안 함 - 원액 로트가 아직 없는 단계 (SMOKE_SOLUTION=-)');
    console.log('  이 훑기는 원액 로트를 열어 보지 않았습니다. 통과로 세지 않습니다');
  } else if (!sol) {
    bad++;
    console.log('  실패  원액 로트가 없습니다 - npm run save 를 먼저');
  } else {
    /* 태그는 구분 문자로 바꾼다 - 이웃한 칸의 글자가 이어 붙어 가짜로 맞는 일이 없게 */
    const SEP = '\u001f';
    const plain = (h) => h.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, SEP);
    const page = async (p) => {
      const r = await fetch(`${BASE}${p}`, { headers: { cookie: mgrCookie }, redirect: 'manual' });
      const html = r.status === 200 ? (await r.text()).replace(SCRIPTS, '') : '';
      return { status: r.status, html, text: plain(html) };
    };
    const cell = (t, v) => t.includes(`${SEP}${v}${SEP}`);

    /* 1) 자재 목록. 찾기 칸의 value 는 태그 안이라 번호가 거기만 있으면 맞지 않는다 */
    {
      const p = `/material?q=${encodeURIComponent(sol.lot_no)}`;
      const r = await page(p);
      mark(r.status === 200 && cell(r.text, sol.lot_no),
        `자재 목록에 ${sol.lot_no} 한 줄이 있다`,
        r.status !== 200 ? String(r.status) : cell(r.text, sol.lot_no) ? '' : '(로트가 목록에서 빠졌다)');
      mark(r.text.includes(`사내 제조 · ${sol.made_on}`),
        '공급자 자리에 사내 제조 · 제조일이 적힌다');
    }

    /* 2) 자재 추적. 제목이 그 번호이고, 입고 정보 대신 제조 정보와 원료 표가 선다 */
    {
      const r = await page(`/trace/material/${sol.id}`);
      const h1 = (r.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) ?? [])[1] ?? '';
      const title = plain(h1).split(SEP).join('').trim();
      mark(r.status === 200 && title === sol.lot_no,
        `추적 화면의 제목이 ${sol.lot_no} 이다`,
        r.status !== 200 ? String(r.status) : title === sol.lot_no ? '' : `(제목: ${title})`);
      mark(r.text.includes('제조 정보') && !r.text.includes('입고 정보'),
        '입고 정보 대신 제조 정보가 선다');
      const miss = solInputs.filter((x) => !cell(r.text, x.material_lot_no));
      mark(solInputs.length > 0 && miss.length === 0,
        `원료 표에 원료 로트 ${solInputs.length}건이 있다`,
        solInputs.length === 0 ? '(이 원액에 원료 줄이 없다)'
          : miss.length ? `(빠진 것: ${miss.map((x) => x.material_lot_no).join(', ')})` : '');
    }

    /* 3) 원료 쪽에서도 원액을 거쳐 간 길이 보인다 */
    if (solInputs[0]) {
      const r = await page(`/trace/material/${solInputs[0].material_lot_id}`);
      mark(r.status === 200 && r.text.includes('원액을 거쳐 들어간 곳') && cell(r.text, sol.lot_no),
        `원료 로트 ${solInputs[0].material_lot_no} 의 추적에 원액 ${sol.lot_no} 이 이어진다`,
        r.status !== 200 ? String(r.status) : '');
    }

    /*
     * 원액으로만 쓰인 시약 로트의 첫 표 (이 자재가 들어간 곳).
     *
     * 그 로트는 직접 투입이 없다. 그런데 이 표가 "아직 공정에 투입되지 않았습니다"
     * 라고 하면서 바로 아래에 원액이 간 배치를 늘어놓으면, 영향 범위를 보러 온
     * 사람이 위의 말을 믿는다. 직접 투입이 없다는 말만 해야 한다.
     *
     * 그런 로트가 없으면(모든 원료 로트에 직접 투입이 있으면) 이 점검은 설 자리가
     * 없다. 그래도 건너뛰지 않고 실패한다 - 시드는 NaCl 외의 원료 시약을 원액으로만
     * 쓰도록 심으므로, 없다면 시드가 바뀌었거나 이 구멍을 밟을 자료가 사라진 것이다.
     */
    {
      const only = (await db2.query(
        `select vi.material_lot_id as id, vi.material_lot_no as no
           from v_solution_input vi
          where not exists (select 1 from material_issue mi
                             where mi.material_lot_id = vi.material_lot_id)
          order by vi.material_lot_no limit 1`)).rows[0];
      if (!only) {
        mark(false, '원액으로만 쓰인 시약 로트가 있다',
          '(없다 - 모든 원료 로트에 직접 투입이 있다. npm run seed:flow 로 원액을 만든 뒤에 훑으십시오)');
      } else {
        const r = await page(`/trace/material/${only.id}`);
        mark(r.status === 200
             && r.text.includes('직접 투입된 기록이 없습니다.')
             && !r.text.includes('현장 화면에서 이 로트를 투입 자재로 적으면'),
          `원액으로만 쓰인 시약 ${only.no} 의 첫 표가 직접 투입 없음이라고 말한다`,
          r.status !== 200 ? String(r.status) : '');
      }
    }

    /* 4) 자재 라벨 (미리보기) */
    {
      const r = await page(`/print/label/${sol.id}`);
      /* 종은 원료 품목의 수다. 같은 시약 로트가 둘이어도 한 종이다 */
      const kinds = new Set(solInputs.map((x) => x.item_code)).size;
      const want = `사내 제조 · 제조일 ${sol.made_on} · 원료 ${kinds}종`;
      mark(r.status === 200 && r.text.includes(sol.lot_no),
        `라벨이 ${sol.lot_no} 을 그린다`, r.status !== 200 ? String(r.status) : '');
      mark(r.text.includes(want), `성적서 자리에 "${want}" 가 적힌다`);
    }
  }
}

/*
 * 훑기는 대장에 아무것도 남기지 않아야 한다 (2026-09-16).
 *
 * 훑는 경로에 인쇄 화면이 여덟 있다. 전에는 여는 것이 곧 발행이라 이 훑기
 * 한 번이 아홉 줄을 남겼고, 여기서는 그 사실을 적어 두는 것밖에 할 수 없었다.
 *
 * 이제는 회차를 인쇄 단추가 올린다. 그러므로 늘었다면 그것은 안내가 아니라
 * **미리보기가 깨졌다는 뜻**이다. 대장은 손에 든 종이만 세어야 한다 (§10).
 */
{
  const after = Number((await db2.query('select count(*)::int n from record_print')).rows[0].n);
  const added = after - printBefore;
  if (added > 0) {
    bad += 1;
    console.log(`
  실패  이 훑기가 인쇄 대장에 ${added}줄을 남겼습니다.
        화면을 여는 것만으로는 남지 않아야 합니다 (회차는 인쇄 단추가 올립니다).`);
  }
}
await db2.end();

console.log(`\n${bad === 0 ? '전 화면 통과' : `실패 ${bad}건`}`);
if (SKIP_SOLUTION) {
  console.log('  * 원액 확인 안 함 - 이 결과는 원액 로트를 확인하지 않았다 (SMOKE_SOLUTION=-)');
}
process.exit(bad === 0 ? 0 : 1);
