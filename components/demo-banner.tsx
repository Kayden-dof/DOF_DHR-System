'use client';

import { useActionState } from 'react';
import { Dialog, useDialog } from './dialog';
import { Msg } from './ui';
import { purgeDemoData } from '@/app/demo-actions';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   시연 자료 경고 띠

   운영 DB 에 지어낸 배치 기록이 들어 있는 동안 모든 화면 맨 위에 띤다.
   눈에 거슬리는 것이 목적이다 - 거슬려야 지운다 (사용자 지시).

   ── 왜 이렇게까지 하는가 ──────────────────────────────────────────────────
   이 시스템에는 삭제가 없다 (§1). 실 기록이 한 줄이라도 들어간 뒤에는 지어낸
   기록과 진짜 기록을 갈라낼 방법이 없다. 그 지점을 지나면 되돌릴 수 없으므로,
   지나기 전에 반복해서 알린다.

   닫는 단추를 두지 않는다. 닫히면 잊는다. 자료를 비우면 띠도 함께 사라진다.

   ── 안내가 아니라 단추다 ──────────────────────────────────────────────────
   처음에는 터미널 명령을 적어 두었는데, 그 명령을 칠 자리가 없는 사람에게는
   아무 소용이 없다는 지적을 받았다 (사용자). 알리는 자리와 처리하는 자리가
   같아야 한다. 시스템관리자에게는 여기서 바로 비울 수 있는 단추를 준다.

   한 번 비우면 표시가 사라지고 띠와 단추가 함께 사라진다. 두 번 누를 수 있는
   물건이 아니다.

   인쇄물에는 나오지 않는다. 종이가 정본이고 거기엔 서명이 들어가므로 화면
   경고가 끼어들 자리가 아니다 - 다만 그 종이 자체가 시연물이라는 것은
   워터마크와 자료 식별자로 추적된다.
--------------------------------------------------------------------------- */
export default function DemoBanner({
  seededAt, canPurge,
}: { seededAt: string | null; canPurge: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(purgeDemoData, {});
  const { open, setOpen } = useDialog(state);

  if (!seededAt) return null;

  const when = seededAt.slice(0, 16).replace('T', ' ');

  return (
    <div className="no-print border-b border-danger/40 bg-danger-bg">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5">
        <span className="chip shrink-0 bg-danger text-white">시연 자료</span>
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink">
          <b>지어낸 배치 기록이 들어 있습니다.</b> 실 운영을 시작하기 전에 반드시
          비우십시오. 이 시스템에는 삭제가 없어, 실 기록이 한 줄이라도 들어간 뒤에는
          지어낸 기록과 갈라낼 수 없습니다.
        </p>

        {canPurge ? (
          <button type="button" onClick={() => setOpen(true)}
                  className="btn-ghost h-8 shrink-0 border-danger/40 px-3 text-xs">
            시연 자료 비우기
          </button>
        ) : (
          /* 시스템관리자만 비울 수 있다. 누구에게 말해야 하는지는 알려 준다 */
          <span className="shrink-0 text-xs text-muted">시스템관리자가 비웁니다</span>
        )}
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="시연 자료 비우기"
        note={`${when} 에 넣은 시연 자료를 전부 지웁니다. 되돌릴 수 없습니다.`}
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-surface p-3">
            <p className="text-xs font-semibold text-ink">지워지는 것</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              작업 지시 · 제품 로트 · 공정 기록 · 자재 투입 · 재고 증감 · 인쇄 이력 ·
              일차 잠금 · 부적합 · 멸균 · 출고, 그리고 자재 로트와 발주.
            </p>
            <p className="mt-2 text-xs font-semibold text-ink">남는 것</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              품목 · 공급자 · 제품표준서 · 설비 · 채번 규칙 · 계정, 그리고 감사추적.
              비웠다는 사실도 감사추적에 남습니다.
            </p>
          </div>

          <p className="text-xs leading-relaxed text-muted">
            시연 자료를 넣은 뒤에 기록이 한 줄이라도 더 쌓였으면 비우지 않습니다.
            그 경우 지어낸 기록과 실제 기록을 갈라낼 수 없기 때문입니다.
          </p>

          <form action={action} className="space-y-3">
            <label className="block">
              <span className="label">확인</span>
              <input
                name="confirm"
                autoComplete="off"
                placeholder="비웁니다"
                className="input mt-1 w-full"
              />
              <span className="mt-1 block text-xs text-muted">
                비우려면 <b className="text-ink">비웁니다</b> 를 그대로 적어 주십시오.
              </span>
            </label>

            <div className="flex items-center gap-2">
              <button type="submit" disabled={pending} className="btn-danger h-9 px-3 text-xs">
                {pending ? '비우는 중' : '비웁니다'}
              </button>
              <button type="button" onClick={() => setOpen(false)}
                      className="btn-quiet h-9 px-3 text-xs">
                그만두기
              </button>
              <Msg state={state} />
            </div>
          </form>
        </div>
      </Dialog>
    </div>
  );
}
