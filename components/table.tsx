import Link from 'next/link';

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
}: { id: React.ReactNode; sub?: React.ReactNode; tone?: 'warn' | 'danger' | 'ok' | 'brand' }) {
  const bar = tone && {
    warn: 'bg-warn', danger: 'bg-danger', ok: 'bg-ok', brand: 'bg-brand',
  }[tone];

  return (
    <td className="td relative whitespace-nowrap pl-5">
      {bar && <span aria-hidden className={`absolute inset-y-1.5 left-1.5 w-[3px] rounded-full ${bar}`} />}
      <div className="font-mono text-[0.8125rem] font-bold text-ink">{id}</div>
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
      {children}
    </td>
  );
}

export function ActionTh() {
  return <th className="th sticky right-0 w-0 shadow-[-10px_0_10px_-10px_rgb(31_29_36/.14)]" />;
}

/** 행 전체가 링크인 목록. 마지막 칸의 작은 단추를 겨냥하게 만들지 않는다. */
export function RowLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <tr className="group">
      {children}
      <ActionTd>
        <Link href={href} className="btn-quiet h-7 opacity-60 transition-opacity group-hover:opacity-100">
          열기
        </Link>
      </ActionTd>
    </tr>
  );
}
