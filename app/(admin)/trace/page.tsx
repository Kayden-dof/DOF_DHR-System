import Link from 'next/link';
import { requireUser, hasRole } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate, fmtDateTime } from '@/lib/fmt';
import Denied from '@/components/denied';
import { PageHead, Panel, Empty, Tag, Field } from '@/components/ui';
import { SubNav } from '../nav';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   계보 추적 (§8.3)

   두 방향을 같은 화면에서 다룬다.
     역추적  제품 로트 -> 배치 -> 원재료 로트와 투입 자재 전부
     정추적  자재 로트 -> 그 자재가 들어간 제품 로트 전부

   원재료는 작업지시에 직접 붙고 시약·포장재는 공정 기록을 경유한다.
   두 경로를 모두 따라가야 계보가 온전하다.
--------------------------------------------------------------------------- */

type Search = Promise<{ q?: string }>;

interface Hit {
  kind: 'product' | 'material' | 'batch';
  id: string; label: string; sub: string;
}

export default async function TracePage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    return <Denied what="조회" need="생산관리자 또는 시스템관리자" />;
  }

  const sp = await searchParams;
  const q = (sp.q ?? '').trim();

  const d = q
    ? await withActor(user.id, async (db) => ({
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line pb-4">
        <div className="min-w-0">
          <h1 className="text-[1.375rem] font-bold text-ink">조회</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            로트번호 하나로 위아래를 모두 따라갑니다.
          </p>
        </div>

        <SubNav
          items={[
            { href: '/trace', label: '계보 추적' },
            { href: '/trace/cost', label: '원가' },
          ]}
        />
      </div>

      <PageHead
        title="계보 추적"
        note="제조번호 · 자재 로트번호 · 배치번호 · 성적서 번호 중 아무거나 넣으십시오."
      />

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
              · <b className="text-ink">원재료</b>는 작업지시에 직접 붙습니다. 배치당 하나이므로
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
              · 투입 기록에는 작업지시를 중복 저장하지 않습니다. 공정 기록을 경유하면 배치와
              제품 로트 양쪽이 나오므로 경로가 하나면 충분하고, 둘이면 어긋납니다.
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}
