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

   ── 개정안을 제품표준서 판에 묶어 넣기 (0137 · 2026-11-19) ─────────────────
     node --env-file=.env.deploy scripts/load-br-forms.mjs <양식.json> --prod --dmr Rev.01

   --dmr 을 주면 문서 줄이 없을 때 세운다 - 같은 문서번호의 현행 줄에서 공정 ·
   제목을 베끼고, 현행이 아니게(is_current = false) 그 판의 제품표준서에 묶는다.
   그 판으로 낸 지시만 이 양식을 쓰고, 다른 판의 지시는 지금 양식 그대로다
   (br_form_in_scope). 자료의 docs 배열(작업표준서 개정안 등 모양 없는 문서)도
   같은 길로 세운다. 이미 있는 줄은 판 묶음만 맞춘다.
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
const dmIdx = args.indexOf('--dmr');
const DMR = dmIdx >= 0 ? args[dmIdx + 1] : null;
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--as' && args[i - 1] !== '--dmr');
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

const n = { set: 0, same: 0, missing: [], made: 0 };
try {
  await c.query('begin');
  await c.query('set local role app_role');
  await c.query(`select set_config('app.user_id', $1, true)`, [actor]);
  await c.query(`select set_config('app.change_reason', $1, true)`,
                [data.note ?? '제조기록서 양식 모양 (F706 PDF 에서 옮김)']);
  if (DMR) {
    const dm = (await c.query(
      `select dm.id from device_master dm join item i on i.id = dm.item_id
        where coalesce(dm.product_code, i.code) = $1 and dm.revision = $2`, [P, DMR])).rows[0]?.id;
    if (!dm) throw new Error(`제품표준서 ${P} ${DMR} 이 없습니다`);
    const docs = [
      ...data.forms.map((f) => ({ kind: 'BR', doc_no: f.doc_no, revision: f.revision, pages: f.pages.length, note: data.note })),
      ...(data.docs ?? []),
    ];
    for (const d of docs) {
      const had = await c.query(
        `update mfg_doc set device_master_id = $5
          where product_code = $1 and doc_no = $2 and revision = $3 and kind = $4
            and device_master_id is distinct from $5 returning id`,
        [P, d.doc_no, d.revision, d.kind, dm]);
      const exists = had.rowCount || (await c.query(
        `select 1 from mfg_doc where product_code = $1 and doc_no = $2 and revision = $3 and kind = $4`,
        [P, d.doc_no, d.revision, d.kind])).rowCount;
      if (exists) continue;
      const r = await c.query(
        `insert into mfg_doc (product_code, op_code, kind, doc_no, title, revision, issued_on, pages,
                              note, is_current, device_master_id, registered_by)
         select product_code, op_code, kind, doc_no, title, $3::text, null, $5::int, $6::text, false, $7::uuid, $8::uuid
           from mfg_doc where product_code = $1 and doc_no = $2 and kind = $4 and is_current
          order by revision desc limit 1
         returning id`,
        [P, d.doc_no, d.revision, d.kind, d.pages ?? null, d.note ?? null, dm, actor]);
      if (r.rowCount) n.made++; else n.missing.push(`${d.doc_no} (현행 줄 없음)`);
    }
  }
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
console.log(`${DMR ? `문서 세움 ${n.made} · ` : ''}붙임 ${n.set} · 같아서 넘김 ${n.same}${n.missing.length ? ` · 문서 없음 ${n.missing.join(', ')}` : ''}`);
