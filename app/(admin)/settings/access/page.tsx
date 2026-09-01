import { requireUser, blocksReadOnly, hasRole } from '@/lib/session';
import Denied from '@/components/denied';
import { PageShell } from '@/components/shell';
import { Panel, TableWrap } from '@/components/ui';
import { SubNav } from '../../nav';
import { settingsNav } from '../../sections';
import { withActor } from '@/lib/db';
import { ROLE_LABEL, ROLE_NOTE } from '@/lib/roles';
import {
  ACCESS_ROWS, ACCESS_ROLES, ACCESS_LABEL, ACCESS_NOTE, accessOf, type Access,
} from '@/lib/access';

export const dynamic = 'force-dynamic';

export const metadata = { title: '권한' };

/* ---------------------------------------------------------------------------
   어느 역할이 어느 화면에 닿는가 (사용자 요청 2026-09-01)

   계정에 역할을 붙이는 자리는 사용자 화면이다. 거기서는 "이 사람에게 무엇을
   줄까" 를 고르는데, 그 선택이 실제로 무엇을 여는지는 화면 스물일곱을 하나씩
   눌러 봐야 알 수 있었다.

   표를 세워 둔다. 역할을 정하기 전에 무엇이 열리는지 먼저 본다.
--------------------------------------------------------------------------- */

const TONE: Record<Access, string> = {
  open:    'bg-ok-bg text-ok',
  blocked: 'bg-danger-bg text-danger',
  away:    'bg-line-soft text-faint',
};

/* 글자에 기대지 않는다. 색을 못 가리는 눈에도 모양이 다르게 보여야 한다 */
function Mark({ a }: { a: Access }) {
  return (
    <span
      title={`${ACCESS_LABEL[a]} · ${ACCESS_NOTE[a]}`}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md
                  text-[0.6875rem] font-bold ${TONE[a]}`}
    >
      <span className="sr-only">{ACCESS_LABEL[a]}</span>
      <span aria-hidden>{a === 'open' ? '●' : a === 'blocked' ? '✕' : '–'}</span>
    </span>
  );
}

export default async function AccessPage() {
  const user = await requireUser();
  if (blocksReadOnly(user)) {
    return <Denied what="권한 매트릭스" need="생산관리자 또는 시스템관리자" />;
  }

  const sysAdmin = hasRole(user, 'SYS_ADMIN');

  /* 지금 그 역할을 실제로 몇 사람이 들고 있는가. 표에 사람 수를 함께 얹는다 */
  const counts = await withActor(user.id, async (db) => db.rows<{
    role: string; n: number;
  }>(
    `select r.role::text as role, count(*)::int as n
       from user_role r join app_user u on u.id = r.user_id
      where u.is_active
      group by r.role`,
  ), { readOnly: true, reason: '권한 매트릭스 조회' });

  const byRole = new Map(counts.map((r) => [r.role, r.n]));

  /* 구역이 바뀌는 자리에 머리줄을 하나 끼운다. 상단 차림표와 같은 묶음이다 */
  const groups: { group: string; rows: typeof ACCESS_ROWS }[] = [];
  for (const row of ACCESS_ROWS) {
    const last = groups[groups.length - 1];
    if (last && last.group === row.group) last.rows.push(row);
    else groups.push({ group: row.group, rows: [row] });
  }

  return (
    <PageShell
      section="설정"
      title="역할이 여는 문"
      lede="역할 다섯이 화면 스물일곱에 각각 어떻게 닿는지 한 장에 둔 것입니다.
            계정에 역할을 붙이기 전에 무엇이 열리는지 여기서 봅니다."
      nav={<SubNav items={settingsNav(sysAdmin)} />}
    >
      <Panel
        title="권한 매트릭스"
        note="한 계정에 역할이 둘이면 둘 중 열리는 쪽을 따릅니다."
      >
        <TableWrap>
          <table className="w-full min-w-[46rem]">
            <thead>
              <tr>
                <th className="th text-left">화면</th>
                {ACCESS_ROLES.map((r, i) => (
                  <th key={r}
                      className={`th text-center whitespace-nowrap
                                  ${i === 0 ? 'border-l border-line-soft' : ''}`}>
                    {ROLE_LABEL[r]}
                    <span className="mt-0.5 block text-[0.6875rem] font-normal text-faint">
                      {byRole.get(r) ?? 0}명
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.group}>
                <tr>
                  <td colSpan={1 + ACCESS_ROLES.length}
                      className="border-y border-line bg-canvas px-4 py-1.5
                                 text-[0.6875rem] font-bold tracking-wide text-faint">
                    {g.group}
                  </td>
                </tr>
                {g.rows.map((row) => (
                  <tr key={row.path} className="hover:bg-canvas">
                    <td className="td">
                      <span className="font-semibold text-ink">{row.label}</span>
                      <code className="ml-2 text-[0.6875rem] text-faint">{row.path}</code>
                    </td>
                    {ACCESS_ROLES.map((r, i) => (
                      <td key={r}
                          className={`td text-center
                                      ${i === 0 ? 'border-l border-line-soft' : ''}`}>
                        <Mark a={accessOf(row, r)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </TableWrap>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="표 읽는 법">
          <dl className="space-y-3 p-4 text-sm">
            {(['open', 'blocked', 'away'] as Access[]).map((a) => (
              <div key={a} className="flex items-start gap-3">
                <Mark a={a} />
                <div className="min-w-0">
                  <dt className="font-semibold text-ink">{ACCESS_LABEL[a]}</dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-muted">
                    {ACCESS_NOTE[a]}
                  </dd>
                </div>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title="역할이 하는 일">
          <dl className="space-y-3 p-4 text-sm">
            {ACCESS_ROLES.map((r) => (
              <div key={r} className="flex items-start gap-3">
                <dt className="w-20 shrink-0 font-semibold text-ink">{ROLE_LABEL[r]}</dt>
                <dd className="min-w-0 text-xs leading-relaxed text-muted">{ROLE_NOTE[r]}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      {/*
        * 표가 코드와 갈라질 수 있다는 사실을 화면에서도 말한다.
        *
        * 적어 둔 표는 언제든 실제와 어긋날 수 있다. 어긋난 표는 없는 것보다
        * 나쁘다 - 사람이 그것을 믿고 계정을 만들기 때문이다. 무엇이 그것을
        * 막고 있는지 여기 적어 두어, 이 화면을 고치는 사람이 그 도구를 함께
        * 돌리게 한다.
        */}
      <p className="text-xs leading-relaxed text-faint">
        이 표는 화면의 판정을 옮겨 적은 것입니다. 둘이 갈라지면 표가 거짓말이
        되므로, <code className="text-muted">npm run access</code> 가 역할마다
        실제로 전 화면을 두드려 이 표와 대조하고 한 칸이라도 다르면 멈춥니다.
      </p>
    </PageShell>
  );
}
