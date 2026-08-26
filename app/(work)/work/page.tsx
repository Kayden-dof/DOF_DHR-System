import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { WO_STATUS_LABEL } from '@/lib/forms';
import { Tag } from '@/components/ui';

export const dynamic = 'force-dynamic';

interface BatchTile {
  id: string; batch_no: string; wo_no: string; status: string; sheet_count: number;
  item_name: string; item_code: string;
  raw_lot_no: string; thickness_band: string | null;
  issued_at: Date;
  my_records: number; my_open: number; my_locked_days: number;
  total_records: number; lot_count: number; last_day: number | null;
}

/* ---------------------------------------------------------------------------
   현장 첫 화면

   지금 손댈 수 있는 배치만 큰 타일로 보여 준다. 목록을 뒤지게 하지 않는다.
   진행 중인 것이 위로 온다.
--------------------------------------------------------------------------- */
export default async function WorkHome() {
  const user = await requireUser();

  const batches = await withActor(user.id, (db) =>
    db.rows<BatchTile>(
      `select wo.id, wo.batch_no, wo.wo_no, wo.status::text as status, wo.sheet_count,
              i.name as item_name, i.code as item_code,
              ml.lot_no as raw_lot_no, ml.thickness_band, wo.issued_at,
              (select count(*)::int from process_record pr
                where pr.work_order_id = wo.id and pr.worker_id = $1) as my_records,
              (select count(*)::int from process_record pr
                where pr.work_order_id = wo.id and pr.worker_id = $1
                  and pr.ended_at is null) as my_open,
              (select count(*)::int from day_lock dl
                where dl.work_order_id = wo.id and dl.worker_id = $1) as my_locked_days,
              (select count(*)::int from process_record pr
                where pr.work_order_id = wo.id) as total_records,
              (select count(*)::int from product_lot pl
                where pl.work_order_id = wo.id) as lot_count,
              (select max(pr.day_no) from process_record pr
                where pr.work_order_id = wo.id) as last_day
         from work_order wo
         join device_master dm on dm.id = wo.device_master_id
         join item i on i.id = dm.item_id
         join material_lot ml on ml.id = wo.material_lot_id
        where wo.status in ('ISSUED','IN_PROCESS','CUT')
        order by (wo.status = 'IN_PROCESS') desc, wo.issued_at desc`,
      [user.id]),
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">작업할 배치</h1>
        <p className="mt-1.5 text-sm text-muted">
          {user.full_name} 님. 배치를 눌러 공정 기록을 작성하십시오.
        </p>
      </div>

      {batches.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-lg font-semibold text-ink">진행 중인 배치가 없습니다.</p>
          <p className="mt-2 text-sm text-muted">
            작업지시가 발행되면 여기에 나타납니다.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {batches.map((b) => (
            <Link key={b.id} href={`/work/${b.id}`}
                  className="tile no-select relative gap-0 overflow-hidden p-0">
              {/* 진행 중인 배치는 왼쪽 띠로 먼저 눈에 들어오게 한다 */}
              <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${
                b.my_open > 0 ? 'bg-warn' : b.status === 'IN_PROCESS' ? 'bg-brand' : 'bg-line-strong'
              }`} />

              <div className="flex items-start gap-3 px-5 pb-3 pt-4">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xl font-bold tracking-tight text-ink">
                    {b.batch_no}
                  </div>
                  <div className="mt-0.5 text-base text-body">{b.item_name}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Tag tone={b.status === 'IN_PROCESS' ? 'brand' : 'info'}>
                    {WO_STATUS_LABEL[b.status] ?? b.status}
                  </Tag>
                  {b.my_open > 0 && <Tag tone="warn">마감 전 {b.my_open}</Tag>}
                </div>
              </div>

              <dl className="grid grid-cols-3 gap-px border-t border-line-soft bg-line-soft">
                {[
                  ['장입', `${b.sheet_count}장`],
                  ['내 기록', `${b.my_records}건`],
                  b.lot_count > 0
                    ? ['제품 로트', `${b.lot_count}건`]
                    : ['마감 일차', `${b.my_locked_days}일`],
                ].map(([k, v]) => (
                  <div key={k} className="bg-surface px-5 py-2.5">
                    <dt className="text-xs text-muted">{k}</dt>
                    <dd className="mt-0.5 text-base font-bold tnum text-ink">{v}</dd>
                  </div>
                ))}
              </dl>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-soft px-5 py-2.5 text-sm text-muted">
                <span>원재료 <span className="font-mono text-body">{b.raw_lot_no}</span></span>
                {b.thickness_band && <span>두께 {b.thickness_band}</span>}
                {b.last_day && <span className="tnum">{b.last_day}일차까지 기록</span>}
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="card bg-surface-sub p-5">
        <h2 className="text-sm font-bold text-ink">기억할 것</h2>
        <ul className="mt-2.5 space-y-2 text-sm leading-relaxed text-muted">
          <li>· 공정을 시작하면 시작 시각이 찍히고, 마감하면 종료 시각이 찍힙니다.</li>
          <li>· 자재를 넣지 않고 마감하려면 <b className="text-ink">해당 없음 사유</b>를 골라야 합니다.</li>
          <li>· 일차를 마감하고 기록서를 인쇄하면 <b className="text-ink">그 묶음은 고칠 수 없습니다.</b></li>
          <li>· 빠뜨린 것은 다음 일차에 정정 기록으로 남기십시오. 지우거나 되돌리는 방법은 없습니다.</li>
        </ul>
      </div>
    </div>
  );
}
