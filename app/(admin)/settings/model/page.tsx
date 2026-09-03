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
      /*
       * 하나만 보여 주지 않는다 (6차 감사 N3).
       *
       * 전에는 `limit 1` 이었다. 완제품 생성기는 어느 체계로 만들지 고르게
       * 해 두었는데(0086) 그 고를 것을 만들 자리가 없었다 - 두 번째 체계를
       * 등록해도 이 화면에 뜨지 않아 고치지도 못했다.
       */
      `select id, name, prefix, spec_pattern, name_pattern
         from model_scheme where is_active order by prefix`),
    segments: await db.rows<Segment>(
      `select scheme_id, seq, digits, divisor::text as divisor, decimals, label, role
         from model_segment order by seq`),
    /* 이 체계로 실제 만들어진 형명이 몇 개인가. 고칠 때 무엇이 걸리는지 알려 준다 */
    items: await db.val<number>(`select count(*)::int from item where type = 'FIN'`),
  }));

  const segsOf = (id: string) => d.segments.filter((s) => s.scheme_id === id);
  const nextSeqOf = (id: string) => {
    const g = segsOf(id);
    return g.length ? Math.max(...g.map((s) => s.seq)) + 1 : 1;
  };

  return (
    <PageShell
      section="설정"
      title="형명 체계"
      lede={
        <>
          형명 한 줄이 종이의 규격 표기를 만듭니다. 접두어와 자리를 정해 두면
          형명에서 <b className="text-ink">규격 문구</b>가 만들어지고, 그 문구가
          라벨요청서와 출하 승인 요청서에 그대로 나갑니다.
        </>
      }
      nav={<SubNav items={settingsNav(user.roles)} />}
    >
      {d.schemes.length === 0 && (
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
          이미 만들어진 완제품 형명이 <b className="text-ink tnum">{d.items}종</b> 있습니다.
          <b className="text-ink"> 여기를 고치면 그 형명들의 규격 표기가 함께 달라지고,
          이미 인쇄된 종이의 해석까지 달라집니다.</b> 바꾼 사실은 감사추적에 남습니다.
        </p>
      )}

      {/*
        * 등록된 체계를 모두 편다 (6차 감사 N3). 전에는 첫 하나만 보여 주어,
        * 두 번째 제품군을 위한 체계를 등록해도 화면에 뜨지 않고 고칠 수도
        * 없었다. 완제품 생성기는 이미 어느 체계로 만들지 고르게 해 두었다.
        */}
      {d.schemes.map((sc) => {
        const segs = segsOf(sc.id);
        return (
          <section key={sc.id} className="space-y-4">
            <Panel title={`${sc.name} · ${sc.prefix}`}
                   note="접두어와 규격 문구. 이 문구가 라벨요청서와 출하 승인 요청서에 찍힙니다.">
              <SchemeForm scheme={sc} />
            </Panel>

            <Panel title={`${sc.prefix} 자리`}
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
                      {segs.map((sg) => (
                        <tr key={sg.seq}>
                          <td className="td tnum text-right font-bold">{sg.seq}</td>
                          <td className="td">{sg.label}</td>
                          <td className="td tnum text-right">{sg.digits}</td>
                          <td className="td tnum text-right">{sg.divisor}</td>
                          <td className="td tnum text-right">{sg.decimals}</td>
                          <td className="td text-xs text-muted">{sg.role}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
              <SegmentForm schemeId={sc.id} next={nextSeqOf(sc.id)} />
            </Panel>
          </section>
        );
      })}

      {/*
        * 체계를 하나 더 낼 자리. 제품군이 둘이면 접두어가 둘이다.
        * 활성 유일 제약이 접두어별이므로 서로 다른 접두어는 함께 산다.
        */}
      <Panel title={d.schemes.length === 0 ? '체계 등록' : '체계 하나 더'}
             note={d.schemes.length === 0
               ? '접두어와 규격 문구를 정합니다.'
               : '제품군이 둘이면 접두어가 둘입니다. 완제품을 만들 때 어느 체계로 만들지 고릅니다.'}>
        <SchemeForm scheme={null} />
      </Panel>

    </PageShell>
  );
}
