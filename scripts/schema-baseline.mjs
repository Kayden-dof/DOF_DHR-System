/**
 * db/schema-baseline.json 을 지금 스키마에서 다시 적는다.
 *
 * 이 파일은 "이 코드가 기대하는 스키마" 다. IQ 가 이것과 견주고 (scripts/iq.mjs),
 * 설정 화면이 운영과 어긋나면 붉은 띠를 띄운다 (lib/schema-check.ts).
 *
 * ── 왜 만드는 명령이 필요한가 ─────────────────────────────────────────────
 * 손으로 적고 있었다. 이관을 올릴 때마다 사람이 이 파일을 고쳐야 했고, 잊으면
 * **기준이 조용히 뒤처진다.** 뒤처진 기준은 아무것도 잡지 못하면서 잡고 있는
 * 것처럼 보인다 - 이 저장소에서 되풀이된 결함이다.
 *
 *   node --env-file=.env.local scripts/schema-baseline.mjs
 *
 * ── 아무 DB 나 읽지 않는다 ────────────────────────────────────────────────
 * 이관을 전부 올린 DB 여야 한다. 덜 올라간 DB 를 읽으면 기준이 거꾸로 낮아져
 * 빠진 이관을 영영 못 잡는다. 그래서 **로컬만 읽는다** - 운영을 읽으면
 * 운영에 손으로 만든 것까지 기준이 된다.
 *
 * 고친 뒤에는 `git diff db/schema-baseline.json` 으로 무엇이 늘었는지 본다.
 * 줄어든 줄이 있으면 그것은 이관이 빠진 것이지 기준이 틀린 것이 아니다.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { NAME_SQL } from './schema-names.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'db', 'schema-baseline.json');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL 이 없습니다.');
  process.exit(2);
}
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error('로컬 DB 만 읽습니다. 운영을 읽으면 손으로 만든 것까지 기준이 됩니다.');
  process.exit(2);
}

const c = new pg.Client({ connectionString: url });
await c.connect();
const rows = (await c.query(NAME_SQL)).rows;
await c.end();

const out = {};
for (const r of rows) (out[r.kind] ??= []).push(r.name);
for (const k of Object.keys(out)) out[k].sort();

const before = (() => {
  try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return {}; }
})();

const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
writeFileSync(OUT, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');

console.log('\n  db/schema-baseline.json 을 다시 적었습니다\n');
for (const k of Object.keys(sorted)) {
  const was = (before[k] ?? []).length;
  const now = sorted[k].length;
  const gone = (before[k] ?? []).filter((x) => !sorted[k].includes(x));
  console.log(`    ${k.padEnd(10)} ${String(was).padStart(4)} → ${String(now).padStart(4)}`
    + (gone.length ? `   빠진 것 ${gone.join(', ')}` : ''));
}
console.log('\n  줄어든 줄이 있으면 이관이 빠진 것입니다. 기준이 틀린 것이 아닙니다.\n');
