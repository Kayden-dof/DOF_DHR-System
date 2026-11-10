/* ---------------------------------------------------------------------------
   제조기록서(F706) 양식 모양에 시스템이 아는 칸을 채운다 (0130 · 사용자 2026-11-10)

   양식 모양은 F706 PDF 에서 칸 단위로 옮긴 것이다 (mfg_doc.form). 인쇄는 그
   모양을 그대로 그리고, 시스템이 **확실히 아는 칸만** 채운다. 나머지 결과 ·
   확인 칸은 종이에서 사람이 적는다 - 시스템이 모르는 값을 지어내지 않는다 (§1).

     채우는 칸          어디서
     배치번호            작업 지시
     로트번호 · 모델명    제품 로트 (포장 · 멸균 양식)
     부여로트번호        그 공정에 투입한 자재 로트 · 원재료 로트
     작업(검사)자 · 일자  자재를 채운 줄의 작업자 · 작업일
     Porcine dermis 투입량 결과   장입 수량
     기기번호의 □        여러 설비 가운데 실제로 쓴 것을 ■
     특이사항            시작 · 종료 시각, 설비, 순환자, 재포장, 사유, 정정

   어느 칸이 무엇인지는 **양식의 머리 줄**로 안다 - "자재규격 · 부여로트번호 ·
   작업(검사)자 · 일자" 같은 낱말이 놓인 열이다. 양식마다 칸 배치가 달라도
   같은 규칙으로 채운다. 판정하지 않는다 (§8.5) - 값을 놓을 뿐이다.

   양식에 자리가 없는 투입은 버리지 않고 특이사항에 적는다. 종이에서 사라지면
   그 투입이 없었던 것처럼 읽힌다.
--------------------------------------------------------------------------- */

export interface FormCell {
  c: number; cs?: number; rs?: number;
  t?: string; a?: 'l' | 'c' | 'r'; b?: boolean; s?: number;
  /** 시스템이 채운 칸 (종이에 파란 글씨, 사용자 2026-11-10) */
  f?: boolean;
  /** 양식 글 가운데 시스템이 적은 조각만 (■ 1 L 같은 고른 칸). 이 조각만 파랗다 */
  tk?: string[];
  /** 특이사항 칸 (위 · 왼쪽부터 적는다) */
  n?: boolean;
  /* --- 현장에서 적는 칸 (0132) --------------------------------------------- */
  /** 칸 자리 p쪽 t표 r줄 c열. 사람이 적는 칸에만 있다 */
  id?: string;
  /** 무엇을 적는가: 고르기 · 시각 · 수치 · 글 */
  k?: FieldKind;
  /** 고르기의 보기 (□ 다음 글) */
  o?: string[];
  /** 수치 뒤에 붙는 단위 (양식에 인쇄된 것) */
  u?: string;
  /** 시각에 날짜도 적는가 (여러 날에 걸치는 칸) */
  dt?: boolean;
  /** 화면에 보일 이름: 세부공정 · 관리항목 · 허용범위 */
  lb?: string;
  /** 지금 적힌 값 */
  v?: string;
}
export type FieldKind = 'choice' | 'time' | 'number' | 'text';
export interface Entry { value: string; by: string; at: string }
export interface FormRow { h: number; cells: FormCell[] }
export interface FormTable { x: number; y: number; w: number; cols: number[]; rows: FormRow[] }
export interface FormText { t: string; x0: number; x1: number; y: number; s: number; b: boolean; color: string | null }
export interface FormPage { texts: FormText[]; tables: FormTable[] }
export interface BrForm { page: { w: number; h: number }; pages: FormPage[]; source?: string }

export interface FillIssue {
  item_code: string; item_name: string; lot_no: string; qty: string; usage_uom: string;
  amend_reason: string | null;
}
export interface FillData {
  batchNo: string;
  productLotNo: string | null;
  productModel: string | null;
  rawItemCode: string;
  rawLotNo: string;
  sheets: number;
  loadUnit: string | null;
  worker: string;
  workDate: string;
  issues: FillIssue[];
  /** 로트 없이 쓰는 소모품 품목 코드 (0129). 그 줄의 부여로트번호는 공란이다 */
  noLotCodes: string[];
  equipment: string | null;
  /** 특이사항에 적을 줄 (시각 · 설비 · 순환자 · 사유 …) */
  notes: string[];
  /** 현장에서 적은 칸 (0132). 칸 자리 → 값 · 적은 사람 · 날짜(YYYY-MM-DD) */
  entries?: Record<string, Entry>;
}

const norm = (s: string | undefined) => (s ?? '').replace(/\s+/g, '');
/* 자재 이름과 세부공정 관리항목을 맞댈 때: 띄어쓰기 · 붙임표 · 괄호 · % · 점을 뺀다
   ("6N-수산화나트륨 수용액" = "6N 수산화나트륨 수용액", "에탄올 99.5%" = "에탄올(99.5%)") */
const key = (s: string | undefined) => (s ?? '').replace(/[\s\-()%.·,]/g, '').toLowerCase();
const sameThing = (a: string | undefined, b: string | undefined) => {
  const A = key(a), B = key(b);
  return A.length >= 2 && B.length >= 2 && (A.includes(B) || B.includes(A));
};

/* 머리 줄의 낱말 → 그 열이 무엇인가 */
const ROLE: Record<string, string> = {
  제품명: 'product', 배치번호: 'batch', 로트번호: 'plot', 모델명: 'model',
  확인자: 'checker', 확인일자: 'checkdate',
  사용설비: 'equip', 기기번호: 'equipno', 검교정일자확인: 'calib',
  사용전기기확인: 'precheck', 확인결과: 'precheck_result',
  투입자재: 'mat', 자재명: 'matname', 자재규격: 'matcode', 부여로트번호: 'matlot',
  '작업(검사)자': 'worker', '작업(검사자)': 'worker', 일자: 'date',
  세부공정: 'step', 관리항목: 'stepitem', 허용범위: 'range', 결과: 'result',
  공정검사: 'inspect', 제조번호: 'cutlot', 수량: 'qty',
};

type Section = 'head' | 'equip' | 'mat' | 'step' | 'cut' | null;

const fmtQty = (q: string) => {
  const n = Number(q);
  return Number.isFinite(n) ? String(n) : q;
};

/** 양식 한 벌을 채운 사본. 원본은 건드리지 않는다 */
export function fillForm(form: BrForm, d: FillData): { pages: FormPage[]; placed: Set<number>; lost: string[] } {
  const placed = new Set<number>();
  const pages: FormPage[] = JSON.parse(JSON.stringify(form.pages));
  let rawName: string | null = null;
  let noteCell: FormCell | null = null;
  /* 투입한 자재가 양식의 어느 자재 줄에 붙었는가 (그 줄의 자재명) */
  const matOf = new Map<number, string>();
  /* 세부공정 줄 - 투입량은 부여로트번호가 아니라 여기 결과 칸에 적는다 */
  const stepRows: { item: string; result: FormCell; sz: number }[] = [];

  /*
   * 열이 무엇인지는 머리 줄의 **가로 자리(pt)**로 기억한다. 다음 쪽의 표가 머리
   * 줄 없이 이어지면(F706-01 의 2쪽처럼) 앞 표의 머리 줄을 그대로 쓴다 - 종이
   * 위에서 같은 세로줄이기 때문이다. 열 번호로 기억하면 이어지는 표의 칸
   * 나눔이 달라질 때 엉뚱한 칸을 짚는다.
   */
  let roles: { x0: number; x1: number; role: string }[] = [];
  let section: Section = null;
  /* 세부공정 칸은 여러 줄에 걸친다 - 그 아래 줄은 위 줄의 세부공정을 이어받는다 */
  let stepGroup = '';
  let equipName = '';
  /* 사람이 적을 수 있는 칸 후보와 서명(작업자 · 일자) 칸. 칸 판정은 시스템 채움이 끝난 뒤에 한다 */
  const cand: { cell: FormCell; id: string; role?: string; section: Section; lb: string; row: string; left?: string }[] = [];
  const signs: { rows: string[]; cell: FormCell; role: 'worker' | 'date'; sz: number }[] = [];
  /* 자재를 채운 줄 (그 줄의 작업자 칸은 투입한 작업자로) */
  const matRow = new Set<string>();

  pages.forEach((page, pi) => {
    page.tables.forEach((tb, ti) => {
      const edge = [tb.x];
      for (const w of tb.cols) edge.push(edge[edge.length - 1] + w);
      const x0Of = (c: FormCell) => edge[c.c];
      const x1Of = (c: FormCell) => edge[Math.min(edge.length - 1, c.c + (c.cs ?? 1))];
      const roleOf = (c: FormCell) =>
        roles.find((r) => x0Of(c) >= r.x0 - 1.5 && x0Of(c) < r.x1 - 1.5)?.role;
      const rowKey = (ri: number) => `${pi}:${ti}:${ri}`;

      tb.rows.forEach((row, ri) => {
        const hits = row.cells.filter((c) => ROLE[norm(c.t)]);
        if (hits.length >= 2) {
          /* 새 머리 줄이 덮는 가로 자리만 바꾼다 (투입자재 줄은 사용설비 줄 아래 같은 표에 온다) */
          const fresh = hits.map((c) => ({ x0: x0Of(c), x1: x1Of(c), role: ROLE[norm(c.t)] }));
          roles = [
            ...roles.filter((r) => !fresh.some((f) => f.x0 < r.x1 - 1.5 && r.x0 < f.x1 - 1.5)),
            ...fresh,
          ];
          const set = new Set(hits.map((c) => ROLE[norm(c.t)]));
          section = set.has('equip') ? 'equip'
            : set.has('matname') ? 'mat'
            : set.has('cutlot') ? 'cut'
            : set.has('step') || set.has('inspect') || set.has('stepitem') ? 'step'
            : set.has('batch') || set.has('plot') || set.has('product') ? 'head'
            : section;
          return;
        }

        /* 특이사항: 그 낱말 칸 다음 칸이 적는 자리다 */
        const first = row.cells[0];
        if (first && norm(first.t) === '특이사항') {
          const next = row.cells[1];
          if (next && !norm(next.t)) {
            next.n = true; noteCell = next;
            Object.assign(next, { id: `p${pi}t${ti}r${ri}c${next.c}`, k: 'text' as const, lb: '특이사항' });
          }
          return;
        }

        const by = (role: string) => row.cells.find((c) => roleOf(c) === role);
        /* 채운 글자는 그 줄 양식 글자와 같은 크기로 - 작게 들어가면 덧붙인 것처럼 보인다 */
        const sz = Math.max(0, ...row.cells.filter((c) => norm(c.t) && !c.f).map((c) => c.s ?? 10)) || 10;

        /* 사람이 적을 칸 후보와 서명 칸 - 모든 구역 */
        if (by('equip')?.t) equipName = by('equip')!.t!;
        if (by('step')?.t) stepGroup = by('step')!.t!;
        /* 공정검사 줄은 첫 칸(이물질 · pH)이 검사 이름이다 */
        if (by('inspect')?.t) stepGroup = `공정검사 · ${by('inspect')!.t!}`;
        const flat = (s?: string) => (s ?? '').replace(/\s*\n\s*/g, ' ').trim();
        const label = section === 'equip'
          ? [equipName, by('precheck')?.t].map(flat).filter(Boolean).join(' · ')
          : [stepGroup || flat(first?.t), by('stepitem')?.t, by('range')?.t].map(flat).filter(Boolean).join(' · ');
        const sorted = [...row.cells].sort((a, b) => a.c - b.c);
        for (const c of row.cells) {
          const role = roleOf(c);
          if (role === 'worker' || role === 'date') {
            if (!norm(c.t)) {
              const span: string[] = [];
              for (let k = ri; k < ri + (c.rs ?? 1); k++) span.push(rowKey(k));
              signs.push({ rows: span, cell: c, role, sz });
            }
            continue;
          }
          const left = sorted[sorted.indexOf(c) - 1]?.t?.trim();
          const CUT_COL: Record<string, string> = { cutlot: '제조번호', model: '모델명', qty: '수량' };
          const lb = role === 'calib' ? [flat(equipName), '검교정일자 확인'].filter(Boolean).join(' · ')
            : section === 'cut' ? `${ri}줄 · ${CUT_COL[role ?? ''] ?? '측정'}`
            : label;
          cand.push({ cell: c, id: `p${pi}t${ti}r${ri}c${c.c}`, role, section, lb, row: rowKey(ri), left });
        }

        if (section === 'head') {
          const batch = by('batch');
          if (batch && (!norm(batch.t) || norm(batch.t) === 'B')) {
            Object.assign(batch, { t: d.batchNo, f: true, a: 'c' as const, b: false, s: sz });
          }
          const plot = by('plot');
          if (plot && !norm(plot.t) && d.productLotNo) Object.assign(plot, { t: d.productLotNo, f: true, a: 'c' as const, s: sz });
          const model = by('model');
          if (model && !norm(model.t) && d.productModel) Object.assign(model, { t: d.productModel, f: true, a: 'c' as const, s: sz });
        }

        if (section === 'equip' && d.equipment) {
          const no = by('equipno');
          if (no?.t && no.t.includes('□') && no.t.includes(d.equipment)) {
            no.t = no.t.replace(`□ ${d.equipment}`, `■ ${d.equipment}`);
            no.tk = [`■ ${d.equipment}`];
          }
        }

        if (section === 'mat') {
          const name = by('matname')?.t ?? '';
          const code = norm(by('matcode')?.t);
          const lotCell = by('matlot');
          if (lotCell && !norm(lotCell.t) && (name || code)) {
            let text: string | null = null;
            if (code === d.rawItemCode) {
              text = d.rawLotNo;
              rawName = name;
            } else if (!(code && d.noLotCodes.includes(code))) {
              const hit = d.issues
                .map((x, k) => ({ x, k }))
                .filter(({ x }) => code
                  ? x.item_code === code
                  : !!norm(name) && (norm(x.item_name).includes(norm(name)) || norm(name).includes(norm(x.item_name))));
              if (hit.length) {
                /* 부여로트번호 칸에는 로트만 (사용자 2026-11-10). 양은 세부공정 결과로 간다 */
                text = [...new Set(hit.map(({ x }) => x.lot_no))].join('\n');
                hit.forEach(({ k }) => { placed.add(k); matOf.set(k, name); });
              }
            }
            if (text) {
              Object.assign(lotCell, { t: text, f: true, a: 'c' as const, b: false, s: sz });
              matRow.add(rowKey(ri));
            }
          }
        }

        if (section === 'step') {
          const item = by('stepitem');
          const result = by('result');
          /*
           * 원재료 투입량: 관리항목이 원재료 이름이거나 (2025.10.16 판), 세부공정이
           * "Porcine dermis 투입량" 이고 관리항목이 "수량" 이다 (2026.02.20 판).
           */
          const rawRow = !!rawName && !!item && (
            norm(item.t) === norm(rawName)
            || (norm(item.t) === '수량' && norm(stepGroup).includes(norm(rawName))));
          if (item && result && rawRow && !norm(result.t)) {
            Object.assign(result, { t: `${d.sheets} ${d.loadUnit ?? '장'}`, f: true, a: 'c' as const, s: sz });
          } else if (item?.t && result) {
            stepRows.push({ item: item.t, result, sz });
          }
        }
      });
    });
  });

  /* -------------------------------------------------------------------------
     투입량 → 세부공정 결과 칸

     같은 자재의 관리항목 줄이 **딱 하나**일 때만 놓는다. 둘 이상이면 어느
     단계에 얼마를 넣었는지 시스템이 모르므로 특이사항에 적는다.
     결과 칸이 비어 있으면 양을 적고, "□ 1 L / □ 2 L" 같은 고르는 칸이면 같은
     양의 □ 를 ■ 로 한다. 같은 양이 없으면 (단위가 다르면) 특이사항으로.
  ------------------------------------------------------------------------- */
  const qtyNotes: string[] = [];
  const byMat = new Map<string, { name: string; qty: number; uom: string; ok: boolean }>();
  for (const [k, name] of matOf) {
    const x = d.issues[k];
    const cur = byMat.get(name) ?? { name, qty: 0, uom: x.usage_uom, ok: true };
    const n = Number(x.qty);
    if (!Number.isFinite(n) || cur.uom !== x.usage_uom) cur.ok = false;
    cur.qty += Number.isFinite(n) ? n : 0;
    byMat.set(name, cur);
  }
  for (const m of byMat.values()) {
    const amount = `${+m.qty.toFixed(6)} ${m.uom}`;
    const rows = stepRows.filter((r) => sameThing(r.item, m.name));
    let done = false;
    if (m.ok && rows.length === 1) {
      const { result, sz } = rows[0];
      if (!norm(result.t)) {
        Object.assign(result, { t: amount, f: true, a: 'c' as const, b: false, s: sz });
        done = true;
      } else if (key(result.t) === key(m.uom)) {
        /* 단위만 인쇄된 칸 ("g") - 그 단위 앞에 양을 적는다 */
        Object.assign(result, { t: amount, f: true, a: 'c' as const, b: false, s: sz });
        done = true;
      } else if (result.t?.includes('□')) {
        const opts = result.t.split('\n');
        const at = opts.findIndex((l) => key(l.replace('□', '')) === key(amount));
        if (at >= 0) {
          opts[at] = opts[at].replace('□', '■');
          Object.assign(result, { t: opts.join('\n'), tk: [opts[at].trim()] });
          done = true;
        }
      }
    }
    if (!done) qtyNotes.push(`투입량 ${m.name.replace(/\s*\n\s*/g, '')} ${amount}`);
  }

  /* -------------------------------------------------------------------------
     사람이 적는 칸 (0132 · 사용자 2026-11-10 «체크와 적어야 하는 부분들은 모두
     생산자가 체크 하거나 기록 할수 있도록»)

     시스템이 채운 칸은 빼고, 양식 글로 무엇을 적는 칸인지 가른다.
       □ 가 있다              고르기 (보기 = □ 다음 글)
       "시작 … 종료" 가 있다    시각 (날짜 칸 "/" 가 있으면 날짜도)
       제조번호 · 모델명 열     글 (GM · PD 처럼 앞머리가 인쇄됨)
       비었거나 단위만 있다     수치 (단위는 양식 그대로)
     이름표 · 허용범위 · 자재명 · 기기번호 같은 인쇄 글은 칸이 아니다.
     작업(검사)자 · 일자는 적는 칸이 아니라 적은 사람이 들어가는 자리다.
  ------------------------------------------------------------------------- */
  const LABEL_ROLES = new Set(['product', 'batch', 'plot', 'model_head', 'checker', 'checkdate', 'equip',
    'equipno', 'precheck', 'mat', 'matname', 'matcode', 'matlot', 'step', 'stepitem', 'range', 'inspect']);
  const UNIT = /^[A-Za-z℃°%µ²₂/.\s]{1,8}$/;
  const entries = d.entries ?? {};
  const enteredRow = new Map<string, Entry>();
  for (const x of cand) {
    const c = x.cell;
    if (c.f || c.tk?.length || c.id) continue;
    const t = (c.t ?? '').trim();
    const cutText = x.section === 'cut' && (x.role === 'cutlot' || x.role === 'model');
    if (!cutText && x.role && LABEL_ROLES.has(x.role)) continue;
    if (x.section === 'head') continue;
    let k: FieldKind | null = null;
    /* "합격 [ ] 불합격 [ ]" 처럼 이름 칸 옆의 빈칸은 표시(✓) 하나를 고르는 칸이다 */
    const MARK = /^(합격|불합격|적합|부적합|재포장)$/;
    if (!t && x.left && MARK.test(x.left)) {
      Object.assign(c, { id: x.id, k: 'choice' as const, o: ['✓'], lb: `${x.lb || '칸'} · ${x.left}` });
      const e = entries[x.id];
      if (e && e.value !== '') { c.v = e.value; Object.assign(c, { t: '✓', f: true, a: 'c' as const }); enteredRow.set(x.row, e); }
      continue;
    }
    if (t.includes('□')) k = 'choice';
    else if (/시작/.test(t) && /종료/.test(t)) k = 'time';
    else if (cutText) k = 'text';
    else if (!t || UNIT.test(t)) k = 'number';
    if (!k) continue;
    Object.assign(c, { id: x.id, k, lb: x.lb || '칸' });
    if (k === 'choice') {
      c.o = t.split('□').slice(1).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    }
    if (k === 'number' && t) c.u = t;
    if (k === 'time' && t.includes('/')) c.dt = true;
    if (k === 'text' && t) c.u = t;      // 앞머리 (GM · PD)
    const e = entries[x.id];
    if (e && e.value !== '') {
      c.v = e.value;
      applyEntry(c, e.value);
      enteredRow.set(x.row, e);
    }
  }

  /* 서명 칸: 자재를 채운 줄은 투입한 작업자, 사람이 적은 줄은 적은 사람 (모두 파랗다) */
  for (const s of signs) {
    const e = s.rows.map((r) => enteredRow.get(r)).filter(Boolean)
      .sort((a, b) => (a!.at < b!.at ? 1 : -1))[0];
    const sys = s.rows.some((r) => matRow.has(r));
    if (!e && !sys) continue;
    const text = s.role === 'worker' ? (e?.by ?? d.worker) : (e?.at ?? d.workDate);
    Object.assign(s.cell, { t: text, f: true, a: 'c' as const, b: false, s: s.sz });
  }

  /* 특이사항: 시스템 기록과 양식에 자리가 없던 투입 */
  const extra = d.issues
    .map((x, k) => ({ x, k }))
    .filter(({ k }) => !placed.has(k))
    .map(({ x }) => `투입 ${x.item_name}(${x.item_code}) · ${x.lot_no} · ${fmtQty(x.qty)} ${x.usage_uom}`);
  const amend = d.issues
    .filter((x) => x.amend_reason)
    .map((x) => `정정 ${x.item_name} ${x.lot_no} · ${x.amend_reason}`);
  const lines = [...d.notes, ...qtyNotes, ...extra, ...amend];
  if (noteCell) {
    const nc = noteCell as FormCell;
    /* 현장에서 적은 특이사항이 먼저, 시스템 기록이 뒤에 */
    const mine = nc.id ? entries[nc.id]?.value ?? '' : '';
    if (mine) nc.v = mine;
    const all = [mine, ...lines].filter(Boolean);
    if (all.length) Object.assign(nc, { t: all.join('\n'), f: true, a: 'l' as const, b: false, s: 9 });
  }

  /* 특이사항 칸이 없는 양식이면 부르는 쪽이 장 아래에 적는다 */
  return { pages, placed, lost: noteCell ? [] : lines };
}

/* ---------------------------------------------------------------------------
   적은 값을 칸에 놓는다

   값의 모양
     고르기   "보기"  또는 "보기|덧붙임" (충진시간처럼 보기 안에 빈자리가 있을 때)
     시각     "09:20~09:40"  또는 날짜까지 "11/05 15:19~11/06 10:19"
     수치     "45.6"  (단위는 양식의 것)
     글       그대로
--------------------------------------------------------------------------- */
export function applyEntry(c: FormCell, value: string) {
  if (c.k === 'choice') {
    const [pick, extra] = value.split('|');
    const opts = c.o ?? [];
    const sep = (c.t ?? '').includes('\n') ? '\n' : '  ';
    let hit = '';
    const shown = opts.map((o) => {
      if (o !== pick) return `□ ${o}`;
      let s = `■ ${o}`;
      if (extra) {
        s = /:\s*~\s*:/.test(s) ? s.replace(/:\s*~\s*:/, extra.replace('~', ' ~ '))
          : /_{2,}/.test(s) ? s.replace(/_{2,}/, extra)
          : `${s} ${extra}`;
      }
      hit = s;
      return s;
    });
    c.t = shown.join(sep);
    if (hit) c.tk = [hit];
    return;
  }
  if (c.k === 'time') {
    const [s, e] = value.split('~').map((x) => x.trim());
    Object.assign(c, { t: `시작 ${s || '  :  '} ~ 종료 ${e || '  :  '}`, f: true, a: 'c' as const, b: false });
    return;
  }
  if (c.k === 'number') {
    Object.assign(c, { t: c.u ? `${value} ${c.u}` : value, f: true, a: 'c' as const, b: false });
    return;
  }
  Object.assign(c, { t: value, f: true, b: false });
}

/** 보기 안에 덧붙여 적을 빈자리가 있는가 (충진시간 : ~ : · ____ 분) */
export const optionBlank = (o: string): 'time' | 'number' | null =>
  /:\s*~\s*:/.test(o) ? 'time' : /_{2,}/.test(o) ? 'number' : null;

/** 사람이 적을 칸 목록 (화면이 몇 칸 적었는지 센다) */
export function fieldsOf(pages: FormPage[]) {
  return pages.flatMap((p) => p.tables.flatMap((t) => t.rows.flatMap((r) => r.cells.filter((c) => c.id))));
}

/** 머리 · 꼬리 글 가운데 쪽 번호 ("1 / 2", "1 / __") */
export const isPageLabel = (t: string) => /^\d+\s*\/\s*(\d+|_+)$/.test(t.trim());

/**
 * 서명란이 마지막 표 아래에 들어갈 자리가 있는가 (양식 꼬리글 위까지).
 * 서버(인쇄 화면)가 부르므로 클라이언트 부품 파일에 두지 않는다 - 'use client'
 * 파일의 함수는 서버에서 부를 수 없다 (운영에서 화면이 죽었다, 2026-11-10).
 */
export function formHasSignRoom(page: FormPage) {
  const bottom = Math.max(0, ...page.tables.map((t) => t.y + t.rows.reduce((a, r) => a + r.h, 0)));
  return bottom + 8 + 41 <= 550;
}
