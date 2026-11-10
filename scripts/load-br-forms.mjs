/* ===========================================================================
   load-br-forms.mjs · 제조기록서(F706) 양식 모양을 문서에 붙인다 (0130)

     로컬   node --env-file=.env.local scripts/load-br-forms.mjs <양식.json>
     운영   node --env-file=.env.deploy scripts/load-br-forms.mjs <양식.json> --prod

   자료 파일은 사내 폴더에 있다 (공개 저장소에 회사 양식을 싣지 않는다).
   만드는 법: F706 PDF 의 표를 칸 단위로 옮긴 것이다 - 머리 · 꼬리 글, 표의
   위치 · 열 너비 · 행 높이 · 칸 병합 · 글 · 정렬 · 굵기 · 크기.

   문서(제품 · 문서번호 · 개정)가 이미 있어야 한다. 없으면 넣지 않고 이름을
   댄다 - 문서 줄은 대조 자료가 만든다 (load-mfg-docs.mjs).
   같은 모양이면 건드리지 않는다. 다시 돌려도 같다.

   화면과 같은 길로 쓴다 - app_role 로 내려가 행위자를 심고 바꾼 까닭을 남긴다.
=========================================================================== */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { pgSsl } from './pgssl.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const asIdx = args.indexOf('--as');
const AS = asIdx >= 0 ? args[asIdx + 1] : '000000';
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--as');
if (!file || !existsSync(file)) {
  console.error('자료 파일 경로를 주십시오:  node scripts/load-br-forms.mjs <양식.json> [--prod] [--as 사번]');
  process.exit(2);
}

const URL_ = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!URL_) { console.error('DATABASE_URL 이 없습니다'); process.exit(2); }
const local = /@(localhost|127\.0\.0\.1)/.test(URL_);
if (!local && !PROD) {
  console.error('운영 DB 로 보입니다. 운영에 넣으려면 --prod 를 붙이십시오.');
  process.exit(2);
}
if (local && PROD) {
  console.error('--prod 인데 로컬 DB 를 가리킵니다. --env-file=.env.deploy 를 확인하십시오.');
  process.exit(2);
}

const data = JSON.parse(readFileSync(file, 'utf8'));
const P = data.product_code;
if (!P || !Array.isArray(data.forms)) { console.error('product_code 와 forms 가 있어야 합니다'); process.exit(2); }

const c = new pg.Client({ connectionString: URL_, ssl: pgSsl(URL_, ROOT) });
await c.connect();
console.log(`대상 ${local ? '로컬' : '운영'} · 제품 ${P} · 양식 ${data.forms.length}종 · 행위자 ${AS}`);

const actor = (await c.query(`select id from app_user where login_code = $1`, [AS])).rows[0]?.id;
if (!actor) { console.error(`사번 ${AS} 계정이 없습니다`); process.exit(2); }

const n = { set: 0, same: 0, missing: [] };
try {
  await c.query('begin');
  await c.query('set local role app_role');
  await c.query(`select set_config('app.user_id', $1, true)`, [actor]);
  await c.query(`select set_config('app.change_reason', $1, true)`,
                [data.note ?? '제조기록서 양식 모양 (F706 PDF 에서 옮김)']);
  for (const f of data.forms) {
    const { doc_no, revision, ...form } = f;
    const r = await c.query(
      `update mfg_doc set form = $4::jsonb
        where product_code = $1 and doc_no = $2 and revision = $3 and kind = 'BR'
          and form is distinct from $4::jsonb
        returning id`, [P, doc_no, revision, JSON.stringify(form)]);
    if (r.rowCount) { n.set++; continue; }
    const hit = await c.query(
      `select 1 from mfg_doc where product_code = $1 and doc_no = $2 and revision = $3 and kind = 'BR'`,
      [P, doc_no, revision]);
    if (hit.rowCount) n.same++; else n.missing.push(`${doc_no} ${revision}`);
  }
  await c.query('commit');
} catch (e) {
  await c.query('rollback');
  console.error('되돌렸습니다:', e.message);
  process.exitCode = 1;
}
await c.end();
console.log(`붙임 ${n.set} · 같아서 넘김 ${n.same}${n.missing.length ? ` · 문서 없음 ${n.missing.join(', ')}` : ''}`);
