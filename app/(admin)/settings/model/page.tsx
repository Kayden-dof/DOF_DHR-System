import { requireUser, hasRole } from '@/lib/session';
import { withActor } from '@/lib/db';
import Denied from '@/components/denied';
import { PageShell } from '@/components/shell';
import { Panel, TableWrap, Empty, Tag } from '@/components/ui';
import { SubNav } from '../../nav';
import { settingsNav } from '../../sections';
import { SchemeForm, SegmentForm, type Scheme, type Segment } from './forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: '형명 체계' };

/* ---------------------------------------------------------------------------
   형명 체계 (4차 감사 G1)

   0075 가 형명 규칙을 코드에서 빼 표로 옮겼는데(§2.0) **그 표를 넣을 화면이
   없었다.** 넣는 주체는 seed-demo 와 시험 fixture 둘뿐이라 빈 설치에서는
   완제품 형명 생성이 아예 거부됐다. §2.0 을 절반만 옮긴 상태였다.

   여기가 나머지 절반이다. 다른 제조소가 자기 형명 규칙을 화면에서 넣는다.
--------------------------------------------------------------------------- */

export default async function ModelSchemePage() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN')) {
    return <Denied what="형명 체계" need="시스템관리자" />;
  }

  const d = await withActor(user.id, async (db) => ({
    schemes: await db.rows<Scheme>(
      `select id, name, prefix, spec_pattern, name_pattern
         from model_scheme where is_active order by registered_at limit 1`),
    segments: await db.rows<Segment>(
      `select scheme_id, seq, digits, divisor::text as divisor, decimals, label, role
         from model_segment order by seq`),
    /* 이 체계로 실제 만들어진 형명이 몇 개인가. 고칠 때 무엇이 걸리는지 알려 준다 */
    items: await db.val<number>(`select count(*)::int from item where type = 'FIN'`),
  }));

  const scheme = d.schemes[0] ?? null;
  const segs = scheme ? d.segments.filter((s) => s.scheme_id === scheme.id) : [];
  const nextSeq = segs.length ? Math.max(...segs.map((s) => s.seq)) + 1 : 1;

  return (
    <PageShell
      section="설정"
      title="형명 체계"
      lede={
        <>
          형명 한 줄이 종이의 규격 표기를 만듭니다. <code>PD05050510</code>이
          <b className="text-ink"> 5x5cm · 두께 0.5~1.0mm</b>가 되는 규칙입니다.
        </>
      }
      nav={<SubNav items={settingsNav(user.roles)} />}
    >
      {!scheme && (
        <div className="card border-warn/40 bg-warn-bg p-4">
          <div className="flex items-start gap-3">
            <Tag tone="warn">먼저 할 일</Tag>
            <div className="text-sm leading-relaxed">
              <p className="font-semibold text-ink">형명 체계가 없습니다.</p>
              <p className="mt-1 text-muted">
                이것이 없으면 완제품 형명을 만들 수 없고, 규격 표기가 종이에 나가지
                않습니다. 아래에서 등록하십시오.
              </p>
            </div>
          </div>
        </div>
      )}

      {(d.items ?? 0) > 0 && (
        <p className="rounded-md border border-line bg-canvas px-3 py-2 text-xs leading-relaxed text-body">
          이미 이 체계로 만들어진 형명이 <b className="text-ink tnum">{d.items}종</b> 있습니다.
          <b className="text-ink"> 여기를 고치면 그 형명들의 규격 표기가 함께 달라지고,
          이미 인쇄된 종이의 해석까지 달라집니다.</b> 바꾼 사실은 감사추적에 남습니다.
        </p>
      )}

      <Panel title={scheme ? '체계' : '체계 등록'}
             note="접두어와 규격 문구. 이 문구가 라벨요청서와 출하 승인 요청서에 찍힙니다.">
        <SchemeForm scheme={scheme} />
      </Panel>

      {scheme && (
        <Panel title="자리"
               note="형명의 숫자를 앞에서부터 몇 자리씩 끊어 무엇으로 읽을지 정합니다.">
          {segs.length === 0 ? (
            <Empty hint="아래에서 1번 자리부터 정하십시오.">아직 정해진 자리가 없습니다.</Empty>
          ) : (
            <TableWrap>
              <table className="w-full min-w-[40rem]">
                <thead>
                  <tr>
                    <th className="th text-right">자리</th>
                    <th className="th">이름</th>
                    <th className="th text-right">자릿수</th>
                    <th className="th text-right">나눌 값</th>
                    <th className="th text-right">소수</th>
                    <th className="th">뜻</th>
                  </tr>
                </thead>
                <tbody>
                  {segs.map((s) => (
                    <tr key={s.seq}>
                      <td className="td tnum text-right font-bold">{s.seq}</td>
                      <td className="td">{s.label}</td>
                      <td className="td tnum text-right">{s.digits}</td>
                      <td className="td tnum text-right">{s.divisor}</td>
                      <td className="td tnum text-right">{s.decimals}</td>
                      <td className="td text-xs text-muted">{s.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          <SegmentForm schemeId={scheme.id} next={nextSeq} />
        </Panel>
      )}
    </PageShell>
  );
}
