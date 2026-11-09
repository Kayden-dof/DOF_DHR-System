/* ---------------------------------------------------------------------------
   작업표준서 · 제조기록서 대조 (0123)

   화면과 인쇄물이 같은 이름과 같은 판정을 쓰도록 여기 한 곳에 둔다.
--------------------------------------------------------------------------- */

export type Verdict = 'MATCH' | 'MISMATCH' | 'MISSING' | 'UNDEFINED' | 'BR_ONLY' | 'FLOW';

export const VERDICT_LABEL: Record<Verdict, string> = {
  MATCH: '일치',
  MISMATCH: '불일치',
  MISSING: '기재 누락',
  UNDEFINED: '기준 미정',
  BR_ONLY: '기록서에만',
  FLOW: '흐름 어긋남',
};

/** 어긋난 것. 빨간색으로 찍는다 */
export const isOff = (v: Verdict) => v !== 'MATCH';

export const VERDICT_ORDER: Verdict[] = ['MISMATCH', 'MISSING', 'UNDEFINED', 'BR_ONLY', 'FLOW', 'MATCH'];

export const DOC_KIND_LABEL = { WS: '작업표준서', BR: '제조기록서' } as const;

export type ReqKind = 'VALUE' | 'FIELD' | 'FLOW' | 'CRITERIA' | 'DOC' | 'OTHER';
export const REQ_KIND_LABEL: Record<ReqKind, string> = {
  VALUE: '값 정정',
  FIELD: '기록 칸 추가',
  FLOW: '순서 · 흐름',
  CRITERIA: '기준 명시',
  DOC: '문서 오류',
  OTHER: '기타',
};

export type ReqStatus = 'OPEN' | 'SENT' | 'DONE' | 'DROPPED';
export const REQ_STATUS_LABEL: Record<ReqStatus, string> = {
  OPEN: '작성',
  SENT: '품질에 넘김',
  DONE: '반영됨',
  DROPPED: '반영 안 함',
};

export const REQ_TARGET_LABEL = { WS: '작업표준서', BR: '제조기록서', BOTH: '두 문서' } as const;

/** 판정에서 개정 제안의 종류를 미리 고른다. 사람이 바꿀 수 있다 */
export function kindFor(v: Verdict): ReqKind {
  switch (v) {
    case 'MISMATCH': return 'VALUE';
    case 'MISSING': return 'FIELD';
    case 'UNDEFINED': return 'CRITERIA';
    case 'FLOW': return 'FLOW';
    default: return 'OTHER';
  }
}

export interface CheckRow {
  id: string;
  op_code: string; op_name: string; seq: number; grp: string; item: string;
  ws_text: string; ws_at: string; br_text: string; br_at: string;
  verdict: Verdict; why: string; basis: string;
  ws_order: number | null; br_order: number | null;
}

/* ---------------------------------------------------------------------------
   수치가 다른 줄 (사용자 2026-11-10 «작업 표준서의 수치랑 제조기록서의 수치가
   다른 경우 · 정리해서 보여줄 수 있도록»)

   판정이 불일치이고 두 문서 모두 숫자를 적은 줄이다. 문서 머리 · 꼬리(서식번호 ·
   발행일)와 흐름 메모는 공정 값이 아니므로 뺀다. 판정을 새로 하지 않는다 -
   사람이 맞대어 본 불일치 가운데 숫자끼리 어긋난 것만 추린다.
--------------------------------------------------------------------------- */
export const isNumberDiff = (r: Pick<CheckRow, 'verdict' | 'grp' | 'ws_text' | 'br_text'>) =>
  r.verdict === 'MISMATCH' && r.grp !== '문서' && r.grp !== '흐름'
  && /\d/.test(r.ws_text) && /\d/.test(r.br_text);

/* ---------------------------------------------------------------------------
   흐름 - 제조기록서가 작업 순서를 따라 적히는가

   작업표준서 차례(ws_order)대로 줄을 늘어놓고 제조기록서 차례(br_order)를
   읽는다. 순서를 따르는 기록서라면 그 수가 계속 커진다.

   가장 길게 커지는 줄기(최장 증가 부분열)를 찾고, 거기서 빠지는 줄을 "앞뒤가
   바뀐 자리" 로 본다. 한 줄이 엉뚱한 곳에 있을 때 그 뒤 줄 전부를 어긋났다고
   하지 않고 그 한 줄만 짚는다.

   두 차례가 다 있는 줄만 견준다. 한쪽에만 있는 줄은 흐름을 말할 수 없다.
--------------------------------------------------------------------------- */
export function flowBreaks(rows: Pick<CheckRow, 'id' | 'ws_order' | 'br_order'>[]): Set<string> {
  const both = rows
    .filter((r) => r.ws_order != null && r.br_order != null)
    .sort((a, b) => (a.ws_order! - b.ws_order!) || (a.br_order! - b.br_order!));
  const n = both.length;
  if (n < 2) return new Set();
  const len = new Array<number>(n).fill(1);
  const prev = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (both[j].br_order! <= both[i].br_order! && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1; prev[i] = j;
      }
    }
  }
  let end = 0;
  for (let i = 1; i < n; i++) if (len[i] > len[end]) end = i;
  const keep = new Set<number>();
  for (let k = end; k >= 0; k = prev[k]) keep.add(k);
  const out = new Set<string>();
  both.forEach((r, i) => { if (!keep.has(i)) out.add(r.id); });
  return out;
}
