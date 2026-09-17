/* ---------------------------------------------------------------------------
   화면의 폼을 사람처럼 채워 보낸다

   ── 왜 필요한가 ──────────────────────────────────────────────────────────
   §2.0 의 판단 기준은 "다른 제조소가 코드를 고치지 않고 받아 쓸 수 있는가" 다.
   그 말은 **사람이 화면에서 설정을 넣을 수 있는가** 이고, 지금까지 그것을
   묻는 시험이 없었다 (7차 감사 2026-09-16).

     npm run settings   열마다 화면에 칸이 있는지 본다. 저장은 안 본다
     npm run smoke      화면이 그려지는지 본다. POST 를 한 번도 안 한다
     npm run fresh      자료가 서고 흐르는지 본다. 그런데 씨앗이 SQL 로 넣는다

   셋 사이에 구멍이 있었다 - `scripts/settings-cover.mjs` 자신이 "스크립트는
   화면이 아니다" 라고 적어 두었는데, 정작 그 스크립트가 §2.0 의 증명을 맡고
   있었다. 칸이 있고 화면이 그려지는데 저장이 안 되면 아무도 모른다.

   ── 액션 식별자를 지어내지 않는다 ────────────────────────────────────────
   Next 의 서버 액션은 폼 안에 `$ACTION_ID_…` 를 숨겨 두고, 그 값은 빌드마다
   바뀐다. 그것을 시험이 지어내면 빌드할 때마다 시험이 먼저 깨진다
   (scripts/session-cookie.mjs 가 로그인에서 같은 함정을 적어 두었다).

   그래서 **화면이 내준 것을 그대로 돌려보낸다.** 화면을 열고, 거기 그려진
   폼의 숨은 값을 전부 실어, 사람이 채울 칸만 바꿔 보낸다. 사람이 브라우저
   없이 하는 것과 같은 일이고, 사람이 못 하는 일은 시험도 못 한다.

   ── 무엇을 못 하는가 ─────────────────────────────────────────────────────
   대화상자 안에서 눌러야 비로소 그려지는 폼은 첫 HTML 에 없다. 그런 자리는
   여기서 닿지 않는다 - 닿는 것만 시험하고, 닿지 않는 것은 그렇다고 적는다.
--------------------------------------------------------------------------- */

/** HTML 에서 <form> 안쪽 조각을 뽑는다 */
export function forms(html) {
  return html.split('<form').slice(1).map((s) => s.split('</form>')[0]);
}

/**
 * 폼 조각에서 보낼 값을 읽는다.
 *
 * 숨은 값(`$ACTION_…`)은 그대로 실어야 액션이 선다. 고르개는 지금 골라져 있는
 * 것을, 없으면 첫 번째를 집는다 - 사람이 열었을 때 보이는 것과 같다.
 */
export function fields(form) {
  const out = new Map();

  for (const m of form.matchAll(/<input\b[^>]*>/g)) {
    const tag = m[0];
    const name = tag.match(/\bname="([^"]*)"/)?.[1];
    if (!name) continue;
    const type = tag.match(/\btype="([^"]*)"/)?.[1] ?? 'text';
    if (type === 'checkbox' || type === 'radio') {
      if (/\bchecked\b/.test(tag)) out.set(name, tag.match(/\bvalue="([^"]*)"/)?.[1] ?? 'on');
      continue;
    }
    out.set(name, unescapeHtml(tag.match(/\bvalue="([^"]*)"/)?.[1] ?? ''));
  }

  for (const m of form.matchAll(/<select\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const [, name, body] = m;
    const sel = [...body.matchAll(/<option\b[^>]*>/g)].find((o) => /\bselected\b/.test(o[0]))
      ?? [...body.matchAll(/<option\b[^>]*>/g)][0];
    if (sel) out.set(name, unescapeHtml(sel[0].match(/\bvalue="([^"]*)"/)?.[1] ?? ''));
  }

  for (const m of form.matchAll(/<textarea\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/textarea>/g)) {
    out.set(m[1], unescapeHtml(m[2]));
  }

  return out;
}

function unescapeHtml(s) {
  return s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * 화면을 열어 폼을 고르고, 채워서 보낸다.
 *
 * @param want  그 폼에 있어야 하는 칸 이름들. 이것으로 폼을 가려낸다
 * @param values 바꿀 값. 나머지는 화면에 있던 그대로 간다
 * @returns {Promise<{ok:boolean, status:number, reason?:string, sent?:Map}>}
 */
export async function submitForm(base, path, cookie, want, values) {
  const html = await (await fetch(base + path, { headers: { cookie } })).text();

  const hit = forms(html)
    .map((f) => ({ f, v: fields(f) }))
    .find(({ v }) => want.every((k) => v.has(k)));

  if (!hit) return { ok: false, status: 0, reason: `그 폼이 화면에 없습니다 (${want.join(', ')})` };

  const body = new FormData();
  for (const [k, v] of hit.v) body.append(k, v);
  for (const [k, v] of Object.entries(values)) body.set(k, String(v));

  const r = await fetch(base + path, {
    method: 'POST', headers: { cookie }, body, redirect: 'manual',
  });
  /* 서버 액션은 리다이렉트나 RSC 를 돌려준다. 성공 여부는 DB 가 답한다 */
  return { ok: r.status < 400, status: r.status, sent: hit.v };
}
