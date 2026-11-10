import Link from 'next/link';
import { requireUser, canWrite, blocksScreen, hasRole } from '@/lib/session';
import Denied from '@/components/denied';
import { withActor } from '@/lib/db';
import { PageShell, StatStrip, type StatItem } from '@/components/shell';
import { SubNav } from '../../nav';
import { settingsNav } from '../../sections';
import { Panel, Empty, Tag } from '@/components/ui';
import { Table, Th, Td } from '@/components/table';
import { fmtDate } from '@/lib/fmt';
import {
  VERDICT_LABEL, isOff, isNumberDiff, flowBreaks, kindFor, REQ_KIND_LABEL, REQ_STATUS_LABEL, REQ_TARGET_LABEL,
  type CheckRow, type Verdict, type ReqKind, type ReqStatus,
} from '@/lib/mfg-doc';
import { RevisionButton, StatusForm } from './revision-forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: '문서 대조' };

/* ---------------------------------------------------------------------------
   작업표준서 · 제조기록서 대조 (0123 · 사용자 요청 2026-11-07)

   서면 두 문서를 항목마다 맞대어 본 결과를 공정 순서로 보인다. 어긋난 줄은
   빨간색이고, 그 자리에서 개정 제안을 낼 수 있다. 인쇄물은 /print 아래 둘이다
   (대조표 · 개정 제안서).
--------------------------------------------------------------------------- */

interface DocRow {
  op_code: string | null; kind: 'WS' | 'BR'; doc_no: string; title: string;
  revision: string; issued_on: string | null; pages: number | null; note: string | null;
}
interface ReqRow {
  id: string; req_no: string; op_code: string | null; target: 'WS' | 'BR' | 'BOTH';
  doc_nos: string; kind: ReqKind; current_text: string; proposed_text: string; reason: string;
  status: ReqStatus; status_note: string; requested_at: string; requested_by_name: string;
}

type Search = Promise<{ p?: string }>;

const TONE: Record<Verdict, string> = {
  MATCH: 'quiet', MISMATCH: 'danger', MISSING: 'danger', UNDEFINED: 'danger',
  BR_ONLY: 'danger', FLOW: 'danger',
};

export default async function DocsCheckPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  if (blocksScreen(user, '/settings/docs')) {
    return <Denied what="이 화면" need="생산관리자 또는 시스템관리자" />;
  }
  const writable = canWrite(user) && hasRole(user, 'SYS_ADMIN', 'PROD_MGR');
  const sp = await searchParams;

  const d = await withActor(user.id, async (db) => {
    const products = (await db.rows<{ product_code: string }>(
      `select distinct product_code from mfg_check where is_current
       union select distinct product_code from mfg_doc where is_current
       order by 1`)).map((r) => r.product_code);
    const product = sp.p && products.includes(sp.p) ? sp.p : products[0] ?? null;
    if (!product) return { products, product, docs: [], checks: [], reqs: [] };
    return {
      products, product,
      docs: await db.rows<DocRow>(
        `select op_code, kind, doc_no, title, revision, issued_on::text, pages, note
           from mfg_doc where product_code = $1 and is_current
          order by op_code nulls first, kind desc, doc_no`, [product]),
      checks: await db.rows<CheckRow>(
        `select id, op_code, op_name, seq, grp, item, ws_text, ws_at, br_text, br_at,
                verdict, why, basis, ws_order, br_order
           from mfg_check where product_code = $1 and is_current
          order by op_code, seq`, [product]),
      reqs: await db.rows<ReqRow>(
        `select r.id, r.req_no, r.op_code, r.target, r.doc_nos, r.kind, r.current_text,
                r.proposed_text, r.reason, r.status, r.status_note,
                to_char(timezone('Asia/Seoul', r.requested_at), 'YYYY-MM-DD') as requested_at,
                u.full_name as requested_by_name
           from mfg_revision_request r join app_user u on u.id = r.requested_by
          where r.product_code = $1
          order by r.requested_at desc`, [product]),
    };
  });

  const ops = [...new Map(d.checks.map((c) => [c.op_code, c.op_name])).entries()];
  const count = (v: Verdict) => d.checks.filter((c) => c.verdict === v).length;
  const breaks = new Set<string>();
  for (const [op] of ops) {
    for (const id of flowBreaks(d.checks.filter((c) => c.op_code === op && c.grp !== '흐름'))) breaks.add(id);
  }
  const openReqs = d.reqs.filter((r) => r.status === 'OPEN' || r.status === 'SENT').length;
  const numDiff = d.checks.filter(isNumberDiff);
  const docNosOf = (op: string) => d.docs.filter((x) => x.op_code === op).map((x) => x.doc_no).join(', ');

  const stats: StatItem[] = d.product ? [
    { label: '대조 항목', value: d.checks.filter((c) => c.grp !== '흐름').length, unit: '줄' },
    { label: '불일치', value: count('MISMATCH'), unit: '줄', tone: 'danger' },
    { label: '그중 수치가 다른 줄', value: numDiff.length, unit: '줄', tone: 'danger' },
    { label: '기재 누락', value: count('MISSING'), unit: '줄', tone: 'danger' },
    { label: '기준 미정', value: count('UNDEFINED'), unit: '줄', tone: 'danger' },
    { label: '기록서에만', value: count('BR_ONLY'), unit: '줄', tone: 'danger' },
    { label: '순서가 바뀐 줄', value: breaks.size, unit: '줄', tone: 'danger' },
    { label: '열린 개정 제안', value: openReqs, unit: '건', tone: 'brand' },
  ] : [];

  return (
    <PageShell
      section="설정"
      title="작업표준서 · 제조기록서 대조"
      lede="서면 작업표준서와 제조기록서를 항목마다 맞대어 본 결과입니다. 어긋난 줄은 빨간색으로 찍고, 그 자리에서 개정을 제안할 수 있습니다."
      action={d.product ? (
        <>
          <Link href={`/print/docs-check/${d.product}`} className="btn-ghost">대조표 인쇄</Link>
          {numDiff.length > 0 && (
            <Link href={`/print/docs-check/${d.product}?v=num`} className="btn-ghost">수치 다른 줄 인쇄</Link>
          )}
          <Link href={`/print/revision-requests/${d.product}`} className="btn-primary">개정 제안서 인쇄</Link>
        </>
      ) : null}
      nav={<SubNav items={settingsNav(user.roles, user.screens)} />}
      stats={d.product ? <StatStrip items={stats} /> : undefined}
    >
      {d.products.length > 1 && (
        <nav className="flex flex-wrap gap-2">
          {d.products.map((p) => (
            <Link key={p} href={`/settings/docs?p=${p}`}
                  className={p === d.product ? 'btn-primary' : 'btn-ghost'}>{p}</Link>
          ))}
        </nav>
      )}

      {!d.product ? (
        <Panel>
          <Empty hint="작업표준서와 제조기록서를 대조한 자료를 넣으면 공정마다 여기에 나옵니다.">
            등록된 문서가 없습니다.
          </Empty>
        </Panel>
      ) : (
        <>
          {numDiff.length > 0 && (
            <Panel
              title="수치가 다른 항목"
              note={`불일치 가운데 두 문서가 서로 다른 숫자를 적은 줄 ${numDiff.length}줄입니다. 공정 순서대로 모았습니다.`}
            >
              <Table grow={4}>
                <thead>
                  <tr>
                    <Th>공정</Th>
                    <Th>항목</Th>
                    <Th>작업표준서</Th>
                    <Th>제조기록서</Th>
                    <Th>무엇이 다른가</Th>
                    {writable && <Th />}
                  </tr>
                </thead>
                <tbody>
                  {numDiff.map((r) => (
                    <tr key={r.id}>
                      <Td className="whitespace-nowrap">
                        <div className="font-mono text-xs text-faint">{r.op_code}</div>
                        <div>{r.op_name}</div>
                      </Td>
                      <Td className="font-semibold text-ink">{r.item}</Td>
                      <Td className="min-w-[12rem] whitespace-pre-line">
                        {r.ws_text}
                        {r.ws_at && <div className="mt-0.5 text-xs text-faint">{r.ws_at}</div>}
                      </Td>
                      <Td className="min-w-[12rem] whitespace-pre-line">
                        {r.br_text}
                        {r.br_at && <div className="mt-0.5 text-xs text-faint">{r.br_at}</div>}
                      </Td>
                      <Td className="min-w-[14rem] text-danger">{r.why}</Td>
                      {writable && (
                        <Td>
                          <RevisionButton compact product={d.product!} opCode={r.op_code} checkId={r.id}
                                          docNos={docNosOf(r.op_code)} kind={kindFor(r.verdict)}
                                          current={`[작업표준서] ${r.ws_text}\n[제조기록서] ${r.br_text}`} />
                        </Td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Panel>
          )}

          {ops.map(([op, opName]) => {
            const rows = d.checks.filter((c) => c.op_code === op && c.grp !== '흐름');
            const flow = d.checks.filter((c) => c.op_code === op && c.grp === '흐름');
            const docs = d.docs.filter((x) => x.op_code === op);
            const docNos = docs.map((x) => x.doc_no).join(', ');
            // 인쇄 대조표와 같은 셈: 판정이 어긋났거나 순서가 바뀐 줄
            const off = rows.filter((r) => isOff(r.verdict) || breaks.has(r.id)).length;
            return (
              <Panel
                key={op}
                title={`${op} ${opName}`}
                note={
                  <>
                    {docs.map((x) => `${x.doc_no} ${x.revision}${x.issued_on ? ` (${fmtDate(x.issued_on)})` : ''}`).join(' · ')}
                    {/* 어긋난 줄이 없으면 아무것도 적지 않는다. '어긋남 0' 은 잘못된 안심이다 (§8.5) */}
                    {off > 0 && (
                      <>{' · '}<span className="font-semibold text-danger">어긋남 {off}줄 / {rows.length}줄</span></>
                    )}
                  </>
                }
                action={writable ? (
                  <RevisionButton product={d.product!} opCode={op} docNos={docNos} kind="FLOW"
                                  label="공정 개정 제안" />
                ) : null}
              >
                <Table grow={2}>
                  <thead>
                    <tr>
                      <Th w="3rem">차례</Th>
                      <Th>항목</Th>
                      <Th>작업표준서</Th>
                      <Th>제조기록서</Th>
                      <Th>판정</Th>
                      {writable && <Th />}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const bad = isOff(r.verdict);
                      const jumped = breaks.has(r.id);
                      return (
                        <tr key={r.id} className={bad || jumped ? 'bg-danger-bg/50' : undefined}>
                          <Td className="tnum text-muted">
                            {r.seq}
                            {r.br_order != null && (
                              <div className={`text-xs ${jumped ? 'font-semibold text-danger' : 'text-faint'}`}
                                   title="제조기록서에서 이 항목이 놓인 차례">
                                기록 {r.br_order}{jumped ? ' 순서' : ''}
                              </div>
                            )}
                          </Td>
                          <Td className={bad ? 'text-danger' : 'text-ink'}>
                            <div className="font-semibold">{r.item}</div>
                            {r.grp && <div className="text-xs text-faint">{r.grp}</div>}
                          </Td>
                          <Td className={`min-w-[14rem] whitespace-pre-line ${bad ? 'text-danger' : ''}`}>
                            {r.ws_text || <span className="text-faint">없음</span>}
                            {r.ws_at && <div className="mt-0.5 text-xs text-faint">{r.ws_at}</div>}
                          </Td>
                          <Td className={`min-w-[14rem] whitespace-pre-line ${bad ? 'text-danger' : ''}`}>
                            {r.br_text || <span className="text-faint">없음</span>}
                            {r.br_at && <div className="mt-0.5 text-xs text-faint">{r.br_at}</div>}
                          </Td>
                          <Td className="min-w-[10rem]">
                            <Tag tone={TONE[r.verdict]}>{VERDICT_LABEL[r.verdict]}</Tag>
                            {r.why && <div className="mt-1 text-sm leading-relaxed text-danger">{r.why}</div>}
                            {r.basis && <div className="mt-0.5 text-xs text-faint">{r.basis}</div>}
                          </Td>
                          {writable && (
                            <Td>
                              {(bad || jumped) && (
                                <RevisionButton compact product={d.product!} opCode={op} checkId={r.id}
                                                docNos={docNos} kind={jumped && !bad ? 'FLOW' : kindFor(r.verdict)}
                                                current={`[작업표준서] ${r.ws_text || '없음'}\n[제조기록서] ${r.br_text || '없음'}`} />
                              )}
                            </Td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
                {flow.length > 0 && (
                  <div className="border-t border-line px-3 py-3">
                    <p className="text-xs font-semibold text-danger">작업 흐름과 기록서 배치</p>
                    <ul className="mt-1.5 space-y-1">
                      {flow.map((f) => (
                        <li key={f.id} className="text-sm leading-relaxed text-danger">
                          {f.item}{f.why ? ` - ${f.why}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Panel>
            );
          })}

          <Panel title="개정 제안" note="품질의 문서관리 절차에 넘길 제안입니다. 넘긴 뒤 반영 결과를 상태로 적습니다.">
            {d.reqs.length === 0 ? (
              <Empty hint="대조표의 빨간 줄이나 공정 머리의 단추로 제안을 적습니다.">
                적힌 개정 제안이 없습니다.
              </Empty>
            ) : (
              <Table grow={4}>
                <thead>
                  <tr>
                    <Th>번호</Th><Th>대상</Th><Th>종류</Th><Th>제안</Th><Th>상태</Th>
                    {writable && <Th />}
                  </tr>
                </thead>
                <tbody>
                  {d.reqs.map((r) => (
                    <tr key={r.id}>
                      <Td>
                        <div className="font-mono text-sm font-semibold text-ink">{r.req_no}</div>
                        <div className="text-xs text-faint">{r.requested_at} · {r.requested_by_name}</div>
                      </Td>
                      <Td>
                        <div>{REQ_TARGET_LABEL[r.target]}</div>
                        <div className="text-xs text-faint">{r.doc_nos}</div>
                      </Td>
                      <Td>{REQ_KIND_LABEL[r.kind]}</Td>
                      <Td className="min-w-[18rem] whitespace-pre-line">
                        <div className="text-ink">{r.proposed_text}</div>
                        <div className="mt-0.5 text-xs text-muted">까닭: {r.reason}</div>
                      </Td>
                      <Td>
                        <Tag tone={r.status === 'DONE' ? 'ok' : r.status === 'DROPPED' ? 'quiet' : r.status === 'SENT' ? 'info' : 'brand'}>
                          {REQ_STATUS_LABEL[r.status]}
                        </Tag>
                        {r.status_note && <div className="mt-1 text-xs text-muted">{r.status_note}</div>}
                      </Td>
                      {writable && <Td><StatusForm id={r.id} status={r.status} /></Td>}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </>
      )}
    </PageShell>
  );
}
