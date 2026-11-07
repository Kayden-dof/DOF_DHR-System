
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

/*
 * 치수는 정본이 정한다 (`app/q-design.list.css` · `.qd-table`). 진짜 <table> 에
 * 정본 값을 건다. 머리글이 한글이라 `--hangul` 로 라틴 자간 · 대문자를 푼다.
 *
 * grow 는 남는 폭을 받을 열 하나 (1부터 · 적지 않으면 첫 열 · 0 이면 모든 열이
 * 똑같이 나눈다). 정본 `.qd-table` 이 `data-grow` 를 읽는다 (Q-Design 7장 «표»).
 */
export function Table({ children, grow, className = '' }: {
  children: React.ReactNode; grow?: number; className?: string;
}) {
  return (
    <div className="qd-table-scroll">
      <table className={`qd-table qd-table--hangul ${className}`.trim()}
             data-grow={grow !== undefined && grow !== 1 ? grow : undefined}>
        {children}
      </table>
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
  /*
   * tone 은 받되 그리지 않는다 (Q-Design · 2026-11-06). 줄 왼쪽의 색 기둥은 옆 띠라
   * 걷었다. 그 줄의 상태는 같은 줄의 상태 조각이 글자로 말한다.
   */
  void tone;

  return (
    <td className="td whitespace-nowrap">
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
      <div className="font-mono text-sm font-semibold text-ink">{id}</div>
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
    <td className="td sticky right-0 bg-[var(--qd-table-fill,var(--color-surface))] text-right">
      {/* 손이 얹히거나 초점이 오면 나온다. 자리는 늘 차지한다 (globals.css) */}
      <span className="row-action inline-flex items-center justify-end gap-1.5">
        {children}
      </span>
    </td>
  );
}

export function ActionTh() {
  return <th className="th sticky right-0" scope="col" aria-label="동작" />;
}

/*
 * 행 전체가 링크인 목록. 구현은 클라이언트 조각이라 따로 두고 여기서 다시
 * 내보낸다. 표 부품은 이 파일 하나에서 가져다 쓰는 것이 규칙이다.
 */
export { RowLink } from './row-link';
