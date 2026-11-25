/* ---------------------------------------------------------------------------
   형명 · UDI 찾기 (0158 · 0159)

   형명 코드, UDI-DI(GTIN-14), 라벨 바코드의 GS1 글((01)…)을 받아 형명을 고른다
   (사용자 2026-11-25 «형명은 입력하면 자동으로 배치되게»). 재단 폼과 수주 등록 폼이 같은 셈을 쓴다.
   가져오는 것이 없다 - 시험(test/cases/40_sales_order.mjs)이 그대로 읽는다.
--------------------------------------------------------------------------- */

/** 넣은 글에서 GTIN-14 를 꺼낸다. (01) 뒤 14자리 · 01 로 시작하는 바코드 글 · 14자리 · 13자리(앞에 0) */
export function gtinOf(input: string): string | null {
  const key = input.replace(/\s/g, '').toUpperCase();
  return key.match(/\(01\)(\d{14})/)?.[1]
    ?? (/^01\d{14}/.test(key) && key.length > 14 ? key.slice(2, 16) : null)
    ?? (/^\d{14}$/.test(key) ? key : /^\d{13}$/.test(key) ? `0${key}` : null);
}

/** 형명 코드(띄어쓰기 · 대소문자 무시)나 UDI-DI 가 맞는 형명. 없으면 undefined */
export function findModel<T extends { code: string; udi?: string | null }>(input: string, pool: T[]): T | undefined {
  const key = input.replace(/\s/g, '').toUpperCase();
  if (!key) return undefined;
  const gtin = gtinOf(input);
  return pool.find((o) => o.code.toUpperCase() === key || (!!gtin && o.udi === gtin));
}
