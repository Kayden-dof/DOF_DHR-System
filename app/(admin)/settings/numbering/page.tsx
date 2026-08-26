import { requireUser, hasRole } from '@/lib/session';
import { withActor } from '@/lib/db';
import { NUMBERING_TARGETS } from '@/lib/forms';
import Denied from '@/components/denied';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';
import { SETTINGS_NAV } from '../../sections';
import TargetCard, { type RuleRow } from './target-card';

export const dynamic = 'force-dynamic';

/*
 * 품목별 규칙을 걸 수 있는 대상.
 *
 * 제조번호는 형명 단위로 갈리고, 배치번호와 작업 지시서 번호도 품목이 늘면
 * 형식이 갈릴 수 있다. 자재 로트번호 · 멸균 배치번호 · 일탈 번호는 품목과
 * 무관하게 하나의 흐름이라 여기서 뺀다.
 */
const PER_ITEM_TARGETS = ['PRODUCT_LOT', 'BATCH', 'WORK_ORDER'];


export default async function NumberingPage() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN')) {
    return <Denied what="채번 규칙 관리" need="시스템관리자" />;
  }

  const { rules, items, today } = await withActor(user.id, async (db) => ({
    rules: await db.rows<RuleRow>(
      // 미리보기도 그 규칙이 매인 품목 코드로 낸다. {ITEM} 이 든 패턴을 공통으로
      // 그리면 화면과 실제 발행이 어긋난다
      `select r.id, r.target::text as target, r.item_id, r.pattern,
              r.reset::text as reset, r.seq_width, r.is_active,
              r.effective_from, r.registered_at,
              u.full_name as registered_by_name,
              i.code as item_code, i.name as item_name,
              preview_number(r.pattern, r.seq_width, 1, i.code) as sample
         from numbering_rule r
         join app_user u on u.id = r.registered_by
         left join item i on i.id = r.item_id
        order by r.is_active desc, r.registered_at desc`,
    ),
    /*
     * 품목별 규칙을 걸 수 있는 품목. 완제품만 고른다.
     *
     * 제조번호와 배치번호는 완제품 형명 단위로 갈리는 값이다. 시약이나 포장재에
     * 채번 규칙을 걸 자리는 없다 - 자재 로트번호는 품목을 가리지 않는다.
     */
    items: await db.rows<{ id: string; code: string; name: string }>(
      `select id, code, name from item
        where type = 'FIN' and is_active order by code`,
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
    <PageShell
      section="설정"
      title="채번 규칙"
      lede={
        <>
          번호 형식은 코드에 박지 않고 여기서 정의합니다.{' '}
          <b className="text-ink">등록한 규칙은 수정할 수 없고, 번호는 재사용하지 않습니다.</b>{' '}
          지시서를 취소해도 그 번호는 소멸합니다.
        </>
      }
      nav={<SubNav items={SETTINGS_NAV} />}
    >

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
              · <b className="text-ink">품목별 규칙이 공통 규칙보다 우선합니다.</b> 품목을 고르고
            등록하면 그 품목만 그 형식으로 채번되고, 나머지는 공통 규칙을 계속 씁니다.
            제조번호 · 배치번호 · 작업 지시서 번호에 걸 수 있습니다.
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
            // 품목별로 갈리는 것만. 자재 로트번호는 품목을 가리지 않는다
            items={PER_ITEM_TARGETS.includes(t.code) ? items : []}
            today={today ?? ''}
          />
        ))}
      </div>
    </PageShell>
  );
}
