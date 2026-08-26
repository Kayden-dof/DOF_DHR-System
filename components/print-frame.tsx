'use client';

import Link from 'next/link';
import { Wordmark } from './logo';
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
  return (
      <div className="sheet">
        <header className="mb-4 border-b-2 border-black pb-2">
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
                  <td className="font-mono">{meta.dataHash.slice(0, 12)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </header>

        {children}

        <footer className="mt-6 border-t border-black pt-1.5 text-[9px] text-black">
          <div className="flex justify-between">
            <span>
              {meta.kindLabel} · 자료 식별자 {meta.dataHash.slice(0, 12)} · 회차 {meta.seq}
            </span>
            <span className="tnum">{page} / {meta.pages}</span>
          </div>
          <div className="mt-0.5">
            이 인쇄물은 서명 후 정본이 됩니다. 시스템은 판정하지 않으며 전자서명을 받지 않습니다.
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
