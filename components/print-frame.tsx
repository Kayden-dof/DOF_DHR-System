'use client';

import Link from 'next/link';
import { Wordmark } from './logo';
import Barcode from './barcode';
import { useEffect, useState } from 'react';

export interface PrintMeta {
  kind: string;
  kindLabel: string;
  seq: number;
  dataHash: string;
  printedAt: string;
  printedBy: string;
  pages: number;
}

/* ---------------------------------------------------------------------------
   인쇄물 틀

   머리글과 꼬리글은 모든 양식이 같다 (§7).
   화면에서만 보이는 조작 막대는 인쇄에서 사라진다.
--------------------------------------------------------------------------- */
export default function PrintFrame({
  meta, title, subtitle, back, children, after,
}: {
  meta: PrintMeta;
  title: string;
  subtitle?: React.ReactNode;
  back?: string;
  children: React.ReactNode;
  /** 뒤에 이어 붙는 장. Sheet 로 만든다. */
  after?: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  return (
    <>
      <div className="no-print sticky top-0 z-20 mb-5 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-[210mm] flex-wrap items-center gap-3 px-2 py-3">
          {back && <Link href={back} className="btn-ghost h-9">돌아가기</Link>}
          <div className="leading-tight">
            <div className="text-[0.8125rem] font-bold text-ink">{meta.kindLabel}</div>
            <div className="text-xs text-muted">
              인쇄 회차 <b className="tnum text-ink">{meta.seq}</b>
              {meta.seq > 1 && <span className="ml-1.5 font-bold text-warn">재발행</span>}
            </div>
          </div>
          <button onClick={() => window.print()} disabled={!ready}
                  className="btn-primary ml-auto h-9">
            인쇄
          </button>
        </div>
      </div>

      <Sheet meta={meta} title={title} subtitle={subtitle} page={1}>
        {children}
      </Sheet>

      {after}
    </>
  );
}

/* ---------------------------------------------------------------------------
   낱장

   양식 하나가 여러 장이 될 때가 있다. 장마다 머리글과 꼬리글을 같은 자료
   식별자로 다시 찍는다. 종이가 흩어졌을 때 어느 묶음의 몇 장째인지 그 장만
   보고 알 수 있어야 한다.
--------------------------------------------------------------------------- */
export function Sheet({
  meta, title, subtitle, page = 1, children,
}: {
  meta: PrintMeta;
  title: string;
  subtitle?: React.ReactNode;
  page?: number;
  children: React.ReactNode;
}) {
  const short = meta.dataHash.slice(0, 12);
  const reissued = meta.seq > 1;

  return (
      <div className="sheet relative">
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
        {reissued && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
          >
            <span className="-rotate-[24deg] whitespace-nowrap text-[64px] font-bold tracking-[0.1em] text-black/[0.07]">
              재발행 {meta.seq}회차
            </span>
          </div>
        )}

        <header className="relative mb-4 border-b-2 border-black pb-2">
          <div className="flex items-start justify-between">
            <div>
              <Wordmark className="h-3.5 w-auto" purple="#000" gray="#666" />
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
        <tr>{roles.map((r) => <td key={r} className="sign-box" />)}</tr>
      </tbody>
    </table>
  );
}
