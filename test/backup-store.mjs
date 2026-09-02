/* ---------------------------------------------------------------------------
   자동 백업이 실제로 도는가 (5차 감사 C3)

   예약 작업이 백업을 떠서 보관소에 올린다. 그 길에 네 단계가 있고, 백업을
   뜨는 것 자체는 복구 훈련(`npm run restore:check`)이 이미 본다. 여기서는
   그 뒤에 새로 생긴 것을 본다.

     lock        화면에서 내려받는 것과 같은 방식으로 잠근다
     putBackup   보관소에 올린다
     backup_log  사람 없이 줄을 남긴다 (0092)

   보관소는 남의 서버다. 진짜 보관소를 두드리면 자격 증명이 필요하고, 그 값이
   없다는 이유로 시험이 조용히 건너뛰게 된다 - 확인해 주는 도구가 확인하지
   않는 그 모양이다. 그래서 **같은 REST 를 받는 가짜 보관소**를 세워 두드린다.

     npm run test:store

   ── 여기서 보지 않는 것 ────────────────────────────────────────────────
   올린 파일이 잠겨 있고 다른 암호로는 안 열린다는 것은 여기서 보지 않는다.
   화면에서 내려받는 것과 **같은 `lock()`** 을 쓰고, 그 자물쇠는 복구 문턱
   시험(`npm run test:restore`) 25건이 이미 본다. 같은 것을 두 곳에서 보면
   두 벌이 갈라진다 (§10).

   훈련용 DB 를 망가뜨리지 않는다. backup_log 에 줄 하나가 남는데 그것이 이
   시험이 확인하는 것이다.
--------------------------------------------------------------------------- */
import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import pg from 'pg';

/*
 * `lib/backup-store.ts` 는 아무것도 부르지 않으므로 Node 가 그대로 읽는다.
 * 시험이 논리를 베껴 쓰지 않고 실물을 읽는다 - 베끼면 두 벌이 갈라진다 (§10).
 */
import { putBackup, storeMissing } from '../lib/backup-store.ts';

const PASS = 'backup-store-시험용-암호-2026';

/* --- 같은 REST 를 받는 가짜 보관소 --------------------------------------- */
let got = null;
let status = 200;
const store = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    got = {
      path: req.url,
      method: req.method,
      auth: req.headers.authorization,
      upsert: req.headers['x-upsert'],
      body: Buffer.concat(chunks),
    };
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(status === 200 ? '{"Key":"ok"}' : '{"error":"Duplicate"}');
  });
});
await new Promise((r) => store.listen(0, '127.0.0.1', r));
const port = store.address().port;
const cfg = {
  url: `http://127.0.0.1:${port}`, key: 'test-key',
  bucket: 'dhr-backup', passphrase: PASS,
};

let failed = 0;
const check = (cond, what, extra = '') => {
  if (!cond) failed++;
  console.log(`  ${cond ? '통과' : '실패'}  ${what.padEnd(46)}${extra}`);
};

console.log('\n자동 백업 · 가짜 보관소로 확인\n');

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? undefined
    : { rejectUnauthorized: false },
});
await c.connect();

try {
  /* --- ① 설정이 없으면 무엇이 없는지 말한다 --------------------------- */
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'BACKUP_PASSPHRASE']) {
    delete process.env[k];
  }
  const miss = storeMissing();
  check(miss !== null, '설정이 없으면 없다고 말한다');
  check(['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'BACKUP_PASSPHRASE']
          .every((k) => miss.includes(k)),
        '무엇이 없는지 이름으로 말한다', miss ?? '');

  process.env.SUPABASE_URL = cfg.url;
  process.env.SUPABASE_SERVICE_KEY = cfg.key;
  check(storeMissing() === 'BACKUP_PASSPHRASE',
        '둘만 채우면 남은 하나를 짚는다', String(storeMissing()));
  process.env.BACKUP_PASSPHRASE = PASS;
  check(storeMissing() === null, '셋이 차면 갖춰진 것으로 본다');

  /* --- ② 올린다 ------------------------------------------------------- */
  const sealed = randomBytes(4096);
  const fileName = 'dhr-20260902-120000.ndjson.gz';
  const at = await putBackup(cfg, fileName, sealed);

  check(got !== null, '보관소가 파일을 받았다');
  check(got.method === 'POST', '올리는 방법이 맞다', got.method);
  check(got.auth === `Bearer ${cfg.key}`, '열쇠를 실어 보냈다');
  check(got.upsert === 'false', '덮어쓰기를 켜지 않았다', got.upsert);
  check(got.path.includes(`/${cfg.bucket}/`) && got.path.endsWith(fileName),
        '버킷 아래 그 이름으로 올렸다', got.path);
  check(at.startsWith(`${cfg.bucket}/`) && at.endsWith(fileName),
        '둔 자리를 돌려준다', at);
  check(Buffer.compare(got.body, sealed) === 0, '올라간 바이트가 잠근 그대로다');

  /* --- ③ 보관소가 거부하면 삼키지 않는다 ------------------------------ */
  status = 409;
  let threw = '';
  try { await putBackup(cfg, fileName, sealed); } catch (e) { threw = e.message; }
  status = 200;
  check(threw.includes('409'), '보관소가 거부하면 그대로 알린다', threw.slice(0, 60));

  /* --- ④ 사람 없이 줄을 남긴다 (0092) --------------------------------- */
  const sha = createHash('sha256').update(sealed).digest('hex');
  const row = (await c.query(
    `insert into backup_log (taken_by, file_name, byte_size, total_rows,
                             table_count, data_sha256, migration_count,
                             locked, source, stored_at)
     values (null, $1, $2, 1, 1, $3, 1, true, 'AUTO', $4)
     returning taken_by, source, stored_at`,
    [fileName, sealed.byteLength, sha, at])).rows[0];

  check(row.taken_by === null,
        '실행자를 비운 채로 남는다 - 사람이 한 일처럼 꾸미지 않는다');
  check(row.source === 'AUTO', '예약 작업이 뜬 것으로 남는다');
  check(row.stored_at === at, '어디에 두었는지가 남는다', row.stored_at);

  let badSource = false;
  try {
    await c.query(
      `insert into backup_log (taken_by, file_name, byte_size, total_rows,
                               table_count, data_sha256, migration_count, locked, source)
       values (null, 'x', 1, 1, 1, 'x', 1, true, 'WHATEVER')`);
  } catch { badSource = true; }
  check(badSource, '정해지지 않은 출처는 거부된다');
} finally {
  await c.end();
  /*
   * 닫히기를 기다린 뒤에 나간다. 닫는 중에 process.exit 을 부르면 윈도우에서
   * libuv 가 멈춰 서고 **종료 코드가 127 로 뒤집힌다** - 시험이 "전 구간 통과"
   * 를 적고도 실패로 보인다. 실제로 그렇게 한 번 속았다 (2026-09-02).
   */
  await new Promise((r) => store.close(r));
}

console.log(`\n  ${failed === 0 ? '전 구간 통과' : `실패 ${failed}건`}\n`);
process.exitCode = failed ? 1 : 0;
