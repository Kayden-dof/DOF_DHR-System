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
  mat: (await rows(`select id from material_lot order by lot_no limit 1`))[0]?.id,
  day: (await rows(
    `select work_order_id, day_no, worker_id from process_record order by day_no limit 1`))[0],
  eq: (await rows(`select id from equipment order by code limit 1`))[0]?.id,
};
const userIds = Object.fromEntries(
  (await rows(`select login_code, id from app_user`)).map((u) => [u.login_code, u.id]));
await db.end();

/* --- 훑을 경로 ------------------------------------------------------------ */

const ADMIN = [
  '/', '/production', '/production/setup', '/production/deviation', '/material', '/material/items', '/material/orders', '/material/stock',
  '/material/movement', '/shipping', '/shipping/steril', '/shipping/ship',
  '/trace', '/trace/verify', '/board', '/board/cost',
  '/settings', '/settings/brand', '/settings/numbering', '/settings/items', '/settings/suppliers',
  '/settings/dmr', '/equipment', '/settings/users', '/settings/audit',
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

async function sweep(label, cookie, paths) {
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
    const ok = (status === 200 || status === 307 || status === 308) && !note;
    if (!ok) bad++;
    console.log(`  ${ok ? '통과' : '실패'}  ${String(status).padEnd(4)} ${p}${note ? `  ${note}` : ''}`);
  }
}

const mgrCookie = session(userIds['100200']);
await sweep('관리자 화면', mgrCookie, ADMIN);

const workerCookie = session(userIds['200100']);
await sweep('현장 화면', workerCookie, WORKER);

console.log(`\n${bad === 0 ? '전 화면 통과' : `실패 ${bad}건`}`);
process.exit(bad === 0 ? 0 : 1);
