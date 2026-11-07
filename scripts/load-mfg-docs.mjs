/* ===========================================================================
   load-mfg-docs.mjs · 작업표준서 · 제조기록서 대조와 자재 단가를 넣는다 (0123)

     로컬   node --env-file=.env.local scripts/load-mfg-docs.mjs <자료.json>
     운영   node --env-file=.env.deploy scripts/load-mfg-docs.mjs <자료.json> --prod

   ── 자료는 저장소 밖에 둔다 ───────────────────────────────────────────────
   이 저장소는 공개다. 작업표준서의 공정 조건과 공급자 단가는 회사 자료라
   저장소에 들이지 않는다. 이 스크립트는 넣는 방법만 갖고, 자료 파일은 사내
   폴더에 있다 (경로를 인자로 준다).

   ── 다시 돌려도 같다 ──────────────────────────────────────────────────────
   공급자 · 품목은 코드가 있으면 건드리지 않는다. 단가는 같은 품목 · 공급자 ·
   적용일 · 값이 이미 있으면 넣지 않는다. 문서는 (제품, 문서번호, 개정)이 있으면
   넘어가고, 대조 줄은 (제품, 공정, 차례)의 현행 줄이 있으면 넘어간다.

   자료를 고쳐 대조 줄을 통째로 바꾸려면 --replace 를 준다. 그 제품의 현행 줄을
   지우지 않고 현행 표시만 내린 뒤(감사추적에 남는다) 새 줄을 넣는다.

   ── 화면과 같은 길로 쓴다 ─────────────────────────────────────────────────
   트랜잭션마다 app_role 로 내려가 행위자를 심는다 (lib/db.ts withActor 와 같다).
   감사추적에 누가 넣었는지가 남는다. 행위자는 --as <사번> (기본 000000).
=========================================================================== */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { pgSsl } from './pgssl.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const REPLACE = args.includes('--replace');
const asIdx = args.indexOf('--as');
const AS = asIdx >= 0 ? args[asIdx + 1] : '000000';
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--as');
if (!file || !existsSync(file)) {
  console.error('자료 파일 경로를 주십시오:  node scripts/load-mfg-docs.mjs <자료.json> [--prod] [--replace] [--as 사번]');
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
if (!P) { console.error('product_code 가 없습니다'); process.exit(2); }

const c = new pg.Client({ connectionString: URL_, ssl: pgSsl(URL_, ROOT) });
await c.connect();
const host = new URL(URL_.replace(/^postgres(ql)?:/, 'http:')).hostname;
console.log(`대상 ${local ? '로컬' : '운영'} (${host}) · 제품 ${P} · 행위자 ${AS}${REPLACE ? ' · 대조 줄 교체' : ''}`);

const actor = (await c.query(`select id from app_user where login_code = $1`, [AS])).rows[0]?.id;
if (!actor) { console.error(`사번 ${AS} 계정이 없습니다`); process.exit(2); }

const n = { supplier: 0, item: 0, price: 0, doc: 0, check: 0, retired: 0, skipped: 0 };
try {
  await c.query('begin');
  await c.query('set local role app_role');
  await c.query(`select set_config('app.user_id', $1, true)`, [actor]);
  await c.query(`select set_config('app.change_reason', $1, true)`,
                [data.source ?? '작업표준서 · 제조기록서 대조 자료 입력']);
  const one = async (s, p) => (await c.query(s, p)).rows[0];

  /* 공급자 */
  for (const s of data.suppliers ?? []) {
    const hit = await one(`select id from supplier where code = $1`, [s.code]);
    if (hit) { n.skipped++; continue; }
    await c.query(
      `insert into supplier (code, name, status, contact_name, contact_phone, contact_email, note)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [s.code, s.name, s.status ?? 'PENDING', s.contact_name ?? null, s.contact_phone ?? null,
       s.contact_email ?? null, s.note ?? null]);
    n.supplier++;
  }

  /* 품목 */
  for (const it of data.items ?? []) {
    const hit = await one(`select id from item where code = $1`, [it.code]);
    if (hit) { n.skipped++; continue; }
    await c.query(
      `insert into item (code, name, type, purchase_uom, usage_uom, conversion)
       values ($1,$2,$3::item_type,$4,$5,$6)`,
      [it.code, it.name, it.type, it.purchase_uom, it.usage_uom, it.conversion ?? 1]);
    n.item++;
  }

  /* 단가. usage_uom 한 단위의 공급가액 */
  for (const pr of data.prices ?? []) {
    const item = await one(`select id from item where code = $1`, [pr.item]);
    const sup = await one(`select id from supplier where code = $1`, [pr.supplier]);
    if (!item || !sup) throw new Error(`단가 ${pr.item} · ${pr.supplier}: 품목이나 공급자가 없습니다`);
    const dup = await one(
      `select 1 from price_history where item_id=$1 and supplier_id=$2 and effective_from=$3::date and price=$4`,
      [item.id, sup.id, pr.effective_from, pr.price]);
    if (dup) { n.skipped++; continue; }
    await c.query(
      `insert into price_history (item_id, supplier_id, price, effective_from, registered_by)
       values ($1,$2,$3,$4::date,$5)`, [item.id, sup.id, pr.price, pr.effective_from, actor]);
    await c.query(
      `insert into item_supplier (item_id, supplier_id, current_price) values ($1,$2,$3)
       on conflict (item_id, supplier_id) do update set current_price = excluded.current_price`,
      [item.id, sup.id, pr.price]);
    await c.query(
      `update item set default_supplier_id = $2 where id = $1 and default_supplier_id is null`,
      [item.id, sup.id]);
    n.price++;
  }

  /* 문서 */
  for (const dc of data.docs ?? []) {
    const r = await c.query(
      `insert into mfg_doc (product_code, op_code, kind, doc_no, title, revision, issued_on, pages, note, registered_by)
       values ($1,$2,$3,$4,$5,$6,nullif($7,'')::date,$8,$9,$10)
       on conflict (product_code, doc_no, revision) do nothing`,
      [P, dc.op ?? null, dc.kind, dc.doc_no, dc.title, dc.rev, dc.issued ?? '', dc.pages ?? null,
       dc.note ?? null, actor]);
    if (r.rowCount) n.doc++; else n.skipped++;
  }

  /* 대조 줄 */
  if (REPLACE) {
    const r = await c.query(
      `update mfg_check set is_current = false where product_code = $1 and is_current`, [P]);
    n.retired = r.rowCount;
  }
  for (const ck of data.checks ?? []) {
    const hit = await one(
      `select 1 from mfg_check where product_code=$1 and op_code=$2 and seq=$3 and is_current`,
      [P, ck.op, ck.seq]);
    if (hit) { n.skipped++; continue; }
    await c.query(
      `insert into mfg_check (product_code, op_code, op_name, seq, grp, item, ws_text, ws_at,
                              br_text, br_at, verdict, why, basis, ws_order, br_order, registered_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [P, ck.op, ck.op_name, ck.seq, ck.group ?? '', ck.item, ck.ws ?? '', ck.ws_at ?? '',
       ck.br ?? '', ck.br_at ?? '', ck.verdict, ck.why ?? '', ck.basis ?? '',
       ck.ws_order ?? null, ck.br_order ?? null, actor]);
    n.check++;
  }

  await c.query('commit');
} catch (e) {
  await c.query('rollback');
  console.error('되돌렸습니다:', e.message);
  process.exitCode = 1;
}
await c.end();
console.log(`공급자 ${n.supplier} · 품목 ${n.item} · 단가 ${n.price} · 문서 ${n.doc} · 대조 ${n.check}`
  + `${n.retired ? ` · 내린 줄 ${n.retired}` : ''} · 있어서 넘김 ${n.skipped}`);
