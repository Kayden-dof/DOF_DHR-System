import Link from 'next/link';
import Denied from '@/components/denied';
import { requireUser, blocksViewer } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDateTime } from '@/lib/fmt';
import { KIND_LABEL, dataHash } from '@/lib/print';
import { dayRecordPayload, hashable } from '@/lib/print-payload';
import { Panel, Empty, Tag, Field } from '@/components/ui';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';
import { TRACE_NAV } from '../../sections';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '인쇄물 확인' };

/* ---------------------------------------------------------------------------
   인쇄물 조회 (§7 · 인쇄물 통제)

   손에 든 종이의 자료 식별자를 넣으면 그 종이가 무엇인지 되짚는다.
   가장 중요한 답은 하나다. "이 뒤에 다시 뽑은 회차가 있는가."

   같은 기록의 종이가 두 장 도는 것이 이 시스템에서 가장 위험한 상태다.
   종이만 봐서는 어느 것이 최신인지 알 수 없고, 잘못된 쪽에 서명이 들어가면
   되돌릴 방법이 없다.

   판정하지 않는다. "무효" 같은 말을 쓰지 않는다. 언제 뽑혔고 뒤에 몇 회차가
   더 나왔고 회수 기록이 있는지를 사실로만 답한다. 무엇을 할지는 보는 사람이
   정한다 (§8.5).
--------------------------------------------------------------------------- */

interface Hit {
  id: string; kind: string; short_hash: string; seq: number; pages: number;
  printed_at: Date; printed_by_name: string;
  retrieved_at: Date | null; retrieve_reason: string | null;
  work_order_id: string | null; batch_no: string | null; wo_no: string | null;
  day_no: number | null; worker_name: string | null;
  product_lot_no: string | null; material_lot_no: string | null;
  equipment_code: string | null; equipment_name: string | null;
  newer_count: number; latest_seq: number;
  data_hash: string;
  /* 지금 자료로 다시 계산한 값. 대조할 수 없는 양식이면 null */
  recomputed?: string | null;
}

export default async function VerifyPage({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  /* 열람자에게 열어 둔 화면이 아니다. 주소를 직접 쳐도 들어가지 못한다 */
  if (blocksViewer(user)) return <Denied what="이 화면" need="생산관리자 또는 시스템관리자" />;

  const sp = await searchParams;
  const q = (sp.q ?? '').trim().toLowerCase().replace(/[^0-9a-f]/g, '');

  const hits = q.length >= 4
    ? await withActor(user.id, (db) =>
        db.rows<Hit>(
          `select * from v_print_lookup
            where short_hash like $1 || '%'
            order by printed_at desc limit 20`, [q]))
    : [];

  /*
   * 지금 자료로 다시 계산해 종이에 찍힌 값과 견준다 (1차 감사 지적 2 의 나머지).
   *
   * 제조기록서만 한다. 인쇄하면 그 묶음이 잠겨 (S04) 자료가 얼기 때문에,
   * 나중에 다시 계산한 값이 다르면 그건 실제로 무언가 달라진 것이다.
   *
   * 다른 양식은 대조하지 않는다. 편철 표지는 일차가 늘면 바뀌고 라벨요청서는
   * 재단이 진행되면 바뀐다. 그것까지 견주면 정상 진행에도 계속 "다르다" 가
   * 떠서, 신호가 아니라 소음이 된다 (§8.5).
   */
  await withActor(user.id, async (db) => {
    for (const h of hits) {
      if (h.kind !== 'DAY_RECORD' || !h.work_order_id || h.day_no === null) continue;
      const worker = await db.val<string>(
        `select worker_id::text from record_print where id = $1`, [h.id]);
      if (!worker) continue;
      const payload = await dayRecordPayload(db, h.work_order_id, h.day_no, worker);
      h.recomputed = payload ? dataHash(hashable(payload)) : null;
    }
  });

  return (
    <PageShell
      section="조회"
      title="인쇄물 조회"
      lede="종이 아래쪽에 찍힌 자료 식별자 12자리를 입력하십시오. 바코드를 읽어도 같은 값이 들어갑니다."
      nav={<SubNav items={TRACE_NAV} />}
    >
      <form className="card flex gap-2 p-3">
        <input
          name="q"
          defaultValue={sp.q ?? ''}
          autoComplete="off"
          autoFocus
          placeholder="자료 식별자 (예: 7f2dbdb9a018)"
          className="input flex-1 font-mono uppercase"
        />
        <button className="btn-primary px-6">찾기</button>
      </form>

      {q.length >= 4 && (
        <Panel title={`결과 ${hits.length}건`}>
          {hits.length === 0 ? (
            <Empty hint="식별자를 다시 확인하십시오. 앞 4자리만 넣어도 찾습니다.">
              그 식별자로 뽑힌 인쇄물이 없습니다.
            </Empty>
          ) : (
            <ul className="divide-y divide-line-soft">
              {hits.map((h) => (
                <li key={h.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold text-ink">
                      {h.short_hash}
                    </span>
                    <Tag tone="brand">{KIND_LABEL[h.kind] ?? h.kind}</Tag>
                    <Tag tone={h.seq > 1 ? 'warn' : 'quiet'}>{h.seq}회차</Tag>

                    {/* 사실만 적는다. 무효라고 말하지 않는다 */}
                    {h.newer_count > 0 && (
                      <Tag tone="danger">뒤에 {h.newer_count}회 재출력</Tag>
                    )}
                    {h.retrieved_at && <Tag tone="ok">회수됨</Tag>}
                  </div>

                  <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
                    {h.batch_no && (
                      <Field label="배치 · 지시서">
                        <span className="font-mono">{h.batch_no}</span>
                        <span className="ml-1.5 font-mono text-xs text-muted">{h.wo_no}</span>
                      </Field>
                    )}
                    {h.day_no !== null && (
                      <Field label="일차 · 작업자">
                        <span className="tnum">{h.day_no}일차</span>
                        {h.worker_name && <span className="ml-1.5">{h.worker_name}</span>}
                      </Field>
                    )}
                    {h.product_lot_no && (
                      <Field label="제조번호">
                        <span className="font-mono">{h.product_lot_no}</span>
                      </Field>
                    )}
                    {h.equipment_code && (
                      <Field label="설비">
                        <span className="font-mono">{h.equipment_code}</span>
                        {h.equipment_name && (
                          <span className="ml-1.5 text-muted">{h.equipment_name}</span>
                        )}
                      </Field>
                    )}
                    {h.material_lot_no && (
                      <Field label="자재 로트">
                        <span className="font-mono">{h.material_lot_no}</span>
                      </Field>
                    )}
                    <Field label="인쇄">
                      <span className="tnum">{fmtDateTime(h.printed_at)}</span>
                      <span className="ml-1.5 text-muted">{h.printed_by_name}</span>
                    </Field>
                    <Field label="매수">
                      <span className="tnum">{h.pages}장</span>
                    </Field>
                  </div>

                  {/*
                    * 지금 자료로 다시 계산한 값.
                    *
                    * 종이에 찍힌 값은 인쇄한 그 순간의 자료를 요약한 것이다.
                    * 지금 자료를 같은 방법으로 요약해 견주면, 그 뒤로 무언가
                    * 달라졌는지 알 수 있다. 이 대조가 없으면 재인쇄가 일어나기
                    * 전까지 어긋남이 드러나지 않는다.
                    *
                    * 판정하지 않는다 (§8.5). 같다 · 다르다만 적고, 다르면
                    * 무엇을 보라고만 일러 준다.
                    */}
                  {h.recomputed !== undefined && (
                    h.recomputed === h.data_hash ? (
                      <p className="rounded-md border border-line bg-surface-sub px-3.5 py-2.5 text-sm leading-relaxed text-muted">
                        지금 자료로 다시 계산해도 같은 식별자입니다. 이 종이가 나온 뒤
                        이 묶음의 자료는 달라지지 않았습니다.
                      </p>
                    ) : (
                      <p className="rounded-md border border-warn/40 bg-warn-bg px-3.5 py-2.5 text-sm leading-relaxed text-ink">
                        <b>지금 자료로 다시 계산하면 값이 다릅니다.</b>{' '}
                        <span className="font-mono text-xs">
                          {h.recomputed ? h.recomputed.slice(0, 12) : '자료 없음'}
                        </span>
                        {' '}이 종이가 나온 뒤 이 묶음에 무엇이 달라졌는지는
                        감사추적에서 확인하십시오.
                      </p>
                    )
                  )}

                  {h.newer_count > 0 && (
                    <p className="rounded-md border border-danger-line bg-danger-bg px-3.5 py-2.5 text-sm leading-relaxed text-ink">
                      이 종이는 <b className="tnum">{h.seq}회차</b>이고, 같은 묶음에서
                      뒤에 <b className="tnum">{h.newer_count}</b>회 더 뽑혔습니다
                      (가장 최근 <b className="tnum">{h.latest_seq}회차</b>).
                      {h.retrieved_at
                        ? <> 이 종이는 {fmtDateTime(h.retrieved_at)}에 회수로 기록되었습니다.</>
                        : <> 회수 기록은 없습니다.</>}
                    </p>
                  )}

                  {h.retrieve_reason && (
                    <p className="text-xs text-muted">회수 사유: {h.retrieve_reason}</p>
                  )}

                  {h.work_order_id && (
                    <Link href={`/production/${h.work_order_id}`}
                          className="btn-ghost h-8">
                      배치 열기
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <section className="card p-4">
        <h3 className="text-xs font-bold text-ink">자료 식별자가 말해 주는 것과 아닌 것</h3>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
          <li>
            · <b className="text-ink">말해 주는 것.</b> 이 종이가 언제, 누가, 어떤 자료로
            뽑았는지. 그리고 그 뒤에 같은 묶음을 재출력한 회차가 있는지.
          </li>
          <li>
            · <b className="text-ink">말해 주지 않는 것.</b> 종이 자체의 진위. 식별자는
            그 시점 자료의 해시일 뿐이라 종이를 베끼거나 고친 것은 잡지 못합니다.
            그건 종이와 서명의 몫입니다.
          </li>
          <li>
            · 시스템은 어느 종이가 유효한지 판정하지 않습니다. 사실만 보여 주고
            판단은 보는 사람이 합니다.
          </li>
        </ul>
      </section>
    </PageShell>
  );
}
