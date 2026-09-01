'use client';

import { useActionState, useState } from 'react';
import { saveBrand, uploadLogo, clearLogo, uploadDarkLogo, clearDarkLogo } from './actions';
import { Msg } from '@/components/ui';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   회사 표시 입력 (M5-2)

   색은 강조색 하나만 받는다. 나머지 단계는 lib/brand.ts 가 만든다 - 두 곳에서
   만들면 갈라진다 (§10). 여기서 미리 보기를 그릴 때도 같은 계산을 다시 쓰지
   않고, 고른 색 그대로만 보인다.
--------------------------------------------------------------------------- */

export function BrandForm({ name, color, sys, sysLong, tagline, companyTagline }: {
  name: string; color: string;
  sys: string | null; sysLong: string | null;
  tagline: string | null; companyTagline: string | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveBrand, {});
  const [c, setC] = useState(color);

  return (
    <form action={action} className="space-y-3 px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">회사 이름</label>
          <input name="company_name" defaultValue={name} required autoComplete="off"
                 maxLength={80} className="input" />
          <p className="mt-1 text-xs leading-relaxed text-faint">
            화면 바닥글과 인쇄물에 나옵니다. 로고가 없으면 이 이름이 글자로 나옵니다.
          </p>

          <label className="label mt-3">회사 슬로건</label>
          <input name="company_tagline" defaultValue={companyTagline ?? ''} autoComplete="off"
                 maxLength={80} placeholder="REGENERATIVE HEALTHCARE PLATFORM"
                 className="input" />
          <p className="mt-1 text-xs leading-relaxed text-faint">
            로그인 화면 로고 아래에 옵니다.{' '}
            <b className="text-ink">비워 두면 아무것도 나오지 않습니다.</b>{' '}
            로고 그림에 슬로건이 이미 들어 있으면 비워 두십시오 - 두 번 나옵니다.
          </p>
        </div>

        <div>
          <label className="label">강조색</label>
          <div className="flex items-center gap-2">
            <input type="color" value={c} onChange={(e) => setC(e.target.value)}
                   aria-label="강조색 고르기"
                   className="h-10 w-14 cursor-pointer rounded-md border border-line bg-surface p-1" />
            <input name="brand_color" value={c} onChange={(e) => setC(e.target.value)}
                   pattern="#[0-9A-Fa-f]{6}" required autoComplete="off"
                   className="input font-mono uppercase" />
          </div>
          <p className="mt-1 text-xs leading-relaxed text-faint">
            이 색 하나에서 바탕 · 테두리 · 눌린 상태를 만듭니다. 현장에서 읽히도록
            바탕은 아주 밝게, 글자는 아주 어둡게 고정합니다.
          </p>
        </div>
      </div>

      {/*
        * 시스템 이름도 설정이다 (0071). 다른 제조소가 받아 자기 이름을 넣어도
        * 옆에 남의 제품 이름이 남아 있으면 안 된다.
        */}
      <div className="grid gap-3 border-t border-line-soft pt-3 sm:grid-cols-3">
        <div>
          <label className="label">시스템 이름 (짧게)</label>
          <input name="system_name" defaultValue={sys ?? ''} autoComplete="off"
                 maxLength={20} placeholder="DHR" className="input" />
          <p className="mt-1 text-xs text-faint">머리줄에 붙습니다.</p>
        </div>
        <div>
          <label className="label">풀어 쓴 이름</label>
          <input name="system_name_long" defaultValue={sysLong ?? ''} autoComplete="off"
                 maxLength={80} placeholder="Device History Record" className="input" />
          <p className="mt-1 text-xs text-faint">로그인 화면 제목입니다.</p>
        </div>
        <div>
          <label className="label">한 줄 설명</label>
          <input name="system_tagline" defaultValue={tagline ?? ''} autoComplete="off"
                 maxLength={80} placeholder="제조기록 지원 시스템" className="input" />
          <p className="mt-1 text-xs text-faint">제목 아래에 옵니다.</p>
        </div>
      </div>

      <Msg state={state} />
      <button type="submit" disabled={pending} className="btn-primary h-9 px-4 text-xs">
        {pending ? '저장하는 중' : '저장'}
      </button>
    </form>
  );
}

/* ---------------------------------------------------------------------------
   로고 두 칸 (0074)

   로고 한 장으로 밝은 바탕과 어두운 바탕을 다 감당할 수 없다. 짙은 로고는
   현장 머리줄에서 묻히고 흰 로고는 관리 머리줄에서 묻힌다.

   어두운 바탕용을 올리지 않아도 화면은 빈 곳 없이 돈다 - 밝은 판을 깔고 밝은
   바탕용 로고를 얹는다. 그래서 이 칸은 없어도 되는 칸이고, 화면에도 그렇게
   적는다.
--------------------------------------------------------------------------- */

export function LogoForm({ hasLogo, logoName, hasDarkLogo, darkName, version }: {
  hasLogo: boolean; logoName: string | null;
  hasDarkLogo: boolean; darkName: string | null;
  version: string | null;
}) {
  return (
    <div className="grid gap-0 border-t border-line-soft sm:grid-cols-2 sm:divide-x sm:divide-line-soft">
      <LogoSlot
        title="로고" hint="밝은 바탕에 얹힙니다. 관리 머리줄 · 설정 · 인쇄물."
        has={hasLogo} name={logoName} version={version}
        upload={uploadLogo} clear={clearLogo}
        empty="없음 · 이름이 글자로 나옵니다" onDark={false}
      />
      <LogoSlot
        title="어두운 바탕용 로고"
        hint="로그인 왼쪽 면과 현장 머리줄에 얹힙니다. 흰색 · 밝은 색 로고를 올립니다."
        has={hasDarkLogo} name={darkName} version={version}
        upload={uploadDarkLogo} clear={clearDarkLogo}
        empty="없음 · 밝은 판 위에 위 로고를 얹습니다" onDark
      />
    </div>
  );
}

function LogoSlot({ title, hint, has, name, version, upload, clear, empty, onDark }: {
  title: string; hint: string;
  has: boolean; name: string | null; version: string | null;
  upload: (p: FormState, f: FormData) => Promise<FormState>;
  clear: (p: FormState, f: FormData) => Promise<FormState>;
  empty: string; onDark: boolean;
}) {
  const [up, upAction, upPending] = useActionState<FormState, FormData>(upload, {});
  const [rm, rmAction, rmPending] = useActionState<FormState, FormData>(clear, {});

  return (
    <div className="space-y-3 px-4 py-3">
      <div>
        <span className="label">{title}</span>
        {/*
          * 미리보기 바탕을 쓰일 자리와 같게 둔다. 흰 로고를 흰 바탕에 놓고
          * 보면 아무것도 안 보여서 잘못 올린 줄 안다.
          */}
        <div className={`mt-1 flex h-16 items-center rounded-md border border-line px-3 ${
          onDark ? 'band-dark' : 'bg-surface'}`}>
          {has ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/logo?v=${version ?? '0'}${onDark ? '&dark=1' : ''}`}
                 alt={title} className="max-h-10 w-auto" style={{ objectFit: 'contain' }} />
          ) : (
            <span className={`text-xs ${onDark ? 'text-white/55' : 'text-faint'}`}>{empty}</span>
          )}
        </div>
        {name && <p className="mt-1 truncate text-xs text-faint">{name}</p>}
      </div>

      <form action={upAction} className="space-y-2">
        <p className="text-xs leading-relaxed text-faint">{hint}</p>
        <input type="file" name="logo" accept="image/png" required
               className="block w-full text-xs file:mr-3 file:rounded-md file:border
                          file:border-line file:bg-surface file:px-3 file:py-1.5
                          file:text-xs file:text-ink hover:file:bg-surface-sub" />
        <Msg state={up} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={upPending} className="btn-ghost h-9 px-3 text-xs">
            {upPending ? '올리는 중' : '올리기'}
          </button>
          {has && (
            <button type="submit" form={`clear-${onDark ? 'dark' : 'light'}`}
                    disabled={rmPending} className="btn-quiet h-9 px-3 text-xs">
              {rmPending ? '내리는 중' : '내리기'}
            </button>
          )}
        </div>
      </form>

      {has && (
        <form action={rmAction} id={`clear-${onDark ? 'dark' : 'light'}`}>
          <Msg state={rm} />
        </form>
      )}
    </div>
  );
}

export function LogoNote() {
  return (
    <p className="border-t border-line-soft px-4 py-3 text-xs leading-relaxed text-faint">
      둘 다 <b className="text-ink">PNG</b>, 512 KB 이하.{' '}
      <b className="text-ink">가로 600px 이상</b>을 권합니다 - 종이에 찍히므로 화면에서
      멀쩡해도 인쇄에서 흐려집니다. 바탕이 비치는(투명) 그림이면 어느 자리에나
      얹힙니다.
    </p>
  );
}
