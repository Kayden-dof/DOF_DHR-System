import { requireUser, blocksViewer, hasRole } from '@/lib/session';
import Denied from '@/components/denied';
import { withActor } from '@/lib/db';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';
import { settingsNav } from '../../sections';
import { fmtDate } from '@/lib/fmt';
import { Panel, Empty } from '@/components/ui';
import {
  NewSupplierForm, SupplierRowView, PriceForm, ShelfLifeForm,
  type SupplierRow, type ItemOption,
} from './supplier-forms';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '공급자' };

interface PriceRow {
  item_code: string; item_name: string; supplier_name: string;
  price: string; effective_from: string; registered_by_name: string;
}

interface ShelfRow {
  item_code: string; months: number; effective_from: string;
  study_report_no: string; study_date: string | null; approved_by_name: string;
}

export default async function SuppliersPage() {
  const user = await requireUser();
  /* 열람자에게 열어 둔 화면이 아니다. 주소를 직접 쳐도 들어가지 못한다 */
  if (blocksViewer(user)) return <Denied what="이 화면" need="생산관리자 또는 시스템관리자" />;


  const d = await withActor(user.id, async (db) => ({
    suppliers: await db.rows<SupplierRow>(
      `select s.*, count(distinct isup.item_id)::int as item_count,
              count(distinct ml.id)::int as lot_count
         from supplier s
         left join item_supplier isup on isup.supplier_id = s.id
         left join material_lot ml on ml.supplier_id = s.id
        group by s.id order by s.code`),
    items: await db.rows<ItemOption>(
      `select id, code, name, usage_uom, type::text as type from item
        where is_active order by type, code`),
    prices: await db.rows<PriceRow>(
      `select i.code as item_code, i.name as item_name, s.name as supplier_name,
              h.price, h.effective_from, u.full_name as registered_by_name
         from price_history h
         join item i on i.id = h.item_id
         join supplier s on s.id = h.supplier_id
         join app_user u on u.id = h.registered_by
        order by h.registered_at desc limit 20`),
    shelf: await db.rows<ShelfRow>(
      `select i.code as item_code, h.months, h.effective_from, h.study_report_no,
              h.study_date, u.full_name as approved_by_name
         from shelf_life_history h
         join item i on i.id = h.item_id
         join app_user u on u.id = h.approved_by
        order by h.registered_at desc limit 20`),
    today: await db.val<string>(`select to_char(timezone('Asia/Seoul', now()),'YYYY-MM-DD')`),
  }));

  return (
    <PageShell
      section="설정"
      title="공급자 · 단가 · 사용기간"
      lede="승인 상태는 경고 표시에만 쓰입니다. 미승인 공급자의 자재도 등록과 사용을 막지 않습니다."
      action={<NewSupplierForm />}
      nav={<SubNav items={settingsNav(hasRole(user, 'SYS_ADMIN'))} />}
    >

      <Panel>
        {d.suppliers.length === 0 ? (
          <Empty>등록된 공급자가 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">코드</th>
                  <th className="th">상호</th>
                  <th className="th">승인</th>
                  <th className="th">만료일</th>
                  <th className="th">담당</th>
                  <th className="th text-right">자재 로트</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {d.suppliers.map((s) => <SupplierRowView key={s.id} s={s} />)}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="단가 등록" note="사용 단위 기준 공급가액">
          <PriceForm items={d.items} suppliers={d.suppliers} today={d.today ?? ''} />
          {d.prices.length > 0 && (
            <div className="overflow-x-auto border-t border-line">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">품목</th><th className="th">공급자</th>
                    <th className="th text-right">단가</th><th className="th">적용일</th>
                  </tr>
                </thead>
                <tbody>
                  {d.prices.map((p, i) => (
                    <tr key={i}>
                      <td className="td font-mono text-xs">{p.item_code}</td>
                      <td className="td text-xs">{p.supplier_name}</td>
                      <td className="td tnum text-right">{Number(p.price).toLocaleString()}</td>
                      <td className="td tnum text-xs text-muted">{fmtDate(p.effective_from)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="사용기간 등록" note="완제품 유효기한의 근거입니다. 안정성 시험 보고서 번호가 필요합니다.">
          <ShelfLifeForm items={d.items} today={d.today ?? ''} />
          {d.shelf.length > 0 && (
            <div className="overflow-x-auto border-t border-line">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">형명</th><th className="th text-right">개월</th>
                    <th className="th">적용일</th><th className="th">보고서</th>
                  </tr>
                </thead>
                <tbody>
                  {d.shelf.map((h, i) => (
                    <tr key={i}>
                      <td className="td font-mono text-xs">{h.item_code}</td>
                      <td className="td tnum text-right">{h.months}</td>
                      <td className="td tnum text-xs text-muted">{fmtDate(h.effective_from)}</td>
                      <td className="td font-mono text-xs">{h.study_report_no}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </PageShell>
  );
}
