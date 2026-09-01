/**
 * 어떤 계정으로 보이는지 눈으로 확인하는 대리 서버 (개발용).
 *
 *   node --env-file=.env.local scripts/preview-as.mjs 100200 3100 3112
 *   → http://localhost:3112 를 열면 그 계정으로 로그인한 화면이 그대로 보인다
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────
 * 화면이 깨졌다는 이야기를 들으면 그 화면을 봐야 한다. 그런데 이 앱은 로그인
 * 뒤에 있고, 자동화가 비밀번호를 치는 것은 하지 않는다. smoke 는 이미 세션
 * 쿠키를 직접 만들어 쓰고 있으므로(scripts/session-cookie.mjs) 같은 방법으로
 * 쿠키를 실어 보내는 대리 서버를 세운다.
 *
 * ── 이것은 앱에 문을 내는 것이 아니다 ─────────────────────────────────────
 * 앱은 손대지 않는다. `override` 나 `skip_auth` 같은 플래그를 만들지 않는다
 * (§10). 바깥에서 쿠키를 붙여 주는 것뿐이고, 앱은 평소와 똑같이 그 쿠키를
 * 검증한다. 이 파일은 개발 기계에서만 돌고 배포에 들어가지 않는다.
 *
 * 그래서 **localhost 로만 듣는다.** 다른 기계에서 이 문으로 들어올 수 없다.
 */
import http from 'node:http';
import pg from 'pg';
import { sessionCookie } from './session-cookie.mjs';

const [code = '100200', from = '3100', to = '3112'] = process.argv.slice(2);

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? undefined
    : { rejectUnauthorized: false },
});
await c.connect();
const u = (await c.query(
  `select u.id, u.full_name,
          coalesce(string_agg(r.role::text, ',' order by r.role), '역할 없음') as roles
     from app_user u left join user_role r on r.user_id = u.id
    where u.login_code = $1 group by u.id`, [code])).rows[0];
await c.end();

if (!u) {
  console.error(`${code} 계정이 없습니다`);
  process.exit(2);
}

const cookie = sessionCookie(u.id);

const srv = http.createServer((req, res) => {
  const p = http.request({
    host: '127.0.0.1', port: Number(from), path: req.url, method: req.method,
    headers: { ...req.headers, host: `localhost:${from}`, cookie },
  }, (r) => {
    res.writeHead(r.statusCode ?? 500, r.headers);
    r.pipe(res);
  });
  p.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
});

/*
 * WebSocket 도 넘긴다.
 *
 * 이것이 없으면 next dev 의 HMR 소켓이 계속 실패하고, 그 뒤로 하이드레이션이
 * 붙지 않는다. 화면은 서버가 그린 그대로 보이는데 아무것도 눌리지 않는다 -
 * 팝업이 안 열리고, 접힌 것이 안 펴지고, 시계가 멈춰 있다.
 *
 * 그것을 앱의 고장으로 읽고 한참을 헤맸다 (2026-09-01). 확인하는 도구가
 * 확인되지 않은 채로 있었다.
 */
const CRLF = String.fromCharCode(13, 10);

srv.on('upgrade', (req, socket, head) => {
  const up = http.request({
    host: '127.0.0.1', port: Number(from), path: req.url, method: req.method,
    headers: { ...req.headers, host: `localhost:${from}`, cookie },
  });
  up.on('upgrade', (r, upSocket, upHead) => {
    const head101 = ['HTTP/1.1 101 Switching Protocols']
      .concat(Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`))
      .join(CRLF) + CRLF + CRLF;
    socket.write(head101);
    if (upHead?.length) socket.unshift(upHead);
    upSocket.pipe(socket).pipe(upSocket);
  });
  up.on('error', () => socket.destroy());
  if (head?.length) up.write(head);
  up.end();
});

srv.listen(Number(to), '127.0.0.1', () => {
  console.log(`  ${u.full_name} (${code}) · ${u.roles}`);
  console.log(`  http://localhost:${to}  →  :${from}`);
});
