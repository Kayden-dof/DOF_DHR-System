import { createHmac } from 'node:crypto';

/* ---------------------------------------------------------------------------
   시험용 세션 쿠키

   lib/session.ts 와 같은 규칙으로 직접 만든다. 서버 액션 식별자를 긁어 로그인
   흐름을 흉내 내는 방식은 빌드마다 값이 바뀌어 시험이 먼저 깨진다. 서명 규칙은
   우리 것이므로 여기서 맞춰 두는 편이 오래간다. 규칙이 바뀌면 이 파일을 쓰는
   시험이 바로 실패하는데, 그게 맞는 동작이다.
--------------------------------------------------------------------------- */
export function sessionCookie(userId) {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET이 없거나 너무 짧습니다');
  const payload = Buffer
    .from(JSON.stringify({ v: 1, u: userId, e: Date.now() + 8 * 3600 * 1000 }))
    .toString('base64url');
  const sig = createHmac('sha256', Buffer.from(s, 'utf8')).update(payload).digest('base64url');
  return `dhr_session=${payload}.${sig}`;
}

/**
 * 인쇄물 HTML 에서 사람이 읽는 글자만 남긴다.
 *
 * 태그 자리에 빈칸을 하나 넣는다. 그냥 지우면 <td>2026-08-27</td><td>김작업</td>
 * 이 "2026-08-27김작업" 으로 붙어서, 옆 칸 값과 이어진 문자열이 우연히 찾는
 * 값을 품는 일이 생긴다. 붙여 놓고 찾으면 없는 것도 있다고 나온다.
 *
 * 다만 주석은 먼저 통째로 지운다. React 가 서버에서 그릴 때 이어 붙는 글
 * 조각 사이에 <!-- --> 를 끼워 넣는데, 이건 눈에 보이는 경계가 아니다.
 * 빈칸으로 바꾸면 종이에 "1일차" 로 찍히는 것이 "1 일차" 가 되어, 맞게 나온
 * 값을 틀렸다고 말하게 된다.
 */
export function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}
