import { cache } from 'react';
import { withActor } from './db';

/* ---------------------------------------------------------------------------
   회사 표시 (M5-2 · §2.0)

   이름 · 강조색 · 로고를 설정에서 읽는다. 전에는 세 곳에 박혀 있었다 —
   화면의 `DOF Inc.`, `globals.css` 의 `#562C8D`, `components/logo.tsx` 의 벡터.

   ── 파생은 여기서만 한다 ──────────────────────────────────────────────────
   강조색 하나를 받아 일곱 단계를 만든다. 화면과 인쇄가 각자 만들면 갈라진다
   (§10). 규격 표기가 두 곳으로 갈려 종이에 10배 틀린 치수가 나간 적이 있다.

   ── 한 요청에 한 번만 읽는다 ──────────────────────────────────────────────
   머리줄 · 바닥글 · 인쇄물 머리가 저마다 부르므로 cache 로 묶는다. 요청이
   끝나면 버린다 - 설정을 바꾼 직후 다음 요청부터 바로 반영되어야 한다.
--------------------------------------------------------------------------- */

export interface Brand {
  companyName: string;
  brandColor: string;
  hasLogo: boolean;
  logoUpdatedAt: string | null;
  /* 시스템 이름. 머리줄은 짧은 것, 로그인 화면은 풀어 쓴 것 (0071) */
  systemName: string;
  systemNameLong: string;
  systemTagline: string;
  companyTagline: string;
}

/** 설정이 아직 없거나 읽지 못했을 때. 화면이 비어 보이지 않게만 한다 */
const FALLBACK: Brand = {
  companyName: '',
  brandColor: '#562C8D',
  hasLogo: false,
  logoUpdatedAt: null,
  systemName: '',
  systemNameLong: '',
  systemTagline: '',
  companyTagline: '',
};

export const getBrand = cache(async (): Promise<Brand> => {
  try {
    const row = await withActor(null, (db) =>
      db.one<{
        company_name: string; brand_color: string;
        has_logo: boolean; logo_updated_at: string | null;
        system_name: string | null; system_name_long: string | null;
        system_tagline: string | null; company_tagline: string | null;
      }>(
        `select company_name, brand_color,
                (logo_bytes is not null) as has_logo,
                to_char(updated_at, 'YYYYMMDDHH24MISS') as logo_updated_at,
                system_name, system_name_long, system_tagline, company_tagline
           from org_brand limit 1`),
    );
    if (!row) return FALLBACK;
    return {
      companyName: row.company_name,
      brandColor: row.brand_color,
      hasLogo: row.has_logo,
      logoUpdatedAt: row.logo_updated_at,
      systemName: row.system_name ?? '',
      systemNameLong: row.system_name_long ?? '',
      systemTagline: row.system_tagline ?? '',
      companyTagline: row.company_tagline ?? '',
    };
  } catch {
    /* 설정 표가 아직 없어도 화면이 서 버리면 안 된다 */
    return FALLBACK;
  }
});

/* ---------------------------------------------------------------------------
   강조색 한 개에서 일곱 단계

   globals.css 가 쓰는 이름 그대로 만든다. 거기 있던 DOF 자주색의 밝기 관계를
   비율로 옮긴 것이라, 다른 색을 넣어도 같은 짜임이 나온다.

     brand       그대로
     deep        어둡게      제목 · 눌린 상태
     mid         조금 밝게   보조
     soft/tint   아주 밝게   바탕
     line        중간 밝게   테두리
     pale        연하게      비활성

   ── 대비를 지킨다 ────────────────────────────────────────────────────────
   현장은 밝은 조명에서 장갑 낀 손으로 본다. 바탕색은 아주 밝게, 글자색은 아주
   어둡게 고정해 어떤 강조색을 넣어도 읽히게 한다.
--------------------------------------------------------------------------- */

function toRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v)))
    .toString(16).padStart(2, '0')).join('');

/** 흰색 쪽으로 t 만큼 (0=그대로 1=흰색) */
const lighten = ([r, g, b]: [number, number, number], t: number) =>
  hex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);

/** 검정 쪽으로 t 만큼 */
const darken = ([r, g, b]: [number, number, number], t: number) =>
  hex(r * (1 - t), g * (1 - t), b * (1 - t));

/* ---------------------------------------------------------------------------
   클라이언트 부품이 쓸 회사 표시

   `app/error.tsx` 는 클라이언트 부품이어야 해서 설정을 읽지 못한다. 뿌리 배치가
   :root 로 한 줄 내려보내면 그 화면도 회사 표시를 낼 수 있다.

   값은 CSS `content` 에 그대로 들어간다. 로고가 있으면 url(...) 이라 그림으로
   바뀌고, 없으면 따옴표 안의 글이라 이름이 나온다. 갈래를 자바스크립트로 나누지
   않으므로 첫 HTML 에서 이미 맞다.

   둘 다 없으면 아무것도 내려보내지 않는다 - 지어내지 않는다.
--------------------------------------------------------------------------- */
export function brandMarkVar(
  b: { hasLogo: boolean; logoUpdatedAt: string | null; companyName: string },
): string {
  if (b.hasLogo) return `--brand-mark:url("/logo?v=${b.logoUpdatedAt ?? '0'}")`;
  if (!b.companyName) return '';
  /* CSS 글에 들어가므로 역슬래시와 따옴표를 막는다 */
  const safe = b.companyName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `--brand-mark:"${safe}"`;
}

/**
 * 어두운 면의 색. 현장 머리띠 · 주소창 · 설치 화면 바탕이 같은 값을 쓴다.
 * brandVars 의 --color-indigo 와 같은 계산이다 - 두 곳에서 만들면 갈라진다.
 */
export function darkTone(color: string): string {
  return darken(toRgb(color), 0.38);
}

export function brandVars(color: string): string {
  const rgb = toRgb(color);
  return [
    `--color-brand:${color}`,
    `--color-brand-deep:${darken(rgb, 0.28)}`,
    `--color-brand-mid:${lighten(rgb, 0.22)}`,
    `--color-brand-soft:${lighten(rgb, 0.94)}`,
    `--color-brand-tint:${lighten(rgb, 0.91)}`,
    `--color-brand-line:${lighten(rgb, 0.7)}`,
    `--color-brand-pale:${lighten(rgb, 0.45)}`,
    /*
     * 어두운 면. 현장 화면의 머리띠와 바닥이 이 색이다. 전에는 DOF 법인
     * 남보라(#342C68)가 globals.css 에 박혀 있었다 - 다른 제조소가 받으면
     * 자기 로고 옆에 남의 회사 색이 깔린다.
     */
    `--color-indigo:${darkTone(color)}`,
    `--color-indigo-deep:${darken(rgb, 0.58)}`,
    `--color-indigo-soft:${darken(rgb, 0.18)}`,
  ].join(';');
}
