import Link from 'next/link';
import { isViewerOnly } from '@/lib/roles';
import { requireUser, hasRole } from '@/lib/session';
import { withUser } from '@/lib/db';
import { fmtDate, fmtDateTime } from '@/lib/fmt';
import { WO_STATUS_LABEL } from '@/lib/forms';
import Denied from '@/components/denied';
import { Panel, Empty, Tag } from '@/components/ui';
import { SubNav } from '../nav';
import { PRODUCTION_NAV } from '../sections';
import { PageShell, FilterBar } from '@/components/shell';
import { Table, Th, Td, IdCell, TwoLine, ActionTh, RowLink } from '@/components/table';
import IssueForm, {
  type DmOpt, type RawLotOpt, type UserOpt, type FinOpt,
} from './issue-form';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '작업 지시' };

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
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR', 'VIEWER', 'QP')) {
    return <Denied what="생산 관리" need="생산관리자 또는 시스템관리자" />;
  }
  /* 순수 열람자면 쓰기 단추를 감춘다 */
  const viewer = isViewerOnly(user.roles);


  const sp = await searchParams;
  const status = sp.status || null;

  const d = await withUser(user, async (db) => ({
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
              dm.product_code, dm.product_name, dm.sheet_min, dm.sheet_max,
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
    // 예정 형명 후보. 같은 두께 구간이면 크기별로만 갈리므로 완제품 전부를
    // 내주고 화면에서 걸러 고르게 한다.
    finished: await db.rows<FinOpt>(
      `select id, code, name from item where type = 'FIN' and is_active order by code`),
    today: await db.val<string>(`select to_char(timezone('Asia/Seoul', now()),'YYYY-MM-DD')`),
    counts: await db.rows<{ status: string; n: number }>(
      `select status::text as status, count(*)::int as n from work_order group by status`),
  }));

  const byStatus = new Map(d.counts.map((c) => [c.status, c.n]));
  const total = d.counts.reduce((s, c) => s + c.n, 0);

  return (
    <PageShell
      section="생산"
      title="작업 지시"
      lede={<>
        배치 하나는 원재료 로트 하나를 가공하는 단위입니다. 번호는 재사용하지 않습니다.
        공정 기록 입력은 현장 화면에서 합니다.
      </>}
      action={viewer ? null : (<IssueForm masters={d.masters} rawLots={d.rawLots} finished={d.finished}
                         users={d.users} today={d.today ?? ''} />)}
      nav={<SubNav items={PRODUCTION_NAV} />}
    >
      {/*
        * 상태 거르개는 차림표 줄에 얹지 않는다. 그 줄은 "어느 화면인가" 를
        * 말하는 자리이고, 이것은 "그 화면의 무엇을 보는가" 다. 전에는 둘이
        * 한 줄에 붙어 있어, 자재 화면에서는 본문에 있던 것이 생산 화면에서만
        * 위에 있었다 (사용자 지적 2026-09-01).
        */}
      <FilterBar
        items={[
          { href: '/production', label: '전체', count: total, on: !status },
          ...Object.entries(WO_STATUS_LABEL).map(([code, label]) => ({
            href: `/production?status=${code}`,
            label,
            count: byStatus.get(code) ?? 0,
            on: status === code,
          })),
        ]}
      />

      <Panel>
        {d.orders.length === 0 ? (
          <Empty hint="위의 작업 지시 발행에서 시작합니다.">
            {status ? '이 상태의 작업 지시가 없습니다.' : '발행된 작업 지시가 없습니다.'}
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>배치 · 지시서</Th>
                <Th>형명 · 개정</Th>
                <Th>원재료 로트</Th>
                <Th right>장입</Th>
                <Th right>로트</Th>
                <Th right>일차</Th>
                <Th>상태</Th>
                <Th>발행</Th>
                <ActionTh />
              </tr>
            </thead>
            <tbody>
              {d.orders.map((w) => (
                <RowLink key={w.id} href={`/production/${w.id}`}>
                  <IdCell
                    id={w.batch_no}
                    sub={w.wo_no}
                    tone={w.status === 'IN_PROCESS' ? 'brand'
                      : w.status === 'CANCELLED' ? 'danger' : undefined}
                  />
                  <TwoLine top={w.item_name} bottom={`${w.item_code} · ${w.dmr_revision}`} />
                  <Td mono nowrap>
                    {w.raw_lot_no}
                    {w.thickness_band && (
                      <span className="ml-1.5 text-faint">{w.thickness_band}</span>
                    )}
                  </Td>
                  <Td right>{w.sheet_count}장</Td>
                  <Td right className="text-muted">{w.lot_count || ''}</Td>
                  <Td right className="text-muted">{w.day_count || ''}</Td>
                  <Td>
                    <Tag tone={TONE[w.status] ?? 'quiet'}>
                      {WO_STATUS_LABEL[w.status] ?? w.status}
                    </Tag>
                  </Td>
                  <Td nowrap className="text-xs text-muted">
                    <div className="tnum">{fmtDate(w.issued_at)}</div>
                    <div className="text-faint">{w.prod_name} · {w.qa_name}</div>
                  </Td>
                </RowLink>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </PageShell>
  );
}
