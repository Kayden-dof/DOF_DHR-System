/* ---------------------------------------------------------------------------
   시연 자료 재구성

     node --env-file=.env.local scripts/demo.mjs

   로컬 개발 DB를 비우고 마이그레이션부터 다시 올린 뒤 기준정보와 배치 하나를
   끝까지 밀어 넣는다. 화면을 손보는 동안 모든 화면에 실제 자료가 차 있어야
   빈 화면만 보고 다 됐다고 착각하지 않는다.

   localhost가 아니면 거부한다. 기록은 지워지지 않는 것이 원칙이므로 이 도구는
   개발 장비 밖으로 나가면 안 된다.
--------------------------------------------------------------------------- */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL ?? '';

/*
 * 주소가 없는 것과 원격인 것은 다른 일이다 (2026-09-08).
 *
 * package.json 의 demo 가 --env-file 없이 돌던 때 DATABASE_URL 이 비어
 * 있었는데, 이 검사가 "로컬 DB가 아닙니다" 라고 답했다. **원격을 가리키고
 * 있다는 뜻으로 읽히지만 사실은 아무 데도 안 가리키고 있었다.** 고칠 곳을
 * 엉뚱한 데서 찾게 만드는 말이다.
 */
if (!url) {
  console.error('DATABASE_URL 이 없습니다. --env-file=.env.local 로 주십시오.');
  process.exit(2);
}
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error('로컬 DB가 아닙니다. 이 도구는 개발 장비에서만 씁니다.');
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

console.log('스키마 비우기');
await client.query(`drop schema if exists public cascade`);
await client.query(`create schema public`);

/*
 * 역할은 지워지면 지우고, 안 지워지면 그냥 둔다.
 *
 * `app_role` 은 **DB 를 가로질러 하나**다. 이 장비에는 시험용 DB 가 여럿
 * 있고(dhr_mut · dhr_restore · dhr_volume_check) 그것들이 같은 역할에 권한을
 * 걸고 있어서, 여기서 지우려 하면 "some objects depend on it" 으로 막힌다.
 * 개발 장비에서는 그게 정상 상태인데 데모가 그걸 못 견디고 죽었다
 * (사용자 지적 2026-09-08).
 *
 * 안 지워도 된다. 이관이 없으면 만들고 있으면 그대로 쓰며, 스키마를 새로
 * 만들었으니 옛 권한은 지운 객체와 함께 사라졌다.
 */
try {
  await client.query(`drop owned by app_role`);
  await client.query(`drop role if exists app_role`);
  console.log('  역할 app_role 을 지웠습니다');
} catch {
  console.log('  역할 app_role 은 다른 DB 가 쓰고 있어 그대로 둡니다 (이관이 다시 맞춥니다)');
}
await client.end();

// 자식 프로세스에 로컬 주소를 못 박는다. deploy-db 는 .env.deploy 의
// MIGRATION_DATABASE_URL 을 우선하므로, 비워 두면 원격으로 가 버린다.
const childEnv = { ...process.env, MIGRATION_DATABASE_URL: url, DATABASE_URL: url };

const run = (label, args, extra = {}) => {
  console.log(`\n${label}`);
  const r = spawnSync(process.execPath, args,
    { cwd: ROOT, stdio: 'inherit', env: { ...childEnv, ...extra } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('마이그레이션', [path.join(ROOT, 'scripts', 'deploy-db.mjs')]);
run('기준정보', [path.join(ROOT, 'scripts', 'seed-demo.mjs')]);
/* ---------------------------------------------------------------------------
   종이는 인쇄 화면이 뽑는다 (§10)

   시드가 record_print 에 직접 넣지 않는다. 넣으면 자료 식별자를 만드는 자리가
   둘이 되고, 실제로 갈라져 있었다 - 시드는 sha256, 앱은 PRINT_SECRET 을 섞은
   HMAC 이라 값이 아예 달라서, 시연 자료의 종이를 열람하면 전부 "그 뒤에 자료가
   바뀌었습니다" 가 떴다 (2026-09-09).

   그래서 여기서 서버를 잠깐 세우고 시드가 화면을 열게 한다. 회차도 잠금도
   해시도 앱이 만든 하나가 된다.

   빌드가 없으면 세우지 않는다. 그때는 종이 없이 자료만 서고, **그렇다고
   말한다** - 조용히 넘어가면 편철 표지가 "기록서 0 장" 인 까닭을 알 수 없다.
--------------------------------------------------------------------------- */
const PORT = process.env.DEMO_PRINT_PORT ?? '3191';
let srv = null;
let base = '';

console.log('\n인쇄용 서버');
if (existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) {
  srv = spawn(process.execPath,
    [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', PORT],
    { cwd: ROOT, env: childEnv, stdio: 'ignore' });
  base = `http://localhost:${PORT}`;

  let up = false;
  for (let i = 0; i < 40 && !up; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    try { up = (await fetch(`${base}/login`)).status === 200; } catch { /* 아직 */ }
  }
  if (!up) {
    srv.kill();
    console.error(`  서버가 ${PORT} 에 뜨지 않았습니다.`);
    process.exit(1);
  }
  console.log(`  ${PORT} 에 세웠습니다`);
} else {
  console.log('  .next 빌드가 없어 세우지 않습니다. **종이를 안 뽑습니다** -');
  console.log('  일차가 잠기지 않고 편철 표지의 기록서 매수가 0 으로 섭니다.');
  console.log('  npm run build 뒤에 다시 돌리면 종이까지 함께 섭니다.');
}

try {
  run('전 공정 진행', [path.join(ROOT, 'scripts', 'seed-flow.mjs')],
      base ? { PRINT_BASE: base } : {});
} finally {
  if (srv) srv.kill();
}

console.log('\n시연 자료를 다시 만들었습니다.');
