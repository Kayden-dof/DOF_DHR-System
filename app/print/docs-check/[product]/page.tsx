import { notFound } from 'next/navigation';
import { requireUser, blocksScreen } from '@/lib/session';
import Denied from '@/components/denied';
import { withActor } from '@/lib/db';
import { VERDICT_LABEL, VERDICT_ORDER, isOff, flowBreaks, type CheckRow, type Verdict } from '@/lib/mfg-doc';
import PrintBar from '../print-bar';

export const dynamic = 'force-dynamic';
export const metadata = { title: '작업표준서 · 제조기록서 대조표' };

/* ---------------------------------------------------------------------------
   대조표 인쇄 (0123 · 사용자 요청 2026-11-07)

   "정합성이 어긋나는 것은 빨간색으로 표기해서 프린트 아웃."

   공정마다 표 하나. 어긋난 줄은 글자와 바탕을 빨갛게 찍는다 - 흑백으로 뽑아도
   판정 칸의 글자(불일치 · 기재 누락 …)와 굵기로 갈린다. 색만으로 말하지 않는다.

   제조기록서 차례 칸은 그 항목이 기록서에서 몇 번째에 놓였는지다. 작업표준서
   차례로 늘어놓았을 때 이 수가 거꾸로 가는 줄에 "순서" 를 붙인다 (lib/mfg-doc.ts
   의 flowBreaks).
--------------------------------------------------------------------------- */

interface DocRow {
  op_code: string | null; kind: 'WS' | 'BR'; doc_no: string; title: string;
  revision: string; issued_on: string | null; pages: number | null;
}

export default async function DocsCheckPrint({ params }: { params: Promise<{ product: string }> }) {
  const user = await requireUser();
  if (blocksScreen(user, '/settings/docs')) return <Denied what="이 인쇄물" need="생산관리자 또는 시스템관리자" />;
  const { product } = await params;

  const d = await withActor(user.id, async (db) => ({
    docs: await db.rows<DocRow>(
      `select op_code, kind, doc_no, title, revision, issued_on::text, pages
         from mfg_doc where product_code = $1 and is_current
        order by op_code nulls first, kind desc, doc_no`, [product]),
    checks: await db.rows<CheckRow>(
      `select id, op_code, op_name, seq, grp, item, ws_text, ws_at, br_text, br_at,
              verdict, why, basis, ws_order, br_order
         from mfg_check where product_code = $1 and is_current
        order by op_code, seq`, [product]),
    now: await db.val<string>(`select to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD HH24:MI')`),
  }));
  if (d.checks.length === 0) notFound();

  const ops = [...new Map(d.checks.map((c) => [c.op_code, c.op_name])).entries()];
  const body = d.checks.filter((c) => c.grp !== '흐름');
  const breaks = new Set<string>();
  for (const [op] of ops) for (const id of flowBreaks(body.filter((c) => c.op_code === op))) breaks.add(id);
  const tally = VERDICT_ORDER.filter((v) => v !== 'FLOW')
    .map((v) => [v, body.filter((c) => c.verdict === v).length] as const);

  return (
    <>
      <PrintBar back="/settings/docs" title={`${product} 대조표 · 어긋난 줄은 빨간색`} />
      <div className="sheet text-[12px] leading-relaxed text-black">
        <header className="mb-3 border-b-2 border-black pb-2">
          <h1 className="text-[18px] font-bold">{product} 작업표준서 · 제조기록서 대조표</h1>
          <p className="mt-1 text-[11px]">
            출력 {d.now} · {user.full_name} · 대조 {body.length}줄 ·{' '}
            {tally.map(([v, n]) => `${VERDICT_LABEL[v as Verdict]} ${n}`).join(' · ')} · 순서가 바뀐 줄 {breaks.size}
          </p>
          <p className="mt-1 text-[11px]">
            <span className="print-red px-1 font-bold">빨간 줄</span> 두 문서가 어긋나는 항목 ·
            불일치(값이 다름) · 기재 누락(작업표준서가 요구하나 기록 칸이 없음) · 기준 미정(수치 없이 문구뿐) ·
            기록서에만(작업표준서에 지시가 없음) · 순서(작업 순서와 기록서 차례가 거꾸로)
          </p>
        </header>

        <table className="print-table mb-4">
          <thead>
            <tr><th>공정</th><th>작업표준서</th><th>제조기록서</th></tr>
          </thead>
          <tbody>
            {ops.map(([op, name]) => {
              const ws = d.docs.filter((x) => x.op_code === op && x.kind === 'WS');
              const br = d.docs.filter((x) => x.op_code === op && x.kind === 'BR');
              const show = (xs: DocRow[]) => xs.map((x) =>
                `${x.doc_no} ${x.revision}${x.issued_on ? ` · ${x.issued_on}` : ''}${x.pages ? ` · ${x.pages}쪽` : ''}`).join('\n');
              return (
                <tr key={op}>
                  <td className="nb"><span className="font-mono">{op}</span> {name}</td>
                  <td className="whitespace-pre-line">{show(ws) || '-'}</td>
                  <td className="whitespace-pre-line">{show(br) || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {ops.map(([op, name]) => {
          const rows = body.filter((c) => c.op_code === op);
          const flow = d.checks.filter((c) => c.op_code === op && c.grp === '흐름');
          const off = rows.filter((r) => isOff(r.verdict) || breaks.has(r.id)).length;
          return (
            <section key={op} className="mb-5 break-inside-auto">
              <h2 className="mb-1 text-[14px] font-bold">
                <span className="font-mono">{op}</span> {name}
                {/* 어긋난 줄이 없으면 아무것도 적지 않는다. '어긋남 0' 은 잘못된 안심이다 (§8.5) */}
                {off > 0 && (
                  <span className="print-red-text ml-2 text-[11px] font-bold">어긋남 {off}줄 / {rows.length}줄</span>
                )}
              </h2>
              <table className="print-table">
                <thead>
                  <tr>
                    <th className="w-[7%] text-center">차례</th>
                    <th className="w-[15%]">항목</th>
                    <th className="w-[30%]">작업표준서</th>
                    <th className="w-[30%]">제조기록서</th>
                    <th className="w-[18%]">판정</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const jumped = breaks.has(r.id);
                    const red = isOff(r.verdict) || jumped;
                    return (
                      <tr key={r.id} className={red ? 'print-red' : undefined}>
                        <td className="text-center">
                          {r.seq}
                          {r.br_order != null && (
                            <div className="text-[10px]">기록 {r.br_order}{jumped ? ' 순서' : ''}</div>
                          )}
                        </td>
                        <td>
                          <b>{r.item}</b>
                          {r.grp && <div className="text-[10px]">{r.grp}</div>}
                        </td>
                        <td className="whitespace-pre-line">
                          {r.ws_text || '없음'}
                          {r.ws_at && <div className="text-[10px] opacity-80">{r.ws_at}</div>}
                        </td>
                        <td className="whitespace-pre-line">
                          {r.br_text || '없음'}
                          {r.br_at && <div className="text-[10px] opacity-80">{r.br_at}</div>}
                        </td>
                        <td>
                          <b>{VERDICT_LABEL[r.verdict]}{jumped && r.verdict === 'MATCH' ? ' · 순서' : ''}</b>
                          {r.why && <div className="text-[10px]">{r.why}</div>}
                          {r.basis && <div className="text-[10px] opacity-80">{r.basis}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {flow.length > 0 && (
                <div className="print-red mt-1 border border-black px-2 py-1 text-[11px]">
                  <b>작업 흐름과 기록서 배치</b>
                  <ul className="mt-0.5 list-disc pl-4">
                    {flow.map((f) => <li key={f.id}>{f.item}{f.why ? ` - ${f.why}` : ''}</li>)}
                  </ul>
                </div>
              )}
            </section>
          );
        })}

        <p className="mt-4 border-t border-black pt-2 text-[10px]">
          이 표는 서면 작업표준서와 제조기록서를 사람이 항목마다 맞대어 본 결과입니다. 판정은 문서의 기재를
          견준 것이며 공정 조건의 적합 여부를 판단하지 않습니다. 개정은 QMS 문서관리 절차를 따릅니다.
        </p>
      </div>
    </>
  );
}
