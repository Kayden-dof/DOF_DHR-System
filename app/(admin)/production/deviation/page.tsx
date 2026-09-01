import { requireUser, blocksReadOnly } from '@/lib/session';
import Denied from '@/components/denied';
import { withActor } from '@/lib/db';
import { PageShell, StatStrip, type StatItem } from '@/components/shell';
import { statRows, mono } from '@/components/stat-rows';
import { Panel, Empty } from '@/components/ui';
import { SubNav } from '../../nav';
import { PRODUCTION_NAV } from '../../sections';
import { OpenDeviation, DeviationRow, type DevRow, type DevOpts } from '../deviation-forms';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다.
 */
export const metadata = { title: '일탈 대장' };

/* ---------------------------------------------------------------------------
   일탈 대장

   §9.1 이 "번호만 나가는 상태로 운영에 들어가지 않는다" 며 남겨 둔 자리다.
   채번 화면이 일탈 번호를 내놓는데 담을 데가 없었다.

   시스템은 일탈을 판정하지 않는다 (§1). 대장이 하는 일은 번호를 잃지 않게
   붙들고, 그 번호가 어느 서면 문서를 가리키는지 남기는 것 하나다.
--------------------------------------------------------------------------- */

export default async function DeviationPage() {
  const user = await requireUser();
  if (blocksReadOnly(user)) return <Denied what="이 화면" need="생산관리자 또는 시스템관리자" />;

  const d = await withActor(user.id, async (db) => ({
    rows: await db.rows<DevRow>(
      `select id, deviation_no, occurred_on::text as occurred_on, title, detail,
              batch_no, product_lot_no, material_lot_no, equipment_code, equipment_name,
              report_no, outcome, approved_by, approved_on::text as approved_on,
              closed_on::text as closed_on, registered_by_name, is_open
         from v_deviation
        order by occurred_on desc, deviation_no desc
        limit 200`),
    batches: await db.rows<{ id: string; batch_no: string }>(
      `select id, batch_no from work_order
        where status <> 'CANCELLED' order by issued_at desc limit 60`),
    lots: await db.rows<{ id: string; lot_no: string }>(
      `select id, lot_no from product_lot order by manufactured_on desc limit 100`),
    materials: await db.rows<{ id: string; lot_no: string; item_name: string }>(
      `select ml.id, ml.lot_no, i.name as item_name
         from material_lot ml join item i on i.id = ml.item_id
        order by ml.received_at desc limit 100`),
    equipment: await db.rows<{ id: string; code: string; name: string }>(
      `select id, code, name from equipment where is_active order by code`),
    today: await db.val<string>(`select to_char(timezone('Asia/Seoul', now()),'YYYY-MM-DD')`),
    rule: await db.val<number>(
      `select count(*)::int from numbering_rule where target='DEVIATION' and is_active`),
  }));

  const opts: DevOpts = {
    batches: d.batches, lots: d.lots, materials: d.materials, equipment: d.equipment,
  };
  const today = d.today ?? '';
  const openRows = d.rows.filter((r) => r.is_open);

  /*
   * 종결 전 건수만 띄운다. 종결된 것까지 세어 나란히 놓으면 "몇 퍼센트가
   * 닫혔다" 로 읽히고, 그건 대장이 할 말이 아니다.
   */
  const stats: StatItem[] = [
    { label: '대장에 오른 일탈', value: d.rows.length, unit: '건',
      detail: statRows(d.rows.map((r) => ({
        left: mono(r.deviation_no), sub: r.title,
        right: r.is_open ? '종결 전' : r.closed_on!,
      })), '등록된 일탈이 없습니다') },
    { label: '종결 전', value: openRows.length, unit: '건',
      tone: openRows.length > 0 ? 'warn' : undefined,
      detail: statRows(openRows.map((r) => ({
        left: mono(r.deviation_no), sub: r.title, right: r.occurred_on,
      })), '종결 전인 일탈이 없습니다') },
  ];

  return (
    <PageShell
      section="생산"
      title="일탈 대장"
      lede="일탈 번호를 붙들고, 그 번호가 어느 서면 문서를 가리키는지 남깁니다."
      action={<OpenDeviation opts={opts} today={today} />}
      nav={<SubNav items={PRODUCTION_NAV} />}
      stats={<StatStrip items={stats} />}
    >
      {(d.rule ?? 0) === 0 && (
        <div className="card border-warn/40 bg-warn-bg px-4 py-3">
          <p className="text-sm leading-relaxed text-ink">
            일탈 번호의 채번 규칙이 없습니다. 규칙을 먼저 등록해야 번호를 만들 수 있습니다.
          </p>
        </div>
      )}

      <Panel>
        {d.rows.length === 0 ? (
          <Empty>대장에 오른 일탈이 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">일탈 번호</th>
                  <th className="th">발생일</th>
                  <th className="th">무엇이 일어났는가</th>
                  <th className="th">서면 근거</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => <DeviationRow key={r.id} d={r} today={today} />)}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <section className="card p-4">
        <h3 className="text-xs font-bold text-ink">이 화면이 하는 일과 하지 않는 일</h3>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
          <li>· 일탈 번호를 채번 규칙으로 만들고 대장에 남깁니다.</li>
          <li>· 어느 배치·로트·설비에 걸린 일탈인지를 연결해 둡니다.</li>
          <li>
            · <b className="text-ink">무엇이 일탈인지, 얼마나 중대한지 판정하지 않습니다.</b>{' '}
            등급도 분류 선택지도 두지 않습니다. 판정은 서면으로 하며, 대장은 그 결론과
            보고서 번호를 옮겨 적습니다.
          </li>
          <li>· 종결하려면 서면 보고서 번호와 승인자가 있어야 합니다.</li>
          <li>
            · 한 번 적은 번호·발생일·종결 기록은 고칠 수 없고, 종결을 되돌릴 수 없습니다.
            경위와 관련 대상은 조사 중에 밝혀지는 것이 있어 열어 둡니다.
          </li>
        </ul>
      </section>
    </PageShell>
  );
}
