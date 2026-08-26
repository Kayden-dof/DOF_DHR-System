'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { fmtDate } from '@/lib/fmt';
import type { FormState } from '@/lib/forms';
import { Msg, Tag, Caution } from '@/components/ui';
import { createSterilBatch, updateSterilBatch, approveRelease, ship } from './actions';

export interface PlOpt {
  id: string; lot_no: string; item_code: string; item_name: string;
  qty_available: number; batch_no: string; status: string;
  expiry_date: string; manufactured_on: string;
  release_approved_by: string | null; release_approved_on: string | null;
  shipped: number;
}
export interface SbRow {
  id: string; batch_no: string; request_no: string | null; vendor_name: string;
  shipped_at: string | null; received_at: string | null; cert_no: string | null;
  lots: { lot_no: string; item_code: string; item_name: string; qty: number }[];
  total: number;
}

/* 멸균 발송은 50개(25ea 2줄) 박스 단위다. 박스 수를 같이 보여 준다. */
const BOX = 50;

/**
 * 규격별로 몇 개인지 묶는다.
 *
 * 제품 규격은 재단에서야 정해진다. 그래서 멸균은 "제품 로트 몇 건"이 아니라
 * "어느 규격 몇 개"로 나가야 위탁 업체와 수량을 맞출 수 있고, 회수 때 대조도
 * 그 단위로 한다. 제품 로트 하나가 규격 하나라 로트를 규격으로 모으면 된다.
 */
function bySpec(rows: { item_code: string; item_name: string; qty: number }[]) {
  const m = new Map<string, { code: string; name: string; qty: number }>();
  for (const r of rows) {
    const cur = m.get(r.item_code);
    if (cur) cur.qty += r.qty;
    else m.set(r.item_code, { code: r.item_code, name: r.item_name, qty: r.qty });
  }
  return [...m.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function SterilForm({ lots, today }: { lots: PlOpt[]; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createSterilBatch, {});
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, number>>({});

  const total = Object.values(picked).reduce((s, n) => s + n, 0);
  const boxes = Math.ceil(total / BOX);

  // 고른 로트를 규격으로 모아 둔다. 발송 전에 규격별 수량이 눈에 보여야
  // 의뢰서에 그대로 옮겨 적을 수 있다.
  const specSummary = bySpec(
    lots
      .filter((l) => (picked[l.id] ?? 0) > 0)
      .map((l) => ({ item_code: l.item_code, item_name: l.item_name, qty: picked[l.id] })));

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-2">
        <button onClick={() => setOpen(true)} className="btn-primary" disabled={lots.length === 0}>
          멸균 배치 만들기
        </button>
        <div className="max-w-md"><Msg state={state} /></div>
      </div>
    );
  }

  return (
    <form action={action} className="card w-full p-4">
      <h3 className="text-sm font-bold text-ink">멸균 위탁 발송</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        한 박스에 여러 제품 로트가 들어갈 수 있습니다. 파괴검사용 2개를 박스에 동봉하는 것은
        재단 시 샘플 수량에 이미 반영되어 있습니다.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">위탁 업체</label>
          <input name="vendor_name" required autoComplete="off" className="input" />
        </div>
        <div>
          <label className="label">의뢰서 번호</label>
          <input name="request_no" autoComplete="off" className="input font-mono" />
        </div>
      </div>

      <p className="label mt-4">동봉할 제품 로트</p>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th w-10" />
              <th className="th">제조번호</th>
              <th className="th">형명</th>
              <th className="th text-right">보유</th>
              <th className="th text-right">발송 수량</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((l) => (
              <tr key={l.id}>
                <td className="td">
                  <input type="checkbox" name={`lot_${l.id}`}
                         className="size-4 accent-brand"
                         onChange={(e) => setPicked((p) => ({
                           ...p, [l.id]: e.target.checked ? (p[l.id] || l.qty_available) : 0,
                         }))} />
                </td>
                <td className="td font-mono text-xs font-semibold">{l.lot_no}</td>
                <td className="td text-xs">{l.item_name}</td>
                <td className="td tnum text-right text-muted">{l.qty_available}</td>
                <td className="td text-right">
                  <input name={`qty_${l.id}`} type="number" min={1} max={l.qty_available}
                         defaultValue={l.qty_available}
                         onChange={(e) => setPicked((p) => ({
                           ...p, [l.id]: p[l.id] ? Number(e.target.value) : 0,
                         }))}
                         className="input h-9 w-24 tnum text-right text-xs" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="mt-2 rounded-md border border-info/20 bg-info-bg px-3.5 py-3">
          <p className="text-xs text-ink">
            총 <b className="tnum">{total}</b>개. 50개(25ea 2줄) 박스 기준{' '}
            <b className="tnum">{boxes}</b>박스입니다.
          </p>
          <dl className="mt-2 grid gap-x-5 gap-y-1 sm:grid-cols-2">
            {specSummary.map((x) => (
              <div key={x.code} className="flex items-baseline justify-between gap-3 text-xs">
                <dt className="truncate text-muted">
                  {x.name}
                  <span className="ml-1.5 font-mono text-[0.6875rem] text-faint">{x.code}</span>
                </dt>
                <dd className="shrink-0 font-bold tnum text-ink">{x.qty} 개</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <Msg state={state} />

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">만들기</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
      </div>
    </form>
  );
}

export function SterilRow({ sb, today }: { sb: SbRow; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateSterilBatch, {});
  const [open, setOpen] = useState(false);
  const stage = sb.received_at ? '회수 완료' : sb.shipped_at ? '멸균 중' : '준비';

  return (
    <>
      <tr>
        <td className="td font-mono text-xs font-semibold">{sb.batch_no}</td>
        <td className="td text-xs">{sb.vendor_name}</td>
        <td className="td font-mono text-xs text-muted">{sb.request_no ?? ''}</td>
        <td className="td text-xs">
          {/* 규격별로 묶어 보여 준다. 제조번호는 펼쳐 보면 나온다 */}
          {bySpec(sb.lots).map((x) => (
            <div key={x.code} className="flex items-baseline gap-2">
              <span className="font-mono text-[0.6875rem] text-muted">{x.code}</span>
              <span className="tnum font-semibold text-ink">{x.qty}</span>
            </div>
          ))}
        </td>
        <td className="td tnum text-right">{sb.total}</td>
        <td className="td tnum text-xs">{fmtDate(sb.shipped_at)}</td>
        <td className="td tnum text-xs">{fmtDate(sb.received_at)}</td>
        <td className="td font-mono text-xs">{sb.cert_no ?? ''}</td>
        <td className="td">
          <Tag tone={sb.received_at ? 'ok' : sb.shipped_at ? 'brand' : 'quiet'}>{stage}</Tag>
        </td>
        <td className="td text-right">
          <button onClick={() => setOpen((v) => !v)} className="btn-quiet h-8 px-2 text-xs">
            {open ? '닫기' : '기록'}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={10} className="border-b border-line bg-canvas p-4">
            <form action={action} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={sb.id} />
              <div className="w-40">
                <label className="label">발송일</label>
                <input name="shipped_at" type="date" defaultValue={sb.shipped_at ?? today}
                       className="input h-9 tnum text-xs" />
              </div>
              <div className="w-40">
                <label className="label">회수일</label>
                <input name="received_at" type="date" defaultValue={sb.received_at ?? ''}
                       className="input h-9 tnum text-xs" />
              </div>
              <div className="w-48">
                <label className="label">멸균 성적서 번호</label>
                <input name="cert_no" defaultValue={sb.cert_no ?? ''}
                       className="input h-9 font-mono text-xs" />
              </div>
              <div className="w-48">
                <label className="label">의뢰서 번호</label>
                <input name="request_no" defaultValue={sb.request_no ?? ''}
                       className="input h-9 font-mono text-xs" />
              </div>
              <button type="submit" disabled={pending} className="btn-primary h-9 px-3 text-xs">
                저장
              </button>
              <p className="w-full text-xs leading-relaxed text-muted">
                발송일을 적으면 제품 로트가 멸균 중으로, 회수일을 적으면 멸균 회수로 넘어갑니다.
                적합 여부는 서면 성적서로 판정합니다. 시스템은 시점과 번호만 기록합니다.
              </p>
              <div className="w-full"><Msg state={state} /></div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

export function ApproveForm({ lot, today }: { lot: PlOpt; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(approveRelease, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex justify-end gap-2">
        <Link href={`/print/release/${lot.id}`} className="btn-ghost h-8 px-3 text-xs">
          요청서 인쇄
        </Link>
        <button onClick={() => setOpen(true)} className="btn-ghost h-8 px-3 text-xs">
          승인 기록
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="rounded-md border border-line bg-canvas p-3 text-left">
      <input type="hidden" name="id" value={lot.id} />
      <Caution>
        품질책임자는 시스템 계정을 쓰지 않습니다. 서면 요청서에 서명받은 내용을
        그대로 옮겨 적으십시오. 시스템이 판정하는 것이 아닙니다.
      </Caution>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="w-44">
          <label className="label">품질책임자 성명</label>
          <input name="release_approved_by" required autoComplete="off"
                 className="input h-9 text-xs" />
        </div>
        <div className="w-36">
          <label className="label">승인 일자</label>
          <input name="release_approved_on" type="date" defaultValue={today} required
                 className="input h-9 tnum text-xs" />
        </div>
        <button type="submit" disabled={pending} className="btn-primary h-9 px-3 text-xs">
          기록
        </button>
        <button type="button" onClick={() => setOpen(false)}
                className="btn-quiet h-9 px-2 text-xs">닫기</button>
      </div>
      <Msg state={state} />
    </form>
  );
}

export function ShipForm({ lot, today }: { lot: PlOpt; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(ship, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-ghost h-8 px-3 text-xs"
              disabled={lot.qty_available === 0}>
        출고 기록
      </button>
    );
  }

  return (
    <form action={action} className="rounded-md border border-line bg-canvas p-3 text-left">
      <input type="hidden" name="product_lot_id" value={lot.id} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-44">
          <label className="label">거래처</label>
          <input name="customer_name" required autoComplete="off" className="input h-9 text-xs" />
        </div>
        <div className="w-28">
          <label className="label">수량</label>
          <input name="qty" type="number" min={1} max={lot.qty_available}
                 defaultValue={lot.qty_available} required
                 className="input h-9 tnum text-xs" />
        </div>
        <div className="w-36">
          <label className="label">출고일</label>
          <input name="shipped_at" type="date" defaultValue={today} required
                 className="input h-9 tnum text-xs" />
        </div>
        <button type="submit" disabled={pending} className="btn-primary h-9 px-3 text-xs">
          기록
        </button>
        <button type="button" onClick={() => setOpen(false)}
                className="btn-quiet h-9 px-2 text-xs">닫기</button>
      </div>
      <p className="mt-2 text-xs text-muted">
        출하 가능 수량 {lot.qty_available}개를 넘길 수 없습니다.
      </p>
      <Msg state={state} />
    </form>
  );
}
