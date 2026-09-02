'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   회사 표시 저장 (M5-2 · §2.0)

   이름 · 강조색 · 로고. 기록이 아니라 표시이므로 고쳐 쓸 수 있고, 고친 사실은
   감사추적에 남는다. 로고 바이트는 감사추적에 담지 않는다 (0070) - 감사추적이
   답해야 하는 것은 "언제 누가 바꿨는가" 이지 그 그림이 아니다.
--------------------------------------------------------------------------- */

const MAX_BYTES = 512 * 1024;
/* ---------------------------------------------------------------------------
   PNG 만 받는다 (사용자 지시 2026-09-01)

   전에는 SVG 도 받았다. SVG 는 글자 파일이라 두 가지가 따라온다.

   1) 글꼴을 참조한다. 로고를 내보낼 때 글자를 외곽선으로 바꾸지 않으면 그
      글꼴이 없는 기계에서 다른 모양으로 그려지거나 아예 사라진다. 회사 이름이
      든 로고가 그렇게 되면 종이에 틀린 것이 찍힌다.
   2) 스크립트와 바깥 그림을 품을 수 있다. app/logo/route.ts 가 머리로 막고
      여기서 한 번 더 보지만, 막을 것이 없는 형식을 쓰는 편이 낫다.

   PNG 는 픽셀이라 어디서 열어도 같은 그림이다. 대신 확대하면 흐려지므로
   화면에서 안내하는 최소 너비를 지킨다 (LOGO_MIN_WIDTH).
--------------------------------------------------------------------------- */
const KINDS: Record<string, string> = {
  'image/png': 'png',
};

/** PNG 는 이 여덟 바이트로 시작한다. 이름만 .png 인 파일을 걸러 낸다 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function admin() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN')) {
    throw new Error('시스템관리자만 회사 표시를 바꿀 수 있습니다');
  }
  return user;
}

function bump() {
  /* 머리줄 · 바닥글 · 로그인 · 인쇄물이 전부 이 값을 쓴다 */
  revalidatePath('/', 'layout');
  revalidatePath('/login');
}

export async function saveBrand(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();

    const name = String(form.get('company_name') ?? '').trim();
    const color = String(form.get('brand_color') ?? '').trim();
    if (!name) return { error: '회사 이름을 적어 주십시오' };
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return { error: '강조색은 #RRGGBB 여섯 자리로 적어 주십시오' };
    }

    const txt = (k: string) => String(form.get(k) ?? '').trim() || null;

    await withActor(me.id, (db) =>
      db.rows(
        `update org_brand set company_name = $1, brand_color = $2,
                              system_name = $3, system_name_long = $4,
                              system_tagline = $5, company_tagline = $6,
                              address = $7, biz_no = $8, ceo_name = $9,
                              updated_by = $10, updated_at = now()`,
        [name, color, txt('system_name'), txt('system_name_long'),
         txt('system_tagline'), txt('company_tagline'),
         txt('address'), txt('biz_no'), txt('ceo_name'), me.id]),
      { reason: '회사 표시 변경' });

    bump();
    return { ok: true, message: '회사 표시를 저장했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 로고 올리기.
 *
 * 밖으로 나가도 회사가 영향을 받지 않는 파일이라 담는다 (§2.2). 제조기록과
 * 성적서는 여전히 담지 않고 번호로 가리킨다.
 *
 * Vercel 의 파일 체계는 배포마다 사라지므로 DB 에 담는다. 백업에 함께 들어가
 * 복구하면 로고도 같이 돌아온다.
 */
export async function uploadLogo(_p: FormState, form: FormData): Promise<FormState> {
  return putLogo(form, false);
}

/**
 * 어두운 바탕용 로고 올리기 (0074).
 *
 * 로그인 왼쪽 면과 현장 머리줄은 어둡다. 짙은 로고는 거기서 묻히고 흰 로고는
 * 밝은 머리줄에서 묻힌다. 한 장으로 두 바탕을 다 감당할 수 없어 칸을 나눈다.
 */
export async function uploadDarkLogo(_p: FormState, form: FormData): Promise<FormState> {
  return putLogo(form, true);
}

async function putLogo(form: FormData, dark: boolean): Promise<FormState> {
  try {
    const me = await admin();
    const file = form.get('logo');

    if (!(file instanceof File) || file.size === 0) {
      return { error: '올릴 그림을 골라 주십시오' };
    }
    if (!KINDS[file.type]) {
      return { error: 'PNG 만 올릴 수 있습니다' };
    }
    if (file.size > MAX_BYTES) {
      return { error: `그림이 큽니다 (${Math.round(file.size / 1024)} KB). 512 KB 이하로 줄여 주십시오` };
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    /*
     * 붙은 이름이 아니라 속을 본다. 밖에서 받은 파일을 그대로 믿지 않는다 -
     * 확장자만 바꾼 파일이 들어오면 브라우저가 무엇으로 해석할지 알 수 없다.
     */
    if (!bytes.subarray(0, 8).equals(PNG_MAGIC)) {
      return { error: '알맹이가 PNG 가 아닙니다. 이름만 .png 인 파일일 수 있습니다' };
    }

    await withActor(me.id, (db) =>
      db.rows(
        dark
          ? `update org_brand set logo_dark_bytes = $1, logo_dark_mime = $2,
                                  logo_dark_name = $3,
                                  updated_by = $4, updated_at = now()`
          : `update org_brand set logo_bytes = $1, logo_mime = $2, logo_name = $3,
                                  updated_by = $4, updated_at = now()`,
        [bytes, file.type, file.name, me.id]),
      { reason: dark ? '어두운 바탕용 로고 올림' : '회사 로고 올림' });

    bump();
    return { ok: true, message: `${file.name} 을 ${dark ? '어두운 바탕용 ' : ''}로고로 담았습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/** 로고를 내린다. 내리면 회사 이름을 글자로 낸다 */
export async function clearLogo(_p: FormState, _form: FormData): Promise<FormState> {
  return dropLogo(false);
}

/** 어두운 바탕용 로고를 내린다. 내리면 밝은 판 위에 밝은 바탕용 로고를 얹는다 */
export async function clearDarkLogo(_p: FormState, _form: FormData): Promise<FormState> {
  return dropLogo(true);
}

async function dropLogo(dark: boolean): Promise<FormState> {
  try {
    const me = await admin();
    await withActor(me.id, (db) =>
      db.rows(
        dark
          ? `update org_brand set logo_dark_bytes = null, logo_dark_mime = null,
                                  logo_dark_name = null,
                                  updated_by = $1, updated_at = now()`
          : `update org_brand set logo_bytes = null, logo_mime = null, logo_name = null,
                                  updated_by = $1, updated_at = now()`,
        [me.id]),
      { reason: dark ? '어두운 바탕용 로고 내림' : '회사 로고 내림' });
    bump();
    return {
      ok: true,
      message: dark
        ? '어두운 바탕용 로고를 내렸습니다. 밝은 판 위에 로고를 얹습니다.'
        : '로고를 내렸습니다. 회사 이름이 글자로 나옵니다.',
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
