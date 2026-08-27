import Link from 'next/link';
import { requireUser, hasRole } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate, fmtTime } from '@/lib/fmt';
import {
  NUMBERING_TARGETS, M1_CRITICAL_TARGETS, WO_STATUS_LABEL, tableLabel,
} from '@/lib/forms';
import { Panel, Empty, Tag } from '@/components/ui';
import { PageShell, StatStrip, type StatItem } from '@/components/shell';
import { Table, Th, Td, IdCell, TwoLine, ActionTh, RowLink } from '@/components/table';
import ActionChip from '@/components/action-chip';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '현황' };

/* ---------------------------------------------------------------------------
   관리자 현황

   지금 손을 대야 할 것만 위로 올린다. 숫자 나열이 아니라 "무엇이 막혀 있는가"와
   "무엇이 진행 중인가"를 먼저 보여 준다.

   판정성 문구를 쓰지 않는다 (§10). 이상이 없으면 아무것도 표시하지 않는다.
--------------------------------------------------------------------------- */

interface Counts {
  wo_open: number; wo_issued: number;
  lots_packed: number; lots_await_release: number; lots_shippable: number;
  reorder: number; expiring: number; expired: number;
  eq_due: number; eq_gone: number;
  open_records: number; unprinted_days: number;
}

export default async function Dashboard() {
  const user = await requireUser();
  const admin = hasRole(user, 'SYS_ADMIN');

  const d = await withActor(user.id, async (db) => ({
    c: await db.one<Counts>(
      `select
        (select count(*)::int from work_order
          where status in ('ISSUED','IN_PROCESS','CUT'))                    as wo_open,
        (select count(*)::int from work_order where status = 'ISSUED')      as wo_issued,
        (select count(*)::int from product_lot where status = 'PACKED')     as lots_packed,
        (select count(*)::int from product_lot
          where status in ('PACKED','STERILIZING','TESTED')
            and release_approved_by is null)                                as lots_await_release,
        (select count(*)::int from product_lot
          where release_approved_by is not null and qty_available > 0)      as lots_shippable,
        (select count(*)::int from v_reorder_alert)                         as reorder,
        (select count(*)::int from material_lot
          where status = 'AVAILABLE' and expiry_date is not null
            and expiry_date < (timezone('Asia/Seoul', now()))::date + 30)   as expiring,
        (select count(*)::int from material_lot where status = 'EXPIRED')   as expired,
        (select count(*)::int from v_equipment_status
          where is_active
            and (valid_until is null
                 or valid_until < (timezone('Asia/Seoul', now()))::date + 30)) as eq_due,
        (select count(*)::int from v_equipment_status
          where is_active
            and (valid_until is null
                 or valid_until < (timezone('Asia/Seoul', now()))::date))      as eq_gone,
        (select count(*)::int from process_record where ended_at is null)   as open_records,
        (select count(*)::int from (
           select pr.work_order_id, pr.day_no, pr.worker_id
             from process_record pr
            group by 1,2,3
           having not exists (select 1 from day_lock dl
                               where dl.work_order_id = pr.work_order_id
                                 and dl.day_no = pr.day_no
                                 and dl.worker_id = pr.worker_id)) s)       as unprinted_days`),
    covered: await db.rows<{ target: string }>(
      `select distinct target::text as target from numbering_rule
        where is_active and item_id is null`),
    ready: await db.val<number>(
      `select count(*)::int from device_master where verified_at is not null`),
    batches: await db.rows<{
      id: string; batch_no: string; wo_no: string; status: string;
      item_name: string; item_code: string;
      sheet_count: number; issued_at: Date; day_count: number; lot_count: number;
      last_op: string | null;
    }>(
      `select wo.id, wo.batch_no, wo.wo_no, wo.status::text as status,
              i.name as item_name, i.code as item_code,
              wo.sheet_count, wo.issued_at,
              (select count(distinct pr.day_no)::int from process_record pr
                where pr.work_order_id = wo.id) as day_count,
              (select count(*)::int from product_lot pl
                where pl.work_order_id = wo.id) as lot_count,
              (select o.name from process_record pr
                 join dmr_operation o on o.id = pr.operation_id
                where pr.work_order_id = wo.id
                order by o.seq desc, pr.attempt desc limit 1) as last_op
         from work_order wo
         join device_master dm on dm.id = wo.device_master_id
         join item i on i.id = dm.item_id
        where wo.status in ('ISSUED','IN_PROCESS','CUT')
        order by wo.issued_at desc limit 6`),
    expiring: await db.rows<{
      id: string; lot_no: string; item_name: string; expiry_date: string;
      qty: string; days_left: number;
    }>(
      `select ml.id, ml.lot_no, i.name as item_name, ml.expiry_date::text as expiry_date,
              ml.qty_available as qty,
              (ml.expiry_date - (timezone('Asia/Seoul', now()))::date) as days_left
         from material_lot ml join item i on i.id = ml.item_id
        where ml.status = 'AVAILABLE' and ml.expiry_date is not null
          and ml.expiry_date < (timezone('Asia/Seoul', now()))::date + 30
        order by ml.expiry_date limit 6`),
    /*
     * 마감하지 않은 일차. "미마감 일차" 숫자를 눌러 갈 곳이 없었다. 숫자만
     * 띄워 놓고 그 숫자가 무엇으로 이루어졌는지 볼 자리를 주지 않으면 그
     * 숫자는 아무 일도 시키지 못한다.
     *
     * 묶음 키가 (지시서, 일차, 작업자)다. 같은 날 두 사람이 작업하면 기록지가
     * 두 장 나오고 각자 자기 것만 마감한다 (§4.9).
     */
    pending: await db.rows<{
      wo_id: string; batch_no: string; day_no: number;
      worker_name: string; records: number; open: number; work_date: string;
    }>(
      `select pr.work_order_id as wo_id, wo.batch_no, pr.day_no,
              u.full_name as worker_name,
              count(*)::int as records,
              count(*) filter (where pr.ended_at is null)::int as open,
              max(pr.work_date)::text as work_date
         from process_record pr
         join work_order wo on wo.id = pr.work_order_id
         join app_user u on u.id = pr.worker_id
        where not exists (select 1 from day_lock dl
                           where dl.work_order_id = pr.work_order_id
                             and dl.day_no = pr.day_no
                             and dl.worker_id = pr.worker_id)
        group by 1,2,3,4
        order by max(pr.work_date) desc, wo.batch_no, pr.day_no
        limit 7`),
    recent: await db.rows<{
      table_name: string; action: string; acted_at: Date; actor_name: string | null;
    }>(
      `select a.table_name, a.action, a.acted_at, u.full_name as actor_name
         from audit_log a left join app_user u on u.id = a.actor_id
        order by a.id desc limit 7`),
  }));

  const c = d.c!;
  const have = new Set(d.covered.map((r) => r.target));
  const blocking = NUMBERING_TARGETS.filter(
    (t) => M1_CRITICAL_TARGETS.includes(t.code) && !have.has(t.code));

  const setup: { text: React.ReactNode; href: string; label: string }[] = [];
  if (blocking.length > 0 && admin) {
    setup.push({
      text: <>{blocking.map((t) => t.label).join(' · ')} 채번 규칙이 없습니다. 번호를 만들 수 없습니다.</>,
      href: '/settings/numbering', label: '채번 규칙',
    });
  }
  if ((d.ready ?? 0) === 0 && admin) {
    setup.push({
      text: <>서면 대조가 확인된 제품표준서가 없습니다. 작업 지시를 발행할 수 없습니다.</>,
      href: '/settings/dmr', label: '제품표준서',
    });
  }

  /*
   * 숫자 띠는 늘 같은 자리에 같은 항목이 있어야 훑을 수 있다. 있을 때만 나오는
   * 항목과 늘 나오는 항목을 섞지 않는다. 0은 흐리게 나오므로 감출 필요가 없고,
   * 감추면 오히려 "그 항목이 어디 갔나" 하고 찾게 된다.
   */
  const stats: StatItem[] = [
    { label: '진행 중인 배치', value: c.wo_open, unit: '건', href: '/production' },
    { label: '마감 안 된 공정', value: c.open_records, unit: '건', href: '/production',
      tone: c.open_records > 0 ? 'info' : undefined },
    { label: '미마감 일차', value: c.unprinted_days, unit: '건', href: '/production',
      tone: c.unprinted_days > 0 ? 'warn' : undefined },
    { label: '출하 승인 대기', value: c.lots_await_release, unit: '로트', href: '/shipping',
      tone: c.lots_await_release > 0 ? 'info' : undefined },
    { label: '기한 임박 자재', value: c.expiring + c.expired, unit: '건', href: '/material',
      tone: c.expired > 0 ? 'danger' : c.expiring > 0 ? 'warn' : undefined },
    { label: '최소 재고선 아래', value: c.reorder, unit: '종', href: '/material/orders',
      tone: c.reorder > 0 ? 'warn' : undefined },
    { label: '설비 밸리데이션', value: c.eq_due, unit: '대', href: '/equipment',
      tone: c.eq_gone > 0 ? 'danger' : c.eq_due > 0 ? 'warn' : undefined },
  ];

  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false,
  }).format(new Date()));
  const greeting = hour < 11 ? '아침' : hour < 17 ? '오후' : '저녁';

  /*
   * 눈썹 자리에 오늘 날짜를 둔다. 다른 화면이 구역 이름을 놓는 자리인데,
   * 현황에서 "현황"이라고 다시 적는 것은 아무것도 말하지 않는다. 작업일이
   * 기록의 축인 시스템이라 날짜가 그 자리에 있을 값이다.
   */
  const today = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).format(new Date());

  return (
    <PageShell
      section={today}
      title={`${greeting} 인사드립니다, ${user.full_name} 님`}
      action={<Link href="/production" className="btn-primary">생산으로</Link>}
      stats={<StatStrip items={stats} />}
    >
      {setup.length > 0 && (
        <section className="card border-warn/30 bg-warn-bg">
          <div className="flex items-start gap-3 p-4">
            <Tag tone="warn">설정 필요</Tag>
            <div className="space-y-2">
              {setup.map((s, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3">
                  <p className="text-sm leading-relaxed text-ink">{s.text}</p>
                  <Link href={s.href} className="btn-ghost h-8">{s.label}</Link>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-3">
        <Panel
          className={d.expiring.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}
          title="진행 중인 배치"
          action={
            <Link href="/production" className="text-xs font-bold text-brand hover:underline">
              전체 보기
            </Link>
          }
        >
          {d.batches.length === 0 ? (
            <Empty hint="작업 지시를 발행하면 여기에 나타납니다.">
              진행 중인 배치가 없습니다.
            </Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>배치 · 지시서</Th>
                  <Th>제품</Th>
                  <Th>최근 공정</Th>
                  <Th right>장입</Th>
                  <Th right>일차</Th>
                  <Th right>로트</Th>
                  <Th>상태</Th>
                  <ActionTh />
                </tr>
              </thead>
              <tbody>
                {d.batches.map((b) => (
                  <RowLink key={b.id} href={`/production/${b.id}`}>
                    <IdCell
                      id={b.batch_no}
                      sub={b.wo_no}
                      tone={b.status === 'IN_PROCESS' ? 'brand' : undefined}
                    />
                    <TwoLine top={b.item_name} bottom={b.item_code} />
                    <Td nowrap className="text-xs text-muted">{b.last_op ?? '착수 전'}</Td>
                    <Td right>{b.sheet_count}</Td>
                    <Td right className="text-muted">{b.day_count || ''}</Td>
                    <Td right className="text-muted">{b.lot_count || ''}</Td>
                    <Td>
                      <Tag tone={b.status === 'IN_PROCESS' ? 'brand'
                        : b.status === 'CUT' ? 'info' : 'quiet'}>
                        {WO_STATUS_LABEL[b.status] ?? b.status}
                      </Tag>
                    </Td>
                  </RowLink>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        {/*
          * 임박한 자재가 없으면 이 패널 자체를 내지 않는다. "없습니다"가 적힌
          * 빈 상자는 자리만 차지하고, 아무것도 없는 것이 정상이다 (§10).
          */}
        {d.expiring.length > 0 && (
          <Panel
            title="유효기한 임박"
            note="30일 이내"
            action={
              <Link href="/material" className="text-xs font-bold text-brand hover:underline">
                자재로
              </Link>
            }
          >
            <ul className="divide-y divide-line-soft">
              {d.expiring.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span aria-hidden className={`h-8 w-[3px] shrink-0 rounded-full ${
                    e.days_left <= 0 ? 'bg-danger' : e.days_left <= 7 ? 'bg-warn' : 'bg-line-strong'
                  }`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">{e.item_name}</div>
                    <div className="font-mono text-xs text-faint">{e.lot_no}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`tnum text-xs font-bold ${
                      e.days_left <= 0 ? 'text-danger' : 'text-warn'}`}>
                      {e.days_left <= 0 ? '기한 경과' : `${e.days_left}일`}
                    </div>
                    <div className="tnum text-xs text-muted">{fmtDate(e.expiry_date)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-3">
        {/*
          * 마감 대기. 위 숫자 띠의 "미마감 일차"가 무엇으로 이루어졌는지가
          * 여기 있다. 숫자를 띄워 놓고 그 안을 볼 자리를 주지 않으면 그 숫자는
          * 아무 일도 시키지 못한다.
          *
          * 마감 자체는 여기서 하지 않는다. 인쇄가 곧 잠금이라 (S04) 되돌릴 수
          * 없고, 되돌릴 수 없는 조작은 배치를 열어 놓고 해야 한다.
          */}
        <Panel
          className="lg:col-span-2"
          title="마감 대기"
          action={
            <Link href="/production" className="text-xs font-bold text-brand hover:underline">
              생산으로
            </Link>
          }
        >
          {d.pending.length === 0 ? (
            <Empty>마감을 기다리는 일차가 없습니다.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>배치</Th>
                  <Th>작업일</Th>
                  <Th>작업자</Th>
                  <Th right>기록</Th>
                  <Th>진행</Th>
                  <ActionTh />
                </tr>
              </thead>
              <tbody>
                {d.pending.map((p) => (
                  <RowLink key={`${p.wo_id}-${p.day_no}-${p.worker_name}`}
                           href={`/production/${p.wo_id}`}>
                    <IdCell
                      id={p.batch_no}
                      sub={`${p.day_no}일차`}
                      tone={p.open > 0 ? 'info' : 'warn'}
                    />
                    <Td nowrap className="tnum text-muted">{fmtDate(p.work_date)}</Td>
                    <Td nowrap>{p.worker_name}</Td>
                    <Td right>{p.records}</Td>
                    <Td>
                      {p.open > 0
                        ? <Tag tone="info">공정 {p.open}건 진행 중</Tag>
                        : <Tag tone="warn">기록서 미발행</Tag>}
                    </Td>
                  </RowLink>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel
          title="최근 활동"
          action={admin
            ? <Link href="/settings/audit" className="text-xs font-bold text-brand hover:underline">감사추적</Link>
            : null}
        >
          {d.recent.length === 0 ? (
            <Empty>기록이 없습니다.</Empty>
          ) : (
            <ul className="divide-y divide-line-soft">
              {d.recent.map((r, i) => (
                <li key={i} className="flex items-center gap-2.5 px-4 py-2.5">
                  <ActionChip action={r.action} />
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink">
                    {tableLabel(r.table_name)}
                  </span>
                  <span className="shrink-0 tnum text-xs text-faint">
                    {fmtTime(r.acted_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </PageShell>
  );
}
