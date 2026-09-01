import Link from 'next/link';
import { Tag } from '@/components/ui';

/* ---------------------------------------------------------------------------
   첫 설정 차례표 (M5-3 · §2.0)

   프로그램을 한 번 올려 두면 개발 없이 화면에서 설정만으로 운영에 들어갈 수
   있어야 한다. 그러려면 **무엇을 어느 차례로 넣어야 하는지**가 화면에 있어야
   한다. 전에는 글로만 적혀 있어, 적힌 것과 지금 상태가 따로 놀았다.

   ── "완료" 를 적지 않는다 ─────────────────────────────────────────────────
   차례마다 초록 표시를 달고 "5 / 7" 을 적으면 그것을 믿고 넘어간다. 그런데
   시스템이 아는 것은 **등록되었는가** 하나뿐이다. 넣은 소요량이 작업표준서와
   같은지, 공정 순서가 맞는지, 설비 번호가 실물과 같은지는 모른다.

   그래서 없는 것만 표시하고, 있는 것은 지금 값을 그대로 적는다. §8.5 가
   검토 지원에서 "이상 없음" 을 금지하는 것과 같은 이유다 - 잘못된 안심을
   만드는 것이 돕지 않는 것보다 나쁘다.

   ── 막지 않는다 ──────────────────────────────────────────────────────────
   차례를 건너뛰어도 된다. 다만 앞의 것이 없으면 뒤 화면에 고를 것이 없다.
   차단은 S01~S05 뿐이다 (§1).
--------------------------------------------------------------------------- */

export interface SetupStep {
  href: string;
  title: string;
  /** 지금 무엇이 들어 있는가. 사실만 적는다 */
  fact: string;
  /** 아직 아무것도 없는가 */
  empty: boolean;
  /** 이것이 없으면 무엇을 못 하는가 */
  blocks: string;
}

export function SetupSteps({ steps }: { steps: SetupStep[] }) {
  const left = steps.filter((s) => s.empty);

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-bold text-ink">첫 설정 차례</h3>
        {left.length > 0 && (
          <span className="text-xs text-muted">
            아직 비어 있는 것 <b className="tnum text-ink">{left.length}</b>
          </span>
        )}
      </div>

      <ol className="mt-3 divide-y divide-line-soft">
        {steps.map((s, i) => (
          <li key={s.href} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
            <span className="tnum w-4 shrink-0 text-xs font-semibold text-faint">{i + 1}</span>

            <Link href={s.href}
                  className="w-32 shrink-0 text-sm font-semibold text-ink hover:text-brand">
              {s.title}
            </Link>

            <span className="min-w-0 flex-1 text-xs leading-relaxed text-muted">
              {s.empty ? s.blocks : s.fact}
            </span>

            {s.empty && <Tag tone="warn">아직 없음</Tag>}
          </li>
        ))}
      </ol>

      <p className="mt-3 border-t border-line-soft pt-3 text-xs leading-relaxed text-muted">
        차례를 건너뛰어도 막지 않습니다. 다만 앞의 것이 없으면 뒤 화면에 고를 것이
        없습니다.
        <br />
        <b className="text-ink">여기에 표시가 없다고 설정이 끝난 것은 아닙니다.</b>{' '}
        시스템이 아는 것은 등록되었는지 하나뿐입니다. 넣은 값이 작업표준서 ·
        제품표준서와 같은지는 서면과 대조해 확인합니다.
      </p>
    </section>
  );
}
