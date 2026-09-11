import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { WO_STATUS_LABEL } from '@/lib/forms';
import { Tag } from '@/components/ui';
import ScanBox from './scan-box';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '현장' };

interface BatchTile {
  id: string; batch_no: string; wo_no: string; status: string; sheet_count: number;
  /* 화면의 낱말이 제품에서 나온다 (0101) */
  load_unit: string | null;
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
export default async function WorkHome(
  { searchParams }: { searchParams: Promise<{ scan?: string }> },
) {
  const user = await requireUser();

  /*
   * 찍은 종이로 배치를 연다 (사용자 요청 2026-09-11).
   *
   * 목록에서 눈으로 고르면 옆 배치를 누른다 - `B260811-01` 과 `B260811-02`
   * 처럼 한 글자만 다르면 더 그렇다. 손에 든 종이를 찍으면 그 종이의 배치가
   * 열린다.
   *
   * 스캐너는 대문자로 친다. 대장의 식별자는 소문자다.
   * **읽기만 한다** - 인쇄 대장에 아무것도 남기지 않는다 (§7.1).
   *
   * ── 손으로도 칠 수 있어야 한다 (사용자 지적 2026-09-11) ────────────────
   * 스캐너가 안 되는 날 남는 길이 **열두 자리 16진수**뿐이면 그건 사람이 칠
   * 물건이 아니다. 같은 칸이 **배치번호와 지시서번호**도 받는다 - 둘 다 모든
   * 종이 맨 위에 큼직하게 찍혀 있고 뜻이 있는 글자라 치기 쉽다.
   *
   * 칸을 늘리지 않는다. 칸이 둘이면 "어디에 치지" 가 생긴다.
   */
  const scan = (await searchParams).scan?.trim() ?? '';
  if (scan !== '') {
    const hit = await withActor(user.id, (db) =>
      db.val<string>(
        `select coalesce(
                  (select v.work_order_id::text from v_print_lookup v
                    where v.short_hash = lower($1) and v.work_order_id is not null
                    limit 1),
                  (select w.id::text from work_order w
                    where upper(w.batch_no) = upper($1)
                       or upper(w.wo_no)    = upper($1)
                    limit 1))`, [scan]));
    if (hit) redirect(`/work/${hit}`);
  }

  const batches = await withActor(user.id, (db) =>
    db.rows<BatchTile>(
      `select wo.id, wo.batch_no, wo.wo_no, wo.status::text as status, wo.sheet_count,
              dm.load_unit,
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

      {/*
        * 스캔 칸을 목록보다 위에 둔다. 찍는 것이 기본이고 눈으로 고르는 것은
        * 스캐너가 없을 때의 갈래다.
        */}
      <ScanBox />
      {scan !== '' && (
        <p className="card bg-warn-bg px-4 py-3 text-base leading-relaxed text-ink">
          <b>{scan}</b> 로는 배치를 찾지 못했습니다. 종이 아래쪽 바코드를
          다시 찍거나, 종이 맨 위의 배치번호(<span className="font-mono">B…</span>)를
          치거나, 아래에서 배치를 고르십시오.
        </p>
      )}

      {/*
        * 배치 목록은 **접어 둔다** (사용자 지적 2026-09-11).
        *
        * 목록이 펼쳐져 있으면 아무도 찍지 않는다. 그런데 목록을 눈으로 훑어
        * 고르는 그 동작이 바로 없애려던 실수 자리다 - 배치번호가 한 글자만
        * 다르면 손이 옆으로 간다.
        *
        * 그래서 찍는 것이 기본이고, 목록은 **스캐너가 안 될 때 펴는 자리**다.
        * 없애지는 않는다 - 길을 하나만 두면 그 길이 막혔을 때 손이 묶인다.
        */}
      <details className="group">
        <summary className="cursor-pointer list-none rounded-md px-1 py-2 text-sm text-on-dark-mute">
          스캐너가 안 됩니까? <b className="text-white">배치 고르기</b>
          <span className="tnum"> ({batches.length}건)</span>
        </summary>
        <div className="mt-3">
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
                  ['장입', `${b.sheet_count}${b.load_unit ?? ''}`],
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
                {b.thickness_band && <span>구간 {b.thickness_band}</span>}
                {b.last_day && <span className="tnum">{b.last_day}일차까지 기록</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
        </div>
      </details>

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
