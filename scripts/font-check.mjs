// =============================================================================
// font-check.mjs - 고정폭 자리에 한글이 들어갔는지 본다
//
//   npm run font
//
// ── 왜 있는가 ────────────────────────────────────────────────────────────────
// 코드 칸에는 `font-mono` 를 건다. `0` 과 `O`, `1` 과 `l` 을 갈라 보여야 하기
// 때문이다. 그런데 그 칸에 **한글**을 넣으면 얼굴이 갈린다 - `Cascadia Mono`
// 에도 `Consolas` 에도 한글 글리프가 없어 `monospace` 일반 이름까지 떨어지고,
// 거기서 나오는 것은 굴림 계열이다. 라벨은 Pretendard 인데 그 칸만 다르다.
//
// 사용자가 화면을 보다 짚었다 (2026-09-10). 손으로 찾으니 한 줄 단위 검색이
// 걸러 낸 것만 보였고, 속성이 여러 줄에 걸친 자리는 통째로 놓쳤다. 그래서
// 이 도구는 **한 덩이를 통째로** 본다.
//
// ── `<code>` 도 본다 ────────────────────────────────────────────────────────
// Tailwind preflight 가 `<code>` 를 고정폭으로 만든다. 클래스를 떼도 그대로다.
//
// ── 무엇이 걸리면 안 되는가 ─────────────────────────────────────────────────
// 값이 아니라 **문구**다. `<span className="font-mono">{lot.lot_no}</span>` 는
// 값이라 괜찮고, `제조번호 {lot_no}` 를 통째로 감싼 것은 낱말이 딸려 들어간다.
// =============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BS = String.fromCharCode(92);
const HAN = /[가-힣]/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e === '.git') continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))];
const ph = [], code = [], txt = [];

const RE_FIELD = new RegExp('<(input|textarea)[^>]*?/>', 'g');
const RE_PH_Q  = new RegExp('placeholder="([^"]*)"');
const RE_PH_T  = new RegExp('placeholder=[{]`([^`]*)`[}]');
const RE_CODE  = new RegExp('<code[^>]*>([^<]*)</code>', 'g');
const RE_SPAN  = new RegExp('<(span|b|div|p)[^>]*font-mono[^>]*>([^<]{0,300})</(?:span|b|div|p)>', 'g');
const RE_EXPR  = new RegExp('[{][^}]*[}]', 'g');

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f).split(BS).join('/');
  const lineOf = (i) => src.slice(0, i).split('\n').length;

  for (const m of src.matchAll(RE_FIELD)) {
    if (!m[0].includes('font-mono')) continue;
    const q = m[0].match(RE_PH_Q), t = m[0].match(RE_PH_T);
    const text = q ? q[1] : t ? t[1] : null;
    if (text === null || !HAN.test(text)) continue;
    ph.push({ rel, line: lineOf(m.index), text: text.split('\n')[0].slice(0, 55) });
  }
  for (const m of src.matchAll(RE_CODE)) {
    if (!HAN.test(m[1])) continue;
    code.push({ rel, line: lineOf(m.index), text: m[1].trim().slice(0, 45) });
  }
  for (const m of src.matchAll(RE_SPAN)) {
    if (!HAN.test(m[2].replace(RE_EXPR, ''))) continue;
    txt.push({ rel, line: lineOf(m.index), text: m[2].trim().slice(0, 45) });
  }
}

const show = (title, arr, how) => {
  if (arr.length === 0) return;
  console.log('\n  ' + title + '  ' + arr.length + '건');
  for (const h of arr) console.log('    ' + h.rel + ':' + h.line + '  ' + JSON.stringify(h.text));
  console.log('    → ' + how);
};

console.log('\n고정폭 자리의 한글 (파일 ' + files.length + '개)');
show('고정폭 칸의 안내문', ph,
     '라벨을 되풀이하는 것이면 떼고, 본보기면 영숫자만 남긴다');
show('<code> 안의 한글', code,
     'preflight 가 고정폭으로 만든다. <b className="text-ink"> 로 바꾼다');
show('font-mono 안의 낱말', txt,
     '낱말은 밖에 두고 값만 감싼다');

const total = ph.length + code.length + txt.length;
if (total === 0) {
  console.log('  한글이 고정폭으로 떨어지는 자리가 없습니다.\n');
  process.exit(0);
}
console.log('\n  모두 ' + total + '건.\n');
process.exit(1);
