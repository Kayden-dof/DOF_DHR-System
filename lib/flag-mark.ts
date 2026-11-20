import type { FormCell, FormPage } from '@/lib/br-form';

/** 확인해 볼 항목 한 줄 (review_flags) */
export interface FlagRow { kind: string; detail: string; day_no: number | null; ref: string }

/*
 * 확인해 볼 항목이 가리키는 양식 칸에 표시를 단다 (사용자 2026-11-20 «여기서 들어가는거인 만큼 잘못된
 * 부분이 표기된 읽기 열람이 가능해야»). 배치 화면에서 그 항목을 눌러 연 열람에서만 쓴다.
 *
 * 항목 글(detail)과 ref 에서 공정 코드 · 자재 이름 · 로트 · 설비를 읽어 칸을 고른다. 판정은
 * review_flags 가 이미 했다 - 여기서는 자리만 찾는다. 찾지 못하면 표시하지 않는다(지어내지 않는다).
 *
 *   구간 이탈     그 자재의 칸 (결과 · 투입 로트)
 *   시각 모순     그 공정들의 시스템 시작 · 종료 (특이사항 칸의 «시스템 기록 · 시작 … · 종료 …» 줄).
 *                 양식의 세척 시간 같은 칸은 다른 시각이라 짚지 않는다
 *   기입 누락     자재 미기록이면 비었거나 «-» 인 자재 칸, 종료 미기입이면 시스템 기록 줄
 *   참조 불일치   그 로트가 적힌 칸
 *   기한 경과     그 설비가 적힌 칸
 */
const OP = /[A-Z]{2,}-[A-Z0-9]+-\d+/g;
const squash = (s?: string) => (s ?? '').replace(/[\s()·]/g, '').toLowerCase();

/** 그 항목이 이 공정을 가리키는가 */
export function flagOps(f: FlagRow): Set<string> {
  const ops = new Set(f.detail.match(OP) ?? []);
  if (/^[A-Z]{2,}-[A-Z0-9]+-\d+$/.test(f.ref)) ops.add(f.ref);
  return ops;
}

/** 표시한 칸 수 */
export function markFlags(pages: FormPage[], opCode: string, flags: FlagRow[]): number {
  let n = 0;
  const cells: FormCell[] = pages.flatMap((p) => p.tables.flatMap((t) => t.rows.flatMap((r) => r.cells)));
  for (const f of flags) {
    if (!flagOps(f).has(opCode)) continue;
    let pick: ((c: FormCell) => boolean) | null = null;
    if (f.kind === '구간 이탈') {
      const name = squash(f.detail.match(/\)\s*([^:]+):/)?.[1]);
      pick = (c) => !!name && !!c.lb && (c.k === 'number' || c.k === 'lot' || c.k === 'choice')
        && (squash(c.lb).includes(name) || name.includes(squash(c.lb).split('결과')[0] || '\u0000'));
    } else if (f.kind === '시각 모순' || (f.kind === '기입 누락' && f.detail.includes('종료 시각'))) {
      pick = (c) => !!c.n && (c.t ?? '').includes('시스템 기록');
    } else if (f.kind === '기입 누락') {
      pick = (c) => c.k === 'lot' && (!c.v || c.v === '-');
    } else if (f.kind === '참조 불일치' || f.kind === '기한 경과') {
      pick = (c) => !!f.ref && (c.t ?? '').includes(f.ref);
    }
    if (!pick) continue;
    for (const c of cells) if (pick(c) && !c.hl) { c.hl = true; n += 1; }
  }
  return n;
}
