import type { Db } from '@/lib/db';

/**
 * 배치에 아직 남은 공정 (사용자 2026-11-20 «모든 공정이 마감되면 해당 배치는 생산 종결 처리를
 * 해야 하는데» → 배치 종료의 «아직 남은 것» 에 마감 안 된 공정 · 남은 로트도 넣는다).
 *
 * 사실만 센다. 막지 않는다 (§2 차단은 다섯 개뿐). 배치 화면의 «배치 종료» 확인과 편철 표지가
 * 같은 목록을 쓴다 - 두 곳이 따로 세면 언젠가 갈라진다 (§10).
 *
 *   진행 중 {공정}          시작하고 마감하지 않은 기록이 있다
 *   {공정} 기록 없음        재단 이전 공정인데 마감한 기록이 없다
 *   {공정} 남은 로트 …      재단 이후 공정에서 마감도 건너뛰기(0149)도 하지 않은 제품 로트
 *                          (제품 로트가 아직 없으면 세지 않는다 - 그때는 «제조번호 전» 이 말한다)
 */
export async function openSteps(db: Db, woId: string): Promise<string[]> {
  const rows = await db.rows<{
    name: string; after_cutting: boolean; running: number; ended: number; lots: number; lots_left: string[] | null;
  }>(
    `select o.name, o.after_cutting,
            (select count(*) from process_record r
              where r.work_order_id = w.id and r.operation_id = o.id and r.ended_at is null)::int as running,
            (select count(*) from process_record r
              where r.work_order_id = w.id and r.operation_id = o.id and r.ended_at is not null)::int as ended,
            (select count(*) from product_lot l where l.work_order_id = w.id)::int as lots,
            (select array_agg(l.lot_no order by l.lot_no) from product_lot l
              where l.work_order_id = w.id
                and not exists (select 1 from process_record r
                                 where r.work_order_id = w.id and r.operation_id = o.id
                                   and r.product_lot_id = l.id and r.ended_at is not null)
                and not exists (select 1 from process_skip s
                                 where s.operation_id = o.id and s.product_lot_id = l.id
                                   and s.cancelled_at is null)) as lots_left
       from work_order w
       join dmr_operation o on o.device_master_id = w.device_master_id
      where w.id = $1
      order by o.seq`, [woId]);

  const out: string[] = [];
  for (const r of rows) {
    if (r.running > 0) out.push(`진행 중 ${r.name}`);
    else if (!r.after_cutting && r.ended === 0) out.push(`${r.name} 기록 없음`);
    else if (r.after_cutting && r.lots > 0 && r.lots_left?.length) {
      /* 셋까지는 로트 번호를, 그보다 많으면 건수를 */
      const left = r.lots_left;
      out.push(`${r.name} 남은 로트 ${left.length <= 3 ? left.join(', ') : `${left.length}건`}`);
    }
  }
  return out;
}
