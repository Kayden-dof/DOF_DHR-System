import { requireUser, hasRole } from '@/lib/session';
import { withActor } from '@/lib/db';
import { NUMBERING_TARGETS } from '@/lib/forms';
import Denied from '@/components/denied';
import TargetCard, { type RuleRow } from './target-card';

export const dynamic = 'force-dynamic';

export default async function NumberingPage() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN')) {
    return <Denied what="채번 규칙 관리" need="시스템관리자" />;
  }

  const { rules, today } = await withActor(user.id, async (db) => ({
    rules: await db.rows<RuleRow>(
      `select r.id, r.target::text as target, r.item_id, r.pattern,
              r.reset::text as reset, r.seq_width, r.is_active,
              r.effective_from, r.registered_at,
              u.full_name as registered_by_name,
              preview_number(r.pattern, r.seq_width, 1) as sample
         from numbering_rule r
         join app_user u on u.id = r.registered_by
        order by r.is_active desc, r.registered_at desc`,
    ),
    today: await db.val<string>(
      `select to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD')`,
    ),
  }));

  const byTarget = new Map<string, RuleRow[]>();
  for (const r of rules) {
    byTarget.set(r.target, [...(byTarget.get(r.target) ?? []), r]);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-base font-bold text-ink">채번 규칙</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
          번호 형식은 코드에 박지 않고 여기서 정의합니다. 시스템은 이 정의를 해석해
          번호를 만듭니다 (§4.10). <b className="text-ink">등록한 규칙은 수정할 수 없고,
          번호는 재사용하지 않습니다</b> - 지시서를 취소해도 그 번호는 소멸합니다.
        </p>
      </div>

      <div className="card p-4">
        <h2 className="text-xs font-bold text-ink">알아둘 것</h2>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
          <li>
            · 규칙을 교체하면 <b className="text-ink">순번은 이어집니다.</b> 같은 대상·주기의
            기존 최대값에서 승계합니다.
          </li>
          <li>
            · 다만 <b className="text-ink">초기화 주기를 바꾸면 승계되지 않습니다.</b> 주기 키가
            달라지기 때문입니다. 주기를 바꿀 때는 패턴도 함께 바꾸십시오 - 화면이 경고합니다.
          </li>
          <li>
            · 실제 다음 순번은 어디에도 표시하지 않습니다. 순번을 되돌리면 번호가 중복되므로
            카운터는 화면에서 다루지 않습니다.
          </li>
          <li>
            · 품목별 규칙은 <b className="text-ink">M1</b>에서 품목 표가 생긴 뒤 다룹니다. 지금은
            대상별 공통 규칙만 등록합니다.
          </li>
        </ul>
      </div>

      <div className="space-y-4">
        {NUMBERING_TARGETS.map((t) => (
          <TargetCard
            key={t.code}
            code={t.code}
            label={t.label}
            note={t.note}
            rules={byTarget.get(t.code) ?? []}
            today={today ?? ''}
          />
        ))}
      </div>
    </div>
  );
}
