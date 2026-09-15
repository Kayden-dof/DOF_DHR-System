import { cache } from 'react';
import { withActor } from './db';

/* ---------------------------------------------------------------------------
   회사 표시 (M5-2 · §2.0)

   이름 · 강조색 · 로고를 설정에서 읽는다. 전에는 세 곳에 박혀 있었다 -
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
  hasDarkLogo: boolean;
  logoUpdatedAt: string | null;
  /* 시스템 이름. 머리줄은 짧은 것, 로그인 화면은 풀어 쓴 것 (0071) */
  systemName: string;
  systemNameLong: string;
  systemTagline: string;
  companyTagline: string;
  /*
   * 제조소를 가리키는 값 (5차 감사 D1). 인쇄물 머리에 회사 이름과 함께
   * 나온다. 비어 있으면 아무것도 나오지 않는다 - 서면 양식이 이미 갖고
   * 있으면 시스템이 낼 이유가 없다.
   */
  /** 본사 소재지. 사업자등록증의 사업장 소재지 */
  address: string;
  /** 제조소 소재지. GMP 제조가 일어나는 자리 (0094) */
  plantAddress: string;
  bizNo: string;
  ceoName: string;
  /*
   * 마지막 백업이 며칠을 넘기면 설정 화면이 묻는가. 그 제조소의 절차가
   * 정한다 (§2.0) - 달마다 뜨는 곳과 분기마다 뜨는 곳이 같을 수 없다.
   */
  backupWarnDays: number;
  /*
   * 유효기한 · 밸리데이션이 며칠 남으면 화면이 눈에 띄게 하는가 (6차 감사 N1).
   * 전에는 네 화면과 함수 하나에 박혀 있었고, 게다가 화면마다 달랐다 -
   * 같은 것을 두 자리가 다르게 말하면 둘 다 못 믿는다.
   */
  expiryWarnDays: number;
  /** 기록 보존 기간(년). 편철 표지에 인쇄된다 (GMP 점검 A6) */
  recordRetentionYears: number;
}

/** 설정이 아직 없거나 읽지 못했을 때. 화면이 비어 보이지 않게만 한다 */
const FALLBACK: Brand = {
  companyName: '',
  brandColor: '#562C8D',
  hasLogo: false,
  hasDarkLogo: false,
  logoUpdatedAt: null,
  systemName: '',
  systemNameLong: '',
  systemTagline: '',
  companyTagline: '',
  address: '',
  plantAddress: '',
  bizNo: '',
  ceoName: '',
  backupWarnDays: 35,
  expiryWarnDays: 30,
  recordRetentionYears: 5,
};

export const getBrand = cache(async (): Promise<Brand> => {
  try {
    const row = await withActor(null, (db) =>
      db.one<{
        company_name: string; brand_color: string;
        has_logo: boolean; has_dark_logo: boolean; logo_updated_at: string | null;
        system_name: string | null; system_name_long: string | null;
        system_tagline: string | null; company_tagline: string | null;
        address: string | null; plant_address: string | null;
        biz_no: string | null; ceo_name: string | null;
        backup_warn_days: number | null; expiry_warn_days: number | null;
        record_retention_years: number | null;
      }>(
        `select company_name, brand_color,
                (logo_bytes is not null) as has_logo,
                (logo_dark_bytes is not null) as has_dark_logo,
                to_char(updated_at, 'YYYYMMDDHH24MISS') as logo_updated_at,
                system_name, system_name_long, system_tagline, company_tagline,
                address, plant_address, biz_no, ceo_name,
                backup_warn_days, expiry_warn_days, record_retention_years
           from org_brand limit 1`),
    );
    if (!row) return FALLBACK;
    return {
      companyName: row.company_name,
      brandColor: row.brand_color,
      hasLogo: row.has_logo,
      hasDarkLogo: row.has_dark_logo,
      logoUpdatedAt: row.logo_updated_at,
      systemName: row.system_name ?? '',
      systemNameLong: row.system_name_long ?? '',
      systemTagline: row.system_tagline ?? '',
      companyTagline: row.company_tagline ?? '',
      address: row.address ?? '',
      plantAddress: row.plant_address ?? '',
      bizNo: row.biz_no ?? '',
      ceoName: row.ceo_name ?? '',
      backupWarnDays: row.backup_warn_days ?? 35,
      expiryWarnDays: row.expiry_warn_days ?? 30,
      recordRetentionYears: row.record_retention_years ?? 5,
    };
  } catch {
    /* 설정 표가 아직 없어도 화면이 서 버리면 안 된다 */
    return FALLBACK;
  }
});

/* ---------------------------------------------------------------------------
   강조색 파생은 lib/tone.ts 로 옮겼다 (2026-09-11)

   회사 표시 화면이 **고른 색에서 무엇이 나오는지 그 자리에서 보여 주려면**
   같은 계산이 브라우저에도 있어야 한다. 이 파일은 DB 를 부르므로 그쪽에서
   부를 수 없다.

   화면이 자기 계산을 따로 두면 두 벌이 되고, 두 벌은 갈라진다 (§10).
   계산만 떼어 내고 여기서 다시 내보낸다 - 부르는 자리는 그대로 둔다.
--------------------------------------------------------------------------- */
export { brandVars, darkTone, brandSteps, type Step } from './tone';


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
