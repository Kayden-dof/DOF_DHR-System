/* ---------------------------------------------------------------------------
   F705-01(Rev.02) 작업요청 및 지시서 - 작업 지시서 인쇄의 첫 장 (사용자 2026-11-11)

   "그리고 작업 지시서 양식도 스캔본에 있었을거 같은데??"

   회사 양식 한 장을 그대로 그린다 (원본: DX2401_작업요청_및_지시서_품질파트_261102.pdf).
   요청자가 1 · 2 를 쓰고 서명하면 생산팀이 작업지시번호를 붙이고 3 을 쓴다.
   시스템이 아는 값(지시번호 · 옮겨 적은 요청 내용 · 배치 사실)은 파란 글씨로
   채우고, 서명 · 수신확인은 비워 둔다 - 사람이 종이에 한다 (§1).

   요청 내용(work_request · 0136)을 옮겨 적지 않았으면 그 칸을 지어내지 않는다.
   비워 두고 그 사실을 적는다.

   양식 번호 · 개정 · 시행일은 원본 꼬리 그대로다. 양식이 개정되면 여기를 고친다.
--------------------------------------------------------------------------- */
const FORM_NO = 'F705-01(Rev.02)';
const FORM_DATE = '26.09.01';
const BLUE = { color: '#1d4ed8' };

export interface WorkRequest {
  request_dept: string | null;
  requester: string | null;
  purpose: 'SALES' | 'PLAN' | 'RND' | 'OTHER' | null;
  purpose_note: string | null;
  urgent: boolean;
  lines: { product?: string; model?: string; qty?: string; due?: string; note?: string }[];
  notes: string | null;
  complete_by: string | null;
  instruction: string | null;
}

export interface F705Facts {
  woNo: string;
  batchNo: string;
  product: string;
  revision: string;
  rawLot: string;
  supplier: string;
  coa: string;
  load: string;
  containers: string;
  planned: number;
  issued: string;
  issuers: string;
}

const PURPOSES: { code: WorkRequest['purpose']; label: string }[] = [
  { code: 'SALES', label: '영업/주문' },
  { code: 'PLAN', label: '재고/생산 계획' },
  { code: 'RND', label: '연구/개발' },
  { code: 'OTHER', label: '기타' },
];

/* 고른 칸은 ■ 와 그 말을 파랗게. 고르지 않은 칸은 양식 그대로 □ */
function Pick({ on, children }: { on: boolean; children: React.ReactNode }) {
  return on
    ? <span style={BLUE}>■ {children}</span>
    : <span>□ {children}</span>;
}

const sys = (v: string | null | undefined) =>
  v ? <span style={BLUE}>{v}</span> : null;

export default function F705({ facts, req, logoUrl, companyName }: {
  facts: F705Facts;
  req: WorkRequest | null;
  logoUrl: string | null;
  companyName: string;
}) {
  const rows = Array.from({ length: 5 }, (_, i) => req?.lines?.[i] ?? null);
  const cell = 'border border-black px-2 py-1.5 align-middle';
  const head = `${cell} bg-[#f0f0f0] text-center font-bold`;
  const bar = `${cell} bg-[#f7f7f7] text-left font-bold`;

  return (
    <div className="text-[12px] leading-snug text-black">
      {/* 머리: 로고 · 제목 · 결재란 */}
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          {logoUrl
            ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={companyName} className="h-7 w-auto" style={{ objectFit: 'contain' }} />
            )
            : <span className="text-base font-bold">{companyName}</span>}
          <div className="mt-4 text-center">
            <div className="text-[22px] font-bold tracking-[0.12em]">작업요청 및 지시서</div>
            <div className="text-[13px] font-bold">(Work Request and Order)</div>
          </div>
        </div>
        <table className="shrink-0 border-collapse text-center text-[11px]">
          <tbody>
            <tr>
              {['작 성', '검 토', '승 인'].map((t) => (
                <td key={t} className="w-[24mm] border border-black px-1 pt-1 font-bold">{t}</td>
              ))}
            </tr>
            <tr>
              {['(요청자)', '(요청부서장)', '(생산팀장)'].map((t) => (
                <td key={t} className="border border-black px-1 pb-1 text-[10px]">{t}</td>
              ))}
            </tr>
            <tr>
              {[0, 1, 2].map((k) => <td key={k} className="h-[16mm] border border-black" />)}
            </tr>
            <tr>
              {[0, 1, 2].map((k) => <td key={k} className="h-[6mm] border border-black" />)}
            </tr>
          </tbody>
        </table>
      </div>

      <table className="mt-5 w-full border-collapse border-2 border-black">
        <colgroup>
          <col className="w-[8%]" /><col className="w-[17%]" /><col className="w-[18%]" />
          <col className="w-[12%]" /><col className="w-[14%]" /><col className="w-[31%]" />
        </colgroup>
        <tbody>
          <tr>
            <td colSpan={2} className={`${head} text-left`}>작업지시번호<span className="font-normal">(생산팀 기입)</span></td>
            <td colSpan={4} className={`${cell} font-mono font-bold`} style={BLUE}>{facts.woNo}</td>
          </tr>

          <tr>
            <td colSpan={6} className={bar}>
              1 생산 요청정보<span className="font-normal">(요청자 작성)</span>
              {!req && (
                <span className="ml-2 text-[10px] font-normal" style={BLUE}>
                  요청 내용이 시스템에 옮겨 적혀 있지 않습니다. 요청자 원본을 함께 철하십시오.
                </span>
              )}
            </td>
          </tr>
          <tr>
            <td colSpan={2} className={head}>요청부서</td>
            <td colSpan={1} className={`${cell} text-center`}>{sys(req?.request_dept)}</td>
            <td colSpan={1} className={head}>담당자</td>
            <td colSpan={2} className={`${cell} text-center`}>{sys(req?.requester)}</td>
          </tr>
          <tr>
            <td colSpan={2} className={head}>작업목적</td>
            <td colSpan={4} className={cell}>
              <span className="flex flex-wrap gap-x-3">
                {PURPOSES.map((p) => (
                  <Pick key={p.code} on={req?.purpose === p.code}>
                    {p.label}
                    {p.code === 'OTHER' && <>( {req?.purpose === 'OTHER' ? req.purpose_note ?? '' : '      '} )</>}
                  </Pick>
                ))}
              </span>
            </td>
          </tr>
          <tr>
            <td colSpan={2} className={head}>작업구분</td>
            <td colSpan={4} className={cell}>
              <span className="flex gap-x-3">
                <Pick on={!!req && !req.urgent}>일반 생산</Pick>
                <Pick on={!!req && req.urgent}>긴급 생산</Pick>
              </span>
            </td>
          </tr>
          <tr>
            <td className={head}>No.</td>
            <td className={head}>제품명</td>
            <td className={head}>모델명</td>
            <td className={head}>요청수량</td>
            <td className={head}>요청기한</td>
            <td className={head}>비고</td>
          </tr>
          {rows.map((r, i) => (
            <tr key={i} className="h-[9mm]">
              <td className={`${cell} text-center font-bold`}>{i + 1}</td>
              <td className={`${cell} text-center`}>{sys(r?.product)}</td>
              <td className={`${cell} text-center font-mono`}>{sys(r?.model)}</td>
              <td className={`${cell} text-center`}>{sys(r?.qty)}</td>
              <td className={`${cell} text-center`}>{sys(r?.due)}</td>
              <td className={`${cell} text-center`}>{sys(r?.note)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={6} className={`${cell} text-[11px]`}>
              * 요청정보가 본 양식의 기재 범위를 초과하는 경우 별첨하여 제출한다.<br />
              * 메일로 스캔본을 전달 시 생산팀장 승인 본을 원본으로 간주하여 관리한다.
            </td>
          </tr>

          <tr><td colSpan={6} className={bar}>2 특이사항 및 요구사항</td></tr>
          <tr>
            <td colSpan={6} className={`${cell} h-[30mm] whitespace-pre-line align-top`}>{sys(req?.notes)}</td>
          </tr>

          <tr><td colSpan={6} className={bar}>3 생산팀 검토 &amp; 지시사항</td></tr>
          <tr>
            <td colSpan={6} className={`${cell} h-[38mm] align-top`}>
              <div>완료예정일: {sys(req?.complete_by)}</div>
              {req?.instruction && <div className="mt-1 whitespace-pre-line" style={BLUE}>{req.instruction}</div>}
              {/*
                * 지시의 사실 - 시스템이 발행한 값 그대로. 공정 순서와 자재 소요량은
                * 다음 장에 이어진다.
                */}
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]" style={BLUE}>
                <div>배치번호 <b className="font-mono">{facts.batchNo}</b></div>
                <div>제품 {facts.product} · 표준서 {facts.revision}</div>
                <div>원재료 로트 <b className="font-mono">{facts.rawLot}</b></div>
                <div>{facts.supplier} · 성적서 {facts.coa}</div>
                <div>장입 수량 <b>{facts.load}</b></div>
                <div>필요 용기 {facts.containers}</div>
                {facts.planned > 0 && <div>예정 생산 {facts.planned}개 (형명은 재단에서 정해짐)</div>}
                <div>발행 {facts.issued} · {facts.issuers}</div>
              </div>
              <div className="mt-1 text-[10px]">공정 순서 및 자재 소요량은 다음 장에 이어집니다.</div>
            </td>
          </tr>

          <tr>
            <td colSpan={6} className={bar}>
              4 생산팀 작업지시 수신확인<span className="text-[10px] font-normal">(서명 후 원본 파일링, 사본 제조기록서에 첨부)</span>
            </td>
          </tr>
          <tr className="h-[11mm]">
            <td className={head}>성명</td>
            <td className={cell} />
            <td className={head}>서명</td>
            <td colSpan={1} className={cell} />
            <td className={head}>일자</td>
            <td className={cell} />
          </tr>
        </tbody>
      </table>

      <div className="mt-3 flex justify-between text-[11px]">
        <span>{FORM_NO}</span>
        <span>{companyName}</span>
        <span>{FORM_DATE}</span>
      </div>
    </div>
  );
}
