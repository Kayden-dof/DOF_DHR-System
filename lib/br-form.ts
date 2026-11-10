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
  /** 시스템이 채운 칸 */
  f?: boolean;
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

  for (const page of pages) {
    for (const tb of page.tables) {
      let roles: string[] = [];
      let section: Section = null;
      /* 자재 줄을 채웠는가 - 작업자 · 일자 칸은 그 칸이 걸친 줄 가운데 하나라도 채웠을 때 */
      const filledRow = new Set<number>();
      const workerCells: { ri: number; rs: number; cell: FormCell; role: 'worker' | 'date' }[] = [];

      tb.rows.forEach((row, ri) => {
        const hits = row.cells.filter((c) => ROLE[norm(c.t)]);
        if (hits.length >= 2) {
          roles = [...roles];
          for (const c of hits) {
            for (let j = 0; j < (c.cs ?? 1); j++) roles[c.c + j] = ROLE[norm(c.t)];
          }
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

        const by = (role: string) => row.cells.find((c) => roles[c.c] === role);

        if (section === 'head') {
          const batch = by('batch');
          if (batch && (!norm(batch.t) || norm(batch.t) === 'B')) {
            Object.assign(batch, { t: d.batchNo, f: true, a: 'c' as const, b: false });
          }
          const plot = by('plot');
          if (plot && !norm(plot.t) && d.productLotNo) Object.assign(plot, { t: d.productLotNo, f: true, a: 'c' as const });
          const model = by('model');
          if (model && !norm(model.t) && d.productModel) Object.assign(model, { t: d.productModel, f: true, a: 'c' as const });
        }

        if (section === 'equip' && d.equipment) {
          const no = by('equipno');
          if (no?.t && no.t.includes('□') && no.t.includes(d.equipment)) {
            no.t = no.t.replace(`□ ${d.equipment}`, `■ ${d.equipment}`);
            no.f = true;
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
                text = hit.map(({ x }) => `${x.lot_no} · ${fmtQty(x.qty)} ${x.usage_uom}`).join('\n');
                hit.forEach(({ k }) => placed.add(k));
              }
            }
            if (text) {
              Object.assign(lotCell, { t: text, f: true, a: 'c' as const, b: false });
              filledRow.add(ri);
            }
          }
          for (const c of row.cells) {
            const role = roles[c.c];
            if ((role === 'worker' || role === 'date') && !norm(c.t)) {
              workerCells.push({ ri, rs: c.rs ?? 1, cell: c, role });
            }
          }
        }

        if (section === 'step' && rawName) {
          const item = by('stepitem');
          const result = by('result');
          if (item && result && norm(item.t) === norm(rawName) && !norm(result.t)) {
            Object.assign(result, { t: `${d.sheets} ${d.loadUnit ?? '장'}`, f: true, a: 'c' as const });
          }
        }
      });

      for (const w of workerCells) {
        let hit = false;
        for (let k = w.ri; k < w.ri + w.rs; k++) if (filledRow.has(k)) hit = true;
        if (hit) Object.assign(w.cell, { t: w.role === 'worker' ? d.worker : d.workDate, f: true, a: 'c' as const, b: false });
      }
    }
  }

  /* 특이사항: 시스템 기록과 양식에 자리가 없던 투입 */
  const extra = d.issues
    .map((x, k) => ({ x, k }))
    .filter(({ k }) => !placed.has(k))
    .map(({ x }) => `투입 ${x.item_name}(${x.item_code}) · ${x.lot_no} · ${fmtQty(x.qty)} ${x.usage_uom}`);
  const amend = d.issues
    .filter((x) => x.amend_reason)
    .map((x) => `정정 ${x.item_name} ${x.lot_no} · ${x.amend_reason}`);
  const lines = [...d.notes, ...extra, ...amend];
  if (noteCell && lines.length) {
    Object.assign(noteCell as FormCell, { t: lines.join('\n'), f: true, a: 'l' as const, b: false, s: 8 });
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
