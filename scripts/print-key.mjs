/* ---------------------------------------------------------------------------
   인쇄 열쇠 고정값 뽑기

     node scripts/print-key.mjs                      .env.local 의 세션 키로
     SESSION_SECRET=... node scripts/print-key.mjs   값을 직접 주고

   ── 왜 이 스크립트가 필요한가 ─────────────────────────────────────────────
   인쇄물의 자료 식별자는 서버 비밀을 섞은 HMAC 이다 (lib/print.ts).
   그 열쇠는 PRINT_SECRET 이고, 없으면 SESSION_SECRET 에서 파생해 쓴다.

   **운영에 그 값이 있는지 여기 적어 두지 않는다.** 한때 "지금 운영에는
   PRINT_SECRET 이 없다" 고 적혀 있었는데, 그런 문장은 적는 순간부터 낡는다 -
   운영 DB 를 새로 세우고도 그대로 남아 있어, 나중에 그것을 근거로 읽을 뻔했다
   (2026-09-04). 주석은 지금 무슨 일이 벌어지는지 모른다.

   지금 상태는 **설정 · 개요 화면의 `이 배포` 칸**이 답한다. 거기에
   "PRINT_SECRET 으로 고정됨" 또는 "고정되지 않음 · 세션 열쇠에서 파생" 이
   적힌다. 그 화면은 process.env 를 그 자리에서 읽으므로 낡지 않는다.

   고정되지 않은 동안은 파생 열쇠로 돌고, 이미 발행된 인쇄물의 식별자도 그
   열쇠로 만들어져 있다.

   여기서 새 무작위 값을 넣으면 열쇠가 갈린다. 같은 자료가 다른 식별자를 내게
   되어, 자료가 그대로인데도 "바뀐 뒤에 다시 뽑았다" 로 읽힌다. §7 이 이 값에
   얹은 신호가 끊긴다.

   그래서 새로 만들지 않는다. 지금 쓰고 있는 파생 열쇠를 그대로 꺼내
   PRINT_SECRET 에 박는다. 동작은 한 글자도 바뀌지 않고, 앞으로 세션 키를
   갈아도 인쇄 식별자는 흔들리지 않는다.

   ── 이 값을 어디에 넣는가 ─────────────────────────────────────────────────
   운영은 Vercel 환경변수, 로컬은 .env.local. 넣은 뒤 재배포해야 반영된다.
   한 번 넣으면 갈지 않는다.
--------------------------------------------------------------------------- */
import { createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;

  const p = path.join(ROOT, '.env.local');
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*SESSION_SECRET\s*=\s*(.*)\s*$/);
      if (m) return m[1].trim();
    }
  }
  return null;
}

const s = sessionSecret();
if (!s || s.length < 32) {
  console.error(
    'SESSION_SECRET 을 찾지 못했습니다 (32자 이상).\n\n' +
    '운영용 값을 뽑으려면 Vercel 에 넣어 둔 SESSION_SECRET 을 주십시오.\n' +
    '  SESSION_SECRET=<운영 값> node scripts/print-key.mjs\n\n' +
    '값을 화면에 남기고 싶지 않으면 그 셸을 닫으면 됩니다.');
  process.exit(2);
}

/* lib/print.ts 의 printKey() 와 같은 계산이다. 두 곳이 갈라지면 안 된다 */
const key = createHmac('sha256', s).update('dhr:print:v1').digest('hex');

console.log('\n  PRINT_SECRET 에 넣을 값 (지금 쓰고 있는 파생 열쇠와 같다)\n');
console.log(`  ${key}\n`);
console.log('  넣는 곳');
console.log('    운영  Vercel 프로젝트 환경변수 · 넣은 뒤 재배포');
console.log('    로컬  .env.local 에 PRINT_SECRET=<위 값>');
console.log('\n  넣어도 지금 발행된 인쇄물의 식별자는 그대로입니다.');
console.log('  한 번 넣으면 갈지 마십시오 - 갈면 같은 자료가 다른 식별자를 냅니다.\n');
