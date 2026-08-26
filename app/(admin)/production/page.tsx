import Link from 'next/link';
import { requireUser, hasRole } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate, fmtDateTime } from '@/lib/fmt';
import { WO_STATUS_LABEL } from '@/lib/forms';
import Denied from '@/components/denied';
import { PageHead, Panel, Empty, Tag } from '@/components/ui';
import IssueForm, { type DmOpt, type RawLotOpt, type UserOpt } from './issue-form';

export const dynamic = 'force-dynamic';

interface WoRow {
  id: string; wo_no: string; batch_no: string; status: string; sheet_count: number;
  dmr_revision: string; issued_at: Date; cancelled_reason: string | null;
  item_code: string; item_name: string;
  raw_lot_no: string; thickness_band: string | null;
  prod_name: string; qa_name: string;
  lot_count: number; record_count: number; day_count: number;
}

type Search = Promise<{ status?: string }>;

const TONE: Record<string, string> = {
  ISSUED: 'info', IN_PROCESS: 'brand', CUT: 'ok', DONE: 'quiet', CANCELLED: 'faint',
};

export default async function ProductionPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    return <Denied what="생산 관리" need="생산관리자 또는 시스템관리자" />;
  }

  const sp = await searchParams;
  const status = sp.status || null;

  const d = await withActor(user.id, async (db) => ({
    orders: await db.rows<WoRow>(
      `select wo.id, wo.wo_no, wo.batch_no, wo.status::text as status, wo.sheet_count,
              wo.dmr_revision, wo.issued_at, wo.cancelled_reason,
              i.code as item_code, i.name as item_name,
              ml.lot_no as raw_lot_no, ml.thickness_band,
              up.full_name as prod_name, uq.full_name as qa_name,
              (select count(*)::int from product_lot pl where pl.work_order_id = wo.id) as lot_count,
              (select count(*)::int from process_record pr where pr.work_order_id = wo.id) as record_count,
              (select count(distinct pr.day_no)::int from process_record pr
                where pr.work_order_id = wo.id) as day_count
         from work_order wo
         join device_master dm on dm.id = wo.device_master_id
         join item i on i.id = dm.item_id
         join material_lot ml on ml.id = wo.material_lot_id
         join app_user up on up.id = wo.issued_by_prod
         join app_user uq on uq.id = wo.issued_by_qa
        where ($1::text is null or wo.status::text = $1)
        order by wo.issued_at desc limit 200`, [status]),
    masters: await db.rows<DmOpt>(
      `select dm.id, dm.revision, dm.verified_at, i.code as item_code, i.name as item_name,
              (select count(*)::int from dmr_operation o where o.device_master_id = dm.id) as op_count
         from device_master dm join item i on i.id = dm.item_id
        order by i.code, dm.revision desc`),
    rawLots: await db.rows<RawLotOpt>(
      `select ml.id, ml.lot_no, i.code as item_code, i.name as item_name,
              ml.qty_available, ml.thickness_band, s.name as supplier_name,
              s.status as supplier_status, ml.expiry_date
         from material_lot ml
         join item i on i.id = ml.item_id
         join supplier s on s.id = ml.supplier_id
        where i.type = 'RAW' and ml.status = 'AVAILABLE' and ml.qty_available > 0
        order by ml.received_at desc`),
    users: await db.rows<UserOpt>(
      `select u.id, u.full_name,
              array_remove(array_agg(r.role::text), null)::text[] as roles
         from app_user u left join user_role r on r.user_id = u.id
        where u.is_active group by u.id order by u.full_name`),
    today: await db.val<string>(`select to_char(timezone('Asia/Seoul', now()),'YYYY-MM-DD')`),
    counts: await db.rows<{ status: string; n: number }>(
      `select status::text as status, count(*)::int as n from work_order group by status`),
  }));

  const byStatus = new Map(d.counts.map((c) => [c.status, c.n]));
  const total = d.counts.reduce((s, c) => s + c.n, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line pb-4">
        <div className="min-w-0">
          <h1 className="text-[1.375rem] font-bold text-ink">생산</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            배치 하나는 원재료 로트 하나를 가공하는 단위입니다. 번호는 재사용하지 않습니다.
            공정 기록 입력은 현장 화면에서 합니다.
          </p>
        </div>
        <IssueForm masters={d.masters} rawLots={d.rawLots}
                   users={d.users} today={d.today ?? ''} />
      </div>

      <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-line bg-surface-sub p-1">
        <Link href="/production"
              className={`rounded-[0.3125rem] px-3 py-1.5 text-xs font-bold transition-all ${
                !status ? 'bg-surface text-brand shadow-[0_1px_2px_rgb(31_29_36/.06)]'
                        : 'text-muted hover:text-ink'}`}>
          전체 <span className="tnum">{total}</span>
        </Link>
        {Object.entries(WO_STATUS_LABEL).map(([code, label]) => (
          <Link key={code} href={`/production?status=${code}`}
                className={`rounded-[0.3125rem] px-3 py-1.5 text-xs font-bold transition-all ${
                  status === code ? 'bg-surface text-brand shadow-[0_1px_2px_rgb(31_29_36/.06)]'
                                  : 'text-muted hover:text-ink'}`}>
            {label} <span className="tnum">{byStatus.get(code) ?? 0}</span>
          </Link>
        ))}
      </div>

      <Panel>
        {d.orders.length === 0 ? (
          <Empty>해당하는 작업지시가 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">배치 · 지시서</th>
                  <th className="th">형명 · 개정</th>
                  <th className="th">원재료 로트</th>
                  <th className="th text-right">장입</th>
                  <th className="th text-right">로트</th>
                  <th className="th text-right">일차</th>
                  <th className="th">상태</th>
                  <th className="th">발행</th>
                  <th className="th sticky right-0 w-0 shadow-[-8px_0_8px_-8px_rgb(31_29_36/.12)]" />
                </tr>
              </thead>
              <tbody>
                {d.orders.map((w) => (
                  <tr key={w.id}>
                    {/* 배치번호와 지시서번호는 늘 같이 읽는다. 한 칸에 묶어
                        열을 하나 줄이면 표가 화면 안에 들어온다 */}
                    <td className="td whitespace-nowrap">
                      <div className="font-mono text-xs font-bold text-ink">{w.batch_no}</div>
                      <div className="font-mono text-xs text-faint">{w.wo_no}</div>
                    </td>
                    <td className="td whitespace-nowrap">
                      <div className="text-sm">{w.item_name}</div>
                      <div className="font-mono text-xs text-faint">
                        {w.item_code} · {w.dmr_revision}
                      </div>
                    </td>
                    <td className="td font-mono text-xs">
                      {w.raw_lot_no}
                      {w.thickness_band && (
                        <span className="ml-1.5 text-faint">{w.thickness_band}</span>
                      )}
                    </td>
                    <td className="td tnum text-right">{w.sheet_count}장</td>
                    <td className="td tnum text-right text-muted">{w.lot_count || ''}</td>
                    <td className="td tnum text-right text-muted">{w.day_count || ''}</td>
                    <td className="td">
                      <Tag tone={TONE[w.status] ?? 'quiet'}>
                        {WO_STATUS_LABEL[w.status] ?? w.status}
                      </Tag>
                    </td>
                    <td className="td whitespace-nowrap text-xs text-muted">
                      <div className="tnum">{fmtDate(w.issued_at)}</div>
                      <div className="text-faint">{w.prod_name} · {w.qa_name}</div>
                    </td>
                    <td className="td sticky right-0 bg-surface text-right shadow-[-8px_0_8px_-8px_rgb(31_29_36/.12)]">
                      <Link href={`/production/${w.id}`} className="btn-ghost h-8 px-3 text-xs">
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
    </div>
  );
}
