import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { WO_STATUS_LABEL } from '@/lib/forms';
import { Tag } from '@/components/ui';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '현장' };

interface BatchTile {
  id: string; batch_no: string; wo_no: string; status: string; sheet_count: number;
  item_name: string; item_code: string;
  raw_lot_no: string; thickness_band: string | null;
  issued_at: Date;
  my_records: number; my_open: number; my_locked_days: number;
  total_records: number; lot_count: number; last_day: number | null;
  last_day_open: boolean;
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
                where pr.work_order_id = wo.id) as last_day,
              /*
               * 마지막 일차가 아직 열려 있는가. 누군가의 그 날 묶음이 잠기지
               * 않았으면 이어서 기록하는 날이고, 전부 잠겼으면 다음 날이 새로
               * 시작된다. 타일이 "몇 일차를 할 차례인지"를 이걸로 말한다.
               */
              exists (select 1 from process_record pr
                where pr.work_order_id = wo.id
                  and pr.day_no = (select max(day_no) from process_record
                                    where work_order_id = wo.id)
                  and not is_locked(wo.id, pr.day_no, pr.worker_id)) as last_day_open
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
        <h1 className="text-2xl font-bold text-white">작업할 배치</h1>
        <p className="mt-1.5 text-sm text-on-dark-mute">
          {user.full_name} 님. 배치를 선택하여 공정 기록을 작성하십시오.
        </p>
      </div>

      {batches.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-lg font-semibold text-ink">진행 중인 배치가 없습니다.</p>
          <p className="mt-2 text-sm text-muted">
            작업 지시가 발행되면 여기에 나타납니다.
          </p>
        </div>
      ) : (
        <div
          // auto-fit 이라 배치가 하나뿐이면 그 하나가 화면을 다 쓴다.
          // auto-fill 이면 빈 칸을 남겨 두어 타일이 한쪽에 몰린다.
          className="grid gap-3.5"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(24rem, 1fr))' }}
        >
          {batches.map((b) => (
            <Link key={b.id} href={`/work/${b.id}`}
                  className="tile no-select relative gap-0 overflow-hidden p-0">
              {/* 진행 중인 배치는 왼쪽 띠로 먼저 눈에 들어오게 한다 */}
              <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${
                b.my_open > 0 ? 'bg-warn' : b.status === 'IN_PROCESS' ? 'bg-brand' : 'bg-line-strong'
              }`} />

              {/*
                * 현장에서 이 타일을 보는 이유는 하나다. "이 배치, 몇 일차를 할
                * 차례인가." 그 답을 타일에서 가장 큰 글자로 둔다. 마지막 일차가
                * 아직 잠기지 않았으면 그 날을 이어서, 전부 잠겼으면 다음 날을
                * 새로 시작한다.
                */}
              <div className="flex items-stretch gap-4 px-5 pb-3 pt-4">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xl font-bold tracking-tight text-ink">
                    {b.batch_no}
                  </div>
                  <div className="mt-0.5 text-base text-body">{b.item_name}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Tag tone={b.status === 'IN_PROCESS' ? 'brand' : 'info'}>
                      {WO_STATUS_LABEL[b.status] ?? b.status}
                    </Tag>
                    {b.my_open > 0 && <Tag tone="warn">마감 전 {b.my_open}</Tag>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-center justify-center rounded-lg bg-brand-tint px-4 py-2">
                  <span className="text-[2rem] font-bold leading-none tnum text-brand-deep">
                    {b.last_day === null ? 1 : b.last_day_open ? b.last_day : b.last_day + 1}
                    <span className="ml-0.5 text-base font-bold">일차</span>
                  </span>
                  <span className="mt-1 text-xs font-semibold text-brand">
                    {b.last_day !== null && b.last_day_open ? '이어서 기록' : '새로 시작'}
                  </span>
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

      {/*
        * 안내는 흰 카드에 담지 않는다.
        *
        * 이 화면에서 흰 면은 "누를 것"이다. 안내까지 흰 카드에 담으니 누를 수
        * 있는 것과 읽기만 할 것이 같은 얼굴이 되고, 장갑 낀 손이 안내문을 먼저
        * 누른다. 읽기만 할 것은 바탕 위에 글자로 둔다.
        *
        * 네 줄 중 두 줄만 남긴다. 시각이 찍히는 것과 정정 기록은 화면이 그때
        * 그 자리에서 다시 말한다. 여기서는 되돌릴 수 없는 것 둘만 짚는다.
        */}
      <div className="border-t border-white/12 pt-5">
        <ul className="space-y-2.5 text-sm leading-relaxed text-on-dark-mute">
          <li>
            자재를 넣지 않고 마감하려면{' '}
            <b className="font-semibold text-white">해당 없음 사유</b>를 선택해야 합니다.
          </li>
          <li>
            일차를 마감하고 기록서를 인쇄하면{' '}
            <b className="font-semibold text-white">그 묶음은 수정할 수 없습니다.</b>{' '}
            누락된 것은 다음 일차에 정정 기록으로 남기십시오.
          </li>
        </ul>
      </div>
    </div>
  );
}
