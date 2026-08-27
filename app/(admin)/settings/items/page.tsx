import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';
import { SETTINGS_NAV } from '../../sections';
import { ITEM_TYPES } from '@/lib/forms';
import { Panel, Empty, Tag } from '@/components/ui';
import { NewItemForm, GenerateFinished, ItemRowView, type ItemRow } from './item-forms';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '품목' };

type Search = Promise<{ type?: string; q?: string }>;

export default async function ItemsPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const sp = await searchParams;
  const type = sp.type || null;
  const q = (sp.q || '').trim() || null;

  const { items, counts } = await withActor(user.id, async (db) => ({
    items: await db.rows<ItemRow>(
      `select i.*, count(ml.id)::int as lot_count
         from item i
         left join material_lot ml on ml.item_id = i.id and ml.status = 'AVAILABLE'
        where ($1::text is null or i.type::text = $1)
          and ($2::text is null or i.code ilike '%'||$2||'%' or i.name ilike '%'||$2||'%')
        group by i.id
        order by i.type, i.code`,
      [type, q],
    ),
    counts: await db.rows<{ type: string; n: number }>(
      `select type::text as type, count(*)::int as n from item group by type`,
    ),
  }));

  const byType = new Map(counts.map((c) => [c.type, c.n]));
  const total = counts.reduce((s, c) => s + c.n, 0);
  const link = (t?: string) => {
    const p = new URLSearchParams();
    if (t) p.set('type', t);
    if (q) p.set('q', q);
    const s = p.toString();
    return s ? `/settings/items?${s}` : '/settings/items';
  };

  return (
    <PageShell
      section="설정"
      title="품목"
      lede={
        <>
          자재와 완제품을 한 표에서 다룹니다. 재고 · 불출 · 단가는 전부 사용 단위 기준이며,
          구매 단위는 입고 등록에서만 받아 환산합니다.
        </>
      }
      action={
        <div className="flex gap-2">
          <GenerateFinished />
          <NewItemForm />
        </div>
      }
      nav={<SubNav items={SETTINGS_NAV} />}
    >

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <a href={link()} className={`chip ${!type ? 'bg-brand text-white' : 'bg-canvas text-muted'}`}>
            전체 {total}
          </a>
          {ITEM_TYPES.map((x) => (
            <a key={x.code} href={link(x.code)}
               className={`chip ${type === x.code ? 'bg-brand text-white' : 'bg-canvas text-muted'}`}>
              {x.label} {byType.get(x.code) ?? 0}
            </a>
          ))}
        </div>
        <form className="ml-auto flex gap-2">
          {type && <input type="hidden" name="type" value={type} />}
          <input name="q" defaultValue={q ?? ''} placeholder="코드 또는 품목명"
                 className="input h-9 w-56 text-xs" autoComplete="off" />
          <button className="btn-ghost h-9 px-3 text-xs">검색</button>
        </form>
      </div>

      <Panel>
        {items.length === 0 ? (
          <Empty>해당하는 품목이 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">코드</th>
                  <th className="th">품목명</th>
                  <th className="th">유형</th>
                  <th className="th">단위</th>
                  <th className="th text-right">최소 재고선</th>
                  <th className="th text-right">보유 로트</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {items.map((it) => <ItemRowView key={it.id} it={it} />)}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <section className="card p-4">
        <h3 className="text-xs font-bold text-ink">유형</h3>
        <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {ITEM_TYPES.map((x) => (
            <div key={x.code} className="flex gap-2">
              <dt className="w-16 shrink-0"><Tag tone={x.code === 'FIN' ? 'brand' : 'quiet'}>{x.label}</Tag></dt>
              <dd className="text-muted">{x.note}</dd>
            </div>
          ))}
        </dl>
      </section>
    </PageShell>
  );
}
