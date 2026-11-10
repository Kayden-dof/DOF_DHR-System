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
}
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

  for (const page of pages) {
    for (const tb of page.tables) {
      const edge = [tb.x];
      for (const w of tb.cols) edge.push(edge[edge.length - 1] + w);
      const x0Of = (c: FormCell) => edge[c.c];
      const x1Of = (c: FormCell) => edge[Math.min(edge.length - 1, c.c + (c.cs ?? 1))];
      const roleOf = (c: FormCell) =>
        roles.find((r) => x0Of(c) >= r.x0 - 1.5 && x0Of(c) < r.x1 - 1.5)?.role;
      /* 자재 줄을 채웠는가 - 작업자 · 일자 칸은 그 칸이 걸친 줄 가운데 하나라도 채웠을 때 */
      const filledRow = new Set<number>();
      const workerCells: { ri: number; rs: number; cell: FormCell; role: 'worker' | 'date'; sz: number }[] = [];

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
          if (next && !norm(next.t)) { next.n = true; noteCell = next; }
          return;
        }

        const by = (role: string) => row.cells.find((c) => roleOf(c) === role);
        /* 채운 글자는 그 줄 양식 글자와 같은 크기로 - 작게 들어가면 덧붙인 것처럼 보인다 */
        const sz = Math.max(0, ...row.cells.filter((c) => norm(c.t) && !c.f).map((c) => c.s ?? 10)) || 10;

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
              filledRow.add(ri);
            }
          }
          for (const c of row.cells) {
            const role = roleOf(c);
            if ((role === 'worker' || role === 'date') && !norm(c.t)) {
              workerCells.push({ ri, rs: c.rs ?? 1, cell: c, role, sz });
            }
          }
        }

        if (section === 'step') {
          const item = by('stepitem');
          const result = by('result');
          const group = by('step');
          if (group?.t) stepGroup = group.t;
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

      for (const w of workerCells) {
        let hit = false;
        for (let k = w.ri; k < w.ri + w.rs; k++) if (filledRow.has(k)) hit = true;
        if (hit) Object.assign(w.cell, { t: w.role === 'worker' ? d.worker : d.workDate, f: true, a: 'c' as const, b: false, s: w.sz });
      }
    }
  }

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

  /* 특이사항: 시스템 기록과 양식에 자리가 없던 투입 */
  const extra = d.issues
    .map((x, k) => ({ x, k }))
    .filter(({ k }) => !placed.has(k))
    .map(({ x }) => `투입 ${x.item_name}(${x.item_code}) · ${x.lot_no} · ${fmtQty(x.qty)} ${x.usage_uom}`);
  const amend = d.issues
    .filter((x) => x.amend_reason)
    .map((x) => `정정 ${x.item_name} ${x.lot_no} · ${x.amend_reason}`);
  const lines = [...d.notes, ...qtyNotes, ...extra, ...amend];
  if (noteCell && lines.length) {
    Object.assign(noteCell as FormCell, { t: lines.join('\n'), f: true, a: 'l' as const, b: false, s: 9 });
  }

  /* 특이사항 칸이 없는 양식이면 부르는 쪽이 장 아래에 적는다 */
  return { pages, placed, lost: noteCell ? [] : lines };
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
