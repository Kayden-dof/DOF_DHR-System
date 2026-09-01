/* ---------------------------------------------------------------------------
   질의문 자리 수 대조 (2차 검수 결함 2)

     node scripts/check-sql-params.mjs

   부적합 기록이 자리표시자 아홉 개에 값 열 개를 넘겨 넉 달째 아무것도 저장하지
   못하고 있었다. 화면도 검증도 멀쩡했고 타입 검사도 0건이었다. 이런 종류는
   실행해 봐야만 드러나는데, 모든 화면을 매번 눌러 볼 수는 없다.

   그래서 글자만 보고 센다. 질의문 안의 $N 최대값과 뒤따르는 값 배열의 원소
   수가 다르면 그 자리는 반드시 터진다. 실행하지 않고도 알 수 있는 사실이다.

   ── 어떻게 세는가 ─────────────────────────────────────────────────────────
   정규식만으로는 배열 안의 중첩 괄호와 문자열을 셀 수 없다. 여는 대괄호부터
   짝이 맞는 닫는 대괄호까지 한 글자씩 따라가며 깊이가 0인 쉼표만 센다.
   문자열 · 템플릿 · 주석 안의 쉼표와 괄호는 건너뛴다.

   ── 세지 않는 것 ──────────────────────────────────────────────────────────
   값 배열이 변수 하나로 들어가거나(`db.rows(sql, params)`) 배열 안에 펼침이
   섞이면(`[id, ...fields]`) 셀 수 없다. 그런 자리는 조용히 넘긴다 -
   못 세는 것을 틀렸다고 말하면 아무도 이 검사를 믿지 않게 된다.
--------------------------------------------------------------------------- */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['app', 'lib', 'components', 'scripts', 'test'];
const EXT = new Set(['.ts', '.tsx', '.mjs']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(p))) out.push(p);
  }
  return out;
}

/**
 * i 번째 글자가 여는 괄호일 때, 짝이 맞는 닫는 괄호의 위치를 돌려준다.
 * 문자열 · 템플릿 · 주석 안은 건너뛴다. 깊이 0의 쉼표 수도 함께 센다.
 */
function scanBracket(s, i) {
  let depth = 0, commas = 0, j = i;

  while (j < s.length) {
    const ch = s[j];

    /* 문자열과 템플릿 */
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      j += 1;
      while (j < s.length) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === q) break;
        /* 템플릿 안의 ${...} 는 코드다. 괄호를 세지 않으면 짝이 어긋난다 */
        if (q === '`' && s[j] === '$' && s[j + 1] === '{') {
          let d = 1; j += 2;
          while (j < s.length && d > 0) {
            if (s[j] === '{') d += 1;
            else if (s[j] === '}') d -= 1;
            j += 1;
          }
          continue;
        }
        j += 1;
      }
      j += 1;
      continue;
    }

    /* 주석 */
    if (ch === '/' && s[j + 1] === '/') { while (j < s.length && s[j] !== '\n') j += 1; continue; }
    if (ch === '/' && s[j + 1] === '*') { j = s.indexOf('*/', j) + 2; if (j === 1) break; continue; }

    if (ch === '[' || ch === '(' || ch === '{') depth += 1;
    else if (ch === ']' || ch === ')' || ch === '}') {
      depth -= 1;
      if (depth === 0) return { end: j, commas, empty: /^[\s]*$/.test(s.slice(i + 1, j)) };
    }
    else if (ch === ',' && depth === 1) commas += 1;

    j += 1;
  }
  return null;
}

const findings = [];
let checked = 0;

for (const file of DIRS.flatMap((d) => walk(path.join(ROOT, d)))) {
  const src = readFileSync(file, 'utf8');

  /* 백틱 질의문마다 그 안의 $N 최대값을 구한다 */
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] !== '`') continue;

    /* 템플릿 끝 찾기 */
    let j = i + 1;
    while (j < src.length) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '`') break;
      j += 1;
    }
    const sql = src.slice(i + 1, j);
    i = j;

    /*
     * 홑따옴표 안은 자료다. 거기 든 $N 은 자리표시자가 아니다.
     *
     * scrypt 해시가 'scrypt$32768$8$1$…' 모양이라, 그 값을 질의문에 그대로
     * 적었더니 검사기가 $32768 을 자리표시자로 읽고 "값이 모자란다" 고 했다.
     * 오탐이다 (적대적 검증 2026-09-01).
     *
     * 반대 방향이 더 무섭다 - 값 안의 큰 $N 이 최대값을 밀어 올리면, 진짜
     * 어긋난 질의문이 그 뒤에 숨는다. 확인해 주는 도구가 틀리면 확인이 아니다.
     */
    const bare = sql.replace(/'(?:[^']|'')*'/g, "''");
    const nums = [...bare.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    if (nums.length === 0) continue;
    /* 템플릿 보간이 섞인 질의문은 자리 수를 확신할 수 없다 */
    if (sql.includes('${')) continue;
    const max = Math.max(...nums);

    /* 바로 뒤에 오는 값 배열을 찾는다. 쉼표와 공백만 사이에 있어야 한다 */
    let k = j + 1;
    while (k < src.length && /[\s,]/.test(src[k])) k += 1;
    if (src[k] !== '[') continue;

    const box = scanBracket(src, k);
    if (!box) continue;
    /* 펼침이 들어 있으면 원소 수를 알 수 없다 */
    if (src.slice(k, box.end).includes('...')) continue;
    const count = box.empty ? 0 : box.commas + 1;
    checked += 1;

    if (count !== max) {
      const line = src.slice(0, i).split('\n').length;
      findings.push({
        file: path.relative(ROOT, file).replace(/\\/g, '/'),
        line, max, count,
        head: sql.trim().split('\n')[0].slice(0, 62),
      });
    }
  }
}

console.log(`자리 수를 셀 수 있었던 질의문 ${checked}개`);
if (findings.length === 0) {
  console.log('전부 일치');
  process.exit(0);
}
console.log(`\n어긋난 곳 ${findings.length}개`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}`);
  console.log(`    자리 $${f.max} · 값 ${f.count}개   ${f.head}`);
}
process.exit(1);
