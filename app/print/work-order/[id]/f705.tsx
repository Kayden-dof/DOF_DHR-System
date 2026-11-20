/* ---------------------------------------------------------------------------
   F705-01(Rev.02) 작업요청 및 지시서 - 작업 지시서 인쇄의 첫 장 (사용자 2026-11-11)

   "그리고 작업 지시서 양식도 스캔본에 있었을거 같은데??"
   "작엽 요청 지시서 디자인도 스캔본 디자인 확인해서 다시 똑같은 디자인으로
    작업해줘." (2026-11-20)

   회사 양식 한 장을 그 자리 그대로 그린다.
     원본 스캔 DX2401_작업요청_및_지시서_품질파트_261102.pdf
     원본 양식 F705-01(Rev.02)_작업요청_및_지시서.docx (생산 업무 인계 자료 261022)
   스캔에서 잰 선의 자리가 docx 의 표 격자와 같다. 그래서 칸 너비는 docx 격자
   (twip)의 비율을, 칸 높이 · 표의 자리는 스캔에서 잰 mm 를 쓴다. 종이 가장자리
   부터 재므로 이 장은 여백이 없다 (PaperSheet · sheet--paper).

   ── 양식과 같게 둔 것 ────────────────────────────────────────────────────
   · 글꼴 맑은 고딕, 글자 크기 docx 그대로 (제목 16pt · 영문 12pt · 칸 11pt ·
     괄호 말 10pt · 9pt). 시스템이 채운 값도 같은 글꼴 · 같은 크기다 - 고정폭을
     섞지 않는다 (F706 과 같은 원칙).
   · 이름표 칸 · 구분 띠 · No. 칸은 옅은 회색(F2F2F2), 바깥 테두리 1.5pt, 안쪽 0.5pt,
     작업지시번호 아래 · 안내 두 줄 아래 · 2 · 3 본문 위아래는 겹줄.
   · 결재란: 칸 하나에 «작 성» 과 «(요청자)», 서명 칸, 날짜 칸. 겹줄로 가른다.
   · 꼬리: 양식 번호 · ㈜ 도프 · 시행일.

   ── 양식에 없던 것 ──────────────────────────────────────────────────────
   시스템이 아는 값(지시번호 · 옮겨 적은 요청 내용 · 배치 사실)은 파란 글씨로
   채우고, 서명 · 수신확인은 비워 둔다 - 사람이 종이에 한다 (§1). 배치의 사실은
   3 «생산팀 검토 & 지시사항» 칸 안에 작은 글씨로 넣는다 (그 칸 높이 안에 든다).

   요청 내용(work_request · 0136)을 옮겨 적지 않았으면 그 칸을 지어내지 않는다.
   비워 두고 그 사실을 1 띠 옆에 적는다.

   양식 번호 · 개정 · 시행일은 원본 꼬리 그대로다. 양식이 개정되면 여기를 고친다.
--------------------------------------------------------------------------- */
import type { CSSProperties, ReactNode } from 'react';

const FORM_NO = 'F705-01(Rev.02)';
const FORM_DATE = '26.09.01';
const FORM_ORG = '㈜ 도프';
const BLUE = '#1d4ed8';

/* 표의 자리 (mm, 종이 가장자리부터). 스캔에서 잰 값 */
const LEFT = 18.8;
const WIDTH = 177.7;
/** 종이 오른쪽 끝에서 표 오른쪽 끝까지 */
export const F705_EDGE = { left: LEFT, right: 210 - LEFT - WIDTH };

/* docx 표 격자 (twip). 칸마다 이 열을 몇 개씩 묶는다 */
const GRID = [586, 423, 1275, 111, 709, 329, 552, 536, 8, 1126, 413, 715, 37, 395, 2835];
const GRID_SUM = GRID.reduce((a, w) => a + w, 0);

const ROW = '10.3mm';
const LINE = '0.5pt solid #000';
const BOLD = '1.5pt solid #000';
const DOUBLE = '1.5pt double #000';
const GRAY = '#f2f2f2';

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

/** 시스템이 채운 값 */
const sys = (v: string | null | undefined) =>
  v ? <span style={{ color: BLUE }}>{v}</span> : null;

/* 고른 칸은 ■ 와 그 말을 파랗게. 고르지 않은 칸은 양식 그대로 □ */
function Pick({ on, children }: { on: boolean; children: ReactNode }) {
  return on
    ? <span style={{ color: BLUE }}>■ {children}</span>
    : <span>□ {children}</span>;
}

/** 표 칸 하나. 이름표 칸(label)은 회색 · 굵게 · 가운데 */
function C({ span = 1, label, center, top, bb, style, children }: {
  span?: number;
  label?: boolean;
  center?: boolean;
  /** 본문 칸처럼 위에서부터 적는다 */
  top?: boolean;
  /** 아래 겹줄 */
  bb?: boolean;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <td colSpan={span} style={{
      border: LINE,
      borderBottom: bb ? DOUBLE : LINE,
      padding: top ? '1mm 1.9mm' : '0 1.9mm',
      verticalAlign: top ? 'top' : 'middle',
      textAlign: label || center ? 'center' : 'left',
      background: label ? GRAY : undefined,
      fontWeight: label ? 700 : undefined,
      /* 이름표는 짧다. 좁은 No. 칸에서 «No» 와 «.» 이 갈라지지 않게 */
      whiteSpace: label ? 'nowrap' : undefined,
      wordBreak: 'keep-all',
      overflowWrap: 'anywhere',
      ...style,
    }}>
      {children}
    </td>
  );
}

/** 구분 띠 (1 생산 요청정보 …). 표 너비 전체 */
function Bar({ bb, children }: { bb?: boolean; children: ReactNode }) {
  return (
    <tr style={{ height: ROW }}>
      <C span={GRID.length} bb={bb} style={{ background: GRAY, fontWeight: 700 }}>{children}</C>
    </tr>
  );
}

const small = (pt: number): CSSProperties => ({ fontSize: `${pt}pt`, fontWeight: 400 });

export default function F705({ facts, req }: {
  facts: F705Facts;
  req: WorkRequest | null;
}) {
  const rows = Array.from({ length: 5 }, (_, i) => req?.lines?.[i] ?? null);
  const boxCell = (k: number, extra: CSSProperties = {}): CSSProperties => ({
    border: LINE,
    borderLeft: k === 0 ? BOLD : LINE,
    borderRight: k === 2 ? BOLD : LINE,
    textAlign: 'center',
    verticalAlign: 'middle',
    padding: 0,
    ...extra,
  });

  return (
    <div style={{
      position: 'relative', marginLeft: `${LEFT}mm`, width: `${WIDTH}mm`, paddingTop: '11.2mm',
      fontSize: '11pt', lineHeight: 1.25, color: '#000',
    }}>
      {/* 양식의 로고 - 원본 docx 의 그림 그대로 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/forms/f705-logo.png" alt="DOF"
           style={{ position: 'absolute', left: '-0.2mm', top: '9.9mm', width: '23.5mm', height: 'auto' }} />

      {/* 머리: 제목 · 결재란 (docx 첫 표) */}
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '62%' }} />
          <col style={{ width: '12.67%' }} /><col style={{ width: '12.67%' }} /><col style={{ width: '12.66%' }} />
        </colgroup>
        <tbody>
          <tr style={{ height: '12.7mm' }}>
            <td rowSpan={3} style={{ borderRight: BOLD, textAlign: 'center', verticalAlign: 'middle', padding: 0 }}>
              <div style={{ fontSize: '16pt', fontWeight: 700, lineHeight: 1.3 }}>작업요청 및 지시서</div>
              <div style={{ fontSize: '12pt', fontWeight: 700, lineHeight: 1.3, marginTop: '1.2mm' }}>(Work Request and Order)</div>
            </td>
            {[['작 성', '(요청자)'], ['검 토', '(요청부서장)'], ['승 인', '(생산팀장)']].map(([t, who], k) => (
              <td key={t} style={boxCell(k, { borderTop: BOLD, borderBottom: DOUBLE })}>
                <div style={{ fontWeight: 700 }}>{t}</div>
                <div style={small(9)}>{who}</div>
              </td>
            ))}
          </tr>
          <tr style={{ height: '15.9mm' }}>
            {[0, 1, 2].map((k) => <td key={k} style={boxCell(k, { borderBottom: DOUBLE })} />)}
          </tr>
          <tr style={{ height: '7.4mm' }}>
            {[0, 1, 2].map((k) => <td key={k} style={boxCell(k, { borderBottom: BOLD })} />)}
          </tr>
        </tbody>
      </table>

      {/* 본표 (docx 둘째 표). 칸을 묶는 수는 docx 의 gridSpan 그대로 */}
      <table style={{
        width: '100%', marginTop: '3.4mm', borderCollapse: 'collapse', tableLayout: 'fixed', border: BOLD,
      }}>
        <colgroup>
          {GRID.map((w, i) => <col key={i} style={{ width: `${(w / GRID_SUM) * 100}%` }} />)}
        </colgroup>
        <tbody>
          <tr style={{ height: ROW }}>
            <C span={6} label bb>작업지시번호<span style={small(10)}>(생산팀 기입)</span></C>
            <C span={9} bb style={{ color: BLUE }}>{facts.woNo}</C>
          </tr>

          <Bar>
            1 생산 요청정보<span style={small(10)}>(요청자 작성)</span>
            {!req && (
              <span style={{ ...small(8), color: BLUE, marginLeft: '2mm' }}>
                요청 내용이 시스템에 옮겨 적혀 있지 않습니다. 요청자 원본을 함께 철하십시오.
              </span>
            )}
          </Bar>
          <tr style={{ height: ROW }}>
            <C span={3} label>요청부서</C>
            <C span={6} center>{sys(req?.request_dept)}</C>
            <C span={3} label>담당자</C>
            <C span={3} center>{sys(req?.requester)}</C>
          </tr>
          <tr style={{ height: ROW }}>
            <C span={3} label>작업목적</C>
            <C span={12}>
              {PURPOSES.map((p) => (
                <span key={p.code}>
                  <Pick on={req?.purpose === p.code}>
                    {p.code === 'OTHER'
                      ? <>기타( {req?.purpose === 'OTHER' ? (req.purpose_note ?? '') : ' '.repeat(12)} )</>
                      : p.label}
                  </Pick>{' '}
                </span>
              ))}
            </C>
          </tr>
          <tr style={{ height: ROW }}>
            <C span={3} label>작업구분</C>
            <C span={12}>
              <Pick on={!!req && !req.urgent}>일반 생산</Pick>{' '}
              <Pick on={!!req && req.urgent}>긴급 생산</Pick>
            </C>
          </tr>
          <tr style={{ height: ROW }}>
            <C label>No.</C>
            <C span={3} label>제품명</C>
            <C span={4} label>모델명</C>
            <C span={2} label>요청수량</C>
            <C span={4} label>요청기한</C>
            <C label>비고</C>
          </tr>
          {rows.map((r, i) => (
            <tr key={i} style={{ height: ROW }}>
              <C label>{i + 1}</C>
              <C span={3} center>{sys(r?.product)}</C>
              <C span={4} center>{sys(r?.model)}</C>
              <C span={2} center>{sys(r?.qty)}</C>
              <C span={4} center>{sys(r?.due)}</C>
              <C center>{sys(r?.note)}</C>
            </tr>
          ))}
          <tr style={{ height: '13.6mm' }}>
            <C span={GRID.length} bb>
              * 요청정보가 본 양식의 기재 범위를 초과하는 경우 별첨하여 제출한다.<br />
              * 메일로 스캔본을 전달 시 생산팀장 승인 본을 원본으로 간주하여 관리한다.
            </C>
          </tr>

          <Bar bb>2 특이사항 및 요구사항</Bar>
          <tr style={{ height: '30.4mm' }}>
            <C span={GRID.length} top bb style={{ whiteSpace: 'pre-line' }}>{sys(req?.notes)}</C>
          </tr>

          <Bar>3 생산팀 검토 &amp; 지시사항</Bar>
          <tr style={{ height: '30.4mm' }}>
            <C span={GRID.length} top bb>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '4mm' }}>
                <span>완료예정일: {sys(req?.complete_by)}</span>
                <span style={{ fontSize: '8pt' }}>공정 순서 및 자재 소요량은 다음 장에 이어집니다.</span>
              </div>
              {req?.instruction && (
                <div style={{ whiteSpace: 'pre-line', color: BLUE, fontSize: '10pt' }}>{req.instruction}</div>
              )}
              {/*
                * 지시의 사실 - 시스템이 발행한 값 그대로. 공정 순서와 자재 소요량은
                * 다음 장에 이어진다. 양식에 없던 줄이라 작게 넣어 칸 높이 안에 둔다.
                * 줄마다 열을 정해 둔다 - 차례대로 흘리면 예정 생산이 없는 지시에서
                * 긴 줄이 좁은 열로 밀려 접히고 칸이 넘친다.
                */}
              <div style={{
                display: 'flex', gap: '4mm', marginTop: '0.8mm',
                fontSize: '8.5pt', lineHeight: 1.2, color: BLUE,
              }}>
                <div style={{ flex: '38 1 0', minWidth: 0 }}>
                  <div>배치번호 <b>{facts.batchNo}</b></div>
                  <div>원재료 로트 <b>{facts.rawLot}</b></div>
                  <div>장입 수량 <b>{facts.load}</b></div>
                  {facts.planned > 0 && <div>예정 생산 {facts.planned}개 (형명은 재단에서 정해짐)</div>}
                </div>
                <div style={{ flex: '62 1 0', minWidth: 0 }}>
                  <div>제품 {facts.product} · 표준서 {facts.revision}</div>
                  <div>{facts.supplier} · 성적서 {facts.coa}</div>
                  <div>필요 용기 {facts.containers}</div>
                  <div>발행 {facts.issued} · {facts.issuers}</div>
                </div>
              </div>
            </C>
          </tr>

          <Bar>
            4 생산팀 작업지시 수신확인<span style={small(9)}>(서명 후 원본 파일링, 사본 제조기록서에 첨부)</span>
          </Bar>
          <tr style={{ height: ROW }}>
            <C span={2} label>성명</C>
            <C span={3} />
            <C span={2} label>서명</C>
            <C span={4} />
            <C span={2} label>일자</C>
            <C span={2} />
          </tr>
        </tbody>
      </table>

      {/* 꼬리: 양식 번호 · 회사 · 시행일 (스캔의 자리) */}
      <div style={{ position: 'relative', height: '4.5mm', marginTop: '5mm', fontSize: '10pt', lineHeight: 1.25 }}>
        <span style={{ position: 'absolute', left: '-0.4mm' }}>{FORM_NO}</span>
        <span style={{ position: 'absolute', left: `${108 - LEFT}mm`, transform: 'translateX(-50%)' }}>{FORM_ORG}</span>
        <span style={{ position: 'absolute', right: `${LEFT + WIDTH - 198}mm` }}>{FORM_DATE}</span>
      </div>
    </div>
  );
}
