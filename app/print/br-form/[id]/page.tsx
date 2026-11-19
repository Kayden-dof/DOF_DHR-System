import { notFound } from 'next/navigation';
import { requireUser, blocksScreen } from '@/lib/session';
import Denied from '@/components/denied';
import { withActor } from '@/lib/db';
import { FormBody } from '@/components/print-frame';
import type { BrForm } from '@/lib/br-form';
import PrintBar from '../../docs-check/print-bar';

export const dynamic = 'force-dynamic';
export const metadata = { title: '빈 양식 보기' };

/* ---------------------------------------------------------------------------
   빈 제조기록서 양식 (0137 · 사용자 2026-11-19)

   개정안 양식은 그 판의 제품표준서로 지시가 나가야 현장 · 인쇄에 나온다. 그 전에
   모양을 볼 수 있게 문서에 붙은 양식을 빈 채로 그린다. 기록이 아니므로 인쇄 대장에
   남지 않고 아무것도 잠그지 않는다 - 자료 식별자 줄도 없다.
--------------------------------------------------------------------------- */

export default async function BlankFormPrint({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (blocksScreen(user, '/settings/docs')) return <Denied what="이 양식" need="생산관리자 또는 시스템관리자" />;
  const { id } = await params;
  const doc = await withActor(user.id, (db) => db.one<{
    doc_no: string; revision: string; title: string; product_code: string; form: BrForm | null;
  }>(
    `select doc_no, revision, title, product_code, form from mfg_doc where id::text = $1 and kind = 'BR'`, [id]));
  if (!doc?.form) notFound();
  const pages = doc.form.pages;
  return (
    <>
      <PrintBar back={`/settings/docs?p=${doc.product_code}`}
                title={`${doc.doc_no} ${doc.revision} · 빈 양식 ${pages.length}쪽 · 기록이 아니라 대장에 남지 않습니다`} />
      {pages.map((pg, i) => (
        <div key={i} className="sheet sheet--form relative mx-auto mb-4 shadow-sm print:mb-0 print:shadow-none">
          <FormBody page={pg} size={doc.form!.page} formPage={{ n: i + 1, of: pages.length }} />
        </div>
      ))}
    </>
  );
}
