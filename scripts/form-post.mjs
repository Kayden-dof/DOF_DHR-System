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
   대화상자 안에서 눌러야 비로소 그려지는 폼은 첫 HTML 에 없다. `submitForm` 은
   그런 자리에 닿지 않는다 - 그 자리는 아래 `clientActionId` · `postClientAction`
   이 닿는다. 그것도 못 닿는 곳은 그렇다고 적는다.
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

  /*
   * 폼을 고를 때는 단추 이름도 센다.
   *
   * 단추(<button name="state" value="…">)는 **누른 것만** 전송되므로 보낼 값에
   * 넣으면 안 된다. 다만 그 이름이 곧 그 폼이 무엇을 하는 자리인지를 말하므로,
   * 고르는 데는 쓴다. 이것을 안 보면 단추로 값을 정하는 폼은 영영 못 찾는다.
   */
  const hit = forms(html)
    .map((f) => ({
      f,
      v: fields(f),
      names: new Set([
        ...fields(f).keys(),
        ...[...f.matchAll(/<button[^>]*name="([^"]*)"/g)].map((m) => m[1]),
      ]),
    }))
    .find(({ names }) => want.every((k) => names.has(k)));

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

/* ---------------------------------------------------------------------------
   버튼을 눌러야 그려지는 폼의 액션을 부른다

   위의 `submitForm` 은 첫 HTML 에 있는 폼만 닿는다. 채번 규칙의 등록 폼처럼
   `규칙 교체` 를 눌러야 비로소 그려지는 폼은 첫 HTML 에 없어, 지금까지 시험이
   닿지 못했다 (그 자리는 "닿지 않는다" 고 적어 두었다).

   ── 식별자는 지어내지 않는다 ─────────────────────────────────────────────
   액션 식별자는 빌드마다 바뀐다. 그 폼을 그리는 클라이언트 부품이 이미 화면에
   실려 오고, 그 조각 안에 "이 파일의 이 이름이 이 식별자" 라는 표시가 있다.
   화면이 내준 조각에서 읽는다 - 사람의 브라우저가 쓰는 것과 같은 값이다.

   개발 서버가 내주는 조각에만 그 표시가 있다. 이 시험은 개발 서버(localhost)
   만 가리키므로 걸리지 않지만, 못 찾으면 조용히 건너뛰지 않고 이유를 돌려준다.

   ── 보내는 모양 ──────────────────────────────────────────────────────────
   `useActionState` 로 묶인 폼이 서버에서 그려질 때 내는 숨은 칸(`$ACTION_REF_n`
   · `$ACTION_n:0` · `$ACTION_n:1` · `$ACTION_KEY`)을 그대로 만들어 실어 보낸다.
   첫 인자(이전 상태)는 빈 객체다 - 폼이 처음 열렸을 때와 같다.
--------------------------------------------------------------------------- */

/**
 * 화면이 싣고 오는 클라이언트 조각에서 서버 액션의 식별자를 읽는다.
 *
 * @param pathHint 액션이 든 파일 경로의 일부 (같은 이름이 여러 파일에 있을 때 가린다)
 * @returns {Promise<{id?: string, reason?: string}>}
 */
export async function clientActionId(base, path, cookie, name, pathHint) {
  const html = await (await fetch(base + path, { headers: { cookie } })).text();
  const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
  const re = new RegExp(
    String.raw`__next_internal_action_entry_do_not_use__ \[\{"([0-9a-f]+)":\{"name":"${name}"\}\},"([^"]*)"`);
  for (const src of srcs) {
    const js = await (await fetch(base + src, { headers: { cookie } })).text();
    const m = js.match(re);
    if (m && (!pathHint || m[2].includes(pathHint))) return { id: m[1] };
  }
  return { reason: `${path} 이 싣고 오는 조각에서 ${name} 의 식별자를 찾지 못했습니다` };
}

/**
 * 식별자로 액션을 바로 부른다. 폼이 서버에서 그려질 때 내는 숨은 칸을 만들어 싣는다.
 *
 * @param values 폼 칸 값. 사람이 채울 칸과 화면이 숨겨 둔 칸을 모두 넣는다
 * @returns {Promise<{ok:boolean, status:number, body:string}>}
 */
export async function postClientAction(base, path, cookie, id, values) {
  const body = new FormData();
  body.append('$ACTION_REF_1', '');
  body.append('$ACTION_1:0', JSON.stringify({ id, bound: '$@1' }));
  body.append('$ACTION_1:1', '[{}]');
  body.append('$ACTION_KEY', 'k0');
  for (const [k, v] of Object.entries(values)) body.set(k, String(v));

  const r = await fetch(base + path, {
    method: 'POST', headers: { cookie }, body, redirect: 'manual',
  });
  return { ok: r.status < 400, status: r.status, body: await r.text() };
}
