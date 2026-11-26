import { requireUser, blocksScreen } from '@/lib/session';
import Denied from '@/components/denied';
import { isViewerOnly } from '@/lib/roles';
import { withUser } from '@/lib/db';
import { PageShell, FilterBar } from '@/components/shell';
import { SubNav } from '../../nav';
import { MATERIAL_NAV } from '../../sections';
import { fmtDate, num } from '@/lib/fmt';
import { ITEM_TYPES } from '@/lib/forms';
import { Panel, Empty, Tag } from '@/components/ui';
import StockTools from './stock-tools';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '재고' };

interface StockRow {
  item_id: string; code: string; name: string; type: string; usage_uom: string;
  min_stock: string | null; on_hand: string; lot_count: number; nearest_expiry: string | null;
}
interface FinRow {
  id: string; lot_no: string; code: string; name: string;
  qty_available: number; qty_produced: number; qty_sample: number;
  manufactured_on: string; expiry_date: string; status: string;
  location: string | null; days_left: number; batch_no: string;
  product_code: string | null;
}

/* 어느 제품 구성표에도 없는 품목의 탭 열쇠 */
const OUT = '-';

export default async function StockPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  /* 열람자에게 열어 둔 화면이 아니다. 주소를 직접 쳐도 들어가지 못한다 */
  if (blocksScreen(user, '/material/stock')) return <Denied what="이 화면" need="생산관리자 또는 시스템관리자" />;

  /* 순수 열람자면 쓰기 단추를 아예 그리지 않는다 */
  const viewer = isViewerOnly(user.roles);


  const d = await withUser(user, async (db) => ({
    material: await db.rows<StockRow>(
      `select * from v_material_stock order by type, code`),
    finished: await db.rows<FinRow>(
      `select f.*, dm.product_code
         from v_finished_stock f
         left join product_lot pl on pl.id = f.id
         left join work_order wo on wo.id = pl.work_order_id
         left join device_master dm on dm.id = wo.device_master_id
        where f.qty_available > 0
        order by f.expiry_date, f.lot_no`),
    /*
     * 품목이 어느 제품에 드는가 (사용자 2026-11-26 «재고 탭의 재료를 DX2401 / DX2402 별로, 제품이 생기면
     * 그 BOM 에 맞게»). 셈에 넣는 것:
     *   · 그 제품 판(모든 개정)의 공정 구성표에 든 품목
     *   · 판의 원료 품목 (raw_item_id)
     *   · 그 제품이 쓰는 원액을 만들 때 든 원료 - 지난 원액 제조 기록(v_solution_input)으로
     * 여러 제품에 들면 탭마다 나온다. 어디에도 없으면 «구성표 밖» 탭에 모인다.
     */
    products: await db.rows<{ code: string }>(
      `select distinct product_code as code from device_master
        where product_code is not null order by 1`),
    belong: await db.rows<{ product_code: string; item_id: string }>(
      `with direct as (
         select dm.product_code, bom.component_item_id as item_id
           from dmr_bom bom
           join dmr_operation o on o.id = bom.operation_id
           join device_master dm on dm.id = o.device_master_id
          where dm.product_code is not null
         union
         select dm.product_code, dm.raw_item_id
           from device_master dm
          where dm.product_code is not null and dm.raw_item_id is not null
       ),
       via as (
         select d.product_code, ml.item_id
           from direct d
           join material_lot sl on sl.item_id = d.item_id
           join v_solution_input v on v.solution_lot_id = sl.id
           join material_lot ml on ml.id = v.material_lot_id
       )
       select product_code, item_id::text as item_id from direct
       union
       select product_code, item_id::text from via`),
    alerts: await db.val<number>(`select count(*)::int from v_reorder_alert`),
    /*
     * «유효기한 확인» 이 넘길 로트 수 (UI/UX 검수 2026-11-11). expire_material_lots()
     * 와 같은 조건이다 - 사용 가능 · 기한 있음 · 기한이 오늘보다 앞.
     */
    expirable: await db.val<number>(
      `select count(*)::int from material_lot
        where status = 'AVAILABLE' and expiry_date is not null
          and expiry_date < (timezone('Asia/Seoul', now()))::date`),
  }));

  /* 품목 → 드는 제품들 */
  const productsOf = new Map<string, string[]>();
  for (const b of d.belong) productsOf.set(b.item_id, [...(productsOf.get(b.item_id) ?? []), b.product_code]);
  const inTab = (r: StockRow, tab: string) =>
    tab === OUT ? !productsOf.has(r.item_id) : (productsOf.get(r.item_id) ?? []).includes(tab);

  const codes = d.products.map((p) => p.code);
  const tabs = [...codes,
    ...(d.material.some((r) => !productsOf.has(r.item_id)) || d.finished.some((f) => !f.product_code) ? [OUT] : [])];
  /* 주소에 제품이 없으면 맨 앞 탭으로 연다 (사용자 2026-11-26 «모든 화면은 제일 앞에 있는 탭으로») */
  const current = sp.p && tabs.includes(sp.p) ? sp.p : (tabs[0] ?? OUT);
  const finished = d.finished.filter((f) =>
    current === OUT ? !f.product_code || !codes.includes(f.product_code) : f.product_code === current);

  const byType = new Map<string, StockRow[]>();
  for (const r of d.material.filter((m) => inTab(m, current))) {
    byType.set(r.type, [...(byType.get(r.type) ?? []), r]);
  }

  return (
    <PageShell
      section="자재"
      title="재고"
      lede={
        <>
          제품마다 그 구성표에 드는 자재를 모읍니다. 자재는 품목별 합계, 완제품은
          <b className="text-ink"> 유효기한 순</b>으로 정렬합니다.
        </>
      }
      action={viewer ? null : (<StockTools alerts={d.alerts ?? 0} expirable={d.expirable ?? 0} />)}
      nav={<SubNav items={MATERIAL_NAV} />}
    >
      {tabs.length > 1 && (
        <FilterBar items={tabs.map((t) => ({
          href: `/material/stock?p=${encodeURIComponent(t)}`,
          label: t === OUT ? '구성표 밖' : t,
          count: d.material.filter((r) => inTab(r, t)).length,
          on: t === current,
        }))} />
      )}

      {current === OUT && (
        <p className="rounded-md border border-line bg-canvas px-3 py-2 text-xs leading-relaxed text-body">
          어느 제품의 구성표에도 들지 않은 자재입니다. 설정 &gt; 제품표준서에서 공정 구성표나 판의 원료에 넣으면
          그 제품 탭으로 옮겨 갑니다.
        </p>
      )}

      {ITEM_TYPES.filter((t) => t.code !== 'FIN').map((t) => {
        const rows = byType.get(t.code) ?? [];
        if (rows.length === 0) return null;
        return (
          <Panel key={t.code} title={t.label} note={t.note}>
            <div className="qd-table-scroll">
              <table className="qd-table qd-table--hangul">
                <thead>
                  <tr>
                    <th className="th">품목</th>
                    <th className="th text-right">보유</th>
                    <th className="th text-right">로트</th>
                    <th className="th text-right">최소 재고선</th>
                    <th className="th">가장 이른 유효기한</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const low = r.min_stock && Number(r.on_hand) < Number(r.min_stock);
                    return (
                      <tr key={r.item_id}>
                        <td className="td">
                          <div className="text-sm">{r.name}</div>
                          <div className="font-mono text-xs text-faint">
                            {r.code}
                            {/* 다른 제품에도 드는 자재는 여기서 쓰면 그쪽 재고도 준다 */}
                            {current !== OUT && (productsOf.get(r.item_id) ?? []).length > 1 && (
                              <span className="ml-2 font-sans">
                                {(productsOf.get(r.item_id) ?? []).filter((p) => p !== current).join(' · ')} 에도 씀
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={`td tnum text-right font-semibold ${low ? 'text-warn' : ''}`}>
                          {num(r.on_hand)} {r.usage_uom}
                        </td>
                        <td className="td tnum text-right text-muted">{r.lot_count || ''}</td>
                        <td className="td tnum text-right text-muted">
                          {r.min_stock ? Number(r.min_stock) : ''}
                        </td>
                        <td className="td tnum ">{fmtDate(r.nearest_expiry)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })}

      <Panel title="완제품" note="유효기한 순">
        {finished.length === 0 ? (
          <Empty hint="재단에서 제조번호가 붙으면 잔여 수량이 여기 잡힙니다.">
            출하 가능한 완제품이 없습니다.
          </Empty>
        ) : (
          <div className="qd-table-scroll">
            <table className="qd-table qd-table--hangul" data-grow="2">
              <thead>
                <tr>
                  <th className="th">제조번호</th>
                  <th className="th">형명</th>
                  <th className="th">배치</th>
                  <th className="th text-right">출하 가능</th>
                  <th className="th text-right">생산</th>
                  <th className="th text-right">샘플</th>
                  <th className="th">제조일</th>
                  <th className="th">유효기한</th>
                  <th className="th">상태</th>
                </tr>
              </thead>
              <tbody>
                {finished.map((f) => (
                  <tr key={f.id}>
                    <td className="td font-mono font-semibold">{f.lot_no}</td>
                    <td className="td">
                      <div className="text-sm">{f.name}</div>
                      <div className="font-mono text-xs text-faint">{f.code}</div>
                    </td>
                    <td className="td font-mono text-muted">{f.batch_no}</td>
                    <td className="td tnum text-right font-semibold">{num(f.qty_available)}</td>
                    <td className="td tnum text-right text-muted">{num(f.qty_produced)}</td>
                    <td className="td tnum text-right text-muted">{f.qty_sample || ''}</td>
                    <td className="td tnum ">{fmtDate(f.manufactured_on)}</td>
                    <td className="td tnum ">
                      <span className={f.days_left <= 60 ? 'font-semibold text-warn' : ''}>
                        {fmtDate(f.expiry_date)}
                      </span>
                      <span className="ml-1.5 text-faint">
                        {f.days_left >= 0 ? `${f.days_left}일` : '경과'}
                      </span>
                    </td>
                    <td className="td">
                      <Tag tone={f.status === 'RELEASE_APPROVED' ? 'ok' : 'quiet'}>
                        {f.status}
                      </Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </PageShell>
  );
}
