'use client';

import { Fragment, useActionState, useState, useId } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { fmtDate } from '@/lib/fmt';
import { daysUntilKST } from '@/lib/kst';
import type { FormState } from '@/lib/forms';
import { Msg, Tag, Caution } from '@/components/ui';
import { PL_STATUS_LABEL } from '@/lib/forms';
import Toasts from '@/components/toast';
import { Unblock } from '@/components/unblock';
import type { Fix } from '@/lib/unblock';
import { createSterilBatch, updateSterilBatch, approveRelease, ship, relinkShipment } from './actions';
import { Dialog, useDialog } from '@/components/dialog';
import type { SpecRow } from '@/lib/ship-check';

export interface PlOpt {
  id: string; lot_no: string; item_code: string; item_name: string;
  qty_available: number; batch_no: string; wo_id: string; status: string;
  expiry_date: string; manufactured_on: string;
  release_approved_by: string | null; release_approved_on: string | null;
  shipped: number;
  /** 완제품검사 시료 수량. 앞 번호부터 빠진다 */
  qty_sample?: number;
  /** 이 배치로 나간 출하 승인 요청서 번호 (0111 · 0160 부터 쓰지 않음) */
  requests?: string[];
  /** 멸균 보고서 번호 (회수된 멸균 위탁 · 0160). 있어야 출고한다 */
  report?: string | null;
}
export interface SbRow {
  id: string; batch_no: string; request_no: string | null; vendor_name: string;
  shipped_at: string | null; received_at: string | null; cert_no: string | null;
  lots: { lot_no: string; item_code: string; item_name: string; qty: number }[];
  total: number;
}

/*
 * 멸균 발송 박스 수량은 제품표준서가 정한다 (M5-1 · §2.0).
 *
 * 전에는 `const BOX = 50` 으로 여기 박혀 있었다. 50개(25ea 2줄)는 DX2401 의
 * 위탁 조건이지 프로그램의 성질이 아니다. 위탁 조건이 바뀌면 코드를 고쳐야
 * 했다.
 *
 * 값이 없으면 박스 수를 세지 않는다. 지어내지 않는다.
 */

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

export function SterilForm({ lots, today, boxQty, fix }: {
  lots: PlOpt[]; today: string; boxQty: number | null;
  /** 보낼 로트가 없을 때 가는 자리 (lib/unblock.ts) */
  fix?: Fix;
}) {
  /* 라벨과 입력을 잇는다 (4차 감사 G2). 같은 부품이 여러 번 그려져도 겹치지 않는다 */
  const uid = useId();

  const [state, action, pending] = useActionState<FormState, FormData>(createSterilBatch, {});
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, number>>({});

  const total = Object.values(picked).reduce((s, n) => s + n, 0);
  const boxes = boxQty && boxQty > 0 ? Math.ceil(total / boxQty) : null;

  // 고른 로트를 규격으로 모아 둔다. 발송 전에 규격별 수량이 눈에 보여야
  // 의뢰서에 그대로 옮겨 적을 수 있다.
  const specSummary = bySpec(
    lots
      .filter((l) => (picked[l.id] ?? 0) > 0)
      .map((l) => ({ item_code: l.item_code, item_name: l.item_name, qty: picked[l.id] })));

  if (!open) {
    /*
     * 막힌 까닭은 단추 «왼쪽»에 둔다 (사용자 2026-11-10 «화면 위치 통일성»). 아래에 두면
     * 화면 머리가 아래 끝에 맞춰 서므로 이 화면만 단추가 제목 높이로 올라갔다.
     */
    return (
      <div className="flex flex-row-reverse flex-wrap items-end gap-x-4 gap-y-2">
        <button onClick={() => setOpen(true)} className="btn-primary" disabled={lots.length === 0}>
          멸균 배치 만들기
        </button>
        {lots.length === 0 && (
          <Unblock fix={fix} why="포장을 마친 제품 로트가 없습니다. 포장까지 기록된 로트만 고를 수 있습니다."
                   todo="작업 지시 보기" />
        )}
      {/*
        * 결과는 화면 오른쪽 위에 띄운다. 여기 아래에 붙이면 뒤 내용이 밀린다
        * (사용자 지시 2026-09-08).
        */}
      <Toasts states={[state]} />
      </div>
    );
  }

  return (
    <form action={action} className="card w-full py-4">
      <h3 className="text-sm font-semibold text-ink">멸균 위탁 발송</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        한 박스에 여러 제품 로트가 들어갈 수 있습니다. 파괴검사용 2개를 박스에 동봉하는 것은
        제조번호를 붙일 때 시료 수량에 이미 반영되어 있습니다.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${uid}-vendor_name`}>위탁 업체</label>
          <input id={`${uid}-vendor_name`} name="vendor_name" required autoComplete="off" className="input" />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-request_no`}>의뢰서 번호</label>
          <input id={`${uid}-request_no`} name="request_no" autoComplete="off" className="input font-mono" />
        </div>
      </div>

      <p className="label mt-4">동봉할 제품 로트</p>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="qd-table qd-table--hangul" data-grow="2">
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
                  {/*
                    * 표 안의 칸에는 제 이름표가 없다. 어느 줄의 것인지 이름에
                    * 담지 않으면 읽어 주는 도구에는 "체크박스" 만 스무 번 들린다.
                    */}
                  <input type="checkbox" name={`lot_${l.id}`}
                         aria-label={`${l.lot_no} 고르기`}
                         className="size-4 accent-brand"
                         onChange={(e) => setPicked((p) => ({
                           ...p, [l.id]: e.target.checked ? (p[l.id] || l.qty_available) : 0,
                         }))} />
                </td>
                <td className="td font-mono font-semibold">{l.lot_no}</td>
                <td className="td ">{l.item_name}</td>
                <td className="td tnum text-right text-muted">{l.qty_available}</td>
                <td className="td text-right">
                  <input name={`qty_${l.id}`} type="number" min={1} max={l.qty_available}
                         aria-label={`${l.lot_no} 수량`}
                         defaultValue={l.qty_available}
                         onChange={(e) => setPicked((p) => ({
                           ...p, [l.id]: p[l.id] ? Number(e.target.value) : 0,
                         }))}
                         className="input w-24 tnum text-right" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="mt-2 rounded-md border border-info/20 bg-info-bg px-3.5 py-3">
          <p className="text-xs text-ink">
            총 <b className="tnum">{total}</b>개.
            {boxes !== null ? (
              <> 박스 한 개 <b className="tnum">{boxQty}</b>개 기준{' '}
                <b className="tnum">{boxes}</b>박스입니다.</>
            ) : (
              <> 박스 수량이 제품표준서에 없어 박스 수는 세지 않습니다.</>
            )}
          </p>
          <dl className="mt-2 grid gap-x-5 gap-y-1 sm:grid-cols-2">
            {specSummary.map((x) => (
              <div key={x.code} className="flex items-baseline justify-between gap-3 text-xs">
                <dt className="truncate text-muted">
                  {x.name}
                  <span className="ml-1.5 font-mono text-xs text-faint">{x.code}</span>
                </dt>
                <dd className="shrink-0 font-semibold tnum text-ink">{x.qty} 개</dd>
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
  /* 라벨과 입력을 잇는다 (4차 감사 G2). 같은 부품이 여러 번 그려져도 겹치지 않는다 */
  const uid = useId();

  const [state, action, pending] = useActionState<FormState, FormData>(updateSterilBatch, {});
  const [open, setOpen] = useState(false);
  const stage = sb.received_at ? '회수 완료' : sb.shipped_at ? '멸균 중' : '준비';

  return (
    <>
      <tr>
        <td className="td font-mono font-semibold">{sb.batch_no}</td>
        <td className="td whitespace-nowrap ">{sb.vendor_name}</td>
        <td className="td font-mono text-muted">{sb.request_no ?? ''}</td>
        <td className="td ">
          {/* 규격별로 묶어 보여 준다. 제조번호는 펼쳐 보면 나온다 */}
          {bySpec(sb.lots).map((x) => (
            <div key={x.code} className="flex items-baseline gap-2">
              <span className="font-mono text-xs text-muted">{x.code}</span>
              <span className="tnum font-semibold text-ink">{x.qty}</span>
            </div>
          ))}
        </td>
        <td className="td tnum text-right">{sb.total}</td>
        <td className="td tnum ">{fmtDate(sb.shipped_at)}</td>
        <td className="td tnum ">{fmtDate(sb.received_at)}</td>
        <td className="td font-mono ">{sb.cert_no ?? ''}</td>
        <td className="td">
          <Tag tone={sb.received_at ? 'ok' : sb.shipped_at ? 'brand' : 'quiet'}>{stage}</Tag>
        </td>
        <td className="td text-right">
          <button onClick={() => setOpen((v) => !v)} className="qd-text-action">
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
                <label className="label" htmlFor={`${uid}-shipped_at`}>발송일</label>
                <input id={`${uid}-shipped_at`} name="shipped_at" type="date" defaultValue={sb.shipped_at ?? today}
                       className="input tnum" />
              </div>
              <div className="w-40">
                <label className="label" htmlFor={`${uid}-received_at`}>회수일</label>
                <input id={`${uid}-received_at`} name="received_at" type="date" defaultValue={sb.received_at ?? ''}
                       className="input tnum" />
              </div>
              <div className="w-48">
                <label className="label" htmlFor={`${uid}-cert_no`}>멸균 보고서 번호</label>
                <input id={`${uid}-cert_no`} name="cert_no" defaultValue={sb.cert_no ?? ''}
                       className="input font-mono" />
              </div>
              <div className="w-48">
                <label className="label" htmlFor={`${uid}-request_no`}>의뢰서 번호</label>
                <input id={`${uid}-request_no`} name="request_no" defaultValue={sb.request_no ?? ''}
                       className="input font-mono" />
              </div>
              <button type="submit" disabled={pending} className="btn-primary">
                저장
              </button>
              <p className="w-full text-xs leading-relaxed text-muted">
                발송일을 적으면 제품 로트가 멸균 중으로, 회수일을 적으면 멸균 회수로 넘어갑니다.
                회수일과 멸균 보고서 번호가 모두 적혀야 이 배치의 제품 로트를 출고할 수 있습니다.
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
   번호는 발행되는 순간 정해져 종이에 찍히고 대장에 남는다 (0111).

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
              <span className="font-mono text-sm font-semibold text-ink">{g.batch_no}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted">{g.item_name}</span>
              <button
                type="button"
                disabled={picked.length === 0}
                onClick={() => router.push(`/print/release-request/${g.wo_id}?sel=${sel}`)}
                className="btn-primary"
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
                      <span className={`font-mono text-sm font-semibold ${on ? 'text-ink' : 'text-faint'}`}>
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
                      className="input w-20 text-right tnum"
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
  /* 라벨과 입력을 잇는다 (4차 감사 G2). 같은 부품이 여러 번 그려져도 겹치지 않는다 */
  const uid = useId();

  const [state, action, pending] = useActionState<FormState, FormData>(approveRelease, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-ghost">
        승인 기록
      </button>
    );
  }

  return (
    <form action={action} className="rounded-md border border-line bg-canvas p-3 text-left">
      <input type="hidden" name="id" value={lot.id} />
      {/*
        * 안내를 고쳤다 (UI/UX 검수 2026-11-11). 전에는 «품질책임자는 시스템
        * 계정을 쓰지 않습니다» 였는데 품질책임자 역할이 있다 - 열람 전용이다.
        * 기록하면 성명 · 일자는 고칠 수 없다 (0056 trg_once_written).
        * 멸균 회수 전 로트를 승인하는 일은 막지 않고 그 자리에서 알린다.
        */}
      <Caution>
        서면 출하 승인 요청서에 품질책임자가 서명한 내용을 그대로 옮겨 적습니다.
        품질책임자 계정은 열람 전용이라 여기서 직접 적지 않습니다. 시스템이
        판정하는 것이 아닙니다. <b>기록하면 성명 · 일자를 고칠 수 없고 되돌릴 수 없습니다.</b>
      </Caution>
      {lot.status !== 'TESTED' && (
        <p className="mt-2 rounded-md border border-warn/40 bg-warn-bg px-3 py-2 text-xs leading-relaxed text-ink">
          이 로트는 아직 <b>{PL_STATUS_LABEL[lot.status] ?? lot.status}</b> 입니다. 멸균 회수 전에
          승인을 적는 것이 맞는지 서면을 다시 보십시오.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="w-44">
          <label className="label" htmlFor={`${uid}-release_approved_by`}>품질책임자 성명</label>
          <input id={`${uid}-release_approved_by`} name="release_approved_by" required autoComplete="off"
                 className="input" />
        </div>
        <div className="w-36">
          <label className="label" htmlFor={`${uid}-release_approved_on`}>승인 일자</label>
          <input id={`${uid}-release_approved_on`} name="release_approved_on" type="date" defaultValue={today} required
                 className="input tnum" />
        </div>
        <button type="submit" disabled={pending} className="btn-primary">
          기록
        </button>
        <button type="button" onClick={() => setOpen(false)}
                className="btn-quiet">닫기</button>
      </div>
      <Msg state={state} />
    </form>
  );
}


/* ---------------------------------------------------------------------------
   출고 - 고른 주문 줄의 형명으로 나갈 수 있는 로트 (0159 · 사용자 2026-11-25)

   «출고할때 발주 업체리스트에서 선택하고, 발주 형명이 맞는지 작업지시서 및 제조기록서 일괄
   검토해서 출고시 오규격이 나가지 않도록». 로트마다 검토 다섯 칸을 보이고, 다른 칸이 있으면 출고
   단추를 끄고 단추 옆에 무엇이 다른지 적는다. 처리 함수와 DB 도 같은 검토로 막는다.

   행을 누르면 그 아래로 입력칸이 표 전체 폭으로 펼쳐진다 (사용자 지적 - 옆으로 좁은 폼은 읽기도
   쓰기도 어려웠다).
--------------------------------------------------------------------------- */
export interface ShipLine {
  id: string; customer_po_no: string; customer_name: string; code: string; name: string;
  qty: number; shipped: number; left: number;
}
export interface ShipLot extends PlOpt { review: SpecRow[]; blocked: string | null }

const REVIEW_SHORT: Record<SpecRow['kind'], string> = {
  LOT: '로트', DMR: '지시서', BAND: '두께', BR: '기록서', STERIL: '멸균',
};

function ReviewMarks({ review }: { review: SpecRow[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {review.map((r) => (
        <span key={r.kind} title={`${r.label}: 주문 ${r.expected ?? '-'} · 실제 ${r.actual ?? '-'}`}>
          <Tag tone={r.ok === false ? 'danger' : r.ok ? 'ok' : 'faint'}>
            {REVIEW_SHORT[r.kind]} {r.ok === false ? '다름' : r.ok ? '맞음' : '볼 수 없음'}
          </Tag>
        </span>
      ))}
    </span>
  );
}

export function ShipList({ lots, line, today }: { lots: ShipLot[]; line: ShipLine; today: string }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="qd-table-scroll">
      <table className="qd-table qd-table--hangul" data-grow="3">
        <thead>
          <tr>
            <th className="th">제조번호</th>
            <th className="th">배치</th>
            <th className="th text-right">출하 가능</th>
            <th className="th">유효기한</th>
            <th className="th">형명 검토</th>
            <th className="th w-0" />
          </tr>
        </thead>
        <tbody>
          {lots.map((l) => {
            const open = openId === l.id;
            const days = daysUntilKST(l.expiry_date) ?? 0;
            return (
              <Fragment key={l.id}>
                <tr
                  onClick={() => setOpenId(open ? null : l.id)}
                  aria-expanded={open}
                  className={`cursor-pointer ${open ? 'bg-brand-soft/60' : ''}`}
                >
                  <td className="td font-mono font-semibold">{l.lot_no}</td>
                  <td className="td font-mono text-muted">{l.batch_no}</td>
                  <td className="td tnum text-right font-semibold">{l.qty_available}</td>
                  <td className="td tnum ">
                    <span className={days <= 60 ? 'font-semibold text-warn' : ''}>
                      {fmtDate(l.expiry_date)}
                    </span>
                    <span className="ml-1 text-faint">{days}일</span>
                  </td>
                  <td className="td"><ReviewMarks review={l.review} /></td>
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
                    <td colSpan={6} className="border-b border-line bg-canvas p-0">
                      <ShipRowForm lot={l} line={line} today={today} />
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

function ShipRowForm({ lot, line, today }: { lot: ShipLot; line: ShipLine; today: string }) {
  /* 라벨과 입력을 잇는다 (4차 감사 G2). 같은 부품이 여러 번 그려져도 겹치지 않는다 */
  const uid = useId();

  const [state, action, pending] = useActionState<FormState, FormData>(ship, {});
  /* 수량은 주문 남은 양과 출하 가능 수량 가운데 작은 값으로 시작한다 */
  const [qty, setQty] = useState(String(Math.max(1, Math.min(lot.qty_available, line.left))));
  const over = Number(qty) > line.left;

  return (
    <form action={action} className="px-5 py-4">
      <input type="hidden" name="product_lot_id" value={lot.id} />
      <input type="hidden" name="sales_order_line_id" value={line.id} />
      <p className="text-sm font-semibold text-ink">
        <span className="font-mono">{lot.lot_no}</span> → {line.customer_name} · 주문{' '}
        <span className="font-mono">{line.customer_po_no}</span>
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor={`${uid}-qty`}>수량 (최대 {lot.qty_available})</label>
          <input id={`${uid}-qty`} name="qty" type="number" min={1} max={lot.qty_available}
                 value={qty} onChange={(e) => setQty(e.target.value)}
                 required className="input tnum" />
          {over && <p className="mt-1 text-xs text-warn">주문 남은 양({line.left})보다 많습니다.</p>}
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-shipped_at`}>출고일</label>
          <input id={`${uid}-shipped_at`} name="shipped_at" type="date" defaultValue={today} required
                 className="input tnum" />
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={pending || !!lot.blocked} className="btn-primary w-full">
            {pending ? '기록 중' : '출고 기록'}
          </button>
        </div>
      </div>
      <div className="mt-2">
        {lot.blocked ? (
          <p role="alert" className="text-sm font-semibold text-danger">{lot.blocked}</p>
        ) : (
          <Caution>
            출고를 기록하면 이 제조번호의 출하 가능 수량과 주문 {line.customer_po_no}의 남은 양이 그만큼 줄고,{' '}
            {line.customer_name}(으)로 나간 것으로 남습니다. <b>되돌릴 수 없습니다.</b>
          </Caution>
        )}
      </div>
      <Msg state={state} />
    </form>
  );
}

/* ---------------------------------------------------------------------------
   출고의 주문 바꾸기 (0159 · 사용자 2026-11-25 «허용»). 같은 형명의 열린 주문 줄로만, 사유 필수
--------------------------------------------------------------------------- */
export interface RelinkOpt { id: string; label: string }

export function RelinkShipment({ id, current, options }: { id: string; current: string; options: RelinkOpt[] }) {
  const uid = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(relinkShipment, {});
  const { open, setOpen } = useDialog(state);
  if (options.length === 0) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="qd-text-action">주문 바꾸기</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="출고의 주문 바꾸기">
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <p className="mb-3 text-sm">지금 주문 <span className="font-mono">{current}</span></p>
          <label className="label" htmlFor={`${uid}-l`}>바꿀 주문 줄</label>
          <select id={`${uid}-l`} name="sales_order_line_id" required defaultValue="" className="input">
            <option value="">선택하십시오</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <label className="label mt-3" htmlFor={`${uid}-r`}>사유</label>
          <textarea id={`${uid}-r`} name="reason" required rows={2} className="input" />
          <p className="mt-2 text-xs leading-relaxed text-muted">
            앞 주문의 남은 양이 돌아오고 바꾼 주문에서 줄어듭니다. 출고 기록의 거래처 이름은 그대로 남습니다.
          </p>
          <Msg state={state} />
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={pending} className="btn-primary">바꾼다</button>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
