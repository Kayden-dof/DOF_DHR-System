/* ---------------------------------------------------------------------------
   시험이 종이를 뽑는 자리

   회차는 인쇄 단추가 올린다 (2026-09-16). 화면을 여는 것만으로는 대장에 아무
   것도 남지 않으므로, 시험이 "발행된 종이" 를 다루려면 사람이 하는 것과 같은
   순서를 밟아야 한다 - 화면을 열고, 거기 실려 온 발행권으로 발행한다.

   **발행권을 지어내지 않는다.** 서버가 봉한 값이라 지어낼 수도 없지만, 그보다
   시험이 화면을 거치지 않고 대장에 쓰는 길을 알면 그 길이 곧 문이 된다 (§10).
   화면이 내주는 것만 쓴다 - 사람이 못 하는 일은 시험도 못 해야 한다.

   묶음 화면은 발행권을 여럿 낸다. 그때는 여럿이 발행되고 대장도 그만큼 는다.
--------------------------------------------------------------------------- */

/** 화면 HTML 에서 발행권을 긁는다. RSC 직렬화라 따옴표가 이스케이프되어 있다 */
export function tickets(html) {
  return [...new Set(
    [...html.matchAll(/ticket[\\"]+:[\\"]+([A-Za-z0-9_.-]+)/g)].map((m) => m[1]))];
}

/**
 * 화면을 열고 거기 실려 온 발행권으로 발행한다.
 *
 * @returns {Promise<{status:number, html:string, issued:object[]}>}
 *          issued 는 발행 결과. 발행권이 없으면 (열람 · 읽기 전용 · 이미 발행된
 *          화면) 빈 배열이고, 그것도 답이다.
 */
export async function printOut(base, path, cookie) {
  const r = await fetch(base + path, { headers: { cookie }, redirect: 'manual' });
  const html = await r.text();
  const issued = [];
  for (const t of tickets(html)) {
    const p = await fetch(`${base}/print/issue`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ ticket: t }),
    });
    issued.push(await p.json());
  }
  return { status: r.status, html, issued };
}
