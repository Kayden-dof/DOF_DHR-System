import { requireUser, blocksScreen } from '@/lib/session';
import Denied from '@/components/denied';
import { withActor } from '@/lib/db';
import {
  REQ_KIND_LABEL, REQ_STATUS_LABEL, REQ_TARGET_LABEL,
  type ReqKind, type ReqStatus,
} from '@/lib/mfg-doc';
import PrintBar from '../../docs-check/print-bar';

export const dynamic = 'force-dynamic';
export const metadata = { title: '작업표준서 · 제조기록서 개정 제안서' };

/* ---------------------------------------------------------------------------
   개정 제안서 (0123 · 사용자 요청 2026-11-07)

   품질에 넘기는 종이. 아직 닫히지 않은 제안(작성 · 품질에 넘김)을 대상 문서별로
   모은다. 받는 쪽이 한 장씩 검토하고 반영 여부를 적을 칸을 둔다.
--------------------------------------------------------------------------- */

interface ReqRow {
  req_no: string; op_code: string | null; target: 'WS' | 'BR' | 'BOTH'; doc_nos: string;
  kind: ReqKind; current_text: string; proposed_text: string; reason: string;
  status: ReqStatus; requested_at: string; requested_by_name: string;
}

export default async function RevisionRequestsPrint({ params }: { params: Promise<{ product: string }> }) {
  const user = await requireUser();
  if (blocksScreen(user, '/settings/docs')) return <Denied what="이 인쇄물" need="생산관리자 또는 시스템관리자" />;
  const { product } = await params;

  const d = await withActor(user.id, async (db) => ({
    reqs: await db.rows<ReqRow>(
      `select r.req_no, r.op_code, r.target, r.doc_nos, r.kind, r.current_text, r.proposed_text,
              r.reason, r.status,
              to_char(timezone('Asia/Seoul', r.requested_at), 'YYYY-MM-DD') as requested_at,
              u.full_name as requested_by_name
         from mfg_revision_request r join app_user u on u.id = r.requested_by
        where r.product_code = $1 and r.status in ('OPEN','SENT')
        order by r.doc_nos, r.req_no`, [product]),
    now: await db.val<string>(`select to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD HH24:MI')`),
  }));

  return (
    <>
      <PrintBar back="/settings/docs" title={`${product} 개정 제안서 · ${d.reqs.length}건`} />
      <div className="sheet text-[12px] leading-relaxed text-black">
        <header className="mb-3 border-b-2 border-black pb-2">
          <h1 className="text-[18px] font-bold">{product} 작업표준서 · 제조기록서 개정 제안서</h1>
          <p className="mt-1 text-[11px]">
            출력 {d.now} · {user.full_name} · 열린 제안 {d.reqs.length}건 · 받는 곳 품질 (QMS 문서관리)
          </p>
        </header>

        {d.reqs.length === 0 ? (
          <p className="py-10 text-center">열린 개정 제안이 없습니다.</p>
        ) : (
          d.reqs.map((r) => (
            <table key={r.req_no} className="print-table mb-3">
              <tbody>
                <tr>
                  <th className="w-[16%]">제안 번호</th>
                  <td className="w-[34%] font-mono nb">{r.req_no}</td>
                  <th className="w-[16%]">제안</th>
                  <td className="w-[34%]">{r.requested_at} · {r.requested_by_name}</td>
                </tr>
                <tr>
                  <th>대상 문서</th>
                  <td>{REQ_TARGET_LABEL[r.target]} · <span className="font-mono">{r.doc_nos}</span></td>
                  <th>종류</th>
                  <td>{REQ_KIND_LABEL[r.kind]} · {REQ_STATUS_LABEL[r.status]}</td>
                </tr>
                {r.current_text && (
                  <tr><th>지금 적힌 것</th><td colSpan={3} className="whitespace-pre-line">{r.current_text}</td></tr>
                )}
                <tr><th>이렇게 바꾸자</th><td colSpan={3} className="whitespace-pre-line"><b>{r.proposed_text}</b></td></tr>
                <tr><th>까닭</th><td colSpan={3} className="whitespace-pre-line">{r.reason}</td></tr>
                <tr>
                  <th>검토 결과</th>
                  <td colSpan={3} className="h-[18mm] align-top">□ 반영 (개정 번호:               )   □ 반영 안 함 (까닭:                                   )</td>
                </tr>
                <tr>
                  <th>검토자 · 일자</th>
                  <td colSpan={3} className="h-[10mm]"></td>
                </tr>
              </tbody>
            </table>
          ))
        )}
      </div>
    </>
  );
}
