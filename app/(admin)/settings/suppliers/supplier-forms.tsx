'use client';

import { useActionState, useState } from 'react';
import { isPastKST } from '@/lib/kst';
import { fmtDate } from '@/lib/fmt';
import { SUPPLIER_STATUS, type FormState } from '@/lib/forms';
import { Msg, Tag } from '@/components/ui';
import { Dialog, useDialog } from '@/components/dialog';
import { saveSupplier, savePrice, saveShelfLife } from './actions';

export interface SupplierRow {
  id: string; code: string; name: string; status: string;
  approved_until: string | null;
  contact_name: string | null; contact_phone: string | null; contact_email: string | null;
  biz_no: string | null; address: string | null; payment_terms: string | null; note: string | null;
  item_count: number; lot_count: number;
}

export interface ItemOption { id: string; code: string; name: string; usage_uom: string; type: string }

const statusOf = (c: string) => SUPPLIER_STATUS.find((s) => s.code === c);

function Fields({ s }: { s?: SupplierRow }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {!s && (
        <div>
          <label className="label">공급자 코드</label>
          <input name="code" required autoComplete="off" placeholder="SUP-001"
                 className="input font-mono" />
        </div>
      )}
      <div className={s ? 'lg:col-span-2' : ''}>
        <label className="label">상호</label>
        <input name="name" required defaultValue={s?.name} autoComplete="off" className="input" />
      </div>
      <div>
        <label className="label">승인 상태</label>
        <select name="status" defaultValue={s?.status ?? 'PENDING'} className="input">
          {SUPPLIER_STATUS.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
        </select>
      </div>
      <div>
        <label className="label">승인 만료일</label>
        <input name="approved_until" type="date" defaultValue={s?.approved_until ?? ''}
               className="input tnum" />
      </div>
      <div>
        <label className="label">담당자</label>
        <input name="contact_name" defaultValue={s?.contact_name ?? ''} className="input" />
      </div>
      <div>
        <label className="label">연락처</label>
        <input name="contact_phone" defaultValue={s?.contact_phone ?? ''} className="input tnum" />
      </div>
      <div>
        <label className="label">이메일</label>
        <input name="contact_email" type="email" defaultValue={s?.contact_email ?? ''} className="input" />
      </div>
      <div>
        <label className="label">사업자번호</label>
        <input name="biz_no" defaultValue={s?.biz_no ?? ''} className="input tnum" />
      </div>
      <div className="lg:col-span-2">
        <label className="label">주소</label>
        <input name="address" defaultValue={s?.address ?? ''} className="input" />
      </div>
      <div>
        <label className="label">결제 조건</label>
        <input name="payment_terms" defaultValue={s?.payment_terms ?? ''} className="input" />
      </div>
      <div className="lg:col-span-4">
        <label className="label">비고</label>
        <input name="note" defaultValue={s?.note ?? ''} className="input" />
      </div>

      {/*
        * 왜 바꾸는가. 고칠 때만 묻는다 - 새로 등록하는 것은 만든 것 자체가
        * 사유다 (3차 검수 결함 7).
        *
        * 감사추적에 남는다. 비워 두어도 저장되지만, 나중에 "이 공급자는 왜
        * 정지되었나" 를 물었을 때 답이 없다.
        */}
      {s && (
        <div className="lg:col-span-4">
          <label className="label" htmlFor={`why-${s.id}`}>변경 사유</label>
          <input id={`why-${s.id}`} name="change_reason" className="input"
                 placeholder="예: 정기 재평가 결과 · 실사 지적 · 계약 갱신" />
          <p className="mt-1 text-xs text-faint">
            감사추적에 함께 남습니다. 비워 두어도 저장됩니다.
          </p>
        </div>
      )}
    </div>
  );
}

export function NewSupplierForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSupplier, {});
  const { open, setOpen } = useDialog(state);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary">공급자 등록</button>
      <Dialog open={open} onClose={() => setOpen(false)} wide title="공급자 등록">
        <form action={action}>
      <h3 className="mb-3 text-sm font-bold text-ink">새 공급자</h3>
      <Fields />
      <p className="mt-3 rounded-md bg-canvas px-3 py-2 text-xs leading-relaxed text-muted">
        미승인 공급자의 자재도 등록과 사용을 막지 않습니다. 작업 지시 발행 화면에서
        <b className="text-ink"> 경고로만 </b>표시합니다. 차단은 S01~S05 다섯 가지뿐입니다.
      </p>
      <Msg state={state} />
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">등록</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
      </div>
        </form>
      </Dialog>
    </>
  );
}

export function SupplierRowView({ s }: { s: SupplierRow }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSupplier, {});
  const { open, setOpen } = useDialog(state);
  const st = statusOf(s.status);
  /* 날짜는 글자끼리 견준다. Date 로 바꾸면 자정 언저리에 하루 어긋난다 (lib/kst) */
  const expired = isPastKST(s.approved_until);

  return (
    <>
      <tr>
        <td className="td font-mono text-xs font-semibold">{s.code}</td>
        <td className="td">{s.name}</td>
        <td className="td">
          <Tag tone={st?.tone ?? 'quiet'}>{st?.label ?? s.status}</Tag>
          {expired && <Tag tone="danger">승인 만료</Tag>}
        </td>
        <td className="td tnum text-xs text-muted">{fmtDate(s.approved_until)}</td>
        <td className="td text-xs text-muted">
          {s.contact_name}
          {s.contact_phone ? ` · ${s.contact_phone}` : ''}
        </td>
        <td className="td tnum text-right text-muted">{s.lot_count || ''}</td>
        <td className="td text-right">
          <button onClick={() => setOpen(true)} className="btn-quiet h-8 px-2 text-xs">
            수정
          </button>
        </td>
      </tr>
      <Dialog open={open} onClose={() => setOpen(false)} wide
              title="공급자 수정"
              note={<><span className="font-mono">{s.code}</span> · {s.name}</>}>
        <form action={action}>
          <input type="hidden" name="id" value={s.id} />
          <Fields s={s} />
          <Msg state={state} />
          <div className="mt-3">
            <button type="submit" disabled={pending} className="btn-primary w-full">
              {pending ? '저장하는 중' : '저장'}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------------------- */

export function PriceForm({ items, suppliers, today }: {
  items: ItemOption[]; suppliers: SupplierRow[]; today: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(savePrice, {});
  return (
    <form action={action} className="p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label className="label">품목</label>
          <select name="item_id" required className="input">
            {items.filter((i) => i.type !== 'FIN').map((i) => (
              <option key={i.id} value={i.id}>{i.code} · {i.name} ({i.usage_uom})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">공급자</label>
          <select name="supplier_id" required className="input">
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">단가</label>
            <input name="price" type="number" step="any" min="0" required className="input tnum" />
          </div>
          <div>
            <label className="label">적용일</label>
            <input name="effective_from" type="date" defaultValue={today} required className="input tnum" />
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        사용 단위 기준 공급가액입니다. 이전 단가는 이력으로 남고 지워지지 않습니다.
      </p>
      <Msg state={state} />
      <div className="mt-3">
        <button type="submit" disabled={pending} className="btn-primary">단가 등록</button>
      </div>
    </form>
  );
}

export function ShelfLifeForm({ items, today }: { items: ItemOption[]; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveShelfLife, {});
  const fin = items.filter((i) => i.type === 'FIN');
  return (
    <form action={action} className="p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <label className="label">완제품 형명</label>
          <select name="item_id" required className="input">
            {fin.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">사용기간(개월)</label>
          <input name="months" type="number" min="1" required className="input tnum" />
        </div>
        <div>
          <label className="label">적용일</label>
          <input name="effective_from" type="date" defaultValue={today} required className="input tnum" />
        </div>
        <div>
          <label className="label">안정성 시험 보고서</label>
          <input name="study_report_no" required autoComplete="off"
                 placeholder="STB-2026-001" className="input font-mono" />
        </div>
      </div>
      <p className="mt-3 rounded-md bg-warn-bg px-3 py-2 text-xs leading-relaxed text-ink">
        <b>이미 만들어진 제품 로트의 유효기한은 바뀌지 않습니다.</b> 유효기한은 로트 생성
        시점 값으로 고정되고 참조한 이력 행도 함께 남습니다. 여기서 등록한 값은
        <b> 이후에 재단되는 로트부터 </b>적용됩니다.
      </p>
      <Msg state={state} />
      <div className="mt-3">
        <button type="submit" disabled={pending || fin.length === 0} className="btn-primary">
          사용기간 등록
        </button>
      </div>
      {fin.length === 0 && (
        <p className="mt-2 text-xs text-faint">완제품 형명을 먼저 생성하십시오.</p>
      )}
    </form>
  );
}
