'use client';

import { useActionState, useId } from 'react';
import { Msg, Caution } from '@/components/ui';
import type { FormState } from '@/lib/forms';
import { returnSolutionInput, addSolutionInput } from './actions';

/* ---------------------------------------------------------------------------
   원액의 원료 줄 바로잡기 (§2.1)

   원료 줄은 고쳐 쓰지 않는다. 틀리게 적었으면 같은 원액을 가리키는 줄을 더한다.

     되돌리기   잘못 고른 원료 · 많이 적은 수량. 원료 재고가 돌아온다
     더하기     실제로 썼는데 빠뜨린 원료. 원료 재고에서 빠지고 원액에 이어진다

   제조일은 고칠 수 없다. 원액을 비우고 원료 줄을 모두 되돌린 뒤 다시 만든다 -
   그 순서를 화면이 한 줄로 적는다.

   원액 추적 화면의 원료 표 아래에 접어 둔다. 펼치지 않아도 폼은 화면에 있다.
   생산관리자 · 시스템관리자에게만 그린다 - 액션도 같은 역할을 다시 묻는다.
--------------------------------------------------------------------------- */

/** 지금 이 원액에 들어가 있는 원료 (원료 표와 같은 값) */
export interface SolutionInputOpt {
  material_lot_id: string; material_lot_no: string; item_name: string;
  usage_uom: string; qty: string;
}

/** 더할 수 있는 로트. 잔여가 있는 것 */
export interface RawLotOpt {
  id: string; lot_no: string; item_name: string; usage_uom: string; qty_available: string;
}

export default function SolutionCorrectForm({ solutionId, inputs, lots }: {
  solutionId: string;
  inputs: SolutionInputOpt[];
  lots: RawLotOpt[];
}) {
  const uid = useId();
  const [backState, backAction, backPending] =
    useActionState<FormState, FormData>(returnSolutionInput, {});
  const [addState, addAction, addPending] =
    useActionState<FormState, FormData>(addSolutionInput, {});

  return (
    <details className="border-t border-line">
      <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-muted hover:bg-canvas">
        원료 줄 바로잡기
        <span className="ml-2 font-normal text-faint">잘못 고른 원료 · 빠뜨린 원료 · 제조일 오기</span>
      </summary>

      <div className="space-y-4 px-4 pb-4 pt-2">
        <Caution>
          원료 줄은 고쳐 쓰지 않습니다. 되돌리거나 더한 줄이 원래 줄 옆에 남고, 위 표는
          그 합을 보여 줍니다. 원액 단가는 만들 때 정한 값 그대로입니다.
        </Caution>

        <div className="grid gap-4 lg:grid-cols-2">
          <form action={backAction} className="space-y-3 rounded-md border border-line p-3">
            <input type="hidden" name="solution_lot_id" value={solutionId} />
            <div>
              <p className="text-sm font-semibold text-ink">되돌리기</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                잘못 고른 원료나 많이 적은 수량. 그만큼 원료 로트의 재고로 돌아갑니다.
              </p>
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-return_lot_id`}>원료 로트</label>
              <select id={`${uid}-return_lot_id`} name="return_lot_id" required
                      disabled={inputs.length === 0} className="input text-xs">
                {inputs.map((x) => (
                  <option key={x.material_lot_id} value={x.material_lot_id}>
                    {x.material_lot_no} · {x.item_name} (사용량 {Number(x.qty)} {x.usage_uom})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor={`${uid}-back-qty`}>되돌릴 수량</label>
                <input id={`${uid}-back-qty`} name="qty" type="number" step="any" min="0" required
                       className="input tnum" />
              </div>
              <div>
                <label className="label" htmlFor={`${uid}-back-reason`}>사유</label>
                <input id={`${uid}-back-reason`} name="reason" required autoComplete="off"
                       placeholder="예: 원료 로트를 잘못 고름" className="input" />
              </div>
            </div>
            <Msg state={backState} />
            <button type="submit" disabled={backPending || inputs.length === 0}
                    className="btn-primary">
              되돌리기
            </button>
          </form>

          <form action={addAction} className="space-y-3 rounded-md border border-line p-3">
            <input type="hidden" name="solution_lot_id" value={solutionId} />
            <div>
              <p className="text-sm font-semibold text-ink">더하기</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                실제로 썼는데 빠뜨린 원료. 그 로트의 재고에서 빠지고 이 원액에 이어집니다.
              </p>
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-add_lot_id`}>원료 로트</label>
              <select id={`${uid}-add_lot_id`} name="add_lot_id" required
                      disabled={lots.length === 0} className="input text-xs">
                {lots.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.lot_no} · {l.item_name} (잔여 {Number(l.qty_available)} {l.usage_uom})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor={`${uid}-add-qty`}>더할 수량</label>
                <input id={`${uid}-add-qty`} name="qty" type="number" step="any" min="0" required
                       className="input tnum" />
              </div>
              <div>
                <label className="label" htmlFor={`${uid}-add-reason`}>사유</label>
                <input id={`${uid}-add-reason`} name="reason" required autoComplete="off"
                       placeholder="예: 원료 한 줄을 빠뜨림" className="input" />
              </div>
            </div>
            <Msg state={addState} />
            <button type="submit" disabled={addPending || lots.length === 0}
                    className="btn-primary">
              더하기
            </button>
          </form>
        </div>

        <p className="text-xs leading-relaxed text-muted">
          제조일을 잘못 적었으면 재고 증감에서 이 원액을 재고 폐기로 비우고, 위에서 원료
          줄을 모두 되돌린 뒤, 원액 제조에서 다시 만드십시오. 이 원액 로트와 번호는 그대로
          남습니다.
        </p>
      </div>
    </details>
  );
}
