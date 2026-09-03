/* ---------------------------------------------------------------------------
   인쇄 충실성 시험 (§8.2)

     node --env-file=.env.local test/print.mjs [http://localhost:3100]

   사양이 "이 시스템에서 가장 중요한 검증"이라고 못 박은 항목이다. 종이가
   정본이므로, DB 에 있는 값이 종이에 그대로 나오지 않으면 이 시스템은 틀린
   기록을 발행한다. 화면이 맞는지가 아니라 종이가 맞는지를 본다.

   양식 6종을 실제로 그려서, 그 종이에 나와야 할 값을 DB 에서 따로 읽어 와
   항목 단위로 대조한다. 규칙 시험(test/run.mjs)이 DB 계층을 보장하고, 화면
   훑기(scripts/smoke.mjs)가 화면이 그려지는지를 보고, 이 시험이 그려진
   내용이 자료와 같은지를 본다.

   나와야 할 것만이 아니라 나오면 안 되는 것도 본다. 작업 지시서에 시약
   로트번호가 찍히면 착수 전에 정해지지 않은 값을 미리 적어 둔 셈이 되고,
   현장은 그 종이를 보고 그 로트를 쓴다.

   ── 주의 ──────────────────────────────────────────────────────────────────
   인쇄 화면을 여는 것 자체가 record_print 에 회차를 남기고, 제조기록서는
   그 묶음을 잠근다 (S04). 그래서 이 시험은 이미 잠긴 묶음만 고른다.
   실운영 서버에 대고 돌리지 말 것.
--------------------------------------------------------------------------- */
import pg from 'pg';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgSsl } from '../scripts/pgssl.mjs';
import { sessionCookie, visibleText } from '../scripts/session-cookie.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] ?? 'http://localhost:3100';
const url = process.env.DATABASE_URL;

const db = new pg.Client({ connectionString: url, ssl: pgSsl(url, process.cwd()) });
await db.connect();
const rows = async (sql, p = []) => (await db.query(sql, p)).rows;
const one = async (sql, p = []) => (await rows(sql, p))[0] ?? null;

/* --- 대조할 자료 고르기 ---------------------------------------------------- */

const wo = await one(
  `select wo.id, wo.wo_no, wo.batch_no, wo.sheet_count, wo.dmr_revision,
          i.code as item_code, i.name as item_name,
          dm.product_code, dm.product_name,
          (select array_agg(o.typical_day order by o.seq)
             from dmr_operation o
            where o.device_master_id = dm.id and o.typical_day is not null) as typical_days,
          ml.lot_no as raw_lot_no, ml.thickness_band, ml.coa_no,
          s.name as supplier_name, ml.supplier_lot_no,
          up.full_name as prod_name, uq.full_name as qa_name
     from work_order wo
     join device_master dm on dm.id = wo.device_master_id
     join item i on i.id = dm.item_id
     join material_lot ml on ml.id = wo.material_lot_id
     join supplier s on s.id = ml.supplier_id
     join app_user up on up.id = wo.issued_by_prod
     join app_user uq on uq.id = wo.issued_by_qa
    /*
     * 제품 로트도 있고 잠긴 일차도 있는 배치라야 여섯 양식을 다 대조할 수 있다.
     *
     * 전에는 제품 로트만 보고 골랐다. 지난 기록으로 넣은 배치들은 재단 결과만
     * 있고 공정 기록이 없어서, 가장 오래된 것을 고르면 편철 표지는 그 배치를
     * 대조하는데 제조기록서는 다른 배치 것을 열게 되었다 (2차 검수 지적).
     * 픽스처는 실제 관계에서 뽑아야 한다.
     */
    where exists (select 1 from product_lot pl where pl.work_order_id = wo.id)
      and exists (select 1 from day_lock dl where dl.work_order_id = wo.id)
    order by wo.issued_at limit 1`);

if (!wo) {
  console.error('대조할 배치가 없습니다. scripts/seed-flow.mjs 를 먼저 돌리십시오.');
  process.exit(2);
}

const lots = await rows(
  `select pl.id, pl.lot_no, pl.qty_produced, pl.qty_sample, pl.qty_available,
          pl.manufactured_on::text as manufactured_on, pl.expiry_date::text as expiry_date,
          i.code as item_code, i.name as item_name, spec_label(i.code) as spec
     from product_lot pl join item i on i.id = pl.item_id
    where pl.work_order_id = $1 order by pl.lot_no`, [wo.id]);

const mat = await one(
  `select ml.id, ml.lot_no, ml.coa_no, ml.qty_available, ml.qty_received,
          ml.expiry_date::text as expiry_date,
          i.name as item_name, i.usage_uom, s.name as supplier_name, ml.supplier_lot_no
     from material_lot ml join item i on i.id = ml.item_id
     join supplier s on s.id = ml.supplier_id
    where ml.item_id in (select id from item where type = 'RAW')
    order by ml.lot_no limit 1`);

/*
 * 제조기록서는 이미 잠긴 묶음만 고른다. 안 잠긴 것을 열면 이 시험이 그 묶음을
 * 잠가 버린다. 잠금 해제는 없으므로 시험이 자료를 되돌릴 수 없게 바꾼다.
 *
 * 반드시 위에서 고른 배치(wo)의 묶음이어야 한다.
 *
 * 전에는 잠긴 묶음이면 아무거나 골랐다. 그런데 편철 표지는 wo 것을 대조하면서
 * 그 안의 "일차별 기록 작업자 · 작업일" 은 여기서 고른 day 로 견주므로, 둘이
 * 다른 배치면 상시 불일치가 났다. 시연 자료에 배치가 하나뿐일 때는 우연히
 * 맞아떨어져 오래 드러나지 않았다 (2차 검수 지적).
 *
 * 인쇄 충실성 시험(§8.2)이 OQ 근거가 되는 문서다. 그 시험이 스스로 틀리면
 * 대조 결과 전체를 믿을 수 없다.
 */
const day = await one(
  `select dl.work_order_id, dl.day_no, dl.worker_id, u.full_name as worker_name,
          (select min(pr.work_date)::text from process_record pr
            where pr.work_order_id = dl.work_order_id
              and pr.day_no = dl.day_no and pr.worker_id = dl.worker_id) as work_date,
          (select wo2.batch_no from work_order wo2 where wo2.id = dl.work_order_id) as batch_no
     from day_lock dl join app_user u on u.id = dl.worker_id
    where dl.work_order_id = $1
    order by dl.locked_at limit 1`, [wo.id]);

if (!day) {
  console.error(
    `배치 ${wo.batch_no} 에 잠긴 일차 묶음이 없습니다.\n` +
    '제조기록서와 편철 표지를 대조하려면 일차 마감이 하나는 있어야 합니다.\n' +
    'scripts/seed-flow.mjs 를 먼저 돌리십시오.');
  process.exit(2);
}

const issues = day ? await rows(
  `select ml.lot_no, mi.qty, i.name as item_name, o.code as op_code, o.name as op_name,
          pr.equipment_id,
          to_char(timezone('Asia/Seoul', pr.started_at),'HH24:MI') as started,
          to_char(timezone('Asia/Seoul', pr.ended_at),'HH24:MI') as ended
     from process_record pr
     join dmr_operation o on o.id = pr.operation_id
     left join material_issue mi on mi.process_record_id = pr.id
     left join material_lot ml on ml.id = mi.material_lot_id
     left join item i on i.id = ml.item_id
    where pr.work_order_id = $1 and pr.day_no = $2 and pr.worker_id = $3
    order by o.seq`, [day.work_order_id, day.day_no, day.worker_id]) : [];

/* 편철 표지 대조 재료: 재작업 회차 · 출하 승인 요청서 번호 · 멸균 성적서 */
const rework = await one(
  `select 1 from process_record where work_order_id = $1 and attempt > 1 limit 1`, [wo.id]);
const coverRR = await one(
  `select 'RR-' || $2 || '-' || lpad(min(seq)::text, 2, '0') as v
     from record_print where work_order_id = $1 and kind = 'RELEASE_REQUEST'`,
  [wo.id, wo.batch_no]).then((r) => r?.v ?? '');
const coverCert = await one(
  `select min(sb.cert_no) as v
     from steril_batch sb
     join steril_batch_lot sbl on sbl.steril_batch_id = sb.id
     join product_lot pl on pl.id = sbl.product_lot_id
    where pl.work_order_id = $1 and sb.cert_no is not null`, [wo.id])
  .then((r) => r?.v ?? '');

/* 공정별 설비. 지시서에 밸리데이션 만료일과 함께 인쇄된다 */
const equipLines = await rows(
  `select e.code, e.name,
          (select max(valid_until)::text from equipment_validation ev
            where ev.equipment_id = e.id) as valid_until
     from dmr_operation o
     join operation_equipment oe on oe.operation_id = o.id and oe.is_active
     join equipment e on e.id = oe.equipment_id and e.is_active
    where o.device_master_id = (select device_master_id from work_order where id = $1)
    order by o.seq, e.code`, [wo.id]);

/*
 * 이 설비가 실제로 쓰인 배치를 함께 가져온다. 시험이 고른 배치를 그냥 기대하면,
 * 배치가 여럿일 때 설비를 쓰지 않은 배치를 기대하게 된다 - 종이는 맞는데
 * 시험이 틀리는 자리다.
 */
const eqLog = await one(
  `select e.id, e.code, e.name,
          (select report_no from equipment_validation ev
            where ev.equipment_id = e.id
            order by valid_until desc limit 1) as report_no,
          (select count(*)::int from process_record pr where pr.equipment_id = e.code) as used,
          (select w.batch_no from process_record pr
             join work_order w on w.id = pr.work_order_id
            where pr.equipment_id = e.code
            order by pr.work_date limit 1) as batch_no
     from equipment e
    where exists (select 1 from process_record pr where pr.equipment_id = e.code)
    order by e.code limit 1`);

/*
 * 필요 용기 수의 기대값 (§7).
 *
 * 화면이 셈하는 방식을 베끼지 않는다 - 베끼면 화면이 틀렸을 때 시험도 같이
 * 틀린다. 사양이 말하는 것을 여기서 다시 짠다: 장입 구간 기준 자재의 소요량을
 * **단위별로** 모은 것.
 */
const containerExpect = await rows(
  `select i.usage_uom as uom, sum(required_qty(o.id, b.component_item_id, $2, 0))::numeric as n
     from dmr_operation o
     join dmr_bom b on b.operation_id = o.id
     join item i on i.id = b.component_item_id
    where o.device_master_id = (select device_master_id from work_order where id = $1)
      and b.basis = 'SHEET_TIER'
      and required_qty(o.id, b.component_item_id, $2, 0) is not null
    group by i.usage_uom
    order by 2 desc, 1`, [wo.id, wo.sheet_count]);

/* 착수 전에 정해지지 않는 값. 작업 지시서에 나오면 안 된다 (§7) */
const reagentLots = await rows(
  `select distinct ml.lot_no
     from material_lot ml join item i on i.id = ml.item_id
    where i.type in ('REAGENT','PROCESS','PACK')`);

const users = Object.fromEntries(
  (await rows(`select login_code, id from app_user`)).map((u) => [u.login_code, u.id]));
/* --- 실행기 --------------------------------------------------------------- */

const cookie = sessionCookie(users['100200']);
const out = [];
let pass = 0; let fail = 0; let skip = 0;

function say(line = '') { out.push(line); console.log(line); }

/* ---------------------------------------------------------------------------
   칸 단위로 대조한다 (4차 감사 2026-09-02)

   전에는 종이 전체를 한 줄로 납작하게 만들어 `text.includes(value)` 하나로
   봤다. 그래서 이런 일이 벌어졌다.

     · 모든 종이에 "2026-09-02 14:33" 인쇄 일시가 있다. 그래서 '2' '20' 같은
       한두 자리 기대값(투입 수량 · 장입 장수)은 **그 칸이 틀려도, 비어도**
       통과했다.
     · 공통 다섯 항목은 기대값이 자기 이름표였다 - { label: '인쇄자',
       value: '인쇄자' }. 값 칸을 통째로 떼어도 이름표가 남아 통과했다.

   "164항목 대조 · 불일치 0" 이 아무것도 뜻하지 않았다. §8.2 가 이 시스템에서
   가장 중요한 검증이라고 적은 자리다.

   이제 종이를 **칸으로 쪼개** 본다. 값은 어느 한 칸 안에 있어야 하고, 이름표가
   붙은 항목은 **그 이름표 바로 뒤 칸**에 있어야 한다.
--------------------------------------------------------------------------- */

const REACT_GAP = new RegExp('<!--\\s*-->', 'g');

const unescape = (t) => t
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** 종이의 칸을 문서 차례대로 뽑는다 */
function cellsOf(html) {
  const body = html.replace(REACT_GAP, '').replace(/<script[\s\S]*?<\/script>/gi, ' ')
                   .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const out = [];
  for (const m of body.matchAll(new RegExp('<(th|td|dd|dt)\\b[^>]*>([\\s\\S]*?)<\\/\\1>', 'gi'))) {
    out.push({ tag: m[1].toLowerCase(), text: unescape(m[2]) });
  }
  return out;
}

/** 이름표 -> 바로 뒤 칸. th/td 짝과 dt/dd 짝을 함께 본다 */
function pairsOf(cells) {
  const map = new Map();
  for (let i = 0; i < cells.length - 1; i += 1) {
    const a = cells[i]; const b = cells[i + 1];
    if ((a.tag === 'th' && b.tag === 'td') || (a.tag === 'dt' && b.tag === 'dd')
        || (a.tag === 'td' && b.tag === 'td')) {
      if (a.text && !map.has(a.text)) map.set(a.text, b.text);
    }
  }
  return map;
}

/**
 * 값이 칸 안에 있는가.
 *
 * 칸의 글이 값과 같거나, 값 뒤에 단위만 붙은 꼴이거나(20 장 · 4 통),
 * 값이 낱말 경계에서 끊어져 들어 있어야 한다. "12" 가 "2026-09-02" 안에
 * 우연히 들어가는 것을 막는 것이 요점이다.
 */
function inCell(cellText, value) {
  const t = cellText.trim();
  const v = value.trim();
  if (!t || !v) return false;
  if (t === v) return true;
  const i = t.indexOf(v);
  if (i < 0) return false;
  const before = i === 0 ? '' : t[i - 1];
  const after = t[i + v.length] ?? '';
  const wordish = (ch) => /[0-9A-Za-z가-힣]/.test(ch);
  /* 숫자 값이 더 긴 숫자 안에 묻히면 안 된다 */
  if (/^[0-9.]+$/.test(v)) {
    return !/[0-9.]/.test(before) && !/[0-9.]/.test(after);
  }
  return !wordish(before) || !wordish(after);
}

async function sheet(name, formPath, checks, signBoxes, register) {
  const r = await fetch(`${BASE}${formPath}`, { headers: { cookie } });
  say('');
  say(`${name}   ${formPath}`);
  say('-'.repeat(96));

  if (r.status !== 200) {
    fail++;
    say(`  ${'실패'}  화면이 열리지 않습니다 (HTTP ${r.status})`);
    return;
  }
  const raw = await r.text();
  const text = visibleText(raw);
  const cells = cellsOf(raw);
  const pairs = pairsOf(cells);

  /*
   * 쪽 번호는 실제 매수와 같아야 한다 (§7).
   *
   * 장 자체를 세고(data-sheet), 꼬리글이 말하는 N 과 견준다. 꼬리글끼리
   * 견주면 틀린 값끼리 맞아떨어져 통과한다.
   */
  /*
   * React 는 이어진 글자 조각 사이에 <!-- --> 를 끼운다. 떼고 본다.
   * 이것을 몰라 "종이가 쪽 번호를 말하지 않는다" 고 일곱 번 잘못 짚었다.
   */
  const flat = raw.replace(REACT_GAP, '');
  const sheets = (flat.match(/data-sheet="/g) || []).length;
  const claims = [...flat.matchAll(new RegExp('(\\d+)\\s*\\/\\s*(\\d+)<\\/div>', 'g'))].map(
    (m) => [Number(m[1]), Number(m[2])]);
  if (sheets > 0) {
    const nOk = claims.length === sheets && claims.every(([, n]) => n === sheets);
    const seqOk = claims.every(([i], k) => i === k + 1);
    const ok = nOk && seqOk;
    ok ? pass++ : fail++;
    say(`  ${ok ? '일치' : '불일치'}  ${'쪽 번호 n / N'.padEnd(22)}  `
      + `실제 ${sheets}장 · 종이가 말하는 것 ${claims.map((c) => c.join('/')).join(' ') || '없음'}`);
  }

  /*
   * 서명란은 낱말로 못 센다.
   *
   * 처음에는 '서명' 이 종이 어딘가에 있는지만 봤다. 그 낱말은 머리글의
   * "서명 후 정본이 됩니다" 에도 있어 서명란이 통째로 빠져도 통과했다.
   * 그래서 이름표로 바꿨는데 그것도 약했다 - '작업자' 는 머리표와 공정 기록에도
   * 나와 종이에 네 번 있다. 역시 서명란 없이 통과한다 (4차 자기 검수).
   *
   * 셀 수 있는 것은 빈 칸 자체다. 다만 sign-box 클래스로는 안 된다 - 편철
   * 표지의 철 확인란이 같은 클래스를 써서, 서류가 여덟 줄이면 서명란 3칸이
   * 11칸으로 잡힌다. SignRow 만 다는 data-sign-role 을 센다.
   */
  const boxes = (raw.match(/data-sign-role="/g) || []).length;
  if (typeof signBoxes === 'number') {
    const ok = boxes === signBoxes;
    ok ? pass++ : fail++;
    say(`  ${ok ? '일치' : '불일치'}  ${'서명란 칸 수'.padEnd(22)}  ${boxes}칸 (기대 ${signBoxes})`);
  }

  /*
   * 대장과 종이를 견준다. 이 셋은 §7 이 모든 인쇄물에 요구한 것이고, 재인쇄
   * 때 자료가 바뀌었는지 아는 장치이므로 값이 맞아야 뜻이 있다.
   */
  if (register) {
    const rp = await registerCheck(register.kind, register.where ?? {});
    if (!rp) {
      fail++;
      say(`  불일치  ${'인쇄 대장'.padEnd(22)}  이 종이의 줄이 대장에 없습니다`);
    } else {
      for (const [label, want] of [
        ['인쇄 회차', String(rp.seq)],
        ['자료 식별자', String(rp.data_hash).slice(0, 12)],
        ['인쇄자', rp.full_name],
      ]) {
        const got = pairs.get(label);
        const ok = got !== undefined && inCell(got, want);
        ok ? pass++ : fail++;
        say(`  ${ok ? '일치' : '불일치'}  ${(label + ' (대장 대조)').padEnd(22)}  `
          + `대장 ${want} · 종이 ${got ?? '(칸 없음)'}`);
      }
    }
  }

  for (const c of checks) {
    const value = c.value === null || c.value === undefined ? '' : String(c.value).trim();
    if (value === '') {
      /*
       * 전에는 조용히 건너뛰었다. DB 에 값이 없으면 대조할 것이 없다는
       * 뜻이었는데, 그러면 자료가 빈 것과 시험이 안 본 것을 가릴 수 없다.
       * 세어서 보고한다.
       */
      skip++;
      say(`  건너뜀  ${c.label.padEnd(22)}  자료가 비어 있어 대조하지 않음`);
      continue;
    }

    let found;
    let where;
    if (c.cell) {
      /* 이름표가 지정된 항목은 그 이름표 바로 뒤 칸에 있어야 한다 */
      const got = pairs.get(c.cell);
      found = got !== undefined && inCell(got, value);
      where = got === undefined ? `'${c.cell}' 칸이 없음` : `'${c.cell}' = ${got}`;
    } else if (c.anywhere) {
      /* 칸이 아닌 자리(문단 · 제목)에 나오는 것 */
      found = text.includes(value);
      where = '';
    } else {
      found = cells.some((x) => inCell(x.text, value));
      where = '';
    }

    const ok = c.absent ? !found : found;
    ok ? pass++ : fail++;
    say(`  ${ok ? '일치' : '불일치'}  ${c.label.padEnd(22)}  ${
      c.absent ? '나오지 않아야 함 ' : ''}${
      value.length > 40 ? value.slice(0, 40) + '…' : value}${where ? '   ' + where : ''}`);
  }
}

/* ---------------------------------------------------------------------------
   모든 인쇄물 공통 (§7)

   전에는 이름표가 종이에 있는지만 봤다 - { label: '인쇄자', value: '인쇄자' }.
   값 칸을 통째로 떼어도 이름표가 남아 통과했다. 회차와 자료 식별자는 재인쇄
   때 자료가 바뀌었는지 아는 유일한 장치인데, 그 값이 옳게 찍히는지는 아무도
   확인하지 않고 있었다 (4차 감사).

   이제 대장(record_print)에서 실제 값을 읽어 종이와 견준다.
--------------------------------------------------------------------------- */
/* 허가 번호는 제품표준서가 들고 있고 라벨 업체가 이 종이를 보고 찍는다 (0095) */
const lic = await one(
  `select coalesce(dm.license_no, '') as license_no
     from device_master dm join work_order wo on wo.device_master_id = dm.id
    where wo.id = $1`, [wo.id]);

const org = await one(
  `select coalesce(company_name,'') as name, coalesce(address,'') as address,
          coalesce(plant_address,'') as plant_address,
          coalesce(biz_no,'') as biz_no, coalesce(ceo_name,'') as ceo_name
     from org_brand limit 1`);

/*
 * 제조소 표시는 설정에 적힌 것만 종이에 나간다 (5차 감사 D1). 비어 있으면
 * 종이에도 없는 것이 맞으므로 건너뛴다 - 대조는 충실성을 묻지 완결성을 묻지
 * 않는다. 적혀 있는데 안 나오는 것만 잡는다.
 */
const common = (kindLabel) => [
  { label: '양식 이름', value: kindLabel, anywhere: true },
  /* 제조소가 먼저이고, 본사는 제조소와 다를 때만 붙는다 (0094) */
  { label: '제조소 소재지', value: org?.plant_address ?? '', anywhere: true },
  { label: '본사 소재지',
    value: (org?.plant_address && org?.address !== org?.plant_address)
      ? (org?.address ?? '') : '', anywhere: true },
  { label: '사업자등록번호',  value: org?.biz_no ?? '',   anywhere: true },
  { label: '대표자',          value: org?.ceo_name ?? '', anywhere: true },
];

/** 종이를 뽑은 뒤 대장에 남은 줄. 그 값이 종이에 그대로 찍혔는지 본다 */
async function registerCheck(kind, where = {}) {
  const cond = ['rp.kind = $1::print_kind'];
  const args = [kind];
  for (const [col, v] of Object.entries(where)) {
    if (v === undefined || v === null) continue;
    args.push(v);
    cond.push(`rp.${col} = $${args.length}`);
  }
  return one(
    `select rp.seq, rp.data_hash, u.full_name
       from record_print rp join app_user u on u.id = rp.printed_by
      where ${cond.join(' and ')}
      order by rp.printed_at desc, rp.seq desc limit 1`, args);
}

/* --- 1. 작업 지시서 -------------------------------------------------------- */

await sheet('① 작업 지시서', `/print/work-order/${wo.id}`, [
  ...common('작업 지시서'),
  { label: '지시서번호',        value: wo.wo_no, cell: '지시서번호' },
  /*
   * 필요 용기 수 (§7). 단위가 다른 값을 더한 숫자가 찍히고 있었다.
   * 단위별로 각각 종이에 있어야 한다.
   */
  ...containerExpect.map((c) => ({
    label: `필요 용기 ${c.uom}`, value: `${c.n} ${c.uom}`, cell: '필요 용기 수',
  })),
  { label: '장입 장수',         value: String(wo.sheet_count), cell: '장입 장수' },
  { label: '배치번호',          value: wo.batch_no },
  // 제품 자리에는 최상위 관리 코드가 나가고, 형명(PD…)은 규격으로 함께 적힌다
  { label: '제품 관리 코드',    value: wo.product_code ?? wo.item_code },
  { label: '제품명',            value: wo.product_name ?? wo.item_name },
  { label: '형명',              value: wo.item_code },
  { label: '제품표준서 개정',   value: wo.dmr_revision },
  { label: '원재료 로트번호',   value: wo.raw_lot_no },
  { label: '두께 구간',         value: wo.thickness_band },
  { label: '원재료 공급자',     value: wo.supplier_name },
  { label: '성적서 번호',       value: wo.coa_no },
  { label: '생산 발행자',       value: wo.prod_name },
  { label: '품질 발행자',       value: wo.qa_name },
  // 공정별 설비. 발행 시점의 밸리데이션 만료일이 함께 찍힌다
  ...equipLines.slice(0, 3).flatMap((q) => [
    { label: `설비 ${q.code}`,        value: q.code },
    { label: `설비 만료 ${q.code}`,   value: q.valid_until },
  ]),
  // §7 "시약·포장재 로트번호는 들어가지 않는다". 착수 전에 정해지지 않는다
  ...reagentLots.map((r) => (
    { label: '시약 로트 미기재', value: r.lot_no, absent: true })),
  /* §7 이 이 양식의 핵심 항목으로 "생산·품질 서명란" 을 적어 두었다 */
  { label: '생산 책임자 서명란', value: '생산 책임자' },
  { label: '품질 책임자 서명란', value: '품질 책임자' },
], 2, { kind: 'WORK_ORDER', where: { work_order_id: wo.id } });

/* --- 2. 제조기록서 --------------------------------------------------------- */

if (day) {
  const mats = issues.filter((i) => i.lot_no);
  await sheet('② 제조기록서', `/print/day-record/${day.work_order_id}/${day.day_no}/${day.worker_id}`, [
    ...common('제조기록서'),
    { label: '배치번호',     value: day.batch_no },
    { label: '일차',         value: `${day.day_no}일차` },
    { label: '작업일',       value: day.work_date },
    { label: '작업자',       value: day.worker_name },
    ...issues.slice(0, 4).map((i) => (
      { label: `공정 ${i.op_code}`, value: i.op_name })),
    ...issues.filter((i) => i.started).slice(0, 3).map((i) => (
      { label: `시작 시각 ${i.op_code}`, value: i.started })),
    ...issues.filter((i) => i.ended).slice(0, 3).map((i) => (
      { label: `종료 시각 ${i.op_code}`, value: i.ended })),
    ...mats.slice(0, 5).map((i) => (
      { label: `투입 로트 ${i.item_name}`, value: i.lot_no })),
    ...mats.slice(0, 5).map((i) => (
      { label: `투입 수량 ${i.item_name}`, value: String(Number(i.qty)) })),
    // 설비를 적었으면 종이에도 그 코드가 있어야 한다. 늘 비어 있던 칸이다
    ...[...new Set(issues.map((i) => i.equipment_id).filter(Boolean))].map((q) => (
      { label: '설비번호', value: q })),
    /*
     * 서명란은 이름표로 대조한다. 전에는 '서명' 이라는 낱말이 종이 어딘가에
     * 있는지만 봤는데, 그 낱말은 머리글의 "서명 후 정본이 됩니다" 에도 있어서
     * 서명란이 통째로 빠져도 통과했다.
     */
    { label: '작업자 서명란', value: '작업자' },
    { label: '생산 책임자 서명란', value: '생산 책임자' },
  ], 2, { kind: 'DAY_RECORD', where: { work_order_id: day.work_order_id,
                                       day_no: day.day_no, worker_id: day.worker_id } });
} else {
  say('');
  say('② 제조기록서   건너뜀 - 잠긴 묶음이 없습니다 (열면 이 시험이 잠급니다)');
}

/* --- 3. 라벨요청서 --------------------------------------------------------- */

await sheet('③ 라벨요청서', `/print/label-request/${wo.id}`, [
  { label: '허가 번호', value: lic?.license_no ?? '', cell: '허가 번호' },
  ...common('라벨요청서'),
  { label: '배치번호', value: wo.batch_no },
  // 이 종이는 배치 하나의 여러 형명을 함께 담는다. 머리글은 최상위 제품 코드다
  { label: '제품 관리 코드', value: wo.product_code ?? wo.item_name },
  ...lots.flatMap((l) => [
    { label: `제조번호 ${l.item_code}`, value: l.lot_no },
    { label: `모델명 ${l.lot_no}`,      value: l.item_code },
    // 규격은 라벨 업체가 이 종이를 보고 찍는 값이다. 한때 10배 작게 나갔다
    // (3차 검수 결함 1). §8.2 가 가장 중요하다고 한 대조가 이것이다.
    { label: `규격 ${l.lot_no}`,        value: l.spec },
    { label: `수량 ${l.lot_no}`,        value: String(l.qty_produced) },
  ]),
  { label: '요청자 서명란', value: '요청자' },
  { label: '확인자 서명란', value: '확인자' },
], 2, { kind: 'LABEL_REQUEST', where: { work_order_id: wo.id } });

/* --- 4. 편철 표지 ---------------------------------------------------------- */

await sheet('④ 편철 표지', `/print/cover/${wo.id}`, [
  { label: '허가 번호 (표지)', value: lic?.license_no ?? '', anywhere: true },
  ...common('편철 표지'),
  { label: '배치번호',        value: wo.batch_no },
  { label: '지시서번호',      value: wo.wo_no },
  { label: '원재료 로트번호', value: wo.raw_lot_no },
  { label: '성적서 번호',     value: wo.coa_no },
  { label: '장입 장수',       value: String(wo.sheet_count) },
  // 공정이 보통 몇 일차인지. 참고값이지만 종이에 나와야 계획을 세운다
  ...(wo.typical_days ?? []).map((d, i) => ({
    label: `공정 ${i + 1} 보통 일차`, value: String(d),
  })),
  ...lots.map((l) => ({ label: `제품 로트 ${l.item_code}`, value: l.lot_no })),
  // 일차는 칸 하나에 숫자로 적힌다. 대조는 그 줄의 작업자와 작업일로 한다
  ...(day ? [
    { label: '일차별 기록 작업자', value: day.worker_name },
    { label: '일차별 기록 작업일', value: day.work_date },
  ] : []),
  // 같은 공정을 두 번 한 불출은 회차가 찍혀야 중복으로 오해되지 않는다
  { label: '재작업 회차 표기', value: rework ? '2회차' : '' },
  // 편철 서류 목록. 이 묶음에 무엇이 철해져야 하는지가 종이에 있어야 한다
  { label: '편철 서류 목록', value: '편철 서류 목록', anywhere: true },
  { label: '목록 · 작업 지시서', value: '작업 지시서' },
  { label: '목록 · 제조기록서', value: '제조기록서 (일차 · 작업자별)' },
  { label: '목록 · 출하 승인 요청서', value: coverRR },
  { label: '목록 · 멸균 성적서', value: coverCert },
  { label: '목록 · 원재료 성적서', value: wo.coa_no },
  { label: '철 확인란',        value: '철 확인' },
  { label: '생산 책임자 서명란', value: '생산 책임자' },
  { label: '품질 검토 서명란', value: '품질 검토' },
  { label: '품질 책임자 서명란', value: '품질 책임자' },
], 3, { kind: 'COVER', where: { work_order_id: wo.id } });

/* --- 5. 자재 라벨 ---------------------------------------------------------- */

if (mat) {
  await sheet('⑤ 자재 라벨', `/print/label/${mat.id}`, [
    ...common('자재 라벨'),
    { label: '로트번호', value: mat.lot_no, anywhere: true },
    { label: '품목명',     value: mat.item_name },
    /*
     * 종이가 찍는 것은 입고 수량이다 (qty_received). 전에는 qty_available 을
     * 기대하면서 종이 어딘가에 그 숫자가 있으면 통과했다 - 둘이 같을 때만
     * 우연히 맞았다 (4차 감사).
     */
    { label: '입고 수량', value: String(Number(mat.qty_received)), cell: '입고 수량' },
    { label: '유효기한',   value: mat.expiry_date },
    { label: '성적서 번호', value: mat.coa_no },
    { label: '공급자',     value: mat.supplier_name },
  ], undefined, { kind: 'LABEL', where: { material_lot_id: mat.id } });
}

/* --- 6. 출하 승인 요청서 --------------------------------------------------- */

/*
 * 요청서는 배치 안에서 고른 로트 묶음 단위다. 로트 두 건을 서로 다른 수량으로
 * 골라 발행하고, 고른 수량이 그대로 종이에 나오는지와 요청서 번호 형식까지
 * 본다. 회차는 이 발행으로 하나 늘어난 값이다.
 */
if (lots.length > 0) {
  const pick = lots.slice(0, 2).map((l, i) => ({ ...l, req: Math.min(l.qty_available, i + 1) }));
  const selArg = pick.map((l) => `${l.id}:${l.req}`).join(',');
  await sheet('⑥ 출하 승인 요청서',
    `/print/release-request/${wo.id}?sel=${encodeURIComponent(selArg)}`, [
    ...common('출하 승인 요청서'),
    { label: '요청서 번호 형식', value: `RR-${wo.batch_no}-` },
    { label: '배치번호',         value: wo.batch_no },
    ...pick.flatMap((l) => [
      { label: `제조번호 ${l.item_code}`, value: l.lot_no },
      { label: `모델명 ${l.lot_no}`,      value: l.item_code },
      { label: `유효기한 ${l.lot_no}`,    value: l.expiry_date },
    ]),
    { label: '요청 합계', value: String(pick.reduce((a, l) => a + l.req, 0)) },
    { label: '품질책임자란', value: '품질책임자' },
  ], undefined, { kind: 'RELEASE_REQUEST', where: { work_order_id: wo.id } });
}

/* --- 7. 설비 사용 기록 ------------------------------------------------------ */

if (eqLog) {
  await sheet('⑦ 설비 사용 기록', `/print/equipment-log/${eqLog.id}`, [
    ...common('설비 사용 기록'),
    { label: '관리번호',        value: eqLog.code },
    { label: '설비명',          value: eqLog.name },
    { label: '밸리데이션 보고서', value: eqLog.report_no },
    { label: '사용 배치',       value: eqLog.batch_no },
    { label: '당시 밸리데이션 열', value: '당시 밸리데이션' },
  ], undefined, { kind: 'EQUIPMENT_LOG', where: {} });
} else {
  say('');
  say('⑦ 설비 사용 기록   건너뜀 - 설비가 적힌 기록이 없습니다');
}

/* --- 보고서 ---------------------------------------------------------------- */

say('');
say('='.repeat(96));
say(` 대조 ${pass + fail}항목 · 일치 ${pass} · 불일치 ${fail}`
  + (skip ? ` · 건너뜀 ${skip} (자료가 비어 대조하지 못한 항목)` : ''));
say('='.repeat(96));
if (fail === 0) {
  say(' 종이에 나와야 할 값이 전부 나왔고, 나오면 안 되는 값은 나오지 않았습니다.');
} else {
  say(' 불일치 항목을 확인하십시오. 종이가 정본이므로 화면이 아니라 종이를 고쳐야 합니다.');
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
const file = path.join(ROOT, 'reports', `PRINT-${stamp}.txt`);
writeFileSync(file, [
  '인쇄 충실성 시험 (§8.2)',
  `대상 ${BASE}`,
  `배치 ${wo.batch_no} · 지시서 ${wo.wo_no}`,
  '',
  ...out,
].join('\n'), 'utf8');
say('');
say(`보고서: ${path.relative(ROOT, file)}`);

await db.end();
process.exit(fail === 0 ? 0 : 1);
