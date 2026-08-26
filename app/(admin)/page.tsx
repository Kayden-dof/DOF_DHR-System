import Link from 'next/link';
import { requireUser, hasRole } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate, fmtDateTime } from '@/lib/fmt';
import { NUMBERING_TARGETS, M1_CRITICAL_TARGETS, WO_STATUS_LABEL } from '@/lib/forms';
import { Panel, Empty, Tag } from '@/components/ui';
import ActionChip from '@/components/action-chip';

export const dynamic = 'force-dynamic';

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
      id: string; batch_no: string; status: string; item_name: string;
      sheet_count: number; issued_at: Date; day_count: number; lot_count: number;
    }>(
      `select wo.id, wo.batch_no, wo.status::text as status, i.name as item_name,
              wo.sheet_count, wo.issued_at,
              (select count(distinct pr.day_no)::int from process_record pr
                where pr.work_order_id = wo.id) as day_count,
              (select count(*)::int from product_lot pl
                where pl.work_order_id = wo.id) as lot_count
         from work_order wo
         join device_master dm on dm.id = wo.device_master_id
         join item i on i.id = dm.item_id
        where wo.status in ('ISSUED','IN_PROCESS','CUT')
        order by wo.issued_at desc limit 6`),
    expiring: await db.rows<{
      id: string; lot_no: string; item_name: string; expiry_date: string; qty: string;
    }>(
      `select ml.id, ml.lot_no, i.name as item_name, ml.expiry_date::text as expiry_date,
              ml.qty_available as qty
         from material_lot ml join item i on i.id = ml.item_id
        where ml.status = 'AVAILABLE' and ml.expiry_date is not null
          and ml.expiry_date < (timezone('Asia/Seoul', now()))::date + 30
        order by ml.expiry_date limit 8`),
    recent: await db.rows<{
      table_name: string; action: string; acted_at: Date; actor_name: string | null;
    }>(
      `select a.table_name, a.action, a.acted_at, u.full_name as actor_name
         from audit_log a left join app_user u on u.id = a.actor_id
        order by a.id desc limit 8`),
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
      text: <>서면 대조가 확인된 제품표준서가 없습니다. 작업지시를 발행할 수 없습니다.</>,
      href: '/settings/dmr', label: '제품표준서',
    });
  }

  const attention = [
    c.reorder > 0 && { tone: 'warn', label: '최소 재고선 아래', n: c.reorder,
      href: '/material/orders', unit: '종' },
    c.expiring > 0 && { tone: 'warn', label: '유효기한 30일 이내', n: c.expiring,
      href: '/material', unit: '건' },
    c.expired > 0 && { tone: 'danger', label: '기한 경과 자재', n: c.expired,
      href: '/material?status=EXPIRED', unit: '건' },
    c.lots_await_release > 0 && { tone: 'info', label: '출하 승인 대기', n: c.lots_await_release,
      href: '/shipping', unit: '로트' },
    c.unprinted_days > 0 && { tone: 'quiet', label: '미마감 일차', n: c.unprinted_days,
      href: '/production', unit: '건' },
  ].filter(Boolean) as { tone: string; label: string; n: number; href: string; unit: string }[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink">현황</h1>
        <p className="mt-1 text-sm text-muted">
          {user.full_name} 님. 지금 손을 대야 할 것부터 보여 줍니다.
        </p>
      </div>

      {setup.length > 0 && (
        <section className="card border-warn/40 bg-warn-bg p-4">
          <div className="flex items-start gap-3">
            <Tag tone="warn">설정 필요</Tag>
            <div className="space-y-2">
              {setup.map((s, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3">
                  <p className="text-sm leading-relaxed text-ink">{s.text}</p>
                  <Link href={s.href} className="btn-ghost h-8 px-3 text-xs">{s.label}</Link>
                </div>
              ))}
              <p className="text-xs text-muted">
                M1이 끝나기 전에 실제 로트를 등록하지 마십시오. 계보는 소급이 안 됩니다.
              </p>
            </div>
          </div>
        </section>
      )}

      {attention.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {attention.map((a) => (
            <Link key={a.label} href={a.href}
                  className="card-raised p-4 transition-colors hover:border-brand-line">
              <div className="text-xs font-semibold text-muted">{a.label}</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-2xl font-bold tnum text-ink">{a.n}</span>
                <span className="text-xs text-muted">{a.unit}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="진행 중인 배치"
               action={<Link href="/production" className="text-xs font-semibold text-brand hover:underline">생산으로</Link>}>
          {d.batches.length === 0 ? (
            <Empty>진행 중인 배치가 없습니다.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">배치</th>
                    <th className="th">제품</th>
                    <th className="th text-right">장입</th>
                    <th className="th text-right">일차</th>
                    <th className="th text-right">제품 로트</th>
                    <th className="th">상태</th>
                    <th className="th" />
                  </tr>
                </thead>
                <tbody>
                  {d.batches.map((b) => (
                    <tr key={b.id}>
                      <td className="td font-mono text-xs font-semibold">{b.batch_no}</td>
                      <td className="td text-sm">{b.item_name}</td>
                      <td className="td tnum text-right">{b.sheet_count}</td>
                      <td className="td tnum text-right text-muted">{b.day_count || ''}</td>
                      <td className="td tnum text-right text-muted">{b.lot_count || ''}</td>
                      <td className="td">
                        <Tag tone={b.status === 'IN_PROCESS' ? 'brand' : 'info'}>
                          {WO_STATUS_LABEL[b.status] ?? b.status}
                        </Tag>
                      </td>
                      <td className="td text-right">
                        <Link href={`/production/${b.id}`} className="btn-quiet h-8 px-2 text-xs">
                          열기
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="유효기한 임박 자재" note="30일 이내">
          {d.expiring.length === 0 ? (
            <Empty>없습니다.</Empty>
          ) : (
            <div className="divide-y divide-line">
              {d.expiring.map((e) => (
                <div key={e.id} className="flex items-center gap-2 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">{e.item_name}</div>
                    <div className="font-mono text-xs text-faint">{e.lot_no}</div>
                  </div>
                  <div className="text-right">
                    <div className="tnum text-xs font-semibold text-warn">
                      {fmtDate(e.expiry_date)}
                    </div>
                    <div className="tnum text-xs text-muted">{Number(e.qty)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="최근 활동"
               action={admin ? <Link href="/settings/audit" className="text-xs font-semibold text-brand hover:underline">감사추적</Link> : null}>
          {d.recent.length === 0 ? (
            <Empty>기록이 없습니다.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">일시</th>
                    <th className="th">표</th>
                    <th className="th">작업</th>
                    <th className="th">수행자</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recent.map((r, i) => (
                    <tr key={i}>
                      <td className="td tnum text-xs text-muted">{fmtDateTime(r.acted_at)}</td>
                      <td className="td font-mono text-xs">{r.table_name}</td>
                      <td className="td"><ActionChip action={r.action} /></td>
                      <td className="td text-xs">{r.actor_name ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="한눈에">
          <dl className="divide-y divide-line">
            {[
              ['진행 중인 배치', c.wo_open, '/production'],
              ['착수 전 지시서', c.wo_issued, '/production?status=ISSUED'],
              ['마감 안 된 공정', c.open_records, '/production'],
              ['포장 완료 로트', c.lots_packed, '/shipping/steril'],
              ['출고 가능 로트', c.lots_shippable, '/shipping/ship'],
            ].map(([label, n, href]) => (
              <Link key={String(label)} href={String(href)}
                    className="flex items-center justify-between px-4 py-2.5 hover:bg-canvas">
                <span className="text-sm text-muted">{label}</span>
                <span className="text-lg font-bold tnum text-ink">{n as number}</span>
              </Link>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
