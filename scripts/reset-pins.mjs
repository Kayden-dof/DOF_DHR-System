/* ---------------------------------------------------------------------------
   로그인 계정의 비밀번호를 한 번에 초기화한다 (비상 경로)

     node --env-file=<환경파일> scripts/reset-pins.mjs           계획만 보여 준다
     node --env-file=<환경파일> scripts/reset-pins.mjs --yes     실제로 바꾼다

   ── 언제 쓰는가 ──────────────────────────────────────────────────────────
   비밀번호를 전원 잃었을 때. 또는 넘겨받은 설치의 계정을 통째로 넘겨줄 때.
   한 사람 것만 바꾸려면 scripts/set-pin.mjs 를 쓴다.

   화면에도 초기화가 있다 (설정 > 사용자). 그쪽은 **누군가 한 사람은 들어갈 수
   있을 때** 쓰는 길이고, 이 도구는 아무도 못 들어갈 때 쓰는 길이다.

   ── 값을 정해 주지 않는다 ────────────────────────────────────────────────
   계정마다 무작위 여섯 자리를 만든다. 같은 값을 돌려쓰면 하나가 새는 순간
   전부 샌다. 만든 값은 **콘솔에 한 번 찍고 저장하지 않는다** - 다시 보려면
   다시 돌린다 (scripts/deploy-db.mjs 가 첫 계정에 쓰는 방식과 같다).

   ── 임시값이다. 첫 로그인에서 본인이 정한다 ──────────────────────────────
   `must_change_pin` 을 켠다. 그래서 이 값으로는 화면을 쓸 수 없고, 로그인하면
   곧바로 비밀번호 변경 화면으로 간다 (lib/session.ts).

   초기화한 사람이 값을 알고 있는 동안은 그 계정의 기록이 누구 것인지 성립하지
   않는다 - 전자서명이 없어 기록의 귀속이 로그인 하나에 달려 있기 때문이다
   (§1). 그래서 그 창을 첫 로그인까지로 좁힌다.

   ── 로그인하지 않는 계정은 건드리지 않는다 ───────────────────────────────
   `can_login = false` 인 계정(스키마 이관 등)은 비밀번호를 쓸 일이 없다.
   여기서 켜 주지도 않는다 - 그 판단은 화면에서 사람이 한다.
--------------------------------------------------------------------------- */
import { randomInt } from 'node:crypto';
import pg from 'pg';
import { hashPin } from './pin.mjs';
import { pgSsl } from './pgssl.mjs';

const GO = process.argv.includes('--yes');
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL 이 없습니다. --env-file=… 로 주십시오.');
  process.exit(2);
}

const c = new pg.Client({ connectionString: url, ssl: pgSsl(url, process.cwd()) });
await c.connect();

const { rows } = await c.query(
  `select id, login_code, full_name, is_developer
     from app_user where can_login order by login_code`);

console.log(`\n대상 : ${url.replace(/\/\/[^@]*@/, '//***@')}`);
console.log(`계정 : ${rows.length}명\n`);

if (rows.length === 0) {
  console.log('로그인하는 계정이 없습니다.');
  await c.end();
  process.exit(0);
}

if (!GO) {
  for (const u of rows) {
    console.log(`  ${u.login_code}  ${u.full_name}${u.is_developer ? '  (개발 계정)' : ''}`);
  }
  console.log('\n위 계정의 비밀번호를 무작위로 바꾸고 첫 로그인에서 새로 정하게 합니다.');
  console.log('옛 비밀번호는 되찾을 수 없습니다.');
  console.log('\n실제로 바꾸려면 --yes 를 붙이십시오.\n');
  await c.end();
  process.exit(0);
}

const made = [];
for (const u of rows) {
  const pin = String(randomInt(100000, 1000000));
  await c.query(
    `update app_user set pin_hash = $2, must_change_pin = true where id = $1`,
    [u.id, await hashPin(pin)]);
  made.push({ 로그인번호: u.login_code, 이름: u.full_name, 임시비밀번호: pin });
}

console.log('  ──────────────────────────────────────────────');
console.table(made);
console.log('  ──────────────────────────────────────────────');
console.log('  이 값은 저장되지 않습니다. 지금 적어 두십시오.');
console.log('  각 계정이 처음 로그인하면 곧바로 새 비밀번호를 정하게 됩니다.\n');

await c.end();
