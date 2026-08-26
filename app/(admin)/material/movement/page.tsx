import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDateTime } from '@/lib/fmt';
import { MOVEMENT_TYPES } from '@/lib/forms';
import { PageHead, Panel, Empty, Tag } from '@/components/ui';
import { MovementForm, SolutionForm, type LotOpt, type WoOpt } from './movement-forms';

export const dynamic = 'force-dynamic';

interface MoveRow {
  id: string; type: string; qty: string; reason_code: string; reason_detail: string | null;
  registered_at: Date; lot_no: string; item_code: string; item_name: string;
  usage_uom: string; batch_no: string | null; registered_by_name: string;
}

export default async function MovementPage() {
  const user = await requireUser();

  const d = await withActor(user.id, async (db) => ({
    lots: await db.rows<LotOpt>(
      `select ml.id, ml.lot_no, i.code as item_code, i.name as item_name,
              i.usage_uom, ml.qty_available
         from material_lot ml join item i on i.id = ml.item_id
        where ml.status in ('AVAILABLE','CONSUMED')
        order by i.code, ml.lot_no`),
    orders: await db.rows<WoOpt>(
      `select id, batch_no, wo_no from work_order
        where status in ('ISSUED','IN_PROCESS','CUT') order by issued_at desc`),
    moves: await db.rows<MoveRow>(
      `select sm.id, sm.type::text as type, sm.qty, sm.reason_code, sm.reason_detail,
              sm.registered_at, ml.lot_no, i.code as item_code, i.name as item_name,
              i.usage_uom, wo.batch_no, u.full_name as registered_by_name
         from stock_movement sm
         join material_lot ml on ml.id = sm.material_lot_id
         join item i on i.id = ml.item_id
         join app_user u on u.id = sm.registered_by
         left join work_order wo on wo.id = sm.work_order_id
        order by sm.registered_at desc limit 100`),
  }));

  const label = (t: string) => MOVEMENT_TYPES.find((m) => m.code === t)?.label
    ?? (t === 'SOLUTION' ? '용액 제조' : t);

  return (
    <div className="space-y-5">
      <PageHead
        title="재고 증감 · 용액 제조"
        note="반납은 원 로트로 복귀시킵니다. 성적서 연결을 유지하기 위함입니다."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="재고 증감" note="반납 · 폐기 · 조정">
          <MovementForm lots={d.lots} orders={d.orders} />
        </Panel>
        <Panel title="용액 제조" note="당일 제조 · 당일 폐기. 로트를 만들지 않는다">
          <SolutionForm lots={d.lots} />
        </Panel>
      </div>

      <Panel title="최근 기록">
        {d.moves.length === 0 ? (
          <Empty>기록이 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">일시</th>
                  <th className="th">유형</th>
                  <th className="th">자재 로트</th>
                  <th className="th text-right">증감</th>
                  <th className="th">사유</th>
                  <th className="th">배치</th>
                  <th className="th">기록자</th>
                </tr>
              </thead>
              <tbody>
                {d.moves.map((m) => {
                  const q = Number(m.qty);
                  return (
                    <tr key={m.id}>
                      <td className="td tnum text-xs text-muted">{fmtDateTime(m.registered_at)}</td>
                      <td className="td">
                        <Tag tone={q > 0 ? 'ok' : m.type === 'SOLUTION' ? 'info' : 'warn'}>
                          {label(m.type)}
                        </Tag>
                      </td>
                      <td className="td">
                        <div className="font-mono text-xs font-semibold">{m.lot_no}</div>
                        <div className="text-xs text-faint">{m.item_name}</div>
                      </td>
                      <td className={`td tnum text-right font-semibold ${q > 0 ? 'text-ok' : 'text-danger'}`}>
                        {q > 0 ? '+' : ''}{q} {m.usage_uom}
                      </td>
                      <td className="td text-xs">
                        {m.reason_code}
                        {m.reason_detail && (
                          <span className="text-muted"> · {m.reason_detail}</span>
                        )}
                      </td>
                      <td className="td font-mono text-xs text-muted">{m.batch_no ?? ''}</td>
                      <td className="td text-xs text-muted">{m.registered_by_name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
