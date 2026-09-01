import Link from 'next/link';
import { requireUser, hasRole } from '@/lib/session';
import { withUser } from '@/lib/db';
import { fmtDate, fmtDateTime } from '@/lib/fmt';
import Denied from '@/components/denied';
import { Panel, Empty, Tag, Field } from '@/components/ui';
import { PageShell } from '@/components/shell';
import { SubNav } from '../nav';
import { TRACE_NAV } from '../sections';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '조회' };

/* ---------------------------------------------------------------------------
   계보 추적 (§8.3)

   두 방향을 같은 화면에서 다룬다.
     역추적  제품 로트 -> 배치 -> 원재료 로트와 투입 자재 전부
     정추적  자재 로트 -> 그 자재가 들어간 제품 로트 전부

   원재료는 작업 지시에 직접 붙고 시약·포장재는 공정 기록을 경유한다.
   두 경로를 모두 따라가야 계보가 온전하다.
--------------------------------------------------------------------------- */

type Search = Promise<{ q?: string }>;

interface Hit {
  kind: 'product' | 'material' | 'batch';
  id: string; label: string; sub: string;
}

export default async function TracePage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  /*
   * 경영열람도 들어온다 (사용자 지시 2026-09-01).
   *
   * 제품 불만이 들어오면 그 배치가 언제 만들어졌고 누가 작업했고 언제 누구에게
   * 나갔는지를 되짚어야 한다. 그 셋이 이 화면에 있다. 쓰기는 DB 가 막는다 -
   * 읽기 전용 세션은 app_readonly 로 돌아 쓰기 함수의 실행 권한이 없다 (0053).
   */
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR', 'QP', 'VIEWER')) {
    return <Denied what="조회" need="생산관리자 또는 시스템관리자" />;
  }

  const sp = await searchParams;
  const q = (sp.q ?? '').trim();

  const d = q
    ? await withUser(user, async (db) => ({
        hits: await db.rows<Hit>(
          `select 'product' as kind, pl.id::text as id, pl.lot_no as label,
                  i.name || ' · 배치 ' || wo.batch_no as sub
             from product_lot pl
             join item i on i.id = pl.item_id
             join work_order wo on wo.id = pl.work_order_id
            where pl.lot_no ilike concat('%', $1::text, '%')
            union all
           select 'material', ml.id::text, ml.lot_no,
                  i.name || ' · ' || i.code
             from material_lot ml join item i on i.id = ml.item_id
            where ml.lot_no ilike concat('%', $1::text, '%')
               or ml.supplier_lot_no ilike concat('%', $1::text, '%')
               or ml.coa_no ilike concat('%', $1::text, '%')
            union all
           select 'batch', wo.id::text, wo.batch_no, wo.wo_no
             from work_order wo
            where wo.batch_no ilike concat('%', $1::text, '%')
               or wo.wo_no ilike concat('%', $1::text, '%')
            limit 50`, [q]),
      }))
    : { hits: [] as Hit[] };

  return (
    <PageShell
      section="조회"
      title="계보 추적"
      lede="제조번호 · 자재 로트번호 · 배치번호 · 성적서 번호 중 아무거나 입력하십시오."
      nav={<SubNav items={TRACE_NAV} />}
    >
      <form className="card flex gap-2 p-3">
        <input name="q" defaultValue={q} autoComplete="off"
               placeholder="P2608-0001 · ML-2608-0003 · B2608-0001 · COA-..."
               className="input flex-1 font-mono" />
        <button className="btn-primary px-6">찾기</button>
      </form>

      {q && (
        <Panel title={`검색 결과 ${d.hits.length}건`}>
          {d.hits.length === 0 ? (
            <Empty>해당하는 번호가 없습니다.</Empty>
          ) : (
            <div className="divide-y divide-line">
              {d.hits.map((h) => (
                <Link key={`${h.kind}-${h.id}`}
                      href={`/trace/${h.kind}/${h.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-canvas">
                  <Tag tone={h.kind === 'product' ? 'brand' : h.kind === 'material' ? 'info' : 'quiet'}>
                    {h.kind === 'product' ? '제조번호' : h.kind === 'material' ? '자재 로트' : '배치'}
                  </Tag>
                  <span className="font-mono text-sm font-semibold text-ink">{h.label}</span>
                  <span className="text-sm text-muted">{h.sub}</span>
                  <span className="ml-auto text-xs text-faint">계보 보기</span>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      )}

      {!q && (
        <section className="card p-4">
          <h3 className="text-xs font-bold text-ink">계보가 성립하는 방식</h3>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
            <li>
              · <b className="text-ink">원재료</b>는 작업 지시에 직접 붙습니다. 배치당 하나이므로
              제품 로트에서 배치를 거쳐 원재료 로트까지 한 줄로 이어집니다.
            </li>
            <li>
              · <b className="text-ink">시약과 공정 자재</b>는 재단 전 공정 기록에 붙습니다.
              배치 전체에 걸립니다.
            </li>
            <li>
              · <b className="text-ink">포장재</b>는 재단 후 공정 기록에 붙습니다. 제품 로트별로
              갈립니다.
            </li>
            <li>
              · 투입 기록에는 작업 지시를 중복 저장하지 않습니다. 공정 기록을 경유하면 배치와
              제품 로트 양쪽이 나오므로 경로가 하나면 충분하고, 둘이면 어긋납니다.
            </li>
          </ul>
        </section>
      )}
    </PageShell>
  );
}
