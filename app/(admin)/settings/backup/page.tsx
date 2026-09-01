import { requireUser, hasRole } from '@/lib/session';
import { withActor } from '@/lib/db';
import Denied from '@/components/denied';
import { PageShell } from '@/components/shell';
import { Panel, TableWrap, Empty, Tag } from '@/components/ui';
import { SubNav } from '../../nav';
import { settingsNav } from '../../sections';
import RestorePanel from './restore-panel';


export const dynamic = 'force-dynamic';

export const metadata = { title: '백업' };

/* ---------------------------------------------------------------------------
   백업 (사용자 요청 2026-09-01)

   전에는 CLI 로만 뜰 수 있었다. `.env.deploy` 를 가진 사람만 돌릴 수 있고,
   파일은 그 사람의 기계에 떨어졌고, 자동으로 도는 것도 없었다. 실제 상태는
   "생각날 때 손으로 뜬 것이 노트북에 있다" 였다.

   ── 잊지 않게 하는 유일한 장치 ─────────────────────────────────────────────
   뜨는 것을 사람에게 맡기면 잊는다. 그래서 마지막이 언제였는지를 늘 크게
   보여 주고, 오래되면 경고한다. **차단하지 않는다** - 백업을 안 떴다고 생산을
   막는 것은 §2 의 다섯이 아니다.
--------------------------------------------------------------------------- */

interface LogRow {
  id: string;
  taken_at: string;
  taken_by_name: string;
  file_name: string;
  byte_size: string;
  total_rows: number;
  table_count: number;
  data_sha256: string;
  days_ago: number;
}

interface RestoreRow {
  id: string;
  restored_at: string;
  restored_by_name: string;
  restored_by_code: string;
  file_name: string;
  rows_before: number;
  rows_after: number;
  elapsed_ms: number;
}

const mb = (b: string | number) => {
  const n = Number(b);
  return n < 1024 * 1024
    ? `${(n / 1024).toFixed(0)} KB`
    : `${(n / 1024 / 1024).toFixed(2)} MB`;
};

/** 며칠이 지나면 눈에 띄게 할 것인가. 코드에 박힌 값이 아니라 표시 기준일 뿐이다 */
const STALE_DAYS = 7;

export default async function BackupPage() {
  const me = await requireUser();
  if (!hasRole(me, 'SYS_ADMIN')) {
    return <Denied what="백업" need="시스템관리자" />;
  }

  const d = await withActor(me.id, async (db) => ({
    logs: await db.rows<LogRow>(
      `select b.id, b.file_name, b.byte_size::text as byte_size,
              b.total_rows, b.table_count, b.data_sha256,
              u.full_name as taken_by_name,
              to_char(timezone('Asia/Seoul', b.taken_at), 'YYYY-MM-DD HH24:MI') as taken_at,
              (current_date - (timezone('Asia/Seoul', b.taken_at))::date) as days_ago
         from backup_log b join app_user u on u.id = b.taken_by
        order by b.taken_at desc limit 20`),
    restores: await db.rows<RestoreRow>(
      `select r.id, r.restored_by_name, r.restored_by_code, r.file_name,
              r.rows_before, r.rows_after, r.elapsed_ms,
              to_char(timezone('Asia/Seoul', r.restored_at), 'YYYY-MM-DD HH24:MI') as restored_at
         from restore_log r order by r.restored_at desc limit 20`),
    /* 지금 담겨 있는 것. 백업이 얼마만 한 일인지 사람이 가늠하게 한다 */
    now: await db.one<{ rows: number; tables: number }>(
      `select (select count(*)::int from process_record)
            + (select count(*)::int from material_issue)
            + (select count(*)::int from audit_log)
            + (select count(*)::int from product_lot)
            + (select count(*)::int from work_order) as rows,
              (select count(*)::int from information_schema.tables
                where table_schema = 'public' and table_type = 'BASE TABLE') as tables`),
  }), { readOnly: true, reason: '백업 대장 조회' });

  const last = d.logs[0];
  const stale = !last || last.days_ago >= STALE_DAYS;

  return (
    <PageShell
      section="설정"
      title="백업"
      lede={
        <>
          지금 담긴 것을 통째로 한 파일에 담아 내려받습니다.{' '}
          <b className="text-ink">서버에 사본을 두지 않습니다</b>. 받은 파일을
          사내 규정대로 보관하십시오.
        </>
      }
      nav={<SubNav items={settingsNav(me.roles)} />}
      action={
        <a href="/api/backup" download className="btn-primary">
          백업 내려받기
        </a>
      }
    >
      {/*
        * 마지막이 언제였나. 이 화면에서 가장 먼저 눈에 들어와야 하는 하나다.
        */}
      <div className={`card p-5 ${stale ? 'border-warn/40 bg-warn-bg' : ''}`}>
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <div>
            <p className="text-[0.6875rem] font-bold tracking-wide text-muted">마지막 백업</p>
            {last ? (
              <>
                <p className="mt-1 text-2xl font-bold tnum text-ink">
                  {last.days_ago === 0 ? '오늘'
                    : last.days_ago === 1 ? '어제'
                    : `${last.days_ago}일 전`}
                </p>
                <p className="mt-0.5 text-xs tnum text-muted">
                  {last.taken_at} · {last.taken_by_name}
                </p>
              </>
            ) : (
              <p className="mt-1 text-2xl font-bold text-ink">없음</p>
            )}
          </div>

          <div>
            <p className="text-[0.6875rem] font-bold tracking-wide text-muted">지금 담긴 것</p>
            <p className="mt-1 text-2xl font-bold tnum text-ink">{d.now?.tables ?? 0}개 표</p>
            <p className="mt-0.5 text-xs tnum text-muted">
              기록·계보·감사추적 {(d.now?.rows ?? 0).toLocaleString('ko-KR')}행
            </p>
          </div>
        </div>

        {stale && (
          <p className="mt-4 text-sm leading-relaxed text-ink">
            {last
              ? `마지막으로 백업을 뜬 지 ${last.days_ago}일이 지났습니다.`
              : '아직 이 화면에서 백업을 뜬 적이 없습니다.'}{' '}
            <span className="text-muted">
              기록은 지울 수 없지만 잃을 수는 있습니다. 백업이 없으면 되살릴 것도 없습니다.
            </span>
          </p>
        )}
      </div>

      {/*
        * 전에는 여기서 "파일을 backups/ 에 두고 npm run restore:check 를
        * 돌리십시오" 라고 안내했다. 그건 기능이 아니다 - 아무도 그렇게 하지
        * 않는다 (사용자 지적 2026-09-01). 파일을 넣으면 되게 한다.
        */}
      <RestorePanel canRestore />

      <Panel
        title="백업 대장"
        note="언제 누가 떴는지 남습니다. 파일 자체는 시스템에 담지 않습니다."
      >
        {d.logs.length === 0 ? (
          <Empty hint="위의 내려받기를 누르면 여기 남습니다.">
            아직 뜬 백업이 없습니다.
          </Empty>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[44rem]">
              <thead>
                <tr>
                  <th className="th">뜬 시각</th>
                  <th className="th">뜬 사람</th>
                  <th className="th">파일</th>
                  <th className="th text-right">크기</th>
                  <th className="th text-right">행</th>
                  <th className="th">지문</th>
                </tr>
              </thead>
              <tbody>
                {d.logs.map((b, i) => (
                  <tr key={b.id}>
                    <td className="td tnum whitespace-nowrap">
                      {b.taken_at}
                      {i === 0 && <Tag tone="ok">최근</Tag>}
                    </td>
                    <td className="td whitespace-nowrap">{b.taken_by_name}</td>
                    <td className="td font-mono text-xs text-muted">{b.file_name}</td>
                    <td className="td tnum text-right whitespace-nowrap">{mb(b.byte_size)}</td>
                    <td className="td tnum text-right">
                      {b.total_rows.toLocaleString('ko-KR')}
                    </td>
                    <td className="td font-mono text-[0.6875rem] text-faint">
                      {b.data_sha256.slice(0, 12)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      <Panel
        title="복구 대장"
        note="되돌린 사실은 복구가 덮지 않습니다. 이 표만은 그대로 쌓입니다."
      >
        {d.restores.length === 0 ? (
          <Empty>되돌린 적이 없습니다.</Empty>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[44rem]">
              <thead>
                <tr>
                  <th className="th">되돌린 시각</th>
                  <th className="th">한 사람</th>
                  <th className="th">쓴 파일</th>
                  <th className="th text-right">덮기 전</th>
                  <th className="th text-right">덮은 뒤</th>
                  <th className="th text-right">걸린 시간</th>
                </tr>
              </thead>
              <tbody>
                {d.restores.map((r) => (
                  <tr key={r.id}>
                    <td className="td tnum whitespace-nowrap">{r.restored_at}</td>
                    <td className="td whitespace-nowrap">
                      {r.restored_by_name}
                      <span className="ml-1.5 tnum text-xs text-faint">{r.restored_by_code}</span>
                    </td>
                    <td className="td font-mono text-xs text-muted">{r.file_name}</td>
                    <td className="td tnum text-right">{r.rows_before.toLocaleString('ko-KR')}</td>
                    <td className="td tnum text-right">{r.rows_after.toLocaleString('ko-KR')}</td>
                    <td className="td tnum text-right whitespace-nowrap">
                      {(r.elapsed_ms / 1000).toFixed(1)}초
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
    </PageShell>
  );
}
