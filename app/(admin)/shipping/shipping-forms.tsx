'use client';

import { Fragment, useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { fmtDate } from '@/lib/fmt';
import type { FormState } from '@/lib/forms';
import { Msg, Tag, Caution } from '@/components/ui';
import { createSterilBatch, updateSterilBatch, approveRelease, ship } from './actions';

export interface PlOpt {
  id: string; lot_no: string; item_code: string; item_name: string;
  qty_available: number; batch_no: string; wo_id: string; status: string;
  expiry_date: string; manufactured_on: string;
  release_approved_by: string | null; release_approved_on: string | null;
  shipped: number;
  /** 완제품검사 시료 수량. 앞 번호부터 빠진다 */
  qty_sample: number;
  /** 다음에 내보낼 첫 개체 순번 */
  next_unit: number;
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
        <td className="td whitespace-nowrap text-xs">{sb.vendor_name}</td>
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

/* ---------------------------------------------------------------------------
   출하 승인 요청서 발행

   배치에서 생산된 규격들을 보여 주고, 미출고 잔여 중 무엇을 몇 개 요청할지
   골라 요청서 한 장을 발행한다. 골라진 내용이 그대로 종이에 실리고, 요청서
   번호(RR-배치번호-회차)는 발행되는 순간 종이에 찍힌다.

   수량 상한은 잔여다. 잔여보다 큰 요청은 화면에서부터 만들 수 없다 - 이건
   기록 차단이 아니라 인쇄 요청의 형식이다.
--------------------------------------------------------------------------- */
export function RequestBuilder({ groups }: {
  groups: { wo_id: string; batch_no: string; item_name: string; lots: PlOpt[] }[];
}) {
  const router = useRouter();
  // 배치별 선택 상태. 로트 id -> 요청 수량 (0 이면 뺀 것)
  const [qty, setQty] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const g of groups) {
      for (const l of g.lots) {
        // 승인 안 된 로트는 잔여 전량으로 미리 골라 둔다. 흔한 경우를 기본값으로
        init[l.id] = l.release_approved_by ? 0 : l.qty_available;
      }
    }
    return init;
  });

  const set = (id: string, v: number, max: number) =>
    setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(max, Math.floor(v) || 0)) }));

  return (
    <div className="divide-y divide-line-soft">
      {groups.map((g) => {
        const picked = g.lots.filter((l) => (qty[l.id] ?? 0) > 0);
        const total = picked.reduce((a, l) => a + qty[l.id], 0);
        const sel = picked.map((l) => `${l.id}:${qty[l.id]}`).join(',');
        return (
          <div key={g.wo_id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-sm font-bold text-ink">{g.batch_no}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted">{g.item_name}</span>
              <button
                type="button"
                disabled={picked.length === 0}
                onClick={() => router.push(`/print/release-request/${g.wo_id}?sel=${sel}`)}
                className="btn-primary h-9 px-4 text-xs"
              >
                요청서 발행{picked.length > 0 && <> · {picked.length}건 {total}개</>}
              </button>
            </div>

            <ul className="mt-2 space-y-1.5">
              {g.lots.map((l) => {
                const v = qty[l.id] ?? 0;
                const on = v > 0;
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => set(l.id, e.target.checked ? l.qty_available : 0, l.qty_available)}
                        className="size-4 shrink-0 accent-brand"
                      />
                      <span className={`font-mono text-[0.8125rem] font-bold ${on ? 'text-ink' : 'text-faint'}`}>
                        {l.lot_no}
                      </span>
                      <span className="min-w-0 truncate text-xs text-muted">{l.item_name}</span>
                      {l.release_approved_by && <Tag tone="ok">승인됨</Tag>}
                    </label>
                    <span className="tnum text-xs text-muted">잔여 {l.qty_available}</span>
                    <input
                      type="number"
                      min={0}
                      max={l.qty_available}
                      value={on ? v : ''}
                      placeholder="0"
                      onChange={(e) => set(l.id, Number(e.target.value), l.qty_available)}
                      className="input h-8 w-20 text-right text-xs tnum"
                      aria-label={`${l.lot_no} 요청 수량`}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function ApproveForm({ lot, today }: { lot: PlOpt; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(approveRelease, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-ghost h-8 px-3 text-xs">
        승인 기록
      </button>
    );
  }

  return (
    <form action={action} className="rounded-md border border-line bg-canvas p-3 text-left">
      <input type="hidden" name="id" value={lot.id} />
      <Caution>
        품질책임자는 시스템 계정을 쓰지 않습니다. 서면 요청서에 서명받은 내용을
        그대로 옮겨 입력하십시오. 시스템이 판정하는 것이 아닙니다.
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


/* ---------------------------------------------------------------------------
   출고 가능 목록 · 행을 누르면 아래로 입력칸이 펼쳐진다

   처음에는 행 끝 "출고 기록" 단추가 옆으로 좁은 폼을 열었다. 칸이 눌려서
   읽기도 쓰기도 어려웠다 (사용자 지적). 행 전체를 누르게 하고, 입력은 그 행
   바로 아래에 표 전체 폭으로 펼친다.

   출하 승인서 번호는 필수다. DB 트리거가 같은 것을 막고 있고 (0026), 여기의
   required 는 그 규칙을 먼저 안내하는 것뿐이다.
--------------------------------------------------------------------------- */
export function ShipList({ lots, today }: { lots: PlOpt[]; today: string }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr>
            <th className="th">제조번호</th>
            <th className="th">형명</th>
            <th className="th">배치</th>
            <th className="th text-right">출하 가능</th>
            <th className="th text-right">기출고</th>
            <th className="th">유효기한</th>
            <th className="th">승인</th>
            <th className="th w-0" />
          </tr>
        </thead>
        <tbody>
          {lots.map((l) => {
            const open = openId === l.id;
            const days = Math.round(
              (new Date(l.expiry_date).getTime() - Date.now()) / 864e5);
            return (
              <Fragment key={l.id}>
                <tr
                  onClick={() => setOpenId(open ? null : l.id)}
                  aria-expanded={open}
                  className={`cursor-pointer ${open ? 'bg-brand-soft/60' : ''}`}
                >
                  <td className="td font-mono text-xs font-semibold">{l.lot_no}</td>
                  <td className="td">
                    <div className="text-sm">{l.item_name}</div>
                    <div className="font-mono text-xs text-faint">{l.item_code}</div>
                  </td>
                  <td className="td font-mono text-xs text-muted">{l.batch_no}</td>
                  <td className="td tnum text-right font-semibold">{l.qty_available}</td>
                  <td className="td tnum text-right text-muted">{l.shipped || ''}</td>
                  <td className="td tnum text-xs">
                    <span className={days <= 60 ? 'font-semibold text-warn' : ''}>
                      {fmtDate(l.expiry_date)}
                    </span>
                    <span className="ml-1 text-faint">{days}일</span>
                  </td>
                  <td className="td text-xs">
                    {l.release_approved_by}
                    <div className="tnum text-faint">{fmtDate(l.release_approved_on)}</div>
                  </td>
                  <td className="td text-right">
                    <span aria-hidden
                          className={`inline-block text-faint transition-transform ${
                            open ? 'rotate-90 text-brand' : ''}`}>
                      &rsaquo;
                    </span>
                  </td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={8} className="border-b border-line bg-canvas p-0">
                      <ShipRowForm lot={l} today={today} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ShipRowForm({ lot, today }: { lot: PlOpt; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(ship, {});
  /*
   * 수량과 시작 순번이 끝 순번을 정한다. 사람이 셋을 따로 적으면 반드시
   * 어긋나므로 끝 번호는 계산해서 보여 주기만 한다.
   */
  const [qty, setQty] = useState(String(lot.qty_available));
  const [from, setFrom] = useState(String(lot.next_unit));
  const unitTo = (Number(from) || 1) + (Number(qty) || 1) - 1;

  return (
    <form action={action} className="px-5 py-4">
      <input type="hidden" name="product_lot_id" value={lot.id} />
      <p className="text-sm font-semibold text-ink">
        <span className="font-mono">{lot.lot_no}</span> 출고 기록
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="label">출하 승인서 번호 (필수)</label>
          <input name="release_request_no" required autoComplete="off"
                 placeholder={`RR-${lot.batch_no}-01`}
                 className="input font-mono" />
        </div>
        <div>
          <label className="label">거래처</label>
          <input name="customer_name" required autoComplete="off" className="input" />
        </div>
        <div>
          <label className="label">수량 (최대 {lot.qty_available})</label>
          <input name="qty" type="number" min={1} max={lot.qty_available}
                 value={qty} onChange={(e) => setQty(e.target.value)}
                 required className="input tnum" />
        </div>
        {/*
          * 나가는 개체 순번. 라벨에 개체마다 다른 번호가 찍히므로 어느 번호가
          * 어디로 갔는지를 여기서 적는다. 시료는 앞 번호부터 빠지고 (§ 0042),
          * 이미 나간 범위는 건너뛴 다음 번호가 미리 채워진다.
          *
          * 겹치거나 로트를 벗어나면 DB 가 막는다. 한 개체가 두 곳으로 갈 수 없다.
          */}
        <div>
          <label className="label">개체 순번</label>
          <div className="flex items-center gap-1.5">
            <input name="unit_from" type="number" min={1} required
                   value={from} onChange={(e) => setFrom(e.target.value)}
                   className="input w-20 tnum" />
            <span className="text-sm text-muted">~</span>
            <input name="unit_to" type="number" min={1} required readOnly
                   value={unitTo} className="input w-20 tnum bg-canvas" />
          </div>
        </div>
        <div>
          <label className="label">출고일</label>
          <input name="shipped_at" type="date" defaultValue={today} required
                 className="input tnum" />
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={pending} className="btn-primary w-full">
            {pending ? '기록 중' : '출고 기록'}
          </button>
        </div>
        <p className="text-xs leading-relaxed text-muted sm:col-span-3 lg:col-span-5">
          라벨에는 <span className="font-mono">{lot.lot_no}-{String(from).padStart(3, '0')}</span>
          {' '}부터 <span className="font-mono">{lot.lot_no}-{String(unitTo).padStart(3, '0')}</span>
          {' '}까지 찍힙니다. 앞 <b className="tnum text-ink">{lot.qty_sample ?? 0}</b>개는
          완제품검사 시료로 빠집니다.
        </p>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        서면 승인이 끝난 요청서의 번호를 옮겨 기재합니다. 번호 없이는 기록되지 않습니다.
      </p>
      <Msg state={state} />
    </form>
  );
}
