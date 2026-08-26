/* ---------------------------------------------------------------------------
   비밀번호 직접 설정 (비상 경로)

     node --env-file=.env.local scripts/set-pin.mjs <로그인번호> <새 비밀번호>
     node --env-file=.env.deploy scripts/set-pin.mjs 000000 000000

   화면에서는 개발 계정만 남의 비밀번호를 초기화할 수 있다. 그런데 개발 계정
   비밀번호를 잃어버리면 화면에서 풀 길이 없다. 그때 쓰는 유일한 경로다.

   DB 소유자로 붙으므로 트리거가 막지 않는다. 대신 감사추적에는 그대로 남는다.
   실행 이력이 남게 이 파일을 저장소에 둔다.
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
  `update app_user set pin_hash = $2, can_login = true
    where login_code = $1 returning full_name, is_developer`,
  [code, await hashPin(pin)]);

if (r.rowCount === 0) {
  console.error(`로그인 번호 ${code} 계정이 없습니다.`);
  process.exit(1);
}

console.log(`${code} ${r.rows[0].full_name}${r.rows[0].is_developer ? ' (개발 계정)' : ''} 비밀번호를 바꿨습니다.`);
await c.end();
