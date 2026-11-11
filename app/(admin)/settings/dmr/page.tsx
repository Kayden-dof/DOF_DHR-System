import { requireUser, hasRole, canWrite, blocksScreen } from '@/lib/session';
import { fixAt } from '@/lib/unblock';
import Denied from '@/components/denied';
import { PageShell } from '@/components/shell';
import { withActor } from '@/lib/db';
import { NewDeviceMaster, NewProduct, type ItemOption, type PrevRevision } from './dmr-forms';
import { SubNav } from '../../nav';
import { settingsNav } from '../../sections';
import { DmrWorkbench } from './workbench';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '제품표준서' };

/* 작업대는 workbench.tsx 하나다. 생산 > 품목 설정과 같은 것을 쓴다. */
export default async function DmrPage({
  searchParams,
}: { searchParams: Promise<{ dm?: string; p?: string }> }) {
  const user = await requireUser();
  /* 열람자에게 열어 둔 화면이 아니다. 주소를 직접 쳐도 들어가지 못한다 */
  if (blocksScreen(user, '/settings/dmr')) return <Denied what="이 화면" need="생산관리자 또는 시스템관리자" />;

  const sp = await searchParams;
  const writable = canWrite(user);
  const fixes = { fin: fixAt(user, '/settings/items', '?type=FIN'), material: fixAt(user, '/material/items') };
  /* 화면 머리의 «제품표준서 개정 추가» 가 고를 완제품 형명 */
  const d = writable
    ? await withActor(user.id, async (db) => ({
        fin: await db.rows<ItemOption>(
          `select id, code, name, usage_uom, type::text as type from item
            where is_active and type = 'FIN' order by code`),
        /*
         * 제품마다 가장 나중 개정 (UI/UX 검수 2026-11-11). 새 개정 칸을 이 값으로 채운다.
         * 열쇠와 순서는 작업대와 같다 - 제품 코드가 없으면 대표 형명, 개정 표기 내림차순.
         */
        products: await db.rows<PrevRevision>(
          `select distinct on (coalesce(dm.product_code, i.code))
                  coalesce(dm.product_code, i.code) as key,
                  dm.product_code, dm.product_name, dm.license_no,
                  dm.item_id, dm.revision
             from device_master dm join item i on i.id = dm.item_id
            order by coalesce(dm.product_code, i.code), dm.revision desc`),
        /* ?dm= 로 연 개정의 제품. 창을 열면 그 제품으로 시작한다 */
        viewing: sp.dm
          ? await db.val<string>(
              `select coalesce(dm.product_code, i.code) from device_master dm
                 join item i on i.id = dm.item_id where dm.id::text = $1`, [sp.dm])
          : null,
        /* «제품 등록» 이 고를 대표 형명 후보와 오늘. 생산 > 제품과 같은 값이다 */
        finished: await db.rows<{ id: string; code: string; name: string }>(
          `select i.id, i.code, i.name from item i
            where i.type = 'FIN' and i.is_active
              and not exists (select 1 from device_master dm where dm.item_id = i.id)
            order by i.code limit 200`),
        today: (await db.val<string>(
          `select to_char(timezone('Asia/Seoul', now()),'YYYY-MM-DD')`)) ?? '',
      }))
    : null;

  return (
    <PageShell
      section="설정"
      title="제품표준서"
      lede="서면 제품표준서가 정본입니다. 여기에는 개정 표기와 공정 · 자재 구성표만 옮겨 기재합니다. 이 내용이 작업 지시서의 소요량 계산 근거가 됩니다."
      /*
       * 제품 등록을 여기서도 연다 (UI/UX 검수 2026-11-11). 전에는 생산 > 제품에만 있어,
       * 설정에서 제품을 세우던 사람이 생산 구역으로 건너가야 했다. 같은 폼 · 같은
       * 서버 동작이다. 생산 > 제품과 같이 개정 추가가 보조 단추로 선다.
       */
      action={d && <>
        <NewDeviceMaster quiet items={d.fin} fix={fixes.fin}
                         products={d.products} current={d.viewing ?? sp.p} />
        <NewProduct finished={d.finished} today={d.today} />
      </>}
      nav={<SubNav items={settingsNav(user.roles, user.screens)} />}
    >
      <DmrWorkbench userId={user.id} dmParam={sp.dm} productParam={sp.p} base="/settings/dmr" writable={writable}
                    fixes={fixes} />
    </PageShell>
  );
}
