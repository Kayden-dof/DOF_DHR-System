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
}

/** 설정이 아직 없거나 읽지 못했을 때. 화면이 비어 보이지 않게만 한다 */
const FALLBACK: Brand = {
  companyName: '',
  brandColor: '#562C8D',
  hasLogo: false,
  logoUpdatedAt: null,
};

export const getBrand = cache(async (): Promise<Brand> => {
  try {
    const row = await withActor(null, (db) =>
      db.one<{
        company_name: string; brand_color: string;
        has_logo: boolean; logo_updated_at: string | null;
      }>(
        `select company_name, brand_color,
                (logo_bytes is not null) as has_logo,
                to_char(updated_at, 'YYYYMMDDHH24MISS') as logo_updated_at
           from org_brand limit 1`),
    );
    if (!row) return FALLBACK;
    return {
      companyName: row.company_name,
      brandColor: row.brand_color,
      hasLogo: row.has_logo,
      logoUpdatedAt: row.logo_updated_at,
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
  ].join(';');
}
