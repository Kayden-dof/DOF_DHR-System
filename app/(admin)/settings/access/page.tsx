import { requireUser, hasRole, blocksScreen } from '@/lib/session';
import Denied from '@/components/denied';
import { PageShell } from '@/components/shell';
import { Panel, TableWrap } from '@/components/ui';
import { SubNav } from '../../nav';
import { settingsNav } from '../../sections';
import { withActor } from '@/lib/db';
import { ROLE_LABEL, ROLE_NOTE } from '@/lib/roles';
import {
  ACCESS_ROWS, ACCESS_ROLES, ACCESS_LABEL, ACCESS_NOTE, accessOf, roleDefault,
  type Access,
} from '@/lib/access';
import type { RoleCode } from '@/lib/roles';
import Link from 'next/link';
import AssignCell from './assign';

export const dynamic = 'force-dynamic';

export const metadata = { title: '권한' };

/*
 * 안내문이 "화면 서른" 이라고 말하려면 서른을 한글로 적어야 한다. 숫자를
 * 그대로 놓으면 문장이 딱딱해지고, 손으로 적으면 또 어긋난다 (5차 감사 C4).
 */
const KR_ONES = ['', '하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉'];
const KR_TENS = ['', '열', '스물', '서른', '마흔', '쉰', '예순', '일흔', '여든', '아흔'];
function krCount(n: number): string {
  if (n < 1 || n > 99) return String(n);
  const t = Math.floor(n / 10);
  const o = n % 10;
  return (KR_TENS[t] + KR_ONES[o]) || String(n);
}


/* ---------------------------------------------------------------------------
   어느 역할이 어느 화면에 닿는가 (사용자 요청 2026-09-01)

   계정에 역할을 붙이는 자리는 사용자 화면이다. 거기서는 "이 사람에게 무엇을
   줄까" 를 고르는데, 그 선택이 실제로 무엇을 여는지는 화면을 하나씩 눌러 봐야
   알 수 있었다.

   표를 세워 둔다. 역할을 정하기 전에 무엇이 열리는지 먼저 본다.

   ── 화면 수를 손으로 적지 않는다 (5차 감사 C4) ────────────────────────────
   전에는 안내문이 "화면 스물일곱" 이라고 적고 있었다. 그 사이 화면이 서른이
   되었는데 문구는 그대로였다. 매트릭스 자체는 145칸 전건 대조로 지켜지는데
   그것을 설명하는 문장만 지켜지지 않았다.

   ACCESS_ROWS 에서 세어 쓴다. 어긋날 수가 없다.
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

export default async function AccessPage({ searchParams }: {
  searchParams: Promise<{ u?: string }>;
}) {
  const user = await requireUser();
  if (blocksScreen(user, '/settings/access')) {
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

  /* ---------------------------------------------------------------------------
     계정별 배정 (0116)

     위 표는 역할이 정하는 **기본값**이다. 제조소마다 조직이 다르므로 관리자가
     계정마다 칸을 열고 닫는다. 손대지 않은 칸은 기본값을 따르니, 아무것도 하지
     않으면 지금까지와 똑같이 움직인다.
  --------------------------------------------------------------------------- */
  const picked = (await searchParams).u ?? null;

  const people = await withActor(user.id, async (db) => db.rows<{
    id: string; login_code: string; full_name: string;
    roles: RoleCode[] | null; touched: number;
  }>(
    `select u.id, u.login_code, u.full_name,
            array_remove(array_agg(distinct r.role::text), null)::text[] as roles,
            count(distinct s.path) filter (where s.is_open is not null)::int as touched
       from app_user u
       left join user_role r on r.user_id = u.id
       left join user_screen s on s.user_id = u.id
      where u.is_active and u.can_login
      group by u.id order by u.login_code`,
  ), { readOnly: true, reason: '화면 배정 조회' });

  const mine = picked
    ? await withActor(user.id, async (db) => db.rows<{ path: string; is_open: boolean | null }>(
        `select path, is_open from user_screen where user_id = $1`, [picked]),
      { readOnly: true, reason: '화면 배정 조회' })
    : [];
  const assigned = new Map(mine.filter((r) => r.is_open !== null).map((r) => [r.path, r.is_open!]));
  const who = people.find((p) => p.id === picked) ?? null;

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
      lede={`역할 ${krCount(ACCESS_ROLES.length)}이 화면 ${krCount(ACCESS_ROWS.length)}에 각각 어떻게 닿는지 한 장에 둔 것입니다. `
            + '계정에 역할을 붙이기 전에 무엇이 열리는지 여기서 봅니다.'}
      nav={<SubNav items={settingsNav(user.roles, user.screens)} />}
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

      {/* ------------------------------------------------------------------
        * 계정별 배정 (사용자 요청 2026-09-17 · 0116)
        *
        * 시스템관리자만 손댄다. 화면을 읽는 것은 생산관리자도 하지만, 배정은
        * 스스로 여는 길이 되므로 좁힌다 (actions.ts).
        * ---------------------------------------------------------------- */}
      {sysAdmin && (
        <Panel
          title="계정별 배정"
          note="손대지 않은 칸은 위 역할 기본값을 따릅니다. 자기 것은 바꿀 수 없습니다."
        >
          <div className="flex flex-wrap gap-2 px-4 py-3">
            {people.map((p) => {
              const self = p.id === user.id;
              const on = p.id === picked;
              return self ? (
                <span key={p.id}
                      title="자기 배정은 바꿀 수 없습니다"
                      className="chip bg-surface-sub text-faint">
                  {p.full_name} (나)
                </span>
              ) : (
                <Link key={p.id}
                      href={on ? '/settings/access' : `/settings/access?u=${p.id}`}
                      className={`chip ${on ? 'bg-brand text-white' : 'bg-surface-sub text-ink'}`}>
                  {p.full_name}
                  <span className={`ml-1.5 font-mono text-[0.625rem] ${on ? 'text-white/70' : 'text-faint'}`}>
                    {p.login_code}
                  </span>
                  {p.touched > 0 && (
                    <span className={`ml-1.5 text-[0.625rem] ${on ? 'text-white/70' : 'text-warn'}`}>
                      {p.touched}칸
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          {!who ? (
            <p className="px-4 pb-4 text-xs leading-relaxed text-muted">
              배정할 사람을 고르십시오. 고르지 않으면 모두 역할 기본값으로 움직입니다.
            </p>
          ) : (
            <TableWrap>
              <table className="w-full min-w-[34rem]">
                <thead>
                  <tr>
                    <th className="th text-left">화면</th>
                    <th className="th text-center whitespace-nowrap">역할 기본값</th>
                    <th className="th text-center whitespace-nowrap">
                      {who.full_name} 님
                    </th>
                  </tr>
                </thead>
                {groups.map((g) => (
                  <tbody key={g.group}>
                    <tr>
                      <td colSpan={3}
                          className="border-y border-line bg-canvas px-4 py-1.5
                                     text-[0.6875rem] font-bold tracking-wide text-faint">
                        {g.group}
                      </td>
                    </tr>
                    {g.rows.map((row) => {
                      const base = roleDefault(row.path, who.roles ?? []);
                      const own = assigned.get(row.path);
                      return (
                        <tr key={row.path}>
                          <td className="td">
                            <span className="text-ink">{row.label}</span>
                            <span className="ml-1.5 font-mono text-[0.6875rem] text-faint">
                              {row.path}
                            </span>
                          </td>
                          <td className="td text-center">
                            <Mark a={base ? 'open' : 'blocked'} />
                          </td>
                          <td className="td">
                            <AssignCell
                              userId={who.id}
                              path={row.path}
                              state={own === undefined ? 'default' : own ? 'open' : 'closed'}
                              roleOpen={base}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                ))}
              </table>
            </TableWrap>
          )}
        </Panel>
      )}

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
