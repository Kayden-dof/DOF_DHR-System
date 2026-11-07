/* ---------------------------------------------------------------------------
   Q-Design 정본 사본 검사

     node scripts/check-qd-copies.mjs

   화면의 짜임 · 글자 · 간격 · 모서리는 Q-Design(github.com/lierline/Q-Design)
   정본 사본이 정한다. 사본은 Q-Design 의 내보내기(tools/sync.mjs)가 쓰고, 머리에
   본문의 sha256 을 찍는다. 이 검사는 두 가지를 본다.

     손대지 않았나   본문을 다시 셈해 머리의 지문과 같은가
                    (사본을 손으로 고치면 정본과 조용히 갈린다 - 2026-11-06
                    첫 시도가 규칙을 손으로 옮겨 수치가 정본과 달라졌다)
     쓰이고 있나     CSS 는 app/globals.css 가 불러오고, TS 는 어딘가가 가져오는가
                    (받아 두기만 하는 사본은 «여기 고치면 된다» 는 착각만 남긴다)

   지문 규칙은 Q-Design tools/sync.mjs 의 bodyOf 와 같다. 사본을 새로 받으려면
   Q-Design 에서 내보내기를 다시 돌린다. 여기서 고치지 않는다.
--------------------------------------------------------------------------- */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARK = 'q-design-nav-sha256:';
const END_MARK = '// q-design-header-end';

/** 받은 사본. 자리는 Q-Design tools/sync-parts.mjs 의 Q-Forge 줄과 같다 */
const COPIES = [
  ['app/q-design.theme.css', 'css'],
  ['app/q-design.mono-fonts.css', 'css'],
  ['app/q-design.foundation.css', 'css'],
  ['app/q-design.components.css', 'css'],
  ['app/q-design.workspace.css', 'css'],
  ['app/q-design.nav.css', 'css'],
  ['app/q-design.list.css', 'css'],
  ['app/q-design.screen.css', 'css'],
  ['app/q-design.palette.css', 'css'],
  ['lib/design/q-design-responsive.ts', 'ts'],
  ['components/top-progress.tsx', 'ts'],
  ['components/sticky-focus-guard.tsx', 'ts'],
];

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

function bodyOf(text, lang) {
  const mark = text.indexOf(MARK);
  if (mark < 0) return null;
  if (lang === 'ts') {
    const at = text.indexOf(END_MARK);
    if (at < 0) return null;
    const nl = text.indexOf('\n', at);
    const rest = text.slice(nl + 1);
    return rest.startsWith('\n') ? rest.slice(1) : rest;
  }
  const at = text.indexOf('*/', mark);
  if (at < 0) return null;
  const rest = text.slice(at + 2);
  return rest.startsWith('\n') ? rest.slice(1) : rest;
}

function codeFiles(dir, out = []) {
  for (const e of readdirSync(path.join(ROOT, dir))) {
    if (['node_modules', '.next', '.git'].includes(e)) continue;
    const rel = path.join(dir, e);
    if (statSync(path.join(ROOT, rel)).isDirectory()) codeFiles(rel, out);
    else if (/\.(tsx?|css)$/.test(e)) out.push(rel.replaceAll('\\', '/'));
  }
  return out;
}

let bad = 0;
const globals = read('app/globals.css');
const sources = ['app', 'components', 'lib'].flatMap((d) => codeFiles(d));

for (const [rel, lang] of COPIES) {
  let text;
  try { text = read(rel); } catch { console.log(`  ✗ ${rel}  사본이 없습니다`); bad++; continue; }
  const body = bodyOf(text, lang);
  const at = text.indexOf(MARK);
  const stamped = at < 0 ? null : text.slice(at + MARK.length).trimStart().slice(0, 64);
  if (body === null || !stamped) { console.log(`  ✗ ${rel}  머리표가 없습니다`); bad++; continue; }
  if (sha(body) !== stamped) {
    console.log(`  ✗ ${rel}  본문이 머리의 지문과 다릅니다 - 손으로 고쳤습니다. Q-Design 원본을 고치고 다시 내보내십시오`);
    bad++; continue;
  }
  const name = path.basename(rel);
  const used = lang === 'css'
    ? new RegExp(`@import\\s+['"]\\./${name.replace(/\./g, '\\.')}['"]`).test(globals)
    : sources.some((f) => f !== rel && new RegExp(`from\\s+['"][^'"]*/${name.replace(/\.tsx?$/, '')}['"]`).test(read(f)));
  if (!used) { console.log(`  ✗ ${rel}  아무도 불러 쓰지 않습니다`); bad++; continue; }
  console.log(`  ✓ ${rel}  ${stamped.slice(0, 12)}`);
}

if (bad) {
  console.log(`\nQ-Design 사본 ${bad}곳이 어긋났습니다.`);
  process.exit(1);
}
console.log(`\nQ-Design 사본 ${COPIES.length}개 모두 정본 지문 그대로이고 쓰이고 있습니다.`);
