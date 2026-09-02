// =============================================================================
// 12_model_scheme.mjs · 형명 체계 (M5-4)
//
// 형명 `PD + 가로2 + 세로2 + 두께하한2 + 두께상한2` 가 일곱 자리에 박혀 있다.
// 그것을 설정으로 여는 것이 M5-4 인데, 이 값이 종이에 찍히는 치수를 만든다.
// 한 번 틀리면 라벨 업체가 보는 종이에 10배 틀린 치수가 나가고, 실제로 그런
// 적이 있다 (0057).
//
// ── 왜 여기서 규칙을 다시 적는가 ─────────────────────────────────────────
// 아래 expected* 는 SQL 을 부르지 않는다. 사양(§4.2 · §7)에 적힌 규칙을 JS 로
// 다시 구현해 견준다. spec_label() 이 무엇을 내든 상관없이 **사양이 말하는
// 값**과 같은지를 묻는다.
//
// 지금 구현을 그대로 베껴 오면 그건 시험이 아니라 복사다 - 구현을 바꿀 때
// 같이 바뀌어 아무것도 잡지 못한다. M5-4 가 구현을 통째로 갈아 끼우므로
// 이 독립성이 유일한 안전망이다.
//
// ── 이름은 규칙 대상이 아니다 ────────────────────────────────────────────
// 처음 판은 완제품 이름도 형명에서 나와야 한다고 보고 전건을 견줬다. 그런데
// 이름은 사람이 손으로 고칠 수 있다 - 채번 시험이 만든 'PD99990510 채번시험
// 형명' 이 그렇다. 코드에서 기계적으로 나오는 것은 규격 문구와 넓이 둘이고,
// 이름은 generate_finished_items 가 처음 만들 때만 규칙을 따른다.
// =============================================================================

import { masterData as master } from '../fixtures.mjs';

/* 크기 두 자리는 숫자가 곧 cm 다.  '05' → 5,  '10' → 10 */
const cm = (d) => String(parseInt(d, 10));

/* 두께 두 자리는 10배한 mm 다.  '05' → 0.5,  '10' → 1.0 */
const mm = (d) => (parseInt(d, 10) / 10).toFixed(1);

const PARTS = /^PD(\d{2})(\d{2})(\d{2})(\d{2})$/;

/** 인쇄물이 쓰는 규격 문구 (§7). 형명이 아니면 빈 글 */
/*
 * 0088 부터 **완제품인데 규격을 못 만들면 그 사실을 적는다** (5차 감사 C2).
 * 빈 칸이 종이에 나가면 아무도 모르고, 그 칸은 라벨 업체가 보고 찍는 자리다.
 *
 * 자재 코드에는 그대로 빈 문자열이다 - 자재에는 이런 뜻의 규격이 없고 없는
 * 것이 정상이다 (MS-03).
 */
function expectedSpec(code, type) {
  const m = PARTS.exec(code);
  if (m) return `${cm(m[1])}x${cm(m[2])}cm · 두께 ${mm(m[3])}~${mm(m[4])}mm`;
  return type === 'FIN' ? '(형명 체계에 없는 코드)' : '';
}

/** 넓이 cm2. 원가를 배치 안에서 넓이로 가르는 데 쓴다 (0066) */
function expectedArea(code) {
  const m = PARTS.exec(code);
  return m ? parseInt(m[1], 10) * parseInt(m[2], 10) : null;
}

/** generate_finished_items 가 처음 붙이는 이름 (§4.2) */
function expectedName(code, prefix) {
  const m = PARTS.exec(code);
  return m ? `${prefix} ${cm(m[1])}x${cm(m[2])}cm ${mm(m[3])}~${mm(m[4])}mm` : null;
}

export default [

{
  id: 'MS-01', expect: '확인',
  name: '등록된 품목 전건이 사양대로 규격 문구와 넓이를 낸다',
  async run(t) {
    await master(t);

    /* 완제품만 보지 않는다. 자재 코드에 규격 문구가 붙어도 안 된다 */
    const rows = await t.rows(
      `select code, type::text as type,
              spec_label(code) as spec, item_area_cm2(code) as area
         from item order by code`);

    t.ok(rows.length > 0, '품목이 하나도 없다');

    const bad = [];
    for (const r of rows) {
      const spec = expectedSpec(r.code, r.type);
      const area = expectedArea(r.code);
      const gotArea = r.area === null ? null : Number(r.area);
      if (r.spec !== spec) bad.push(`${r.code} 규격 "${r.spec}" ≠ "${spec}"`);
      if (gotArea !== area) bad.push(`${r.code} 넓이 ${gotArea} ≠ ${area}`);
    }
    if (bad.length) {
      throw new Error(`${rows.length}종 중 ${bad.length}건이 어긋난다:\n   ` +
        bad.slice(0, 6).join('\n   '));
    }
  },
},

{
  id: 'MS-02', expect: '확인',
  name: '두 자리가 갈리는 자리를 낱낱이 확인한다',
  async run(t) {
    await master(t);

    /*
     * 전건 대조가 지나칠 수 있는 경계다. 앞 네 자리와 뒤 네 자리의 단위가
     * 다르고, 한 자리 수와 두 자리 수, 0 으로 끝나는 값이 서로 다른 길로 간다.
     */
    const cases = [
      ['PD05050510', '5x5cm · 두께 0.5~1.0mm',    25],
      ['PD10150510', '10x15cm · 두께 0.5~1.0mm', 150],
      ['PD10152025', '10x15cm · 두께 2.0~2.5mm', 150],
      ['PD20202530', '20x20cm · 두께 2.5~3.0mm', 400],
      ['PD12151015', '12x15cm · 두께 1.0~1.5mm', 180],
    ];
    for (const [code, spec, area] of cases) {
      t.eq(await t.val(`select spec_label($1)`, [code]), spec, `${code} 규격`);
      t.eq(Number(await t.val(`select item_area_cm2($1)`, [code])), area, `${code} 넓이`);
      /* 시험에 손으로 적은 값이 위의 규칙과도 같은지 본다 - 오타 방지 */
      t.eq(spec, expectedSpec(code), `${code} 시험에 적은 값이 사양과 같다`);
      t.eq(area, expectedArea(code), `${code} 시험에 적은 넓이가 사양과 같다`);
    }
  },
},

{
  id: 'MS-03', expect: '확인',
  name: '형명이 아닌 코드에는 규격 문구를 지어내지 않는다',
  async run(t) {
    await master(t);
    for (const code of ['RM-006', 'PM-001', 'PD1015051', 'PD101505100', 'pd05050510']) {
      t.eq(await t.val(`select spec_label($1)`, [code]), '',
           `${code} 는 형명이 아니다`);
      t.eq(await t.val(`select item_area_cm2($1)`, [code]), null,
           `${code} 는 넓이가 없다`);
    }
  },
},

{
  id: 'MS-04', expect: '확인',
  name: '이름을 만드는 규칙과 제외 조합',
  async run(t) {
    await master(t);

    /*
     * §4.2 가 "62개를 손으로 등록하지 말 것" 이라고 못박은 자리다. 13개 크기 ×
     * 5개 두께에서 세 조합이 빠진다.
     */
    const made = await t.rows(
      `select * from generate_finished_items(
         array['3030','3040'],
         array['0510','2530'],
         array['30402530'],
         'MSTEST')`);

    t.eq(made.length, 3, '2 x 2 에서 하나를 뺀 셋');

    for (const r of made) {
      t.eq(r.item_name, expectedName(r.item_code, 'MSTEST'), `${r.item_code} 이름`);
    }
    t.eq(made.some((r) => r.item_code === 'PD30402530'), false,
         '제외 조합은 만들지 않는다');

    /* 만든 뒤에도 규격 문구가 사양과 같아야 한다 */
    for (const r of made) {
      t.eq(await t.val(`select spec_label($1)`, [r.item_code]),
           expectedSpec(r.item_code), `${r.item_code} 규격`);
    }
  },
},

{
  id: 'MS-05', expect: '확인',
  name: '종이에 나가는 규격은 화면과 같은 자리에서 온다',
  async run(t) {
    await master(t);

    /*
     * 인쇄 페이지가 각자 환산하면 갈라진다 - 한때 두 곳이 복제해 두고 네 자리
     * 전부를 10 으로 나눠, 라벨 업체가 보는 종이에 10배 작은 치수가 나갔다
     * (0057). 규격 문구를 내는 함수가 하나뿐인지 확인한다.
     */
    const n = await t.val(
      `select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'spec_label'`);
    t.eq(n, 1, 'spec_label 은 하나여야 한다');
  },
},

{
  id: 'MS-06', expect: '예외',
  name: '활성 체계가 둘이면 조용히 고르지 않는다 (5차 감사 B2)',
  async run(t) {
    const m = await master(t);

    /* 접두어가 다르면 함께 활성이다. 활성 유일 제약이 prefix 별이다 */
    await t.rows(
      `insert into model_scheme (name, prefix, spec_pattern, name_pattern,
                                 is_active, registered_by)
       values ('두 번째 체계', 'QQ', '{1}x{2}cm', '{P} {1}x{2}', true, $1)`,
      [m.admin]);

    await t.rejects(
      () => t.rows(`select * from generate_finished_items(
                      array['0505'], array['0510'], array[]::text[], 'ZZ')`),
      { code: 'P0001', message: '어느 체계로 만들지 고르십시오' });
  },
},

{
  id: 'MS-07', expect: '통과',
  name: '고른 체계의 접두어로 만든다 (5차 감사 B2)',
  async run(t) {
    const m = await master(t);

    const other = await t.val(
      `insert into model_scheme (name, prefix, spec_pattern, name_pattern,
                                 is_active, registered_by)
       values ('세 번째 체계', 'RR', '{1}x{2}cm', '{P} {1}x{2}', true, $1)
       returning id`, [m.admin]);
    /* 자리 정의가 있어야 코드를 가른다. 앞 네 자리 크기 · 뒤 네 자리 두께 */
    for (const [seq, digits, divisor, decimals, label, role] of [
      [1, 2, 1, 0, '가로', 'WIDTH'], [2, 2, 1, 0, '세로', 'HEIGHT'],
      [3, 2, 10, 1, '두께 하한', 'BAND'], [4, 2, 10, 1, '두께 상한', 'BAND'],
    ]) {
      await t.rows(
        `insert into model_segment (scheme_id, seq, digits, divisor, decimals, label, role)
         values ($1,$2,$3,$4::numeric,$5,$6,$7)`,
        [other, seq, digits, divisor, decimals, label, role]);
    }

    const made = await t.rows(
      `select * from generate_finished_items(
         array['0505'], array['0510'], array[]::text[], 'ZZ', 12, $1)`, [other]);

    t.eq(made.length, 1, '만들어진 수');
    t.eq(made[0].item_code, 'RR05050510', '고른 체계의 접두어');
  },
},

{
  id: 'MS-08', expect: '확인',
  name: '완제품인데 규격을 못 만들면 빈 칸이 아니라 사실을 적는다 (5차 감사 C2)',
  async run(t) {
    await master(t);

    await t.rows(
      `insert into item (code, name, type, purchase_uom, usage_uom)
       values ('ZZNOSCHEME', '체계 밖 완제품', 'FIN', 'EA', 'EA')`);

    t.eq(await t.val(`select spec_label('ZZNOSCHEME')`),
         '(형명 체계에 없는 코드)', '완제품은 말한다');

    /* 자재는 그대로 빈 문자열이다. 없는 것이 정상이다 */
    t.eq(await t.val(`select spec_label('RM-006')`), '', '자재는 말하지 않는다');

    await t.rows(`update model_scheme set is_active = false`);
    t.eq(await t.val(`select spec_label('ZZNOSCHEME')`),
         '(형명 체계 미등록)', '체계가 없을 때는 그렇게 말한다');
  },
},

];
