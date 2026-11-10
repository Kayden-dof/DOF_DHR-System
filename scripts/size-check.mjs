// =============================================================================
// size-check.mjs - 칸 · 단추 · 판에 손으로 붙인 치수를 찾는다
//
//   npm run size
//
// ── 왜 있는가 ────────────────────────────────────────────────────────────────
// 사용자가 두 번 짚었다. «이거 칸 크기 왜 이따위야» (단추, 2026-11-10 오후) ·
// «이런 칸 사이즈 안 맞는 것도 전수 감사해서 정돈할 것» (입력칸 · 판, 같은 날 밤).
// 원인은 늘 같았다 - 공통 부품이 정한 치수 위에 화면마다 h-9 · text-xs · p-4 를
// 손으로 덧붙였고, 그 한 자리만 옆 칸과 어긋났다.
//
// 세 가지를 본다 (종이 화면 app/print 은 양식 치수를 따르므로 뺀다).
//
//   단추   btn · btn-primary · btn-ghost · btn-danger · btn-quiet 에 높이 · 가로 여백 ·
//          글자 크기 · 모서리를 붙이지 않는다. 높이는 --tap 이 정한다 (관리 44 · 현장 56).
//   입력칸 관리 화면의 .input 에 높이 · 글자 크기를 붙이지 않는다. 현장 화면(app/(work))은
//          장갑 낀 손에 맞춰 일부러 키운 자리가 있어 뺀다.
//   판     테두리 · 면이 없는 .card 에 가로 여백을 주지 않는다. 지금 테마에서 card 는
//          보이지 않는 상자라, 가로 여백은 옆 칸과 끝선이 어긋나는 들여쓰기만 남긴다.
//          면(bg-*) · 테두리(border) · 정본 판(qd-panel)이 있으면 여백이 맞다.
// =============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = path.join(d, n);
    if (statSync(p).isDirectory()) {
      if (/node_modules|\.next|icons$/.test(p)) continue;
      walk(p);
    } else if (n.endsWith('.tsx')) files.push(p);
  }
};
walk(path.join(ROOT, 'app'));
walk(path.join(ROOT, 'components'));
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

const BTN = new Set(['btn', 'btn-primary', 'btn-ghost', 'btn-danger', 'btn-quiet']);
const BTN_BAD = /^(h-(\d+|\[.+\])|px-[\d.]+|text-(xs|sm|base|lg|xl)|rounded(-\w+)?|tracking-tight)$/;
const INPUT_BAD = /^(h-(8|9|10|11|12)|text-(xs|sm))$/;
const PAD = /^p[xlr]?-[\d.]+$/;
const FRAME = (t) => t === 'qd-panel' || t.startsWith('bg-') ||
  ['border', 'border-t', 'border-b', 'border-2', 'shadow'].includes(t);

const bad = [];
const cls = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;
for (const f of files) {
  const r = rel(f);
  if (r.startsWith('app/print') || r.startsWith('components/print')) continue;
  const src = readFileSync(f, 'utf8');
  let m;
  while ((m = cls.exec(src))) {
    const t = (m[1] ?? m[2]).split(/\s+/).filter(Boolean);
    const line = src.slice(0, m.index).split('\n').length;
    const where = `${r}:${line}`;
    if (t.some((x) => BTN.has(x))) {
      const x = t.filter((k) => BTN_BAD.test(k));
      if (x.length) bad.push(`단추   ${where}  ${x.join(' ')}`);
    }
    if (t.includes('input') && !r.startsWith('app/(work)')) {
      const x = t.filter((k) => INPUT_BAD.test(k));
      if (x.length) bad.push(`입력칸 ${where}  ${x.join(' ')}`);
    }
    if (t.includes('card') && !t.some(FRAME) && r !== 'components/denied.tsx') {
      const x = t.filter((k) => PAD.test(k) && !k.startsWith('py-'));
      if (x.length) bad.push(`판     ${where}  ${x.join(' ')}`);
    }
  }
}

console.log(`손으로 붙인 치수 (파일 ${files.length}개)\n`);
if (bad.length === 0) {
  console.log('  없음.');
} else {
  for (const b of bad) console.log('  ' + b);
  console.log(`\n  모두 ${bad.length}건. 공통 부품의 치수(--tap · --qd-control-size)를 쓰고, 보이지 않는 판에는 세로 여백만 둔다.`);
  process.exitCode = 1;
}
