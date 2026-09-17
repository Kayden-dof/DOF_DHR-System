/* ---------------------------------------------------------------------------
   비밀번호 직접 설정 (비상 경로)

     node --env-file=.env.local scripts/set-pin.mjs <로그인번호> <새 비밀번호>
     node --env-file=.env.deploy scripts/set-pin.mjs 000000 000000

   화면에서는 개발 계정만 남의 비밀번호를 초기화할 수 있다. 그런데 개발 계정
   비밀번호를 잃어버리면 화면에서 풀 길이 없다. 그때 쓰는 유일한 경로다.

   여러 계정을 한 번에 풀려면 scripts/reset-pins.mjs 를 쓴다.

   DB 소유자로 붙으므로 트리거가 막지 않는다. 대신 감사추적에는 그대로 남는다.
   실행 이력이 남게 이 파일을 저장소에 둔다.

   ── 넣은 값은 임시값이다 (7차 감사 후속 2026-09-17) ──────────────────────
   `must_change_pin` 을 켠다. 그래서 이 값으로는 화면을 쓸 수 없고, 로그인하면
   곧바로 비밀번호 변경 화면으로 간다 (lib/session.ts).

   화면의 초기화(setPin)는 처음부터 그렇게 하고 있었는데 **이 자리만 빠져
   있었다.** 까닭은 거기 적힌 그대로다 - 전자서명이 없어 기록의 귀속이 로그인
   하나에 달려 있으므로(§1), 값을 아는 사람이 둘인 동안은 그 계정의 기록이
   누구 것인지 성립하지 않는다. 그 창을 첫 로그인까지로 좁힌다.

   자기 것을 바꾸는 경우까지 가리지 않는다. 이 도구에는 "지금 누가 돌리는가"
   가 없고, 그것을 인자로 받으면 끄는 길이 생긴다 (§10 은 예외 플래그를
   금지한다). 한 번 더 정하는 수고가 규칙에 구멍을 내는 것보다 낫다.
--------------------------------------------------------------------------- */
import pg from 'pg';
import { hashPin } from './pin.mjs';
import { pgSsl } from './pgssl.mjs';

const [code, pin] = process.argv.slice(2);
if (!code || !pin) {
  console.error('사용법: scripts/set-pin.mjs <로그인번호> <새 비밀번호>');
  process.exit(2);
}

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL이 없습니다'); process.exit(2); }

const c = new pg.Client({ connectionString: url, ssl: pgSsl(url, process.cwd()) });
await c.connect();

console.log(`대상 : ${url.replace(/\/\/[^@]*@/, '//***@')}`);

const r = await c.query(
  `update app_user set pin_hash = $2, can_login = true, must_change_pin = true
    where login_code = $1 returning full_name, is_developer`,
  [code, await hashPin(pin)]);

if (r.rowCount === 0) {
  console.error(`로그인 번호 ${code} 계정이 없습니다.`);
  process.exit(1);
}

console.log(`${code} ${r.rows[0].full_name}${r.rows[0].is_developer ? ' (개발 계정)' : ''} 비밀번호를 바꿨습니다.`);
console.log('이 값은 임시입니다. 로그인하면 곧바로 새 비밀번호를 정하게 됩니다.');
await c.end();
