'use client';

import { useActionState, useId, useState } from 'react';
import { Msg, Caution } from '@/components/ui';
import { Dialog, useDialog } from '@/components/dialog';
import type { FormState } from '@/lib/forms';
import { amendMaterialLot, deleteMaterialLot } from './actions';

/* ---------------------------------------------------------------------------
   자재 로트의 오기를 고친다 (5차 감사 A1)

   전에는 입고 등록이 유일한 입구이고 출구가 없었다. `material_lot_coa_once`
   가 여덟 열을 잠그고 화면에는 고치는 자리가 없어, **한 글자를 틀리면 영구히
   되돌릴 수 없었다.**

   성적서 번호는 서면 성적서와 시스템을 잇는 유일한 고리이고(§11 · S02),
   공급자 로트번호는 동물유래물질 추적의 고리다. 틀리면 계보가 존재하지 않는
   종이를 가리킨다.

   ── 무엇이 여기 없는가 ────────────────────────────────────────────────
   사내 로트번호 · 품목 · 공급자 · 입고 수량은 여기 없다. 고쳐 쓰면 계보가
   뒤집히거나 재고 원장이 어긋나기 때문이고, DB 도 같은 넷을 막는다 (0090).
   수량 정정은 재고 증감으로, 그 밖의 것은 새 로트로 간다.
--------------------------------------------------------------------------- */

export interface AmendLot {
  id: string;
  lot_no: string;
  item_name: string;
  coa_no: string;
  coa_date: string | null;
  supplier_lot_no: string;
  expiry_date: string | null;
  location: string | null;
  unit_price: string | null;
  thickness_band: string | null;
  /** 합격판정일자. 로트번호가 이 날짜로 만들어졌다 (0097) */
  qc_passed_on: string | null;
}

/** YYYY-MM-DD 로 자른다. date 입력이 그 모양만 받는다 */
const day = (v: string | null) => (v ? String(v).slice(0, 10) : '');

export default function AmendLotForm({ lot }: { lot: AmendLot }) {
  const uid = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(amendMaterialLot, {});
  const { open, setOpen } = useDialog(state);
  const [confirm, setConfirm] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)} className="qd-text-action">
        고치기
      </button>
      <Dialog
        open={open}
        onClose={() => { setOpen(false); setConfirm(false); }}
        wide
        title="자재 로트 정정"
        note={<span className="font-mono">{lot.lot_no}</span>}
      >
        <form action={action} className="space-y-3">
          <input type="hidden" name="id" value={lot.id} />

          <Caution>
            {lot.item_name}. 사내 로트번호 · 품목 · 공급자 · 입고 수량은 고칠 수 없습니다.
            고쳐 쓰면 계보가 뒤집히거나 재고 원장이 어긋납니다.
          </Caution>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor={`${uid}-coa_no`}>성적서 번호</label>
              <input id={`${uid}-coa_no`} name="coa_no" required autoComplete="off"
                     defaultValue={lot.coa_no} className="input font-mono" />
              <p className="mt-1 text-xs text-faint">서면 성적서와 잇는 고리입니다.</p>
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-coa_date`}>성적서 일자</label>
              <input id={`${uid}-coa_date`} name="coa_date" type="date" required
                     defaultValue={day(lot.coa_date)} className="input tnum" />
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-qc`}>합격판정일자</label>
              <input id={`${uid}-qc`} name="qc_passed_on" type="date"
                     defaultValue={day(lot.qc_passed_on)} className="input tnum" />
              <p className="mt-1 text-xs text-faint">
                로트번호는 이미 굳어 바뀌지 않습니다. 적힌 날짜만 바로잡습니다.
              </p>
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-slot`}>공급자 로트번호</label>
              <input id={`${uid}-slot`} name="supplier_lot_no" required autoComplete="off"
                     defaultValue={lot.supplier_lot_no} className="input font-mono" />
              <p className="mt-1 text-xs text-faint">동물유래물질 추적의 고리입니다.</p>
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-band`}>두께 구간</label>
              <input id={`${uid}-band`} name="thickness_band" autoComplete="off"
                     defaultValue={lot.thickness_band ?? ''} placeholder="0510"
                     className="input font-mono" />
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-exp`}>유효기한</label>
              <input id={`${uid}-exp`} name="expiry_date" type="date"
                     defaultValue={day(lot.expiry_date)} className="input tnum" />
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-loc`}>보관 위치</label>
              <input id={`${uid}-loc`} name="location" autoComplete="off"
                     defaultValue={lot.location ?? ''} className="input" />
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-price`}>매입 단가</label>
              <input id={`${uid}-price`} name="unit_price" type="number" step="any" min="0"
                     defaultValue={lot.unit_price ?? ''} className="input tnum" />
              <p className="mt-1 text-xs text-faint">사용 단위 기준 공급가액입니다.</p>
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-reason`}>고치는 사유</label>
              <input id={`${uid}-reason`} name="reason" required autoComplete="off"
                     placeholder="예: 입고 등록 시 성적서 번호 오타"
                     className="input" />
            </div>
          </div>

          <p className="text-xs leading-relaxed text-muted">
            바꾼 사실과 이전 값은 감사추적에 남습니다.
            <b className="text-ink"> 이미 인쇄된 자재 라벨과 지시서는 바뀌지 않습니다.</b>
          </p>

          <Msg state={state} />

          {!confirm ? (
            <button type="button" onClick={() => setConfirm(true)}
                    className="btn-ghost w-full">
              고친 내용 확인
            </button>
          ) : (
            <div className="flex gap-2">
              <button type="submit" disabled={pending} className="btn-primary flex-1">
                {pending ? '고치는 중' : '고친다'}
              </button>
              <button type="button" onClick={() => setConfirm(false)}
                      className="btn-ghost flex-1">
                취소
              </button>
            </div>
          )}
        </form>
      </Dialog>
    </>
  );
}

/*
 * 자재 로트 지우기 (0124). 사내 로트번호는 고쳐 쓸 수 없어(0052) 잘못 매긴 번호는
 * 지우고 다시 입고한다. 되돌릴 수 없으므로 한 번 더 묻는다. 배치에 투입된 로트에는
 * 부르는 쪽이 이 단추를 내지 않는다.
 */
export function DeleteLotForm({ lot }: { lot: { id: string; lot_no: string; item_name: string } }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deleteMaterialLot, {});
  const { open, setOpen } = useDialog(state);

  return (
    <>
      <button onClick={() => setOpen(true)} className="qd-text-action qd-text-action--danger">
        지우기
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="자재 로트 지우기"
              note={<span className="font-mono">{lot.lot_no}</span>}>
        <form action={action}>
          <input type="hidden" name="id" value={lot.id} />
          <p className="text-sm leading-relaxed text-ink">
            {lot.item_name} 로트 <span className="font-mono">{lot.lot_no}</span> 을(를) 지웁니다.
            되돌릴 수 없고, 지운 내용은 감사추적에 남습니다.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            라벨을 인쇄한 로트는 인쇄 대장이 가리키고 있어 지워지지 않습니다.
          </p>
          <Msg state={state} />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost h-9">
              그만두기
            </button>
            <button type="submit" disabled={pending} className="btn-danger h-9">
              {pending ? '지우는 중' : '지우기'}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
