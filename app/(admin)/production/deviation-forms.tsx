'use client';

import { useActionState, useState, useId } from 'react';
import { openDeviation, closeDeviation } from './actions';
import { Msg, Tag } from '@/components/ui';
import { Dialog, useDialog } from '@/components/dialog';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   일탈 대장 입력

   두 몸짓뿐이다. 올리는 것과 닫는 것.

   등급도 분류 선택지도 두지 않는다. 무엇이 일탈이고 얼마나 중대한지는 사람이
   서면으로 정한다 (§1). 화면이 선택지를 내놓는 순간 그 목록이 곧 분류 체계가
   되고, 시스템이 일탈의 경중을 정하는 것이 된다.

   닫을 때 받는 것은 서면에 이미 적혀 있는 값들이다 - 보고서 번호, 결론, 승인자,
   승인일. 그 문서가 판정이고 대장은 그것을 가리킨다.
--------------------------------------------------------------------------- */

export interface DevRow {
  id: string;
  deviation_no: string;
  occurred_on: string;
  title: string;
  detail: string | null;
  batch_no: string | null;
  product_lot_no: string | null;
  material_lot_no: string | null;
  equipment_code: string | null;
  equipment_name: string | null;
  report_no: string | null;
  outcome: string | null;
  approved_by: string | null;
  approved_on: string | null;
  closed_on: string | null;
  registered_by_name: string | null;
  is_open: boolean;
}

export interface DevOpts {
  batches: { id: string; batch_no: string }[];
  lots: { id: string; lot_no: string }[];
  materials: { id: string; lot_no: string; item_name: string }[];
  equipment: { id: string; code: string; name: string }[];
}

export function OpenDeviation({ opts, today }: { opts: DevOpts; today: string }) {
  /* 라벨과 입력을 잇는다 (4차 감사 G2). 같은 부품이 여러 번 그려져도 겹치지 않는다 */
  const uid = useId();

  const [state, action, pending] = useActionState<FormState, FormData>(openDeviation, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-2">
        <button onClick={() => setOpen(true)} className="btn-primary">일탈 등록</button>
        <div className="max-w-md"><Msg state={state} /></div>
      </div>
    );
  }

  return (
    <form action={action} className="card w-full p-4">
      <h3 className="text-sm font-bold text-ink">일탈 등록</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        일탈 번호는 채번 규칙이 만듭니다. 무엇이 일탈인지와 그 조치는 서면으로 정하며,
        대장은 그 결정과 문서번호를 붙들어 둡니다.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${uid}-occurred_on`}>발생일</label>
          <input id={`${uid}-occurred_on`} type="date" name="occurred_on" required defaultValue={today} className="input" />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-work_order_id`}>관련 배치</label>
          <select id={`${uid}-work_order_id`} name="work_order_id" className="input" defaultValue="">
            <option value="">해당 없음</option>
            {opts.batches.map((b) => (
              <option key={b.id} value={b.id}>{b.batch_no}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3">
        <label className="label" htmlFor={`${uid}-title`}>무엇이 일어났는가</label>
        <input id={`${uid}-title`} name="title" required autoComplete="off" maxLength={200} className="input"
               placeholder="한 줄로 적습니다" />
      </div>

      <div className="mt-3">
        <label className="label" htmlFor={`${uid}-detail`}>경위 <span className="text-faint">(선택)</span></label>
        <textarea id={`${uid}-detail`} name="detail" rows={3} className="input" />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor={`${uid}-product_lot_id`}>제품 로트 <span className="text-faint">(선택)</span></label>
          <select id={`${uid}-product_lot_id`} name="product_lot_id" className="input" defaultValue="">
            <option value="">해당 없음</option>
            {opts.lots.map((l) => <option key={l.id} value={l.id}>{l.lot_no}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-material_lot_id`}>자재 로트 <span className="text-faint">(선택)</span></label>
          <select id={`${uid}-material_lot_id`} name="material_lot_id" className="input" defaultValue="">
            <option value="">해당 없음</option>
            {opts.materials.map((m) => (
              <option key={m.id} value={m.id}>{m.lot_no} · {m.item_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-equipment_id`}>설비 <span className="text-faint">(선택)</span></label>
          <select id={`${uid}-equipment_id`} name="equipment_id" className="input" defaultValue="">
            <option value="">해당 없음</option>
            {opts.equipment.map((e) => (
              <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
            ))}
          </select>
        </div>
      </div>

      <Msg state={state} />

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? '올리는 중' : '대장에 올리기'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
      </div>
    </form>
  );
}

export function DeviationRow({ d, today }: { d: DevRow; today: string }) {
  /* 라벨과 입력을 잇는다 (4차 감사 G2). 같은 부품이 여러 번 그려져도 겹치지 않는다 */
  const uid = useId();

  const [state, action, pending] = useActionState<FormState, FormData>(closeDeviation, {});
  const { open, setOpen } = useDialog(state);

  const on = [
    d.batch_no && `배치 ${d.batch_no}`,
    d.product_lot_no && `제조번호 ${d.product_lot_no}`,
    d.material_lot_no && `자재 ${d.material_lot_no}`,
    d.equipment_code && `설비 ${d.equipment_code}`,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <tr>
        <td className="td font-mono font-bold">{d.deviation_no}</td>
        <td className="td tnum">{d.occurred_on}</td>
        <td className="td">
          <div className="text-ink">{d.title}</div>
          {on && <div className="mt-0.5 text-xs text-muted">{on}</div>}
        </td>
        <td className="td">
          {d.is_open
            ? <Tag tone="warn">종결 전</Tag>
            : <div className="text-xs leading-relaxed">
                <div className="font-mono text-ink">{d.report_no}</div>
                <div className="text-muted">{d.approved_by} · {d.closed_on}</div>
              </div>}
        </td>
        <td className="td text-right">
          {d.is_open && (
            <button onClick={() => setOpen(true)} className="btn-ghost h-8 px-3 text-xs">
              종결 기록
            </button>
          )}
        </td>
      </tr>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`${d.deviation_no} 종결 기록`}
        note="서면 일탈 보고서에 이미 적힌 값을 그대로 옮겨 적습니다. 한 번 적으면 고칠 수 없습니다."
      >
        <form action={action} className="space-y-3">
          <input type="hidden" name="id" value={d.id} />

          <div className="rounded-lg border border-line bg-surface p-3">
            <p className="text-xs font-semibold text-ink">{d.title}</p>
            {d.detail && <p className="mt-1 text-xs leading-relaxed text-muted">{d.detail}</p>}
          </div>

          <div>
            <label className="label" htmlFor={`${uid}-report_no`}>서면 일탈 보고서 번호</label>
            <input id={`${uid}-report_no`} name="report_no" required autoComplete="off" className="input font-mono" />
          </div>

          <div>
            <label className="label" htmlFor={`${uid}-outcome`}>서면에 적힌 결론</label>
            <textarea id={`${uid}-outcome`} name="outcome" required rows={3} className="input"
                      placeholder="보고서의 결론을 그대로 옮겨 적습니다" />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor={`${uid}-approved_by`}>승인자</label>
              <input id={`${uid}-approved_by`} name="approved_by" required autoComplete="off" className="input" />
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-approved_on`}>승인일</label>
              <input id={`${uid}-approved_on`} type="date" name="approved_on" required defaultValue={today} className="input" />
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-closed_on`}>종결일</label>
              <input id={`${uid}-closed_on`} type="date" name="closed_on" required defaultValue={today} className="input" />
            </div>
          </div>

          <Msg state={state} />

          <button type="submit" disabled={pending} className="btn-primary w-full">
            {pending ? '적는 중' : '대장에 옮겨 적기'}
          </button>
        </form>
      </Dialog>
    </>
  );
}
