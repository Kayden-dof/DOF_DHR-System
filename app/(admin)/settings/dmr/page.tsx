import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';
import { SETTINGS_NAV } from '../../sections';
import { fmtDate, fmtDateTime } from '@/lib/fmt';
import { Panel, Empty, Tag, Field } from '@/components/ui';
import {
  NewDeviceMaster, VerifyForm, AddOperationForm, OperationCard,
  type OperationRow, type ItemOption,
} from './dmr-forms';

export const dynamic = 'force-dynamic';

interface DmRow {
  id: string; revision: string; status: string; effective_from: string | null;
  verified_at: Date | null; verified_by_name: string | null;
  item_code: string; item_name: string;
  op_count: number; bom_count: number; wo_count: number;
}

type Search = Promise<{ dm?: string }>;

export default async function DmrPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const sp = await searchParams;

  const d = await withActor(user.id, async (db) => {
    const masters = await db.rows<DmRow>(
      `select dm.id, dm.revision, dm.status, dm.effective_from, dm.verified_at,
              u.full_name as verified_by_name, i.code as item_code, i.name as item_name,
              (select count(*)::int from dmr_operation o where o.device_master_id = dm.id) as op_count,
              (select count(*)::int from dmr_bom b
                 join dmr_operation o on o.id = b.operation_id
                where o.device_master_id = dm.id) as bom_count,
              (select count(*)::int from work_order w where w.device_master_id = dm.id) as wo_count
         from device_master dm
         join item i on i.id = dm.item_id
         left join app_user u on u.id = dm.verified_by
        order by i.code, dm.revision desc`);

    const selected = sp.dm ?? masters[0]?.id ?? null;

    const operations = selected
      ? await db.rows<OperationRow>(
          `select o.id, o.seq, o.code, o.name, o.after_cutting,
                  coalesce((
                    select json_agg(json_build_object(
                      'id', b.id, 'component_item_id', b.component_item_id,
                      'item_code', ci.code, 'item_name', ci.name, 'usage_uom', ci.usage_uom,
                      'basis', b.basis::text, 'qty_per_unit', b.qty_per_unit,
                      'tiers', coalesce((
                        select json_agg(json_build_object(
                          'id', tr.id, 'min_sheets', tr.min_sheets,
                          'max_sheets', tr.max_sheets, 'qty', tr.qty)
                          order by tr.min_sheets)
                          from dmr_bom_tier tr where tr.dmr_bom_id = b.id), '[]'::json)
                    ) order by ci.code)
                      from dmr_bom b join item ci on ci.id = b.component_item_id
                     where b.operation_id = o.id), '[]'::json) as bom
             from dmr_operation o
            where o.device_master_id = $1
            order by o.seq`, [selected])
      : [];

    return {
      masters, selected, operations,
      items: await db.rows<ItemOption>(
        `select id, code, name, usage_uom, type::text as type from item
          where is_active order by type, code`),
    };
  });

  const dm = d.masters.find((m) => m.id === d.selected) ?? null;
  const verified = !!dm?.verified_at;
  const editable = !!dm && dm.wo_count === 0;

  return (
    <PageShell
      section="설정"
      title="제품표준서"
      lede="서면 제품표준서가 정본입니다. 여기에는 개정 표기와 공정 · 자재 구성표만 옮겨 적습니다. 이 내용이 작업 지시서의 소요량 계산 근거가 됩니다."
      action={<NewDeviceMaster items={d.items} />}
      nav={<SubNav items={SETTINGS_NAV} />}
    >

      {d.masters.length === 0 ? (
        <Panel><Empty>등록된 제품표준서가 없습니다. 완제품 형명을 먼저 만드십시오.</Empty></Panel>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {d.masters.map((m) => (
              <Link
                key={m.id}
                href={`/settings/dmr?dm=${m.id}`}
                className={`rounded-md border px-3 py-2 text-left transition-colors ${
                  m.id === d.selected
                    ? 'border-brand bg-brand-soft'
                    : 'border-line bg-surface hover:border-line-strong'
                }`}
              >
                <div className="flex items-center gap-2">
                  <code className="font-mono text-xs font-semibold text-ink">{m.item_code}</code>
                  <span className="font-mono text-xs text-brand-deep">{m.revision}</span>
                  <Tag tone={m.verified_at ? 'ok' : 'warn'}>
                    {m.verified_at ? '대조 확인' : '확인 전'}
                  </Tag>
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  공정 {m.op_count} · 자재 {m.bom_count}
                  {m.wo_count > 0 && ` · 발행 ${m.wo_count}`}
                </div>
              </Link>
            ))}
          </div>

          {dm && (
            <>
              <Panel title={`${dm.item_code} ${dm.revision}`} note={dm.item_name}>
                <div className="grid gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="상태">
                    <Tag tone={dm.verified_at ? 'ok' : 'warn'}>
                      {dm.verified_at ? '대조 확인 완료' : '확인 전'}
                    </Tag>
                  </Field>
                  <Field label="시행일"><span className="tnum">{fmtDate(dm.effective_from)}</span></Field>
                  <Field label="대조 확인자">{dm.verified_by_name ?? ''}</Field>
                  <Field label="확인 일시">
                    <span className="tnum">{fmtDateTime(dm.verified_at)}</span>
                  </Field>
                </div>
                {!editable && dm.wo_count > 0 && (
                  <p className="border-t border-line bg-canvas px-4 py-2.5 text-xs leading-relaxed text-muted">
                    이 개정으로 발행된 작업 지시가 {dm.wo_count}건 있어 공정과 자재 구성표를
                    더 이상 고칠 수 없습니다. 바꾸려면 새 개정을 만드십시오.
                  </p>
                )}
              </Panel>

              <VerifyForm id={dm.id} verified={verified} />

              <Panel
                title="공정 순서"
                note="재단 이후 공정은 기록이 제품 로트에 붙습니다"
              >
                {d.operations.length === 0 ? (
                  <Empty>등록된 공정이 없습니다.</Empty>
                ) : (
                  <div>
                    {d.operations.map((op) => (
                      <OperationCard key={op.id} dm={dm.id} op={op}
                                     items={d.items} editable={editable} />
                    ))}
                  </div>
                )}
                {editable && (
                  <AddOperationForm dm={dm.id} nextSeq={(d.operations.at(-1)?.seq ?? 0) + 1} />
                )}
              </Panel>

              <section className="card p-4">
                <h3 className="text-xs font-bold text-ink">소요량 기준</h3>
                <dl className="mt-2 space-y-1.5 text-xs leading-relaxed">
                  <div className="flex gap-2">
                    <dt className="w-32 shrink-0 font-semibold text-ink">장입 구간 기준</dt>
                    <dd className="text-muted">
                      시약 · 타이백처럼 통 단위로 소모되어 장수에 비례하지 않는 자재.
                      구간별 고정량을 넣습니다. 구간이 겹치면 등록이 거부됩니다.
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-32 shrink-0 font-semibold text-ink">제품 개수 기준</dt>
                    <dd className="text-muted">포장재 · 라벨처럼 제품 1개당 비례하는 자재.</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-32 shrink-0 font-semibold text-ink">원재료는 넣지 않는다</dt>
                    <dd className="text-muted">
                      작업 지시에 이미 지정되어 있습니다. 자재 구성표에 넣으면 S05가 이중으로 걸립니다.
                    </dd>
                  </div>
                </dl>
              </section>
            </>
          )}
        </>
      )}
    </PageShell>
  );
}
