import Link from 'next/link';
import { requireUser, hasRole } from '@/lib/session';
import { withUser } from '@/lib/db';
import { getBrand } from '@/lib/brand';
import { fmtDate, fmtTime } from '@/lib/fmt';
import {
  NUMBERING_TARGETS, M1_CRITICAL_TARGETS, WO_STATUS_LABEL, PL_STATUS_LABEL, tableLabel,
} from '@/lib/forms';
import { Panel, Empty, Tag } from '@/components/ui';
import { PageShell, StatStrip, type StatItem } from '@/components/shell';
import { statRows, mono } from '@/components/stat-rows';
import { Table, Th, Td, IdCell, TwoLine, ActionTh, RowLink } from '@/components/table';
import AuditTable from '@/components/audit-table';
import { type AuditEntry } from './settings/audit/entry';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '현황' };

/* ---------------------------------------------------------------------------
   관리자 현황

   지금 손을 대야 할 것만 위로 올린다. 숫자 나열이 아니라 "무엇이 막혀 있는가"와
   "무엇이 진행 중인가"를 먼저 보여 준다.

   판정성 문구를 쓰지 않는다 (§10). 이상이 없으면 아무것도 표시하지 않는다.
--------------------------------------------------------------------------- */

interface Counts {
  wo_open: number; wo_issued: number;
  lots_packed: number; lots_await_release: number; lots_shippable: number;
  reorder: number; expiring: number; expired: number;
  eq_due: number; eq_gone: number;
  open_records: number; unprinted_days: number;
}

interface Lists {
  wo_open:        { batch_no: string; item_name: string; status: string }[];
  open_records:   { batch_no: string; op_name: string; worker: string; day_no: number }[];
  unprinted_days: { batch_no: string; worker: string; day_no: number }[];
  await_release:  { lot_no: string; item_name: string; status: string }[];
  expiring:       { lot_no: string; item_name: string; status: string; days_left: number | null }[];
  reorder:        { code: string; name: string; on_hand: string; min_stock: string }[];
  eq_due:         { code: string; name: string; valid_until: string | null; days_left: number | null }[];
}

export default async function Dashboard() {
  const user = await requireUser();
  const admin = hasRole(user, 'SYS_ADMIN', 'VIEWER');

  const d = await withUser(user, async (db) => ({
    c: await db.one<Counts>(
      `select
        (select count(*)::int from work_order
          where status in ('ISSUED','IN_PROCESS','CUT'))                    as wo_open,
        (select count(*)::int from work_order where status = 'ISSUED')      as wo_issued,
        (select count(*)::int from product_lot where status = 'PACKED')     as lots_packed,
        (select count(*)::int from product_lot
          where status in ('PACKED','STERILIZING','TESTED')
            and release_approved_by is null)                                as lots_await_release,
        (select count(*)::int from product_lot
          where release_approved_by is not null and qty_available > 0)      as lots_shippable,
        (select count(*)::int from v_reorder_alert)                         as reorder,
        (select count(*)::int from material_lot
          where status = 'AVAILABLE' and expiry_date is not null
            and expiry_date < (timezone('Asia/Seoul', now()))::date + 30)   as expiring,
        (select count(*)::int from material_lot where status = 'EXPIRED')   as expired,
        (select count(*)::int from v_equipment_status
          where is_active
            and (valid_until is null
                 or valid_until < (timezone('Asia/Seoul', now()))::date + 30)) as eq_due,
        (select count(*)::int from v_equipment_status
          where is_active
            and (valid_until is null
                 or valid_until < (timezone('Asia/Seoul', now()))::date))      as eq_gone,
        (select count(*)::int from process_record where ended_at is null)   as open_records,
        (select count(*)::int from (
           select pr.work_order_id, pr.day_no, pr.worker_id
             from process_record pr
            group by 1,2,3
           having not exists (select 1 from day_lock dl
                               where dl.work_order_id = pr.work_order_id
                                 and dl.day_no = pr.day_no
                                 and dl.worker_id = pr.worker_id)) s)       as unprinted_days`),
    covered: await db.rows<{ target: string }>(
      `select distinct target::text as target from numbering_rule
        where is_active and item_id is null`),
    ready: await db.val<number>(
      `select count(*)::int from device_master where verified_at is not null`),
    batches: await db.rows<{
      id: string; batch_no: string; wo_no: string; status: string;
      item_name: string; item_code: string;
      sheet_count: number; issued_at: Date; day_count: number; lot_count: number;
      last_op: string | null;
    }>(
      `select wo.id, wo.batch_no, wo.wo_no, wo.status::text as status,
              i.name as item_name, i.code as item_code,
              wo.sheet_count, wo.issued_at,
              (select count(distinct pr.day_no)::int from process_record pr
                where pr.work_order_id = wo.id) as day_count,
              (select count(*)::int from product_lot pl
                where pl.work_order_id = wo.id) as lot_count,
              (select o.name from process_record pr
                 join dmr_operation o on o.id = pr.operation_id
                where pr.work_order_id = wo.id
                order by o.seq desc, pr.attempt desc limit 1) as last_op
         from work_order wo
         join device_master dm on dm.id = wo.device_master_id
         join item i on i.id = dm.item_id
        where wo.status in ('ISSUED','IN_PROCESS','CUT')
        order by wo.issued_at desc limit 6`),
    expiring: await db.rows<{
      id: string; lot_no: string; item_name: string; expiry_date: string;
      qty: string; days_left: number;
    }>(
      `select ml.id, ml.lot_no, i.name as item_name, ml.expiry_date::text as expiry_date,
              ml.qty_available as qty,
              (ml.expiry_date - (timezone('Asia/Seoul', now()))::date) as days_left
         from material_lot ml join item i on i.id = ml.item_id
        where ml.status = 'AVAILABLE' and ml.expiry_date is not null
          and ml.expiry_date < (timezone('Asia/Seoul', now()))::date + 30
        order by ml.expiry_date limit 6`),
    /*
     * 마감하지 않은 일차. "미마감 일차" 숫자를 눌러 갈 곳이 없었다. 숫자만
     * 띄워 놓고 그 숫자가 무엇으로 이루어졌는지 볼 자리를 주지 않으면 그
     * 숫자는 아무 일도 시키지 못한다.
     *
     * 묶음 키가 (지시서, 일차, 작업자)다. 같은 날 두 사람이 작업하면 기록지가
     * 두 장 나오고 각자 자기 것만 마감한다 (§4.9).
     */
    pending: await db.rows<{
      wo_id: string; batch_no: string; day_no: number;
      worker_name: string; records: number; open: number; work_date: string;
    }>(
      `select pr.work_order_id as wo_id, wo.batch_no, pr.day_no,
              u.full_name as worker_name,
              count(*)::int as records,
              count(*) filter (where pr.ended_at is null)::int as open,
              max(pr.work_date)::text as work_date
         from process_record pr
         join work_order wo on wo.id = pr.work_order_id
         join app_user u on u.id = pr.worker_id
        where not exists (select 1 from day_lock dl
                           where dl.work_order_id = pr.work_order_id
                             and dl.day_no = pr.day_no
                             and dl.worker_id = pr.worker_id)
        group by 1,2,3,4
        order by max(pr.work_date) desc, wo.batch_no, pr.day_no
        limit 7`),
    /*
     * 띠의 숫자에 든 항목. 숫자 옆에 뜻풀이가 아니라 그 숫자를 이루는 것이
     * 나와야 한다 (사용자 지시). 일곱 칸을 각각 조회하면 왕복이 일곱 번이라
     * 한 번에 받는다.
     *
     * 아홉 줄까지만 받는다. 여덟 줄을 띄우고 남은 수를 적는데, 남은 수는
     * 위에서 이미 센 값을 쓴다 - 잘라 온 배열의 길이로 세면 잘린 것을 전부인
     * 줄 안다.
     */
    lists: await db.one<Lists>(
      `select
        (select coalesce(json_agg(x), '[]'::json) from (
           select wo.batch_no, i.name as item_name, wo.status::text as status
             from work_order wo
             join device_master dm on dm.id = wo.device_master_id
             join item i on i.id = dm.item_id
            where wo.status in ('ISSUED','IN_PROCESS','CUT')
            order by wo.issued_at desc limit 9) x)                         as wo_open,

        (select coalesce(json_agg(x), '[]'::json) from (
           select wo.batch_no, o.name as op_name, u.full_name as worker, pr.day_no
             from process_record pr
             join work_order wo on wo.id = pr.work_order_id
             join dmr_operation o on o.id = pr.operation_id
             join app_user u on u.id = pr.worker_id
            where pr.ended_at is null
            order by pr.work_date desc, pr.day_no desc limit 9) x)         as open_records,

        (select coalesce(json_agg(x), '[]'::json) from (
           /* 위에서 센 것과 같은 키로 묶는다. 이름으로 묶으면 동명이인이
              한 줄로 접혀 숫자와 목록이 갈린다 */
           select wo.batch_no, u.full_name as worker, pr.day_no
             from process_record pr
             join work_order wo on wo.id = pr.work_order_id
             join app_user u on u.id = pr.worker_id
            where not exists (select 1 from day_lock dl
                               where dl.work_order_id = pr.work_order_id
                                 and dl.day_no = pr.day_no
                                 and dl.worker_id = pr.worker_id)
            group by pr.work_order_id, pr.worker_id, pr.day_no, wo.batch_no, u.full_name
            order by max(pr.work_date) desc limit 9) x)                    as unprinted_days,

        (select coalesce(json_agg(x), '[]'::json) from (
           select pl.lot_no, i.name as item_name, pl.status::text as status
             from product_lot pl join item i on i.id = pl.item_id
            where pl.status in ('PACKED','STERILIZING','TESTED')
              and pl.release_approved_by is null
            order by pl.manufactured_on limit 9) x)                        as await_release,

        (select coalesce(json_agg(x), '[]'::json) from (
           select ml.lot_no, i.name as item_name, ml.status::text as status,
                  (ml.expiry_date - (timezone('Asia/Seoul', now()))::date) as days_left
             from material_lot ml join item i on i.id = ml.item_id
            where ml.status = 'EXPIRED'
               or (ml.status = 'AVAILABLE' and ml.expiry_date is not null
                   and ml.expiry_date < (timezone('Asia/Seoul', now()))::date + 30)
            order by ml.expiry_date nulls last limit 9) x)                 as expiring,

        (select coalesce(json_agg(x), '[]'::json) from (
           select code, name, on_hand, min_stock
             from v_reorder_alert order by code limit 9) x)                as reorder,

        (select coalesce(json_agg(x), '[]'::json) from (
           select code, name, valid_until::text as valid_until,
                  (valid_until - (timezone('Asia/Seoul', now()))::date) as days_left
             from v_equipment_status
            where is_active
              and (valid_until is null
                   or valid_until < (timezone('Asia/Seoul', now()))::date + 30)
            order by valid_until nulls first limit 9) x)                   as eq_due`),
    /*
     * 감사추적 화면과 같은 자료를 같은 뷰에서 읽는다 (0077). 전에는 표 이름과
     * 시각만 한 줄로 냈고, 무엇이 바뀌었는지는 감사추적으로 건너가야 보였다.
     *
     * 스무 줄을 받아 열 줄만 펼쳐 둔다 - 접는 것은 화면이 한다.
     */
    recent: await db.rows<AuditEntry>(
      `select id::text as id, table_name, record_id::text as record_id, action,
              acted_at, reason, actor_name, old_value, new_value, label
         from v_audit_entry order by id desc limit 20`),
  }));

  /*
   * 며칠 남으면 눈에 띄게 할지는 설정이 정한다 (6차 감사 N1).
   * 전에는 이 화면이 7일, 설비 화면이 30일로 서로 다르게 보고 있었다.
   */
  const { expiryWarnDays: warnDays } = await getBrand();

  const c = d.c!;
  const have = new Set(d.covered.map((r) => r.target));
  const blocking = NUMBERING_TARGETS.filter(
    (t) => M1_CRITICAL_TARGETS.includes(t.code) && !have.has(t.code));

  const setup: { text: React.ReactNode; href: string; label: string }[] = [];
  if (blocking.length > 0 && admin) {
    setup.push({
      text: <>{blocking.map((t) => t.label).join(' · ')} 채번 규칙이 없습니다. 번호를 만들 수 없습니다.</>,
      href: '/settings/numbering', label: '채번 규칙',
    });
  }
  if ((d.ready ?? 0) === 0 && admin) {
    setup.push({
      text: <>서면 대조가 확인된 제품표준서가 없습니다. 작업 지시를 발행할 수 없습니다.</>,
      href: '/settings/dmr', label: '제품표준서',
    });
  }

  /*
   * 숫자 띠는 늘 같은 자리에 같은 항목이 있어야 훑을 수 있다. 있을 때만 나오는
   * 항목과 늘 나오는 항목을 섞지 않는다. 0은 흐리게 나오므로 감출 필요가 없고,
   * 감추면 오히려 "그 항목이 어디 갔나" 하고 찾게 된다.
   */
  const L = d.lists!;

  /* 남은 날을 사람 말로. 지난 것은 지났다고 적는다 */
  const dLeft = (n: number | null, none: string) =>
    n === null ? none : n < 0 ? `${-n}일 지남` : `${n}일 남음`;

  const stats: StatItem[] = [
    { label: '진행 중인 배치', value: c.wo_open, unit: '건', href: '/production',
      detail: statRows(L.wo_open.map((r) => ({
        left: mono(r.batch_no), sub: r.item_name,
        right: WO_STATUS_LABEL[r.status] ?? r.status,
      })), '진행 중인 배치가 없습니다', c.wo_open) },

    { label: '마감 안 된 공정', value: c.open_records, unit: '건', href: '/production',
      tone: c.open_records > 0 ? 'info' : undefined,
      detail: statRows(L.open_records.map((r) => ({
        left: mono(r.batch_no), sub: `${r.op_name} · ${r.worker}`,
        right: `${r.day_no}일차`,
      })), '끝나지 않은 공정이 없습니다', c.open_records) },

    { label: '미마감 일차', value: c.unprinted_days, unit: '건', href: '/production',
      tone: c.unprinted_days > 0 ? 'warn' : undefined,
      detail: statRows(L.unprinted_days.map((r) => ({
        left: mono(r.batch_no), sub: r.worker, right: `${r.day_no}일차`,
      })), '마감하지 않은 일차가 없습니다', c.unprinted_days) },

    { label: '출하 승인 대기', value: c.lots_await_release, unit: '로트', href: '/shipping',
      tone: c.lots_await_release > 0 ? 'info' : undefined,
      detail: statRows(L.await_release.map((r) => ({
        left: mono(r.lot_no), sub: r.item_name, right: PL_STATUS_LABEL[r.status] ?? r.status,
      })), '승인을 기다리는 로트가 없습니다', c.lots_await_release) },

    { label: '기한 임박 자재', value: c.expiring + c.expired, unit: '건', href: '/material',
      tone: c.expired > 0 ? 'danger' : c.expiring > 0 ? 'warn' : undefined,
      detail: statRows(L.expiring.map((r) => ({
        left: mono(r.lot_no), sub: r.item_name,
        right: r.status === 'EXPIRED' ? '기한 경과' : dLeft(r.days_left, '기한 없음'),
      })), '기한이 임박한 자재가 없습니다', c.expiring + c.expired) },

    { label: '최소 재고선 아래', value: c.reorder, unit: '종', href: '/material/orders',
      tone: c.reorder > 0 ? 'warn' : undefined,
      detail: statRows(L.reorder.map((r) => ({
        left: mono(r.code), sub: r.name, right: `${r.on_hand} / ${r.min_stock}`,
      })), '재고선 아래인 품목이 없습니다', c.reorder) },

    { label: '설비 밸리데이션', value: c.eq_due, unit: '대', href: '/equipment',
      tone: c.eq_gone > 0 ? 'danger' : c.eq_due > 0 ? 'warn' : undefined,
      detail: statRows(L.eq_due.map((r) => ({
        left: mono(r.code), sub: r.name,
        right: r.valid_until === null ? '기록 없음' : dLeft(r.days_left, '기록 없음'),
      })), '기한이 다가온 설비가 없습니다', c.eq_due) },
  ];

  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false,
  }).format(new Date()));
  const greeting = hour < 11 ? '아침' : hour < 17 ? '오후' : '저녁';

  /*
   * 눈썹 자리에 오늘 날짜를 둔다. 다른 화면이 구역 이름을 놓는 자리인데,
   * 현황에서 "현황"이라고 다시 적는 것은 아무것도 말하지 않는다. 작업일이
   * 기록의 축인 시스템이라 날짜가 그 자리에 있을 값이다.
   */
  const today = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).format(new Date());

  return (
    <PageShell
      section={today}
      title={`${greeting} 인사드립니다, ${user.full_name} 님`}
      action={<Link href="/production" className="btn-primary">생산으로</Link>}
      stats={<StatStrip items={stats} />}
    >
      {setup.length > 0 && (
        <section className="card border-warn/30 bg-warn-bg">
          <div className="flex items-start gap-3 p-4">
            <Tag tone="warn">설정 필요</Tag>
            <div className="space-y-2">
              {setup.map((s, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3">
                  <p className="text-sm leading-relaxed text-ink">{s.text}</p>
                  <Link href={s.href} className="btn-ghost h-8">{s.label}</Link>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-3">
        <Panel
          className={d.expiring.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}
          title="진행 중인 배치"
          action={
            <Link href="/production" className="text-xs font-bold text-brand hover:underline">
              전체 보기
            </Link>
          }
        >
          {d.batches.length === 0 ? (
            <Empty hint="작업 지시를 발행하면 여기에 나타납니다.">
              진행 중인 배치가 없습니다.
            </Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>배치 · 지시서</Th>
                  <Th>제품</Th>
                  <Th>최근 공정</Th>
                  <Th right>장입</Th>
                  <Th right>일차</Th>
                  <Th right>로트</Th>
                  <Th>상태</Th>
                  <ActionTh />
                </tr>
              </thead>
              <tbody>
                {d.batches.map((b) => (
                  <RowLink key={b.id} href={`/production/${b.id}`}>
                    <IdCell
                      id={b.batch_no}
                      sub={b.wo_no}
                      tone={b.status === 'IN_PROCESS' ? 'brand' : undefined}
                    />
                    <TwoLine top={b.item_name} bottom={b.item_code} />
                    <Td nowrap className="text-xs text-muted">{b.last_op ?? '착수 전'}</Td>
                    <Td right>{b.sheet_count}</Td>
                    <Td right className="text-muted">{b.day_count || ''}</Td>
                    <Td right className="text-muted">{b.lot_count || ''}</Td>
                    <Td>
                      <Tag tone={b.status === 'IN_PROCESS' ? 'brand'
                        : b.status === 'CUT' ? 'info' : 'quiet'}>
                        {WO_STATUS_LABEL[b.status] ?? b.status}
                      </Tag>
                    </Td>
                  </RowLink>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        {/*
          * 임박한 자재가 없으면 이 패널 자체를 내지 않는다. "없습니다"가 적힌
          * 빈 상자는 자리만 차지하고, 아무것도 없는 것이 정상이다 (§10).
          */}
        {d.expiring.length > 0 && (
          <Panel
            title="유효기한 임박"
            note={`${warnDays}일 이내`}
            action={
              <Link href="/material" className="text-xs font-bold text-brand hover:underline">
                자재로
              </Link>
            }
          >
            <ul className="divide-y divide-line-soft">
              {d.expiring.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span aria-hidden className={`h-8 w-[3px] shrink-0 rounded-full ${
                    e.days_left <= 0 ? 'bg-danger'
                      : e.days_left <= warnDays ? 'bg-warn' : 'bg-line-strong'
                  }`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">{e.item_name}</div>
                    <div className="font-mono text-xs text-faint">{e.lot_no}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`tnum text-xs font-bold ${
                      e.days_left <= 0 ? 'text-danger' : 'text-warn'}`}>
                      {e.days_left <= 0 ? '기한 경과' : `${e.days_left}일`}
                    </div>
                    <div className="tnum text-xs text-muted">{fmtDate(e.expiry_date)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      {/*
        * 마감 대기와 최근 활동을 위아래로 쌓는다 (사용자 지시 2026-09-01).
        *
        * 전에는 2 : 1 로 나란히 두었다. 그런데 왼쪽은 표이고 오른쪽은 목록이라
        * 높이가 서로 맞지 않아, 한쪽이 길면 다른 쪽 옆에 빈 자리가 남았다.
        * 그리고 마감 대기 표가 좁은 칸에 눌려 열이 붙었다.
        *
        * 쌓으면 표가 폭을 다 쓰고 최근 활동은 옆의 빈 자리를 만들지 않는다.
        */}
      <div className="space-y-5">
        {/*
          * 마감 대기. 위 숫자 띠의 "미마감 일차"가 무엇으로 이루어졌는지가
          * 여기 있다. 숫자를 띄워 놓고 그 안을 볼 자리를 주지 않으면 그 숫자는
          * 아무 일도 시키지 못한다.
          *
          * 마감 자체는 여기서 하지 않는다. 인쇄가 곧 잠금이라 (S04) 되돌릴 수
          * 없고, 되돌릴 수 없는 조작은 배치를 열어 놓고 해야 한다.
          */}
        <Panel
          title="마감 대기"
          action={
            <Link href="/production" className="text-xs font-bold text-brand hover:underline">
              생산으로
            </Link>
          }
        >
          {d.pending.length === 0 ? (
            <Empty>마감을 기다리는 일차가 없습니다.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>배치</Th>
                  <Th>작업일</Th>
                  <Th>작업자</Th>
                  <Th right>기록</Th>
                  <Th>진행</Th>
                  <ActionTh />
                </tr>
              </thead>
              <tbody>
                {d.pending.map((p) => (
                  <RowLink key={`${p.wo_id}-${p.day_no}-${p.worker_name}`}
                           href={`/production/${p.wo_id}`}>
                    <IdCell
                      id={p.batch_no}
                      sub={`${p.day_no}일차`}
                      tone={p.open > 0 ? 'info' : 'warn'}
                    />
                    <Td nowrap className="tnum text-muted">{fmtDate(p.work_date)}</Td>
                    <Td nowrap>{p.worker_name}</Td>
                    <Td right>{p.records}</Td>
                    <Td>
                      {p.open > 0
                        ? <Tag tone="info">공정 {p.open}건 진행 중</Tag>
                        : <Tag tone="warn">기록서 미발행</Tag>}
                    </Td>
                  </RowLink>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel
          title="최근 활동"
          action={admin
            ? <Link href="/settings/audit" className="text-xs font-bold text-brand hover:underline">감사추적</Link>
            : null}
        >
          {/* 감사추적 화면과 같은 표다 (components/audit-table.tsx) */}
          {/*
            * 다섯 줄만 먼저 보인다 (사용자 지시 2026-09-02). 나머지는 접혀
            * 있고 펼칠 수 있다. 첫 화면에서 이 표가 세로를 다 먹지 않게 한다.
            */}
          <AuditTable entries={d.recent} collapseTo={5} />
        </Panel>
      </div>
    </PageShell>
  );
}
