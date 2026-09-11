/* ---------------------------------------------------------------------------
   망 경계 - 어디에서 들어왔는가

   이 프로그램은 지금 인터넷 전체에 열려 있다. 문은 여섯 자리 숫자 하나다.
   시도 제한이 있어 전수로 밀어 열기는 어렵지만, 그 문 앞에 아무나 설 수
   있다는 사실 자체가 경계가 없다는 뜻이다.

   **소스가 밖으로 나가도 운영할 수 없어야 한다** (사용자 요구 2026-09-10).
   코드에는 비밀이 없고(열쇠는 전부 환경값이다), 자료는 DB 에 있고, 그 DB 로
   가는 길은 이 프로그램뿐이다. 그러면 남는 것은 "이 프로그램에 닿을 수 있는
   자리를 좁히는 것" 하나다.

   ── 판정하지 않는다 ───────────────────────────────────────────────────────
   여기는 GMP 판정과 무관하다 (§1). 기록을 막지도, 고치지도, 만들지도 않는다.
   문 앞에 서는 사람을 줄일 뿐이다. S01~S05 와 나란히 두지 않는다.

   ── 코드에 주소를 박지 않는다 (§2.0) ──────────────────────────────────────
   제조소 주소는 이 회사의 값이다. 환경값 ALLOW_FROM 에서 온다. 비어 있으면
   **아무도 막지 않는다** - 배포 한 번으로 전원이 잠기는 일이 없어야 한다.
--------------------------------------------------------------------------- */

/** 허용 구간 하나. IPv4 와 IPv6 를 섞지 않는다. */
export interface Rule { v6: boolean; net: bigint; bits: number }

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HEX4 = /^[0-9a-fA-F]{1,4}$/;

function readV4(s: string): bigint | null {
  const m = V4.exec(s);
  if (!m) return null;
  let out = 0n;
  for (let i = 1; i <= 4; i += 1) {
    const n = Number(m[i]);
    if (n > 255) return null;
    out = (out << 8n) | BigInt(n);
  }
  return out;
}

function readV6(s: string): bigint | null {
  let str = s;

  /* ::ffff:203.0.113.9 처럼 꼬리가 IPv4 인 표기 */
  const tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(str);
  if (tail) {
    const n = readV4(tail[1]);
    if (n === null) return null;
    str = str.slice(0, tail.index)
      + (n >> 16n).toString(16) + ':' + (n & 0xffffn).toString(16);
  }

  const half = str.split('::');
  if (half.length > 2) return null;
  const head = half[0] === '' ? [] : half[0].split(':');
  const rest = half.length === 2 ? (half[1] === '' ? [] : half[1].split(':')) : [];

  let groups: string[];
  if (half.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;                 /* :: 는 최소 한 자리를 줄인다 */
    groups = [...head, ...Array<string>(fill).fill('0'), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  let out = 0n;
  for (const g of groups) {
    if (!HEX4.test(g)) return null;
    out = (out << 16n) | BigInt(parseInt(g, 16));
  }
  return out;
}

/**
 * 주소 한 개를 읽는다. IPv4-매핑(`::ffff:1.2.3.4`)은 IPv4 로 되돌린다 -
 * 그러지 않으면 `1.2.3.0/24` 로 적어 둔 규칙이 같은 주소를 못 알아본다.
 */
export function readAddr(ip: string): { v6: boolean; v: bigint } | null {
  const s = ip.trim();
  if (s === '') return null;
  if (!s.includes(':')) {
    const v = readV4(s);
    return v === null ? null : { v6: false, v };
  }
  const v = readV6(s);
  if (v === null) return null;
  if (v >> 32n === 0xffffn) return { v6: false, v: v & 0xffffffffn };
  return { v6: true, v };
}

/** `203.0.113.9` · `203.0.113.0/24` · `2001:db8::/32` 하나를 읽는다. */
export function readRule(text: string): Rule | null {
  const parts = text.trim().split('/');
  if (parts.length > 2) return null;
  const addr = readAddr(parts[0]);
  if (!addr) return null;
  const full = addr.v6 ? 128 : 32;
  if (parts.length === 1) return { v6: addr.v6, net: addr.v, bits: full };
  if (!/^\d{1,3}$/.test(parts[1])) return null;
  const bits = Number(parts[1]);
  if (bits > full) return null;
  return { v6: addr.v6, net: addr.v, bits };
}

/**
 * 환경값 한 줄을 규칙 목록으로. 쉼표 · 공백 · 줄바꿈으로 나눈다.
 *
 * 못 읽은 조각은 버리지 않고 돌려준다. 조용히 버리면 오타 하나가 그 주소를
 * 통째로 빼먹은 채 문이 닫힌 것처럼 보인다.
 */
export function readAllow(raw: string | undefined | null): { rules: Rule[]; bad: string[] } {
  const rules: Rule[] = [];
  const bad: string[] = [];
  for (const part of String(raw ?? '').split(/[,\s]+/)) {
    if (part === '') continue;
    const r = readRule(part);
    if (r) rules.push(r); else bad.push(part);
  }
  return { rules, bad };
}

/** 이 주소가 규칙 중 하나에 드는가. 규칙이 없으면 묻지 않는다(부르는 쪽 책임). */
export function allows(rules: Rule[], ip: string): boolean {
  const a = readAddr(ip);
  if (!a) return false;
  return rules.some((r) => {
    if (r.v6 !== a.v6) return false;
    const shift = BigInt((a.v6 ? 128 : 32) - r.bits);
    return (a.v >> shift) === (r.net >> shift);
  });
}

/* ---------------------------------------------------------------------------
   접속지를 어디서 읽는가

   Vercel 뒤에 있으면 `x-vercel-forwarded-for` 를 Vercel 이 직접 채운다.
   브라우저가 보낸 값이 아니므로 꾸며 낼 수 없다. 이것을 먼저 본다.

   `x-forwarded-for` 는 그다음이다. 앞에 프록시가 없으면 브라우저가 마음대로
   보낼 수 있는 값이라, 프록시 뒤가 아닌 곳에서는 이 검사가 뜻이 없다.
   **그래서 이것은 두 겹 중 안쪽 겹이다** - 바깥 겹은 Vercel 방화벽이고,
   여기는 그 겹이 뚫렸거나 꺼졌을 때 한 번 더 묻는 자리다.
--------------------------------------------------------------------------- */
export function clientIp(h: { get(name: string): string | null }): string | null {
  for (const name of ['x-vercel-forwarded-for', 'x-real-ip', 'x-forwarded-for']) {
    const v = h.get(name);
    if (!v) continue;
    const first = v.split(',')[0].trim();
    if (first !== '') return first;
  }
  return null;
}

/* ---------------------------------------------------------------------------
   접속지의 나라 (사용자 물음 2026-09-11)

   제조소 공인 주소가 유동이면 주소 목록은 바뀔 때마다 사람이 고쳐야 하고,
   고치기 전까지 제조소가 잠긴다. **나라는 주소가 바뀌어도 안 바뀐다.**

   ── 브라우저 위치(GPS)와 다른 물건이다 ───────────────────────────────────
   `navigator.geolocation` 은 **브라우저가 보내는 값**이다. 코드를 쥔 사람이
   제조소 좌표를 지어 보내면 그대로 통과하므로, 우리가 막으려는 바로 그
   상대에게 아무 소용이 없다. 실내 측위 오차로 멀쩡한 현장이 잠기는 위험은
   덤이다.

   여기서 읽는 것은 **Vercel 이 IP 를 보고 채운 값**이다. 브라우저가 손댈
   자리가 없다.

   ── 이것은 경계가 아니라 걸러 내기다 ──────────────────────────────────────
   한국 안이면 전부 통과한다. "제조소만" 이 아니라 "전 세계에서 한국으로" 다.
   줄어드는 폭은 크지만(자동 시도는 대부분 밖에서 온다) 이것 하나로 문이
   닫혔다고 말하지 않는다.
--------------------------------------------------------------------------- */
export function clientCountry(h: { get(name: string): string | null }): string | null {
  const v = h.get('x-vercel-ip-country');
  if (!v) return null;
  const s = v.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

/** 나라 목록. `KR` · `KR,JP` 처럼 적는다. 못 읽은 조각은 함께 돌려준다. */
export function readCountries(raw: string | undefined | null): { list: string[]; bad: string[] } {
  const list: string[] = [];
  const bad: string[] = [];
  for (const part of String(raw ?? '').split(/[,\s]+/)) {
    if (part === '') continue;
    const s = part.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(s)) { if (!list.includes(s)) list.push(s); } else bad.push(part);
  }
  return { list, bad };
}

/**
 * 도시와 시·도. 좁힐 수 있는지 며칠 지켜보라고 화면에 찍는 값이다.
 * 판정에 쓰지 않는다 - 유동 주소는 시·도가 흔들려 멀쩡한 현장을 잠글 수 있다.
 */
export function clientPlace(h: { get(name: string): string | null }): string | null {
  const region = h.get('x-vercel-ip-country-region');
  const raw = h.get('x-vercel-ip-city');
  let city = raw ?? '';
  /* 한글 도시 이름은 주소 인코딩되어 온다 */
  try { city = decodeURIComponent(city); } catch { /* 그대로 쓴다 */ }
  const parts = [region, city].filter((x) => x && x.trim() !== '');
  return parts.length > 0 ? parts.join(' ') : null;
}

/* ---------------------------------------------------------------------------
   지금 켜져 있는가

   설정 > 개요가 이것을 화면에 적는다. 열쇠(CRON_SECRET · PRINT_SECRET)를
   다루는 방식과 같다 - **조용히 열려 있지 않게** 한다. 꺼진 것이 잘못은
   아니지만, 꺼진 줄 모르는 것은 잘못이다.
--------------------------------------------------------------------------- */
export function allowState(): {
  on: boolean; count: number; bad: string[];
  countries: string[]; countryBad: string[];
} {
  const { rules, bad } = readAllow(process.env.ALLOW_FROM);
  const { list, bad: countryBad } = readCountries(process.env.ALLOW_COUNTRY);
  return {
    on: rules.length > 0 || list.length > 0,
    count: rules.length,
    bad,
    countries: list,
    countryBad,
  };
}
