'use client';

import { useActionState, useState } from 'react';
import { saveBrand, uploadLogo, clearLogo } from './actions';
import { Msg } from '@/components/ui';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   회사 표시 입력 (M5-2)

   색은 강조색 하나만 받는다. 나머지 단계는 lib/brand.ts 가 만든다 - 두 곳에서
   만들면 갈라진다 (§10). 여기서 미리 보기를 그릴 때도 같은 계산을 다시 쓰지
   않고, 고른 색 그대로만 보인다.
--------------------------------------------------------------------------- */

export function BrandForm({ name, color, sys, sysLong, tagline }: {
  name: string; color: string;
  sys: string | null; sysLong: string | null; tagline: string | null;
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

export function LogoForm({ hasLogo, logoName, version }: {
  hasLogo: boolean; logoName: string | null; version: string | null;
}) {
  const [up, upAction, upPending] = useActionState<FormState, FormData>(uploadLogo, {});
  const [rm, rmAction, rmPending] = useActionState<FormState, FormData>(clearLogo, {});

  return (
    <div className="border-t border-line-soft px-4 py-3">
      <div className="flex flex-wrap items-start gap-5">
        <div className="w-48 shrink-0">
          <span className="label">지금 로고</span>
          <div className="mt-1 flex h-16 items-center rounded-md border border-line bg-surface px-3">
            {hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/logo?v=${version ?? '0'}`} alt="회사 로고"
                   className="max-h-10 w-auto" style={{ objectFit: 'contain' }} />
            ) : (
              <span className="text-xs text-faint">없음 · 이름이 글자로 나옵니다</span>
            )}
          </div>
          {logoName && <p className="mt-1 truncate text-xs text-faint">{logoName}</p>}
        </div>

        <form action={upAction} className="min-w-[16rem] flex-1 space-y-2">
          <label className="label">로고 올리기</label>
          <input type="file" name="logo" accept="image/png" required
                 className="block w-full text-xs file:mr-3 file:rounded-md file:border
                            file:border-line file:bg-surface file:px-3 file:py-1.5
                            file:text-xs file:text-ink hover:file:bg-surface-sub" />
          <p className="text-xs leading-relaxed text-faint">
            <b className="text-ink">PNG</b>, 512 KB 이하. 화면 머리줄과 인쇄물 머리에
            같은 그림이 나옵니다.
            <br />
            <b className="text-ink">가로 600px 이상</b>을 권합니다. 종이에 찍히므로
            화면에서 멀쩡해도 인쇄에서 흐려집니다.
            <br />
            바탕이 비치는(투명) 그림이면 밝은 자리와 어두운 자리 모두에 얹힙니다.
          </p>
          <Msg state={up} />
          <button type="submit" disabled={upPending} className="btn-ghost h-9 px-3 text-xs">
            {upPending ? '올리는 중' : '올리기'}
          </button>
        </form>
      </div>

      {hasLogo && (
        <form action={rmAction} className="mt-3">
          <Msg state={rm} />
          <button type="submit" disabled={rmPending} className="btn-ghost h-8 px-3 text-xs">
            {rmPending ? '내리는 중' : '로고 내리기'}
          </button>
        </form>
      )}
    </div>
  );
}
