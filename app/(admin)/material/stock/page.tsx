import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';
import { MATERIAL_NAV } from '../../sections';
import { fmtDate } from '@/lib/fmt';
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
}

export default async function StockPage() {
  const user = await requireUser();

  const d = await withActor(user.id, async (db) => ({
    material: await db.rows<StockRow>(
      `select * from v_material_stock order by type, code`),
    finished: await db.rows<FinRow>(
      `select * from v_finished_stock where qty_available > 0
        order by expiry_date, lot_no`),
    alerts: await db.val<number>(`select count(*)::int from v_reorder_alert`),
  }));

  const byType = new Map<string, StockRow[]>();
  for (const r of d.material) byType.set(r.type, [...(byType.get(r.type) ?? []), r]);

  return (
    <PageShell
      section="자재"
      title="재고"
      lede={
        <>
          자재는 품목별 합계, 완제품은 <b className="text-ink">유효기한 순</b>으로 정렬합니다.
          사용기간이 짧고 형명이 많아 형명별로 보면 임박품이 묻힙니다.
        </>
      }
      action={<StockTools alerts={d.alerts ?? 0} />}
      nav={<SubNav items={MATERIAL_NAV} />}
    >

      {ITEM_TYPES.filter((t) => t.code !== 'FIN').map((t) => {
        const rows = byType.get(t.code) ?? [];
        if (rows.length === 0) return null;
        return (
          <Panel key={t.code} title={t.label} note={t.note}>
            <div className="overflow-x-auto">
              <table className="w-full">
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
                          <div className="font-mono text-xs text-faint">{r.code}</div>
                        </td>
                        <td className={`td tnum text-right font-semibold ${low ? 'text-warn' : ''}`}>
                          {Number(r.on_hand)} {r.usage_uom}
                        </td>
                        <td className="td tnum text-right text-muted">{r.lot_count || ''}</td>
                        <td className="td tnum text-right text-muted">
                          {r.min_stock ? Number(r.min_stock) : ''}
                        </td>
                        <td className="td tnum text-xs">{fmtDate(r.nearest_expiry)}</td>
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
        {d.finished.length === 0 ? (
          <Empty>출하 가능한 완제품이 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
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
                {d.finished.map((f) => (
                  <tr key={f.id}>
                    <td className="td font-mono text-xs font-semibold">{f.lot_no}</td>
                    <td className="td">
                      <div className="text-sm">{f.name}</div>
                      <div className="font-mono text-xs text-faint">{f.code}</div>
                    </td>
                    <td className="td font-mono text-xs text-muted">{f.batch_no}</td>
                    <td className="td tnum text-right font-semibold">{f.qty_available}</td>
                    <td className="td tnum text-right text-muted">{f.qty_produced}</td>
                    <td className="td tnum text-right text-muted">{f.qty_sample || ''}</td>
                    <td className="td tnum text-xs">{fmtDate(f.manufactured_on)}</td>
                    <td className="td tnum text-xs">
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
