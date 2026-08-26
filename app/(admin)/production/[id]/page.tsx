import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, hasRole } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate, fmtDateTime } from '@/lib/fmt';
import { WO_STATUS_LABEL, PL_STATUS_LABEL } from '@/lib/forms';
import Denied from '@/components/denied';
import { Panel, Empty, Tag, Field, Caution } from '@/components/ui';
import { CutForm, LotStatusForm, CancelForm, FinishForm, type LotRow, type FinOpt } from './batch-forms';

export const dynamic = 'force-dynamic';

interface Wo {
  id: string; wo_no: string; batch_no: string; status: string; sheet_count: number;
  dmr_revision: string; issued_at: Date; cancelled_reason: string | null;
  item_id: string; item_code: string; item_name: string;
  raw_lot_id: string; raw_lot_no: string; thickness_band: string | null;
  supplier_name: string; coa_no: string; coa_date: string;
  prod_name: string; qa_name: string; device_master_id: string;
}
interface DayRow {
  day_no: number; work_date: string; worker_id: string; worker_name: string;
  records: number; locked: boolean; printed: number;
}
interface RecRow {
  id: string; day_no: number; work_date: string; attempt: number;
  operation_code: string; operation_name: string; after_cutting: boolean;
  worker_name: string; rotation_name: string | null;
  started_at: Date | null; ended_at: Date | null; equipment_id: string | null;
  rework_qty: number | null; no_material_reason: string | null;
  product_lot_no: string | null; issues: number;
}

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    return <Denied what="배치 상세" need="생산관리자 또는 시스템관리자" />;
  }
  const { id } = await params;

  const d = await withActor(user.id, async (db) => {
    const wo = await db.one<Wo>(
      `select wo.id, wo.wo_no, wo.batch_no, wo.status::text as status, wo.sheet_count,
              wo.dmr_revision, wo.issued_at, wo.cancelled_reason, wo.device_master_id,
              i.id as item_id, i.code as item_code, i.name as item_name,
              ml.id as raw_lot_id, ml.lot_no as raw_lot_no, ml.thickness_band,
              ml.coa_no, ml.coa_date, s.name as supplier_name,
              up.full_name as prod_name, uq.full_name as qa_name
         from work_order wo
         join device_master dm on dm.id = wo.device_master_id
         join item i on i.id = dm.item_id
         join material_lot ml on ml.id = wo.material_lot_id
         join supplier s on s.id = ml.supplier_id
         join app_user up on up.id = wo.issued_by_prod
         join app_user uq on uq.id = wo.issued_by_qa
        where wo.id = $1`, [id]);
    if (!wo) return null;

    return {
      wo,
      lots: await db.rows<LotRow>(
        `select pl.id, pl.lot_no, i.code as item_code, i.name as item_name,
                pl.qty_produced, pl.qty_sample, pl.qty_available,
                pl.manufactured_on, pl.expiry_date, pl.status::text as status, pl.location,
                h.months as shelf_months,
                coalesce((select sum(sh.qty)::int from shipment sh
                           where sh.product_lot_id = pl.id), 0) as shipped
           from product_lot pl
           join item i on i.id = pl.item_id
           left join shelf_life_history h on h.id = pl.shelf_life_ref
          where pl.work_order_id = $1 order by i.code`, [id]),
      days: await db.rows<DayRow>(
        `select pr.day_no, min(pr.work_date)::text as work_date, pr.worker_id,
                u.full_name as worker_name, count(*)::int as records,
                exists (select 1 from day_lock dl
                         where dl.work_order_id = pr.work_order_id
                           and dl.day_no = pr.day_no and dl.worker_id = pr.worker_id) as locked,
                /* 인쇄 횟수가 아니라 마지막에 뽑은 장수. 편철 매수와 같은 값이다 */
                coalesce((
                  select rp.pages from record_print rp
                   where rp.kind = 'DAY_RECORD' and rp.work_order_id = pr.work_order_id
                     and rp.day_no = pr.day_no and rp.worker_id = pr.worker_id
                   order by rp.seq desc limit 1), 0) as printed
           from process_record pr join app_user u on u.id = pr.worker_id
          where pr.work_order_id = $1
          group by pr.work_order_id, pr.day_no, pr.worker_id, u.full_name
          order by pr.day_no, u.full_name`, [id]),
      records: await db.rows<RecRow>(
        `select pr.id, pr.day_no, pr.work_date::text as work_date, pr.attempt,
                o.code as operation_code, o.name as operation_name, o.after_cutting,
                u.full_name as worker_name, ru.full_name as rotation_name,
                pr.started_at, pr.ended_at, pr.equipment_id, pr.rework_qty,
                pr.no_material_reason, pl.lot_no as product_lot_no,
                (select count(*)::int from material_issue mi
                  where mi.process_record_id = pr.id) as issues
           from process_record pr
           join dmr_operation o on o.id = pr.operation_id
           join app_user u on u.id = pr.worker_id
           left join app_user ru on ru.id = pr.rotation_worker_id
           left join product_lot pl on pl.id = pr.product_lot_id
          where pr.work_order_id = $1
          order by pr.day_no, o.seq, pr.attempt`, [id]),
      plan: await db.rows<{ item_id: string; item_code: string; item_name: string; planned_qty: number | null }>(
        `select p.item_id, i.code as item_code, i.name as item_name, p.planned_qty
           from work_order_plan p join item i on i.id = p.item_id
          where p.work_order_id = $1 order by p.seq, i.code`, [id]),
      finished: await db.rows<FinOpt>(
        `select id, code, name from item where type = 'FIN' and is_active order by code`),
      today: await db.val<string>(`select to_char(timezone('Asia/Seoul', now()),'YYYY-MM-DD')`),
      prints: await db.rows<{ kind: string; seq: number; printed_at: Date; printed_by_name: string }>(
        `select rp.kind::text as kind, rp.seq, rp.printed_at, u.full_name as printed_by_name
           from record_print rp join app_user u on u.id = rp.printed_by
          where rp.work_order_id = $1 order by rp.printed_at desc limit 20`, [id]),
    };
  });

  if (!d) notFound();
  const { wo } = d;
  const used = new Set(d.lots.map((l) => l.item_code));
  const usedIds = new Set(
    d.finished.filter((f) => used.has(f.code)).map((f) => f.id));
  const active = wo.status !== 'CANCELLED' && wo.status !== 'DONE';

  // 편철 전에 남은 것. 사실만 세고 판정하지 않는다 (§10).
  const unprinted = d.days.filter((r) => r.printed === 0).length;
  const remaining = [
    active && '배치 미종료',
    unprinted > 0 && `기록서 미발행 ${unprinted}건`,
    d.lots.length === 0 && wo.status !== 'CANCELLED' && '재단 전',
  ].filter(Boolean) as string[];
  const totalPages = d.days.reduce((a, r) => a + r.printed, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/production" className="text-xs font-semibold text-muted hover:text-ink">
            생산으로
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-bold text-ink">
            <span className="font-mono">{wo.batch_no}</span>
            <Tag tone={wo.status === 'CANCELLED' ? 'faint' : 'brand'}>
              {WO_STATUS_LABEL[wo.status] ?? wo.status}
            </Tag>
          </h1>
          <p className="mt-1 text-sm text-muted">
            {wo.item_name} · {wo.item_code} · {wo.dmr_revision}
          </p>
        </div>
        {/*
          * 인쇄물은 각자 시점이 있다. 한 줄에 나란히 두면 아무 때나 뽑아도 되는
          * 것처럼 읽힌다. 여기에는 착수 전 문서만 두고, 라벨요청서는 재단 칸에,
          * 편철 표지는 배치를 닫는 칸에 둔다.
          */}
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/print/work-order/${wo.id}`} className="btn-ghost">
            작업 지시서 인쇄
          </Link>
          {active && <FinishForm id={wo.id} />}
        </div>
      </div>

      {wo.status === 'CANCELLED' && (
        <div className="card border-danger/30 bg-danger-bg p-4">
          <p className="text-sm font-semibold text-ink">이 작업 지시는 취소되었습니다.</p>
          <p className="mt-1 text-sm text-muted">사유: {wo.cancelled_reason}</p>
          <p className="mt-1 text-xs text-muted">
            지시서번호와 배치번호는 소멸했으며 재사용하지 않습니다.
          </p>
        </div>
      )}

      <Panel title="지시 내용">
        <div className="grid gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="지시서번호"><span className="font-mono">{wo.wo_no}</span></Field>
          <Field label="배치번호"><span className="font-mono font-semibold">{wo.batch_no}</span></Field>
          <Field label="제품표준서 개정"><span className="font-mono">{wo.dmr_revision}</span></Field>
          <Field label="장입 장수"><span className="tnum font-semibold">{wo.sheet_count}장</span></Field>

          <Field label="원재료 로트">
            <span className="font-mono font-semibold">{wo.raw_lot_no}</span>
            {wo.thickness_band && (
              <span className="ml-2 text-xs text-muted">두께 {wo.thickness_band}</span>
            )}
          </Field>
          <Field label="공급자">{wo.supplier_name}</Field>
          <Field label="성적서">
            <span className="font-mono text-xs">{wo.coa_no}</span>
            <span className="ml-2 tnum text-xs text-muted">{fmtDate(wo.coa_date)}</span>
          </Field>
          <Field label="발행">
            <span className="tnum">{fmtDateTime(wo.issued_at)}</span>
            <div className="text-xs text-muted">생산 {wo.prod_name} · 품질 {wo.qa_name}</div>
          </Field>
        </div>
      </Panel>

      {d.plan.length > 0 && (
        <Panel
          title="예정 형명"
          note="발행 시점에 정한 계획. 실제는 재단에서 정해지며 달라도 시스템이 고치지 않는다"
        >
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">모델명</th>
                  <th className="th">규격</th>
                  <th className="th text-right">예정</th>
                  <th className="th text-right">재단 실적</th>
                  <th className="th text-right">차이</th>
                </tr>
              </thead>
              <tbody>
                {d.plan.map((r) => {
                  const made = d.lots
                    .filter((l) => l.item_code === r.item_code)
                    .reduce((a, l) => a + l.qty_produced, 0);
                  const diff = made - (r.planned_qty ?? 0);
                  return (
                    <tr key={r.item_id}>
                      <td className="td font-mono text-xs">{r.item_code}</td>
                      <td className="td text-sm">{r.item_name}</td>
                      <td className="td tnum text-right text-muted">{r.planned_qty ?? ''}</td>
                      <td className="td tnum text-right font-semibold">{made || ''}</td>
                      {/* 차이는 사실만 적는다. 많고 적음을 판정하지 않는다 (§10) */}
                      <td className={`td tnum text-right ${diff === 0 ? 'text-faint' : 'text-ink'}`}>
                        {made === 0 ? '' : diff > 0 ? `+${diff}` : diff}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel
        title="제품 로트 (재단 분할)"
        note="재단에서 형명별로 나누고 제조번호를 부여한다"
        action={d.lots.length > 0 ? (
          // 라벨요청서는 재단 뒤에 뽑는다 (§7). 재단 결과가 그대로 요청 내용이다.
          <Link href={`/print/label-request/${wo.id}`} className="btn-ghost h-8">
            라벨요청서
          </Link>
        ) : null}
      >
        {d.lots.length === 0 ? (
          <Empty>아직 재단하지 않았습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">제조번호</th>
                  <th className="th">형명</th>
                  <th className="th text-right">생산</th>
                  <th className="th text-right">샘플</th>
                  <th className="th text-right">출하 가능</th>
                  <th className="th text-right">출고</th>
                  <th className="th">제조일</th>
                  <th className="th">유효기한</th>
                  <th className="th">상태</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {d.lots.map((l) => (
                  <tr key={l.id}>
                    <td className="td font-mono text-xs font-semibold">{l.lot_no}</td>
                    <td className="td">
                      <div className="text-sm">{l.item_name}</div>
                      <div className="font-mono text-xs text-faint">{l.item_code}</div>
                    </td>
                    <td className="td tnum text-right">{l.qty_produced}</td>
                    <td className="td tnum text-right text-muted">{l.qty_sample || ''}</td>
                    <td className="td tnum text-right font-semibold">{l.qty_available}</td>
                    <td className="td tnum text-right text-muted">{l.shipped || ''}</td>
                    <td className="td tnum text-xs">{fmtDate(l.manufactured_on)}</td>
                    <td className="td tnum text-xs">
                      {fmtDate(l.expiry_date)}
                      {l.shelf_months && (
                        <span className="ml-1 text-faint">{l.shelf_months}개월</span>
                      )}
                    </td>
                    <td className="td">
                      <Tag tone={l.status === 'SHIPPED' ? 'quiet' : 'ok'}>
                        {PL_STATUS_LABEL[l.status] ?? l.status}
                      </Tag>
                      {l.location && <div className="text-xs text-faint">{l.location}</div>}
                    </td>
                    <td className="td text-right">
                      <LotStatusForm lot={l} woId={wo.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {active && (
          <CutForm woId={wo.id} options={d.finished} today={d.today ?? ''} used={usedIds} />
        )}
      </Panel>

      <Panel title="일차별 기록지" note="인쇄하면 그 묶음이 잠긴다 (S04)">
        {d.days.length === 0 ? (
          <Empty>아직 공정 기록이 없습니다. 현장 화면에서 작성합니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">일차</th>
                  <th className="th">작업일</th>
                  <th className="th">작업자</th>
                  <th className="th text-right">기록</th>
                  <th className="th">잠금</th>
                  <th className="th text-right">인쇄 회차</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {d.days.map((r) => (
                  <tr key={`${r.day_no}-${r.worker_id}`}>
                    <td className="td tnum font-semibold">{r.day_no}일차</td>
                    <td className="td tnum text-xs">{fmtDate(r.work_date)}</td>
                    <td className="td">{r.worker_name}</td>
                    <td className="td tnum text-right text-muted">{r.records}</td>
                    <td className="td">
                      <Tag tone={r.locked ? 'ok' : 'quiet'}>{r.locked ? '잠김' : '작성 중'}</Tag>
                    </td>
                    <td className="td tnum text-right text-muted">{r.printed || ''}</td>
                    <td className="td text-right">
                      <Link
                        href={`/print/day-record/${wo.id}/${r.day_no}/${r.worker_id}`}
                        className="btn-ghost h-8 px-3 text-xs"
                      >
                        {r.locked ? '재발행' : '인쇄'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="공정 기록">
        {d.records.length === 0 ? (
          <Empty>기록이 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">일차</th>
                  <th className="th">공정</th>
                  <th className="th">제품 로트</th>
                  <th className="th">작업자</th>
                  <th className="th">시작</th>
                  <th className="th">종료</th>
                  <th className="th text-right">투입 자재</th>
                  <th className="th">비고</th>
                </tr>
              </thead>
              <tbody>
                {d.records.map((r) => (
                  <tr key={r.id}>
                    <td className="td tnum text-xs">
                      {r.day_no}
                      {r.attempt > 1 && <span className="ml-1 text-warn">{r.attempt}회차</span>}
                    </td>
                    <td className="td">
                      <div className="text-sm">{r.operation_name}</div>
                      <div className="font-mono text-xs text-faint">{r.operation_code}</div>
                    </td>
                    <td className="td font-mono text-xs">{r.product_lot_no ?? ''}</td>
                    <td className="td text-xs">
                      {r.worker_name}
                      {r.rotation_name && (
                        <div className="text-faint">순환 {r.rotation_name}</div>
                      )}
                    </td>
                    <td className="td tnum text-xs">{fmtDateTime(r.started_at)}</td>
                    <td className="td tnum text-xs">{fmtDateTime(r.ended_at)}</td>
                    <td className="td tnum text-right text-muted">{r.issues || ''}</td>
                    <td className="td text-xs text-muted">
                      {r.equipment_id && <div>설비 {r.equipment_id}</div>}
                      {r.rework_qty ? <div>재포장 {r.rework_qty}</div> : null}
                      {r.no_material_reason && (
                        <div className="text-warn">{r.no_material_reason}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {d.prints.length > 0 && (
        <Panel title="인쇄 이력">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">양식</th><th className="th text-right">회차</th>
                  <th className="th">일시</th><th className="th">인쇄자</th>
                </tr>
              </thead>
              <tbody>
                {d.prints.map((p, i) => (
                  <tr key={i}>
                    <td className="td text-xs">{p.kind}</td>
                    <td className="td tnum text-right text-xs">{p.seq}</td>
                    <td className="td tnum text-xs text-muted">{fmtDateTime(p.printed_at)}</td>
                    <td className="td text-xs text-muted">{p.printed_by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* ---------------------------------------------------------------
          배치를 닫는 칸

          편철 표지는 배치가 끝난 뒤에 뽑는다 (§7 "로트 종료"). 표지에 적히는
          매수와 목록이 기록이 쌓일수록 바뀌기 때문이다. 그래서 다른 인쇄물과
          같은 줄에 두지 않고 여기, 배치를 닫는 자리에 둔다.

          아직 안 끝났어도 막지는 않는다 (§2 차단은 다섯 개뿐이다). 대신 무엇이
          남았는지 적어 두고, 그렇게 뽑은 종이에도 같은 문장이 인쇄된다.
      --------------------------------------------------------------- */}
      <Panel title="배치 종료와 편철" note="편철 표지는 배치가 끝난 뒤에 뽑습니다">
        <div className="flex flex-wrap items-start justify-between gap-4 p-4">
          <div className="min-w-0 space-y-1.5">
            {remaining.length > 0 ? (
              <>
                <p className="text-sm text-ink">
                  아직 남은 것이 있습니다: <b>{remaining.join(' · ')}</b>
                </p>
                <p className="text-xs leading-relaxed text-muted">
                  지금 뽑아도 되지만 매수와 목록이 확정값이 아닙니다.
                  그 종이에도 미완료 표시가 함께 인쇄됩니다.
                </p>
              </>
            ) : (
              <p className="text-sm leading-relaxed text-muted">
                기록서 <b className="tnum text-ink">{totalPages}</b>장 ·
                제품 로트 <b className="tnum text-ink">{d.lots.length}</b>건.
                표지를 뽑아 종이 묶음 맨 위에 얹고 매수를 세어 맞춰 보십시오.
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link href={`/print/cover/${wo.id}`}
                  className={remaining.length === 0 ? 'btn-primary' : 'btn-ghost'}>
              편철 표지
            </Link>
            {active && <CancelForm id={wo.id} />}
          </div>
        </div>
      </Panel>
    </div>
  );
}
