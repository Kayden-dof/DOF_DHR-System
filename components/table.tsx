
/* ---------------------------------------------------------------------------
   표

   이 시스템에서 사람이 가장 오래 보는 것이 표다. 그래서 표에 규칙을 둔다.

     첫 칸은 신원이다.   로트번호 · 배치번호 · 제조번호. 고정폭, 굵게, 줄바꿈 없음.
     그 아래 한 줄까지.  코드 · 개정 같은 딸린 값은 작게 아래에 붙인다.
     숫자는 오른쪽.      자릿수가 흔들리지 않게 tnum.
     상태는 왼쪽 띠로.   행 가운데 조각만 있으면 훑을 때 눈이 걸린다.
     동작은 맨 오른쪽.   표가 넘쳐도 잘리지 않게 고정한다.

   행 전체가 어딘가로 가는 목록이면 RowLink 를 쓴다. 누를 수 있다는 것이
   보여야 하고, 마지막 칸의 작은 단추를 겨냥하게 만들면 안 된다.
--------------------------------------------------------------------------- */

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">{children}</table>
    </div>
  );
}

export function Th({
  children, right, className = '', w,
}: { children?: React.ReactNode; right?: boolean; className?: string; w?: string }) {
  return (
    <th className={`th ${right ? 'text-right' : ''} ${className}`} style={w ? { width: w } : undefined}>
      {children}
    </th>
  );
}

export function Td({
  children, right, className = '', mono, nowrap,
}: {
  children?: React.ReactNode; right?: boolean; className?: string;
  mono?: boolean; nowrap?: boolean;
}) {
  return (
    <td className={`td ${right ? 'tnum text-right' : ''} ${mono ? 'font-mono text-xs' : ''} ${
      nowrap ? 'whitespace-nowrap' : ''} ${className}`}>
      {children}
    </td>
  );
}

/** 첫 칸. 신원과 그 아래 딸린 값 한 줄. */
export function IdCell({
  id, sub, tone,
}: {
  id: React.ReactNode; sub?: React.ReactNode;
  tone?: 'warn' | 'danger' | 'ok' | 'brand' | 'info';
}) {
  const bar = tone && {
    warn: 'bg-warn', danger: 'bg-danger', ok: 'bg-ok',
    brand: 'bg-brand', info: 'bg-info',
  }[tone];

  return (
    <td className="td relative whitespace-nowrap pl-5">
      {bar && <span aria-hidden className={`absolute inset-y-1.5 left-1.5 w-[3px] rounded-full ${bar}`} />}
      {/* --------------------------------------------------------------------
        * 번호가 이 제품의 명사다 (2026-09-11).
        *
        * 로트번호 · 배치번호 · 제조번호. 하루 종일 보는 것이 이것이고, 종이와
        * 화면을 눈으로 맞추는 것도 이것이다. 그런데 13px 짜리 굵은 글자로
        * 옆 설명글과 같은 무게로 놓여 있었다.
        *
        * 한 칸 키우고 자간을 벌린다. 고정폭 글자는 자간이 좁으면 글자 덩어리로
        * 뭉쳐 보이는데, 이 번호들은 **한 글자씩 대조하는 물건**이다 -
        * B260810-01 과 B260811-01 을 가르는 것은 한 자리다. 자간이 그 일을
        * 돕는다. 인상과 실용이 같은 방향이다.
        * ------------------------------------------------------------------ */}
      <div className="font-mono text-[0.875rem] font-bold tracking-[0.04em] text-ink">{id}</div>
      {/*
        * 아랫줄은 고정폭으로 두지 않는다. 여기에 "1일차" 같은 한글이 들어가는
        * 자리가 있고(현황의 마감 대기), 고정폭 글꼴에 한글 글리프가 없어
        * 굴림으로 떨어진다. npm run font 가 지키는 바로 그 규칙이다.
        */}
      {sub && <div className="mt-0.5 text-xs text-faint">{sub}</div>}
    </td>
  );
}

/** 이름과 코드처럼 한 칸에 두 줄이 들어가는 자리. */
export function TwoLine({
  top, bottom, nowrap = true,
}: { top: React.ReactNode; bottom?: React.ReactNode; nowrap?: boolean }) {
  return (
    <td className={`td ${nowrap ? 'whitespace-nowrap' : ''}`}>
      <div className="text-sm text-body">{top}</div>
      {bottom && <div className="mt-0.5 font-mono text-xs text-faint">{bottom}</div>}
    </td>
  );
}

/** 맨 오른쪽 동작 칸. 표가 가로로 넘쳐도 붙어 있는다. */
export function ActionTd({ children }: { children: React.ReactNode }) {
  return (
    <td className="td sticky right-0 bg-surface text-right shadow-[-10px_0_10px_-10px_rgb(31_29_36/.14)]">
      {/* 손이 얹히거나 초점이 오면 나온다. 자리는 늘 차지한다 (globals.css) */}
      <span className="row-action inline-flex items-center justify-end gap-1.5">
        {children}
      </span>
    </td>
  );
}

export function ActionTh() {
  return <th className="th sticky right-0 w-0 shadow-[-10px_0_10px_-10px_rgb(31_29_36/.14)]" />;
}

/*
 * 행 전체가 링크인 목록. 구현은 클라이언트 조각이라 따로 두고 여기서 다시
 * 내보낸다. 표 부품은 이 파일 하나에서 가져다 쓰는 것이 규칙이다.
 */
export { RowLink } from './row-link';
