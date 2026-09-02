'use client';

import Link from 'next/link';
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
  /*
   * 회사 표시. 이 틀은 클라이언트 부품이라 설정을 직접 읽을 수 없다 - 읽으면
   * DB 드라이버가 브라우저 번들로 딸려 들어간다 (실제로 그랬다). 서버에서
   * 만들 때 실어 보낸다 (lib/print.ts).
   */
  companyName: string;
  /** 소재지 · 사업자등록번호 · 대표자를 이어 붙인 한 줄. 비면 안 나온다 */
  orgLine?: string;
  logoUrl: string | null;
}

/* ---------------------------------------------------------------------------
   인쇄물 틀

   머리글과 꼬리글은 모든 양식이 같다 (§7).
   화면에서만 보이는 조작 막대는 인쇄에서 사라진다.
--------------------------------------------------------------------------- */
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

  return (
    <>
      {!bare && (
        <PrintBar back={back} label={meta.kindLabel}
                  right={
                    <>
                      인쇄 회차 <b className="tnum text-ink">{meta.seq}</b>
                      {meta.seq > 1 && <span className="ml-1.5 font-bold text-warn">재발행</span>}
                    </>
                  } />
      )}

      <Sheet meta={meta} title={title} subtitle={subtitle} page={1}>
        {children}
      </Sheet>

      {after}
    </>
  );
}

/* ---------------------------------------------------------------------------
   인쇄 막대

   종이에는 나오지 않는다. 돌아갈 곳과 인쇄 단추만 있는 자리다.

   묶음 발행 화면이 여러 양식을 한 문서로 내므로, 막대를 양식에서 떼어 둔다.
   떼지 않으면 묶음 문서에 막대가 여러 번 나온다.
--------------------------------------------------------------------------- */
export function PrintBar({ back, label, right }: {
  back?: string; label: string; right?: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  return (
    <div className="no-print sticky top-0 z-20 mb-5 border-b border-line bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex max-w-[210mm] flex-wrap items-center gap-3 px-2 py-3">
        {back && <Link href={back} className="btn-ghost h-9">돌아가기</Link>}
        <div className="leading-tight">
          <div className="text-[0.8125rem] font-bold text-ink">{label}</div>
          {right && <div className="text-xs text-muted">{right}</div>}
        </div>
        <button onClick={() => window.print()} disabled={!ready}
                className="btn-primary ml-auto h-9">
          인쇄
        </button>
      </div>
    </div>
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
