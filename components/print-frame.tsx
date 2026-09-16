'use client';

import Link from 'next/link';
import Barcode from './barcode';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface PrintMeta {
  kind: string;
  kindLabel: string;
  seq: number;
  dataHash: string;
  printedAt: string;
  printedBy: string;
  pages: number;
  /**
   * 그 종이에 찍힌 문서번호. 지금은 출하 승인 요청서만 제 번호를 들고 나간다
   * (RR-배치번호-회차 · 0111). 발행하는 순간 DB 가 정하고 대장에 남는다 -
   * 화면이 조립하지 않는다. 네 곳에서 각자 조립하다 갈라질 뻔했다 (§10).
   */
  docNo: string | null;
  /*
   * 회사 표시. 이 틀은 클라이언트 부품이라 설정을 직접 읽을 수 없다 - 읽으면
   * DB 드라이버가 브라우저 번들로 딸려 들어간다 (실제로 그랬다). 서버에서
   * 만들 때 실어 보낸다 (lib/print.ts).
   */
  companyName: string;
  /** 소재지 · 사업자등록번호 · 대표자를 이어 붙인 한 줄. 비면 안 나온다 */
  orgLine?: string;
  logoUrl: string | null;
  /**
   * 열람 모드일 때만 있다. 이 값이 있으면 대장에 아무것도 남지 않았다는 뜻이고,
   * 화면은 발행이 아니라 **이미 나간 회차를 다시 보는 자리**가 된다.
   */
  view?: ViewMeta | null;

  /**
   * 미리보기. 아직 대장에 남지 않았다 (2026-09-16).
   *
   * 열람과 헷갈리지 않게 둘을 따로 둔다 - 열람은 **이미 나간 회차의 그때 값**
   * 이고, 미리보기는 **아직 나가지 않은 지금 값**이다. 종이에 깔리는 말도
   * 다르고 (열람용 / 미발행), 인쇄 단추가 하는 일도 다르다.
   */
  preview?: boolean;

  /** 읽기 전용 세션인가. 발행 단추를 낼지 가른다 */
  readOnly?: boolean;

  /**
   * 발행권. 미리보기일 때만 있다 (lib/print.ts).
   *
   * 서버가 봉한 값이라 화면이 안을 들여다볼 수 없고, 그럴 필요도 없다 -
   * 인쇄 단추가 그대로 돌려주면 서버가 그것으로 대장에 적는다.
   */
  ticket?: string;
}

/* 인쇄 단추가 가는 곳. 대장에 쓰는 유일한 자리다 (app/print/issue/route.ts) */
async function issuePrint(
  ticket: string,
): Promise<{ ok: true; meta: PrintMeta } | { ok: false; reason: string }> {
  try {
    const r = await fetch('/print/issue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket }),
    });
    return await r.json();
  } catch {
    return { ok: false, reason: '연결이 끊겼습니다. 다시 눌러 보세요.' };
  }
}

export interface ViewMeta {
  /** 그 양식이 아직 한 번도 나간 적이 없다 */
  neverIssued: boolean;
  /** 그때 종이에 찍힌 자료 식별자 */
  issuedHash: string;
  /** 지금 자료로 다시 만든 값 */
  currentHash: string;
  /** 둘이 다른가. 다르면 그 뒤에 자료가 바뀌었다는 뜻이다 */
  changed: boolean;
  retrievedAt: string | null;
  retrieveReason: string | null;
}

/* ---------------------------------------------------------------------------
   인쇄물 틀

   머리글과 꼬리글은 모든 양식이 같다 (§7).
   화면에서만 보이는 조작 막대는 인쇄에서 사라진다.
--------------------------------------------------------------------------- */
/* ---------------------------------------------------------------------------
   발행하면 모든 장의 머리글이 함께 바뀐다

   인쇄 단추를 누르면 회차 · 인쇄 시각 · 인쇄자가 그때 정해지고 미발행 표시가
   빠진다. 그런데 장은 여럿이고 (작업 지시서는 공정이 많으면 두 장, 편철 표지는
   뒤에 장을 더 단다) 그 장들은 화면이 그려질 때 이미 meta 를 받아 갔다.

   한 장만 바뀌면 같은 문서의 앞장과 뒷장이 다른 회차를 적는다. 종이가 흩어졌을
   때 그 장만 보고 어느 묶음인지 알 수 있어야 한다는 Sheet 의 약속이 거기서
   깨진다. 그래서 위에서 한 번 내려보내고 장은 그것을 읽는다.
--------------------------------------------------------------------------- */
const MetaCtx = createContext<PrintMeta | null>(null);

/* ---------------------------------------------------------------------------
   묶음 발행 - 한 번에 뽑되 대장에는 묶음마다 한 줄

   제조기록서 묶음은 마감된 일차를 한 문서로 낸다. 종이는 한 번에 나가지만
   대장은 묶음마다 한 줄이어야 회차가 성립한다 (§7) - 열 일차를 한 번에 뽑으면
   열 줄이 남고 각자 제 회차를 갖는다.

   그래서 발행권도 묶음마다 하나다. 안에 든 양식들이 마운트하면서 자기 것을
   올려 두고, 위의 단추가 그것을 모아 한꺼번에 발행한 뒤 각자에게 제 회차를
   돌려준다.
--------------------------------------------------------------------------- */
const AddTicketCtx = createContext<((t: string) => void) | null>(null);
const IssuedCtx = createContext<Map<string, PrintMeta> | null>(null);

/** 머리띠 오른쪽 문구. 발행 전후로 말이 달라진다 */
function barRight(m: PrintMeta) {
  if (m.view) {
    return m.view.neverIssued
      ? <>아직 발행된 적이 없습니다</>
      : <>
          <b className="tnum text-ink">{m.seq}</b>회차를 봅니다 ·
          {' '}{m.printedAt} {m.printedBy}
        </>;
  }
  if (m.preview) {
    return <>
      인쇄하면 <b className="tnum text-ink">{m.seq}</b>회차로 남습니다
      {m.seq > 1 && <span className="ml-1.5 font-bold text-warn">재발행</span>}
    </>;
  }
  return <>
    인쇄 회차 <b className="tnum text-ink">{m.seq}</b>
    {m.seq > 1 && <span className="ml-1.5 font-bold text-warn">재발행</span>}
  </>;
}

export default function PrintFrame({
  meta, title, subtitle, back, children, after, bare = false,
}: {
  meta: PrintMeta;
  title: string;
  subtitle?: React.ReactNode;
  back?: string;
  children: React.ReactNode;
  /** 뒤에 이어 붙는 장. Sheet 로 만든다. */
  after?: React.ReactNode;
  /** 묶음 문서에 끼워 넣을 때. 인쇄 막대를 내지 않는다 */
  bare?: boolean;
}) {
  /*
   * 발행된 뒤의 meta. 인쇄 단추가 채운다.
   *
   * 새로 고치면 다시 미리보기다 - 발행 사실을 주소에 싣지 않았기 때문이다.
   * 실으면 그 주소를 다시 열 때마다 정본이 나오는 자리가 생긴다.
   */
  const [issued, setIssued] = useState<PrintMeta | null>(null);

  /* 묶음 안에 있으면 위의 단추가 발행하고 제 회차를 여기로 돌려준다 */
  const addTicket = useContext(AddTicketCtx);
  const bundleIssued = useContext(IssuedCtx);
  useEffect(() => {
    if (bare && meta.ticket && addTicket) addTicket(meta.ticket);
  }, [bare, meta.ticket, addTicket]);

  const m = issued
    ?? (meta.ticket ? bundleIssued?.get(meta.ticket) : null)
    ?? meta;

  /*
   * 인쇄 대화상자는 **다시 그려진 뒤에** 연다. 단추 안에서 바로 부르면 아직
   * 미발행 표시가 붙은 화면이 그대로 종이가 된다.
   *
   * 묶음 안에서는 열지 않는다 - 양식마다 열면 대화상자가 열 번 뜬다. 그 자리는
   * 묶음의 단추 하나다.
   */
  useEffect(() => { if (issued) window.print(); }, [issued]);

  return (
    <MetaCtx.Provider value={m}>
      {!bare && (
        <PrintBar back={back} label={m.kindLabel} view={!!m.view}
                  ticket={m.ticket} onIssued={setIssued}
                  readOnly={m.readOnly}
                  right={barRight(m)} />
      )}

      {m.view && <ViewNote v={m.view} seq={m.seq} />}

      {/*
        * 나간 적이 없으면 내용을 그리지 않는다.
        *
        * 열람은 **이미 나간 회차**를 다시 보는 자리다. 안 나간 것을 여기서
        * 보여 주면 미리보기가 되고, 그러면 "본 것과 찍힌 것이 다르다" 가
        * 성립할 자리가 생긴다 (lib/print.ts 머리 주석).
        */}
      {!m.view?.neverIssued && (
        <>
          <Sheet meta={m} title={title} subtitle={subtitle} page={1}>
            {children}
          </Sheet>
          {after}
        </>
      )}
    </MetaCtx.Provider>
  );
}

/* ---------------------------------------------------------------------------
   열람 알림

   판정하지 않는다 (§8.5). 두 값이 같은지 다른지만 적고, 무엇이 어떻게
   바뀌었는지는 말하지 않는다 - 그건 감사추적이 답할 일이다.
--------------------------------------------------------------------------- */
function ViewNote({ v, seq }: { v: ViewMeta; seq: number }) {
  if (v.neverIssued) {
    return (
      <div className="no-print mx-auto mb-5 max-w-[210mm] rounded-lg border border-line bg-surface-sub px-4 py-3">
        <p className="text-sm leading-relaxed text-ink">
          이 양식은 아직 발행된 적이 없습니다.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          열람은 이미 나간 회차를 다시 보는 자리입니다. 종이가 필요하면 발행하십시오.
        </p>
      </div>
    );
  }
  const tone = v.changed
    ? 'border-warn/40 bg-warn-bg'
    : 'border-line bg-surface-sub';
  return (
    <div className={`no-print mx-auto mb-5 max-w-[210mm] rounded-lg border px-4 py-3 ${tone}`}>
      <p className="text-sm leading-relaxed text-ink">
        <b>{seq}회차</b>로 나간 종이를 지금 자료로 다시 그린 것입니다.
        {' '}이 화면은 인쇄 대장에 남지 않습니다.
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        그때 자료 식별자 <span className="font-mono text-ink">{v.issuedHash.slice(0, 12)}</span>
        {' · '}지금 <span className="font-mono text-ink">{v.currentHash.slice(0, 12)}</span>
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink">
        {v.changed
          ? '두 값이 다릅니다. 그 종이가 나간 뒤에 자료가 바뀌었습니다.'
          : '두 값이 같습니다. 그 종이에 찍힌 자료 그대로입니다.'}
      </p>
      {v.retrievedAt && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          이 회차는 {v.retrievedAt} 에 회수되었습니다
          {v.retrieveReason ? ` · ${v.retrieveReason}` : ''}.
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   인쇄 막대

   종이에는 나오지 않는다. 돌아갈 곳과 인쇄 단추만 있는 자리다.

   묶음 발행 화면이 여러 양식을 한 문서로 내므로, 막대를 양식에서 떼어 둔다.
   떼지 않으면 묶음 문서에 막대가 여러 번 나온다.
--------------------------------------------------------------------------- */
export function PrintBar({
  back, label, right, view = false, ticket, onIssued,
  onPrint, busy: busyGiven, error: errGiven, readOnly = false,
}: {
  back?: string; label: string; right?: React.ReactNode;
  /** 열람 모드. 인쇄 단추를 내지 않는다 */
  view?: boolean;
  /**
   * 읽기 전용 세션. 품질책임자가 미리보기로 들어오는 자리다 (lib/print.ts).
   *
   * 단추를 내지 않는다. 눌러도 대장에 닿지 못하지만 (발행권이 실리지 않고 DB 도
   * 거부한다) 눌러 보고 나서 알게 하는 것은 화면이 할 일이 아니다.
   */
  readOnly?: boolean;
  /**
   * 발행권. 있으면 인쇄 단추가 **먼저 대장에 적고** 인쇄 대화상자를 연다.
   * 없으면 이미 발행된 화면이므로 곧바로 연다 (lib/print.ts).
   */
  ticket?: string;
  onIssued?: (m: PrintMeta) => void;
  /** 발행을 바깥이 맡을 때 (묶음 발행). 그러면 ticket 은 쓰지 않는다 */
  onPrint?: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [ready, setReady] = useState(false);
  const [busyOwn, setBusyOwn] = useState(false);
  const [errOwn, setErrOwn] = useState<string | null>(null);
  useEffect(() => setReady(true), []);

  const busy = busyGiven ?? busyOwn;
  const err = errGiven ?? errOwn;

  async function own() {
    if (!ticket) { window.print(); return; }
    setBusyOwn(true); setErrOwn(null);
    const r = await issuePrint(ticket);
    setBusyOwn(false);
    if (!r.ok) { setErrOwn(r.reason); return; }
    /*
     * 인쇄 대화상자는 여기서 열지 않는다. 머리글이 새 값으로 다시 그려진 뒤에
     * PrintFrame 이 연다 - 여기서 부르면 미발행 표시가 붙은 채로 나간다.
     */
    onIssued?.(r.meta);
  }

  const print = onPrint ?? own;

  /*
   * 인쇄 화면의 머리띠 (2026-09-11).
   *
   * **종이는 건드리지 않는다.** 이 띠는 no-print 라 종이에 나가지 않는다 -
   * 화면에서 종이를 보는 동안만 위에 떠 있는 자리다.
   *
   * 관리 화면 머리줄과 같은 얕은 그림자를 준다. 종이(흰 면)가 그 아래로
   * 지나갈 때 띠가 위에 있다는 것이 형태로 보여야, 스크롤하다 종이 가장자리와
   * 띠를 헷갈리지 않는다.
   */
  return (
    <div className="no-print sticky top-0 z-20 mb-5 border-b border-line bg-canvas/92 backdrop-blur
                    shadow-[0_1px_2px_rgb(26_26_31/.04),0_8px_20px_-14px_rgb(26_26_31/.24)]">
      <div className="mx-auto flex max-w-[210mm] flex-wrap items-center gap-3 px-2 py-3">
        {back && <Link href={back} className="btn-ghost h-9">돌아가기</Link>}
        <div className="leading-tight">
          <div className="flex items-center gap-1.5">
            <div className="text-[0.8125rem] font-bold text-ink">{label}</div>
            {view && <span className="chip bg-info-bg text-info">열람</span>}
          </div>
          {right && <div className="text-xs text-muted">{right}</div>}
        </div>
        {/*
          * 열람에는 인쇄 단추를 내지 않는다. 브라우저의 Ctrl+P 까지 막을 수는
          * 없으므로 종이 쪽에 "열람용 · 정본 아님" 을 깔아 둔다 (Sheet).
          */}
        {!view && !readOnly && (
          <div className="ml-auto flex items-center gap-3">
            {/*
              * 막힌 까닭을 그 자리에서 말한다. 열람 권한이거나, 그 묶음이 이미
              * 잠겼거나 (S04), 화면을 연 지 오래되었거나 - 셋 다 사람이 다음에
              * 무엇을 해야 하는지가 문장에 들어 있다.
              */}
            {err && <span className="max-w-[28rem] text-xs text-danger">{err}</span>}
            <button onClick={print} disabled={!ready || busy}
                    className="btn-primary h-9">
              {busy ? '등록 중 …' : '인쇄'}
            </button>
          </div>
        )}

        {!view && readOnly && (
          <span className="ml-auto text-xs text-muted">발행은 생산관리자가 합니다</span>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   묶음 틀

   안에 든 양식들의 발행권을 모아 한꺼번에 발행한다. 종이는 한 번 나가고 대장은
   묶음 수만큼 늘어난다.

   **하나라도 막히면 아무것도 발행하지 않는다.** 절반만 대장에 남으면 손에 든
   종이 묶음과 대장이 어긋나고, 어느 장이 남았는지는 종이만 봐서는 알 수 없다.
   제조기록서 묶음은 발행이 곧 마감이라 (S04) 되돌릴 수도 없다.
--------------------------------------------------------------------------- */
export function PrintBundle({ back, label, right, children }: {
  back?: string; label: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  const [tickets, setTickets] = useState<string[]>([]);
  const [issued, setIssued] = useState<Map<string, PrintMeta> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /*
   * 양식이 마운트하면서 올려 둔다. 같은 것을 두 번 담지 않는다 - 다시 그려질
   * 때마다 쌓이면 한 묶음이 대장에 여러 줄을 남긴다.
   */
  const add = useCallback((t: string) => {
    setTickets((prev) => (prev.includes(t) ? prev : [...prev, t]));
  }, []);

  useEffect(() => { if (issued) window.print(); }, [issued]);

  async function print() {
    if (issued || tickets.length === 0) { window.print(); return; }
    setBusy(true); setErr(null);

    const done = new Map<string, PrintMeta>();
    for (const t of tickets) {
      const r = await issuePrint(t);
      if (!r.ok) {
        setBusy(false);
        setErr(done.size === 0
          ? r.reason
          : `${r.reason} (앞서 ${done.size}건은 이미 대장에 남았습니다)`);
        /* 남은 것이라도 화면에 반영한다. 대장에 있는 것과 종이가 같아야 한다 */
        if (done.size > 0) setIssued(done);
        return;
      }
      done.set(t, r.meta);
    }
    setBusy(false);
    setIssued(done);
  }

  return (
    <AddTicketCtx.Provider value={add}>
      <IssuedCtx.Provider value={issued}>
        <PrintBar back={back} label={label} right={right}
                  onPrint={print} busy={busy} error={err} />
        {children}
      </IssuedCtx.Provider>
    </AddTicketCtx.Provider>
  );
}

/* ---------------------------------------------------------------------------
   낱장

   양식 하나가 여러 장이 될 때가 있다. 장마다 머리글과 꼬리글을 같은 자료
   식별자로 다시 찍는다. 종이가 흩어졌을 때 어느 묶음의 몇 장째인지 그 장만
   보고 알 수 있어야 한다.
--------------------------------------------------------------------------- */
export function Sheet({
  meta: given, title, subtitle, page = 1, children,
}: {
  meta: PrintMeta;
  title: string;
  subtitle?: React.ReactNode;
  page?: number;
  children: React.ReactNode;
}) {
  /*
   * 틀 안에 있으면 틀이 내려보내는 값을 쓴다. 발행하면 그 값이 바뀌므로 장이
   * 여럿이어도 전부 같은 회차를 적는다. 틀 밖에서 홀로 쓰이면 받은 것을 쓴다.
   */
  const meta = useContext(MetaCtx) ?? given;
  /*
   * 나간 적이 없으면 장을 그리지 않는다.
   *
   * PrintFrame 안에서 한 번 걸렀는데도 여기 한 번 더 두는 이유가 있다 - 편철
   * 표지처럼 **PrintFrame 바깥에 장을 더 다는 양식**이 있다. 틀에서만 막으면
   * 그 장이 그대로 나온다 (실제로 나왔다).
   *
   * 막는 자리를 장 자체에 둔다. 어느 양식이 어떻게 조립하든 열람은 나간 회차만
   * 연다는 규율이 한 자리에서 선다.
   */
  if (meta.view?.neverIssued) return null;

  const short = meta.dataHash.slice(0, 12);
  const reissued = meta.seq > 1;

  return (
      /*
       * data-sheet 는 종이에 나오지 않는 표시다.
       *
       * 인쇄 충실성 시험이 쪽 번호를 대조하려면 "이 문서가 실제로 몇 장인가" 를
       * 셀 수 있어야 한다. 꼬리글의 "n / N" 을 글자로 세면 N 이 틀렸을 때
       * 틀린 값끼리 맞아떨어져 통과한다 - 재는 것이 재어질 것에서 나오면
       * 아무것도 재지 못한다 (§8.0.1).
       *
       * 그래서 장 자체를 센다. 이 표가 붙은 개수가 실제 매수다.
       */
      <div data-sheet={page} className="sheet relative">
        {/*
          * 재발행본 워터마크.
          *
          * 이 시스템에서 가장 위험한 상태는 같은 기록의 종이가 두 장 도는 것이다.
          * 회차는 머리글에도 찍히지만 작아서 겹쳐 놓으면 안 보인다. 종이 한가운데를
          * 가로지르는 표시가 있어야 멀리서도, 뒤집어 놓아도 눈에 들어온다.
          *
          * 1회차에는 아무것도 넣지 않는다. 평소와 다른 것에만 표시가 붙어야
          * 그 표시가 눈에 들어온다.
          */}
        {reissued && !meta.view && !meta.preview && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
          >
            <span className="-rotate-[24deg] whitespace-nowrap text-[64px] font-bold tracking-[0.1em] text-black/[0.07]">
              재발행 {meta.seq}회차
            </span>
          </div>
        )}

        {/*
          * 열람용 표시.
          *
          * 열람 화면에는 인쇄 단추를 내지 않지만 브라우저의 Ctrl+P 까지 막을
          * 수는 없다. 그렇게 나간 종이는 **대장에 없는 종이**다 - 이 시스템이
          * 가장 막고 싶어 하는 상태다 (§10 "대장에는 실제 종이만 남는다").
          *
          * 재발행 표시보다 진하게, 그리고 종이 위쪽에 한 줄을 더 얹는다.
          * 멀리서도, 뒤집어 놓아도, 한 장만 주워도 정본이 아닌 것이 보여야 한다.
          */}
        {meta.view && (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
            >
              <span className="-rotate-[24deg] whitespace-nowrap text-[64px] font-bold tracking-[0.1em] text-black/[0.13]">
                열람용 · 정본 아님
              </span>
            </div>
            <p className="mb-2 border border-black px-2 py-1 text-center text-[10px] font-bold">
              열람용입니다. 발행된 종이가 아니며 인쇄 대장에 남지 않았습니다.
              {meta.view.changed && ' 그 종이가 나간 뒤에 자료가 바뀌었습니다.'}
            </p>
          </>
        )}

        {/*
          * 미발행 표시 (2026-09-16).
          *
          * 인쇄 단추를 누르기 전의 화면이다. 단추는 대장에 적고 나서 인쇄
          * 대화상자를 열지만, 브라우저의 Ctrl+P 까지 막을 수는 없다. 그렇게
          * 나간 종이는 **대장에 없는 종이**이고, 그것이 이 시스템이 가장 막고
          * 싶어 하는 상태다 (§10 "대장에는 실제 종이만 남는다").
          *
          * 열람과 같은 어법을 쓰되 말이 다르다. 열람은 이미 나간 것의 사본이고
          * 이것은 아직 나가지 않은 것이다. 인쇄 일시 · 인쇄자 칸이 비어 있는
          * 것도 사실이므로 지어내지 않고 그대로 둔다 (§1).
          */}
        {meta.preview && (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
            >
              <span className="-rotate-[24deg] whitespace-nowrap text-[64px] font-bold tracking-[0.1em] text-black/[0.13]">
                미발행 · 정본 아님
              </span>
            </div>
            <p className="mb-2 border border-black px-2 py-1 text-center text-[10px] font-bold">
              아직 발행되지 않았습니다. 인쇄 대장에 남기려면 화면의 인쇄 단추를 누르세요.
            </p>
          </>
        )}

        <header className="relative mb-4 border-b-2 border-black pb-2">
          <div className="flex items-start justify-between">
            <div>
              {meta.logoUrl
                ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={meta.logoUrl} alt={meta.companyName}
                       className="h-3.5 w-auto" style={{ objectFit: 'contain' }} />
                )
                : (
                  <span className="display text-[0.75rem] leading-none text-black">
                    {meta.companyName}
                  </span>
                )}
              {/*
                * 제조소가 누구인지 (5차 감사 D1). 이 시스템의 종이는 미리
                * 인쇄된 양식에 얹는 것이 아니라 통째로 만들어 내므로, 그
                * 자리가 여기다. 설정이 비면 아무것도 나오지 않는다.
                */}
              {meta.orgLine && (
                <div className="mt-0.5 text-[9px] leading-tight text-black">
                  {meta.orgLine}
                </div>
              )}
              <h1 className="mt-1.5 text-lg font-bold text-black">{title}</h1>
              {subtitle && <div className="mt-0.5 text-xs text-black">{subtitle}</div>}
            </div>
            <table className="text-[10px] text-black">
              <tbody>
                <tr>
                  <td className="pr-2 text-right">인쇄 일시</td>
                  <td className="tnum font-semibold">{meta.printedAt}</td>
                </tr>
                <tr>
                  <td className="pr-2 text-right">인쇄자</td>
                  <td className="font-semibold">{meta.printedBy}</td>
                </tr>
                <tr>
                  <td className="pr-2 text-right">인쇄 회차</td>
                  <td className="tnum font-semibold">{meta.seq}</td>
                </tr>
                <tr>
                  <td className="pr-2 text-right">자료 식별자</td>
                  <td className="font-mono font-bold">{short}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </header>

        <div className="relative">{children}</div>

        <footer className="relative mt-6 border-t border-black pt-1.5 text-[9px] text-black">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div>
                {meta.kindLabel} · 자료 식별자{' '}
                <span className="font-mono font-bold">{short}</span> · 회차 {meta.seq}
                {reissued && <b> · 재발행본</b>}
              </div>
              <div className="mt-0.5">
                이 인쇄물은 서명 후 정본이 됩니다. 시스템은 판정하지 않으며
                전자서명을 받지 않습니다.
              </div>
              <div className="mt-0.5">
                조회 화면에서 위 자료 식별자를 입력하면 이 종이가 언제 어떤 자료로
                뽑혔는지, 뒤에 재출력한 회차가 있는지 확인할 수 있습니다.
              </div>
            </div>
            {/* 손으로 옮겨 적다 틀리지 않게 바코드로도 찍는다 */}
            <div className="shrink-0 text-right">
              <Barcode value={short.toUpperCase()} height={26} module={1} />
              <div className="tnum mt-0.5">{page} / {meta.pages}</div>
            </div>
          </div>
        </footer>
      </div>
  );
}

/* 서명란. 순환자는 서명하지 않는다 (§7). */
export function SignRow({ roles }: { roles: string[] }) {
  return (
    <table className="print-table mt-5">
      <thead>
        <tr>{roles.map((r) => <th key={r} className="w-1/4 text-center">{r}</th>)}</tr>
      </thead>
      <tbody>
        {/*
          * data-sign-role 은 화면에도 종이에도 나오지 않는다. 시험이 "서명란이
          * 실제로 있는가" 를 셀 수 있게 두는 표시다.
          *
          * sign-box 로는 셀 수 없다. 편철 표지의 철 확인란이 같은 클래스를
          * 쓰기 때문에, 서류가 여덟 줄이면 서명란 3칸이 11칸으로 잡힌다
          * (4차 자기 검수).
          */}
        <tr>{roles.map((r) => <td key={r} data-sign-role={r} className="sign-box" />)}</tr>
      </tbody>
    </table>
  );
}
