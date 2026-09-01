import { requireUser, hasRole } from '@/lib/session';
import Denied from '@/components/denied';
import { withActor } from '@/lib/db';
import { PageShell } from '@/components/shell';
import { Panel } from '@/components/ui';
import { SubNav } from '../../nav';
import { SETTINGS_NAV } from '../../sections';
import { BrandForm, LogoForm, LogoNote } from './brand-forms';

export const dynamic = 'force-dynamic';

export const metadata = { title: '회사 표시' };

/* ---------------------------------------------------------------------------
   회사 표시 (M5-2 · §2.0)

   이름 · 강조색 · 로고를 여기서 정한다. 전에는 세 곳에 박혀 있어 다른 제조소가
   받으면 코드를 고쳐 다시 빌드해야 했다.

   기록이 아니라 표시다. 판정에 관여하지 않고, 고치면 감사추적에 남는다.
--------------------------------------------------------------------------- */

interface Row {
  company_name: string; brand_color: string;
  system_name: string | null; system_name_long: string | null;
  system_tagline: string | null; company_tagline: string | null;
  logo_name: string | null; has_logo: boolean; version: string | null;
  logo_dark_name: string | null; has_dark_logo: boolean;
  updated_by_name: string | null; updated_at: string | null;
}

export default async function BrandPage() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN')) {
    return <Denied what="회사 표시" need="시스템관리자" />;
  }

  const d = await withActor(user.id, (db) =>
    db.one<Row>(
      `select b.company_name, b.brand_color, b.logo_name,
              b.system_name, b.system_name_long, b.system_tagline, b.company_tagline,
              (b.logo_bytes is not null) as has_logo,
              b.logo_dark_name, (b.logo_dark_bytes is not null) as has_dark_logo,
              to_char(b.updated_at, 'YYYYMMDDHH24MISS') as version,
              u.full_name as updated_by_name,
              to_char(timezone('Asia/Seoul', b.updated_at), 'YYYY-MM-DD HH24:MI') as updated_at
         from org_brand b left join app_user u on u.id = b.updated_by
        limit 1`),
  );

  if (!d) {
    return (
      <PageShell section="설정" title="회사 표시" nav={<SubNav items={SETTINGS_NAV} />}>
        <Panel>
          <p className="px-4 py-6 text-sm text-muted">
            회사 표시 설정이 아직 없습니다. 이관을 올린 뒤 다시 열어 주십시오.
          </p>
        </Panel>
      </PageShell>
    );
  }

  return (
    <PageShell
      section="설정"
      title="회사 표시"
      lede="이름과 색, 로고를 정합니다. 화면과 인쇄물이 같은 것을 씁니다."
      nav={<SubNav items={SETTINGS_NAV} />}
    >
      <Panel title="회사"
             note={d.updated_at ? `${d.updated_at} · ${d.updated_by_name ?? ''}` : undefined}>
        <BrandForm name={d.company_name} color={d.brand_color}
                   sys={d.system_name} sysLong={d.system_name_long}
                   tagline={d.system_tagline} companyTagline={d.company_tagline} />
        <LogoForm hasLogo={d.has_logo} logoName={d.logo_name}
                  hasDarkLogo={d.has_dark_logo} darkName={d.logo_dark_name}
                  version={d.version} />
        <LogoNote />
      </Panel>

      <section className="card p-4">
        <h3 className="text-xs font-bold text-ink">이 화면이 하는 일과 하지 않는 일</h3>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
          <li>· 회사 이름 · 강조색 · 로고를 정합니다. 화면과 인쇄물이 같은 것을 씁니다.</li>
          <li>
            · <b className="text-ink">기록이 아니라 표시입니다.</b> 판정에 관여하지 않고,
            이미 발행된 인쇄물의 자료 식별자에도 영향이 없습니다.
          </li>
          <li>
            · 로고는 두 칸입니다. 어두운 바탕용을 올리지 않아도 화면은 빈 곳 없이
            돕니다 - 밝은 판 위에 위 로고를 얹습니다.
          </li>
          <li>
            · 로고는 담습니다. 밖으로 나가도 회사가 영향을 받지 않는 파일이기 때문입니다.
            <b className="text-ink"> 제조기록 · 제품표준서 · 성적서는 담지 않고 번호로
            가리킵니다.</b>
          </li>
          <li>· 그림은 백업에 함께 들어갑니다. 복구하면 로고도 같이 돌아옵니다.</li>
        </ul>
      </section>
    </PageShell>
  );
}
