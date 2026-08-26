// =============================================================================
// 03_numbering.mjs - 채번 규칙 시험
// 근거: CLAUDE.md §4.10, §8.1 채번 시험
// =============================================================================

async function newItem(t) { return t.val(`select gen_random_uuid()`); }

async function mkRule(t, { target, item = null, pattern, reset = 'YEARLY', width = 4 }) {
  return t.val(
    `insert into numbering_rule
       (target, item_id, pattern, reset, seq_width, effective_from, registered_by)
     values ($1,$2,$3,$4,$5, current_date, $6) returning id`,
    [target, item, pattern, reset, width, t.fx.admin]);
}

const kstDate  = (t) => t.val(`select to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD')`);
const kstMonth = (t) => t.val(`select to_char(timezone('Asia/Seoul', now()), 'YYYY-MM')`);
const kstYear  = (t) => t.val(`select to_char(timezone('Asia/Seoul', now()), 'YYYY')`);

// WORK_ORDER 공통/품목별 규칙은 N-04·N-05가 공유한다.
let wo = null;
async function ensureWO(t) {
  if (wo) return wo;
  const item = await newItem(t);
  await mkRule(t, { target: 'WORK_ORDER', pattern: 'WO-COMMON-{SEQ:3}', reset: 'NEVER', width: 3 });
  await mkRule(t, { target: 'WORK_ORDER', item, pattern: 'WO-ITEM-{SEQ:3}', reset: 'NEVER', width: 3 });
  wo = { item };
  return wo;
}

export default [

{
  id: 'N-01', expect: '예외',
  name: '규칙 미정의 상태에서 채번 시도',
  async run(t) {
    // STERIL_BATCH에는 공통 규칙을 만들지 않는다.
    await t.rejects(() => t.val(`select next_number('STERIL_BATCH')`),
      { code: 'P0001', message: '채번 규칙이 정의되지 않았습니다' });
  },
},

{
  id: 'N-02', expect: '중복 0건',
  name: '동일 규칙으로 100회 연속 채번',
  async run(t) {
    const item = await newItem(t);
    await mkRule(t, { target: 'MATERIAL_LOT', item,
                      pattern: 'RM-{YYYY}{MM}-{SEQ:4}', reset: 'YEARLY', width: 4 });

    const nums = [];
    for (let i = 0; i < 100; i++) {
      nums.push(await t.val(`select next_number('MATERIAL_LOT', $1)`, [item]));
    }

    t.eq(new Set(nums).size, 100, '고유 번호 수');
    const seqs = nums.map((n) => n.slice(-4));
    t.eq(seqs[0],  '0001', '첫 순번');
    t.eq(seqs[99], '0100', '마지막 순번');
    const gap = seqs.findIndex((s, i) => Number(s) !== i + 1);
    t.eq(gap, -1, '순번 연속성(어긋난 위치)');
  },
},

{
  id: 'N-03', expect: '순번 초기화',
  name: 'reset=YEARLY 규칙에서 연도 경계',
  async run(t) {
    const item = await newItem(t);
    const rule = await mkRule(t, { target: 'MATERIAL_LOT', item,
                                   pattern: 'YB-{YYYY}-{SEQ:4}', reset: 'YEARLY', width: 4 });

    const year = await kstYear(t);
    const prev = String(Number(year) - 1);

    // 전년도 주기에 이미 42번까지 나간 상태를 만든다.
    await t.rows(`insert into numbering_counter (rule_id, cycle_key, last_seq)
                  values ($1, $2, 42)`, [rule, prev]);

    const no = await t.val(`select next_number('MATERIAL_LOT', $1)`, [item]);
    t.eq(no, `YB-${year}-0001`, '새 연도 첫 번호');

    const rows = await t.rows(
      `select cycle_key, last_seq from numbering_counter
        where rule_id = $1 order by cycle_key`, [rule]);
    t.eq(rows, [{ cycle_key: prev, last_seq: 42 }, { cycle_key: year, last_seq: 1 }],
         '주기별 카운터');
  },
},

{
  id: 'N-04', expect: '품목별 우선',
  name: '품목별 규칙과 공통 규칙 동시 존재',
  async run(t) {
    const { item } = await ensureWO(t);
    const no = await t.val(`select next_number('WORK_ORDER', $1)`, [item]);
    t.ok(no.startsWith('WO-ITEM-'), `품목별 규칙이 적용되어야 한다 (실제: ${no})`);
  },
},

{
  id: 'N-05', expect: '공통 규칙 적용',
  name: '품목 미지정 · 규칙 없는 품목은 공통 규칙으로',
  async run(t) {
    await ensureWO(t);
    const a = await t.val(`select next_number('WORK_ORDER')`);
    t.ok(a.startsWith('WO-COMMON-'), `품목 미지정 (실제: ${a})`);

    const other = await newItem(t);
    const b = await t.val(`select next_number('WORK_ORDER', $1)`, [other]);
    t.ok(b.startsWith('WO-COMMON-'), `규칙 없는 품목 (실제: ${b})`);
  },
},

{
  id: 'N-06', expect: '거부',
  name: '같은 target·품목에 활성 규칙 중복 등록',
  async run(t) {
    const item = await newItem(t);
    await mkRule(t, { target: 'PRODUCT_LOT', item, pattern: 'A-{SEQ:3}' });
    await t.rejects(
      () => mkRule(t, { target: 'PRODUCT_LOT', item, pattern: 'B-{SEQ:3}' }),
      { code: '23505' });

    // 공통 규칙도 마찬가지다.
    await mkRule(t, { target: 'PRODUCT_LOT', pattern: 'C-{SEQ:3}' });
    await t.rejects(
      () => mkRule(t, { target: 'PRODUCT_LOT', pattern: 'D-{SEQ:3}' }),
      { code: '23505' });
  },
},

{
  id: 'N-07', expect: '순번 승계',
  name: '구 규칙을 내리고 신규 규칙 등록',
  async run(t) {
    const item = await newItem(t);
    const old  = await mkRule(t, { target: 'DEVIATION', item,
                                   pattern: 'DV-{SEQ:3}', reset: 'NEVER', width: 3 });

    const before = [];
    for (let i = 0; i < 3; i++) before.push(await t.val(`select next_number('DEVIATION', $1)`, [item]));
    t.eq(before, ['DV-001', 'DV-002', 'DV-003'], '구 규칙 발행분');

    await t.resolves(() => t.rows(`update numbering_rule set is_active = false where id = $1`, [old]));
    await t.resolves(() => mkRule(t, { target: 'DEVIATION', item,
                                       pattern: 'DV-{SEQ:3}', reset: 'NEVER', width: 3 }));

    // 카운터 기본키가 (rule_id, cycle_key)라 신규 규칙은 새 카운터를 쓴다.
    // 승계가 없으면 여기서 DV-001이 다시 나온다 (§10 번호 재사용).
    const after = await t.val(`select next_number('DEVIATION', $1)`, [item]);
    t.eq(after, 'DV-004', '신규 규칙 첫 번호');
  },
},

{
  id: 'N-08', expect: '확인',
  name: '날짜 토큰 치환 정확성 (YYYY · YY · MM · DD)',
  async run(t) {
    const item = await newItem(t);
    await mkRule(t, { target: 'BATCH', item,
                      pattern: '{YYYY}.{YY}.{MM}.{DD}-{SEQ:2}', reset: 'NEVER', width: 2 });

    const d = await kstDate(t);                       // YYYY-MM-DD
    const [Y, M, D] = d.split('-');
    const no = await t.val(`select next_number('BATCH', $1)`, [item]);
    t.eq(no, `${Y}.${Y.slice(2)}.${M}.${D}-01`, '치환 결과');
  },
},

{
  id: 'N-09', expect: '확인',
  name: 'SEQ 자릿수는 seq_width가 결정한다 (패턴의 n이 아니다)',
  async run(t) {
    const item = await newItem(t);
    await mkRule(t, { target: 'PRODUCT_LOT', item,
                      pattern: 'W-{SEQ:2}', reset: 'NEVER', width: 7 });
    const no = await t.val(`select next_number('PRODUCT_LOT', $1)`, [item]);
    t.eq(no, 'W-0000001', 'seq_width=7 영채움');
  },
},

{
  id: 'N-10', expect: '확인',
  name: 'reset=NEVER 의 cycle_key',
  async run(t) {
    const item = await newItem(t);
    const rule = await mkRule(t, { target: 'BATCH', item, pattern: 'NV-{SEQ:3}', reset: 'NEVER' });
    await t.val(`select next_number('BATCH', $1)`, [item]);
    t.eq(await t.val(`select cycle_key from numbering_counter where rule_id = $1`, [rule]),
         'NEVER', 'cycle_key');
  },
},

{
  id: 'N-11', expect: '확인',
  name: 'reset=DAILY 의 cycle_key',
  async run(t) {
    const item = await newItem(t);
    const rule = await mkRule(t, { target: 'PRODUCT_LOT', item, pattern: 'DY-{SEQ:3}', reset: 'DAILY' });
    await t.val(`select next_number('PRODUCT_LOT', $1)`, [item]);
    t.eq(await t.val(`select cycle_key from numbering_counter where rule_id = $1`, [rule]),
         await kstDate(t), 'cycle_key');
  },
},

{
  id: 'N-12', expect: '확인',
  name: 'reset=MONTHLY 의 cycle_key',
  async run(t) {
    const item = await newItem(t);
    const rule = await mkRule(t, { target: 'DEVIATION', item, pattern: 'MO-{SEQ:3}', reset: 'MONTHLY' });
    await t.val(`select next_number('DEVIATION', $1)`, [item]);
    t.eq(await t.val(`select cycle_key from numbering_counter where rule_id = $1`, [rule]),
         await kstMonth(t), 'cycle_key');
  },
},

{
  id: 'N-13', expect: '확인',
  name: '채번 날짜가 세션 타임존에 흔들리지 않는다 (사양 보강)',
  async run(t) {
    const item = await newItem(t);
    const rule = await mkRule(t, { target: 'BATCH', item,
                                   pattern: '{YYYY}{MM}{DD}-{SEQ:3}', reset: 'DAILY', width: 3 });
    const expected = (await kstDate(t)).replaceAll('-', '');

    const seen = [];
    for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
      await t.exec(`set timezone = '${tz}'`);
      const no = await t.val(`select next_number('BATCH', $1)`, [item]);
      seen.push([tz, no.split('-')[0]]);
    }
    await t.exec('reset timezone');

    for (const [tz, got] of seen) {
      t.eq(got, expected, `세션 타임존 ${tz} 에서의 날짜 토큰`);
    }
    t.eq(await t.val(`select count(*)::int from numbering_counter where rule_id = $1`, [rule]),
         1, '주기 카운터는 하나여야 한다');
  },
},

{
  id: 'N-14', expect: '거부',
  name: 'numbering_counter 순번 되돌리기 (사양 보강)',
  async run(t) {
    const item = await newItem(t);
    const rule = await mkRule(t, { target: 'MATERIAL_LOT', item, pattern: 'RB-{SEQ:3}', reset: 'NEVER' });
    for (let i = 0; i < 3; i++) await t.val(`select next_number('MATERIAL_LOT', $1)`, [item]);

    await t.rejects(
      () => t.rows(`update numbering_counter set last_seq = 0 where rule_id = $1`, [rule]),
      { code: 'P0001', message: '채번 순번은 되돌릴 수 없습니다' });
    await t.rejects(
      () => t.rows(`update numbering_counter set last_seq = 3 where rule_id = $1`, [rule]),
      { code: 'P0001', message: '채번 순번은 되돌릴 수 없습니다' });

    t.eq(await t.val(`select last_seq from numbering_counter where rule_id = $1`, [rule]),
         3, '카운터가 유지되어야 한다');
  },
},

{
  id: 'N-15', expect: '통과',
  name: '초기 이관용 시작 순번 지정 (앞으로 건너뛰기)',
  async run(t) {
    const item = await newItem(t);
    const rule = await mkRule(t, { target: 'MATERIAL_LOT', item, pattern: 'MG-{SEQ:4}', reset: 'NEVER', width: 4 });

    await t.resolves(() => t.rows(
      `insert into numbering_counter (rule_id, cycle_key, last_seq) values ($1,'NEVER',500)`, [rule]));
    t.eq(await t.val(`select next_number('MATERIAL_LOT', $1)`, [item]), 'MG-0501', '이관 이후 첫 번호');
  },
},

{
  id: 'N-16', expect: '거부',
  name: '채번 규칙 패턴 제자리 수정 (사양 보강)',
  async run(t) {
    const item = await newItem(t);
    const rule = await mkRule(t, { target: 'STERIL_BATCH', item, pattern: 'ST-{SEQ:3}', reset: 'NEVER' });

    await t.rejects(() => t.rows(`update numbering_rule set pattern = 'XX-{SEQ:3}' where id = $1`, [rule]),
      { code: 'P0001', message: '채번 규칙은 수정할 수 없습니다' });
    await t.rejects(() => t.rows(`update numbering_rule set seq_width = 6 where id = $1`, [rule]),
      { code: 'P0001', message: '채번 규칙은 수정할 수 없습니다' });
    await t.rejects(() => t.rows(`update numbering_rule set reset = 'DAILY' where id = $1`, [rule]),
      { code: 'P0001', message: '채번 규칙은 수정할 수 없습니다' });
  },
},

{
  id: 'N-17', expect: '거부',
  name: '내린 규칙 재활성화 (사양 보강)',
  async run(t) {
    const item = await newItem(t);
    const rule = await mkRule(t, { target: 'STERIL_BATCH', item, pattern: 'RA-{SEQ:3}', reset: 'NEVER' });
    await t.resolves(() => t.rows(`update numbering_rule set is_active = false where id = $1`, [rule]));
    await t.rejects(() => t.rows(`update numbering_rule set is_active = true where id = $1`, [rule]),
      { code: 'P0001', message: '다시 활성화할 수 없습니다' });
  },
},

{
  id: 'N-18', expect: '통과',
  name: 'app_role의 next_number() 실행 (security definer 경유)',
  async run(t) {
    const item = await newItem(t);
    await mkRule(t, { target: 'BATCH', item, pattern: 'AR-{SEQ:3}', reset: 'NEVER', width: 3 });
    const no = await t.asRole('app_role', () => t.resolves(
      () => t.val(`select next_number('BATCH', $1)`, [item])));
    t.eq(no, 'AR-001', '발행 번호');
  },
},

{
  id: 'N-19', expect: '거부',
  name: 'seq_width 허용 범위 밖(11) 규칙 등록',
  async run(t) {
    const item = await newItem(t);
    await t.rejects(() => mkRule(t, { target: 'BATCH', item, pattern: 'Z-{SEQ:11}', width: 11 }),
      { code: '23514' });
  },
},

{
  id: 'N-20', expect: '예외',
  name: '품목 토큰은 item 표(M1) 도입 전에는 쓸 수 없다',
  async run(t) {
    const item = await newItem(t);
    await mkRule(t, { target: 'PRODUCT_LOT', item, pattern: 'P-{ITEM}-{SEQ:3}', reset: 'NEVER' });
    await t.rejects(() => t.val(`select next_number('PRODUCT_LOT', $1)`, [item]),
      { code: 'P0001', message: 'item 표(M1) 도입 이후' });
  },
},

{
  id: 'N-21', expect: '주기별 격리',
  name: '순번 승계는 같은 cycle_key 안에서만',
  async run(t) {
    const item = await newItem(t);
    const old  = await mkRule(t, { target: 'DEVIATION', item,
                                   pattern: 'CY-{SEQ:4}', reset: 'YEARLY', width: 4 });

    for (let i = 0; i < 3; i++) await t.val(`select next_number('DEVIATION', $1)`, [item]);

    // 다른 주기(전년도)에 훨씬 큰 값이 있어도 끌어오면 안 된다.
    const prev = String(Number(await kstYear(t)) - 1);
    await t.rows(`insert into numbering_counter (rule_id, cycle_key, last_seq)
                  values ($1, $2, 999)`, [old, prev]);

    await t.rows(`update numbering_rule set is_active = false where id = $1`, [old]);
    await mkRule(t, { target: 'DEVIATION', item,
                      pattern: 'CY-{SEQ:4}', reset: 'YEARLY', width: 4 });

    const year = await kstYear(t);
    t.eq(await t.val(`select next_number('DEVIATION', $1)`, [item]), 'CY-0004',
         `${year} 주기 승계 (${prev}의 999를 끌어오면 안 된다)`);
  },
},

{
  id: 'N-22', expect: '순번 승계',
  name: '공통 규칙(item_id null) 교체도 승계된다',
  async run(t) {
    const old = await mkRule(t, { target: 'BATCH', pattern: 'CM-{SEQ:3}', reset: 'NEVER', width: 3 });

    const before = [];
    for (let i = 0; i < 2; i++) before.push(await t.val(`select next_number('BATCH')`));
    t.eq(before, ['CM-001', 'CM-002'], '구 규칙 발행분');

    await t.rows(`update numbering_rule set is_active = false where id = $1`, [old]);
    await mkRule(t, { target: 'BATCH', pattern: 'CM-{SEQ:3}', reset: 'NEVER', width: 3 });

    // item_id가 null이므로 = 이 아니라 is not distinct from 으로 물어야 걸린다.
    t.eq(await t.val(`select next_number('BATCH')`), 'CM-003', '신규 공통 규칙 첫 번호');
  },
},

{
  id: 'N-23', expect: '품목별 격리',
  name: '다른 품목의 카운터는 승계하지 않는다',
  async run(t) {
    const a = await newItem(t);
    const b = await newItem(t);
    await mkRule(t, { target: 'MATERIAL_LOT', item: a, pattern: 'IA-{SEQ:3}', reset: 'NEVER', width: 3 });
    for (let i = 0; i < 5; i++) await t.val(`select next_number('MATERIAL_LOT', $1)`, [a]);

    await mkRule(t, { target: 'MATERIAL_LOT', item: b, pattern: 'IB-{SEQ:3}', reset: 'NEVER', width: 3 });
    t.eq(await t.val(`select next_number('MATERIAL_LOT', $1)`, [b]), 'IB-001',
         '다른 품목은 1부터');
  },
},

{
  id: 'N-24', expect: '순번 승계',
  name: '3세대 연속 교체에도 순번이 이어진다',
  async run(t) {
    const item = await newItem(t);
    let rule = await mkRule(t, { target: 'STERIL_BATCH', item,
                                 pattern: 'GN-{SEQ:3}', reset: 'NEVER', width: 3 });
    const all = [];

    for (const gen of [1, 2, 3]) {
      for (let i = 0; i < 2; i++) {
        all.push(await t.val(`select next_number('STERIL_BATCH', $1)`, [item]));
      }
      if (gen < 3) {
        await t.rows(`update numbering_rule set is_active = false where id = $1`, [rule]);
        rule = await mkRule(t, { target: 'STERIL_BATCH', item,
                                 pattern: 'GN-{SEQ:3}', reset: 'NEVER', width: 3 });
      }
    }

    t.eq(all, ['GN-001', 'GN-002', 'GN-003', 'GN-004', 'GN-005', 'GN-006'], '전 세대 발행분');
    t.eq(new Set(all).size, 6, '중복 0건');
  },
},

{
  id: 'N-25', expect: '확인',
  name: '형식 미리보기는 순번을 소비하지 않고 실제 발행과 일치한다',
  async run(t) {
    const item = await newItem(t);
    const pat  = 'PV-{YYYY}{MM}{DD}-{SEQ:4}';
    const rule = await mkRule(t, { target: 'BATCH', item, pattern: pat, reset: 'NEVER', width: 4 });

    const previews = [];
    for (let i = 0; i < 10; i++) {
      previews.push(await t.val(`select preview_number($1, 4, 1)`, [pat]));
    }
    t.eq(new Set(previews).size, 1, '미리보기는 매번 같아야 한다');
    t.eq(await t.val(`select count(*)::int from numbering_counter where rule_id = $1`, [rule]),
         0, '미리보기 후 카운터 행 수');

    // 미리보기가 실제 발행과 다르면 규칙 등록 화면이 거짓말을 하는 것이다.
    const issued = await t.val(`select next_number('BATCH', $1)`, [item]);
    t.eq(issued, previews[0], '미리보기 = 첫 발행 번호');
  },
},

{
  id: 'N-26', expect: '확인',
  name: 'numbering_counter는 감사 대상이 아니다 (설계 결정)',
  async run(t) {
    t.eq(await t.val(
      `select count(*)::int from audit_log where table_name = 'numbering_counter'`),
      0, 'numbering_counter 감사행 수');
    t.ok(await t.val(
      `select count(*)::int from audit_log where table_name = 'numbering_rule'`) > 0,
      'numbering_rule 은 감사 대상이어야 한다');
  },
},

];
