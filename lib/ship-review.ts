/* ---------------------------------------------------------------------------
   출고 전 형명 일괄 검토 (0159 · 사용자 2026-11-25)

   «발주 형명이 맞는지 작업지시서 및 제조기록서 일괄 검토해서 출고시 오규격이 나가지 않도록»

     LOT · DMR · BAND   DB 의 ship_spec_check (제품 로트 형명 · 작업지시서 제품 · 원료 두께)
     BR                 그 배치 재단 기록서의 이 로트 줄 모델명 (lib/ship-check.ts cutRowCheck)
     STERIL             멸균 보고서 (0160 lot_steril_report)

   출고 화면의 검토 표와 처리 함수(ship · relinkShipment)가 이 하나를 쓴다. 서버에서만 부른다.
--------------------------------------------------------------------------- */

import type { Db } from './db';
import { brSheet } from './br-sheet';
import { cutRowCheck, type CutRowCell, type SpecRow } from './ship-check';

/** 그 배치 재단 공정 기록마다의 재단 칸. 재단 기록이 없거나 양식에 재단 표가 없으면 빈 배열 */
export async function cutCellsOf(db: Db, woId: string): Promise<CutRowCell[][]> {
  const recs = await db.rows<{ id: string }>(
    `select pr.id from process_record pr join work_order wo on wo.id = pr.work_order_id
      where pr.work_order_id = $1 and pr.product_lot_id is null
        and pr.operation_id = cut_operation_id(wo.device_master_id)
      order by pr.day_no, pr.id`, [woId]);
  const out: CutRowCell[][] = [];
  for (const r of recs) {
    const s = await brSheet(db, r.id);
    if (s?.cut?.length) out.push(s.cut);
  }
  return out;
}

/**
 * 그 로트를 그 주문 줄로 내보내도 되는가. 한 줄이라도 ok === false 면 출고하지 않는다.
 * cache 는 같은 배치를 여러 번 볼 때 재단 칸을 한 번만 읽게 한다 (배치 id → 칸).
 */
export async function shipReview(
  db: Db, lotId: string, lineId: string, cache?: Map<string, CutRowCell[][]>,
): Promise<SpecRow[]> {
  const spec = await db.rows<SpecRow>(
    `select kind, label, expected, actual, ok from ship_spec_check($1, $2)`, [lotId, lineId]);
  const lot = await db.one<{ lot_no: string; wo: string; idx: number; code: string; report: string | null }>(
    `select pl.lot_no, pl.work_order_id as wo,
            (select count(*)::int from product_lot x
              where x.work_order_id = pl.work_order_id and x.lot_no < pl.lot_no) as idx,
            (select i.code from sales_order_line l join item i on i.id = l.item_id where l.id = $2) as code,
            lot_steril_report(pl.id) as report
       from product_lot pl where pl.id = $1`, [lotId, lineId]);
  if (!lot) throw new Error('제품 로트를 찾을 수 없습니다');

  let sets = cache?.get(lot.wo);
  if (!sets) {
    sets = await cutCellsOf(db, lot.wo);
    cache?.set(lot.wo, sets);
  }
  const results = sets.map((cells) => cutRowCheck(cells, lot.lot_no, lot.idx, lot.code));
  const bad = results.find((r) => r.ok === false);
  const br: SpecRow = {
    kind: 'BR', label: '제조기록서 재단 줄 모델명', expected: lot.code,
    actual: bad ? bad.actual : (results.find((r) => r.ok)?.actual ?? null),
    ok: bad ? false : results.some((r) => r.ok) ? true : null,
  };
  return [
    ...spec, br,
    { kind: 'STERIL', label: '멸균 보고서', expected: null, actual: lot.report, ok: !!lot.report },
  ];
}
