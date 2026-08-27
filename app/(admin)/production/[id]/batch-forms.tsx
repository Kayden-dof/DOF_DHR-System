'use client';

import Link from 'next/link';

import { useActionState, useState } from 'react';
import { PL_STATUS_LABEL, type FormState } from '@/lib/forms';
import { Msg, Caution } from '@/components/ui';
import { Dialog, useDialog } from '@/components/dialog';
import {
  cutLot, setLotStatus, cancelWorkOrder, finishWorkOrder, retrievePrint,
  recordNonconformity,
} from '../actions';

export interface LotRow {
  id: string; lot_no: string; item_code: string; item_name: string;
  qty_produced: number; qty_sample: number; qty_available: number;
  manufactured_on: string; expiry_date: string; status: string;
  location: string | null; shelf_months: number | null; shipped: number;
  rework: number; concession: number; scrap: number;
}
export interface FinOpt { id: string; code: string; name: string }

/* ---------------------------------------------------------------------------
   재단 분할

   한 배치는 하나의 두께 구간이므로 나올 수 있는 형명이 좁혀진다 (§3 ③).
   두께는 원재료가 정하고 재단에서는 가로x세로만 갈리므로, 이 배치에서 나올 수
   있는 형명은 62 개가 아니라 그 두께의 13 개다.

   그런데 목록은 62 개를 그대로 펼치고 있었다. 재단하는 사람이 두께가 다른
   형명을 고를 수 있고, 목록 첫 줄이 이 배치와 무관한 두께였다. 그래서 이
   배치의 두께 구간을 앞으로 모으고 첫 줄로 세운다.

   다른 두께를 지우지는 않는다. 차단은 S01~S05 뿐이고 (§2) 여기는 그 다섯이
   아니다. 원재료 로트에 두께가 안 적혀 있을 수도 있다. 고를 수는 있게 두되
   고른 것이 이 배치의 두께와 다르면 그 사실만 적는다 (§8.5).
--------------------------------------------------------------------------- */
export function CutForm({ woId, options, today, used, band }: {
  woId: string; options: FinOpt[]; today: string; used: Set<string>;
  /** 이 배치 원재료 로트의 두께 구간. 예 '1015' */
  band?: string | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(cutLot, {});
  const [produced, setProduced] = useState('');
  const [sample, setSample] = useState('0');
  const pool = options.filter((o) => !used.has(o.id));

  // 형명 뒤 4 자리가 두께 구간이다 (PD + 가로2 + 세로2 + 두께하한2 + 두께상한2)
  const ofBand = band ? pool.filter((o) => o.code.slice(-4) === band) : [];
  const others = band ? pool.filter((o) => o.code.slice(-4) !== band) : pool;

  const [itemId, setItemId] = useState('');
  const picked = pool.find((o) => o.id === itemId) ?? ofBand[0] ?? others[0];
  const offBand = !!band && !!picked && picked.code.slice(-4) !== band;

  const avail = Math.max(0, Number(produced || 0) - Number(sample || 0));

  return (
    <form action={action} className="border-t border-line bg-canvas p-4">
      <input type="hidden" name="work_order_id" value={woId} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <label className="label">형명</label>
          <select name="item_id" required className="input"
                  value={picked?.id ?? ''} onChange={(e) => setItemId(e.target.value)}>
            {ofBand.length > 0 ? (
              <>
                <optgroup label={`이 배치의 두께 구간 ${band}`}>
                  {ofBand.map((o) => (
                    <option key={o.id} value={o.id}>{o.code} · {o.name}</option>
                  ))}
                </optgroup>
                {others.length > 0 && (
                  <optgroup label="그 밖의 두께">
                    {others.map((o) => (
                      <option key={o.id} value={o.id}>{o.code} · {o.name}</option>
                    ))}
                  </optgroup>
                )}
              </>
            ) : (
              pool.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.name}</option>)
            )}
          </select>
        </div>
        <div>
          <label className="label">생산 수량</label>
          <input name="qty_produced" type="number" min={1} required value={produced}
                 onChange={(e) => setProduced(e.target.value)} className="input tnum" />
        </div>
        <div>
          <label className="label">샘플 수량</label>
          <input name="qty_sample" type="number" min={0} value={sample}
                 onChange={(e) => setSample(e.target.value)} className="input tnum" />
        </div>
        <div>
          <label className="label">제조일</label>
          <input name="manufactured_on" type="date" defaultValue={today} className="input tnum" />
        </div>
      </div>

      {/* 두께가 다른 형명을 골랐다는 사실만 적는다. 막지 않는다 (§8.5) */}
      {offBand && (
        <Caution>
          이 배치의 원재료 두께 구간은 {band} 인데 고른 형명 {picked!.code} 의
          두께 구간은 {picked!.code.slice(-4)} 입니다.
        </Caution>
      )}

      <p className="mt-2 text-xs leading-relaxed text-muted">
        출하 가능 수량은 <b className="text-ink tnum">{avail}</b>개가 됩니다.
        완제품검사 샘플은 생산 수량에서 빠지며 회수되어도 복귀하지 않습니다.
        유효기한은 지금 시점의 사용기간으로 고정되고, 나중에 사용기간이 바뀌어도
        이 로트에는 소급되지 않습니다.
      </p>

      <Msg state={state} />
      <div className="mt-3">
        <button type="submit" disabled={pending || pool.length === 0} className="btn-primary">
          제조번호 부여
        </button>
        {pool.length === 0 && (
          <span className="ml-2 text-xs text-faint">더 나눌 형명이 없습니다.</span>
        )}
      </div>
    </form>
  );
}

export function LotStatusForm({ lot, woId }: { lot: LotRow; woId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setLotStatus, {});
  const { open, setOpen } = useDialog(state);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-quiet h-8 px-2 text-xs">수정</button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="제품 로트 수정"
        note={<><span className="font-mono">{lot.lot_no}</span> · {lot.item_code}</>}
      >
        <form action={action} className="space-y-3">
          <input type="hidden" name="id" value={lot.id} />
          <input type="hidden" name="work_order_id" value={woId} />
          <div>
            <label className="label">상태</label>
            <select name="status" defaultValue={lot.status} className="input">
              {Object.entries(PL_STATUS_LABEL).map(([c, l]) => (
                <option key={c} value={c}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">보관 위치</label>
            <input name="location" defaultValue={lot.location ?? ''} className="input" />
          </div>
          <Msg state={state} />
          <button type="submit" disabled={pending} className="btn-primary w-full">
            {pending ? '저장하는 중' : '저장'}
          </button>
        </form>
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------------------- */

export function CancelForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(cancelWorkOrder, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return <button onClick={() => setOpen(true)} className="btn-danger h-9 px-3 text-xs">취소</button>;
  }

  return (
    <form action={action} className="w-full rounded-md border border-danger/30 bg-danger-bg p-3">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm font-semibold text-ink">작업 지시를 취소합니다</p>
      <Caution>
        지시서번호와 배치번호는 소멸하며 재사용하지 않습니다. 번호가 비는 것이 정상이고,
        취소 기록이 그 설명이 됩니다.
      </Caution>
      <div className="mt-2">
        <label className="label">취소 사유</label>
        <input name="cancelled_reason" required autoComplete="off" className="input" />
      </div>
      <Msg state={state} />
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={pending} className="btn-danger h-9 px-3 text-xs">
          취소한다
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost h-9 px-3 text-xs">
          취소
        </button>
      </div>
    </form>
  );
}

export function FinishForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(finishWorkOrder, {});
  const [ask, setAsk] = useState(false);

  if (!ask) {
    return <button onClick={() => setAsk(true)} className="btn-ghost h-9 px-3 text-xs">배치 종료</button>;
  }

  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <span className="text-xs text-muted">종료하고 편철 표지를 출력하시겠습니까?</span>
      <button type="submit" disabled={pending} className="btn-primary h-9 px-3 text-xs">종료</button>
      <button type="button" onClick={() => setAsk(false)} className="btn-quiet h-9 px-2 text-xs">
        아니오
      </button>
      <Msg state={state} />
    </form>
  );
}

/* ---------------------------------------------------------------------------
   기록서 첫 발행

   이 화면을 여는 것만으로 그 묶음이 잠긴다 (S04). 화면이 그려지는 순간 순번과
   자료 식별자가 붙은 종이가 존재하게 되고, 실제로 인쇄했는지는 브라우저 밖의
   일이라 알 수 없기 때문이다.

   그래서 한 번 더 묻는다. 다른 되돌릴 수 없는 조작에는 전부 확인 단계가
   있는데 여기만 곧장 열리고 있었다. 내용을 보려고 눌렀다가 잠기면 되돌릴
   방법이 없다 - 잠금 해제 함수는 만들지 않는다.

   이미 잠긴 묶음은 묻지 않는다. 재발행은 잠금을 새로 만들지 않는다.
--------------------------------------------------------------------------- */
export function DayPrintLink({
  href, locked,
}: { href: string; locked: boolean }) {
  const [ask, setAsk] = useState(false);

  if (locked) {
    return <Link href={href} className="btn-ghost h-8 px-3 text-xs">재발행</Link>;
  }
  if (!ask) {
    return (
      <button type="button" onClick={() => setAsk(true)} className="btn-ghost h-8 px-3 text-xs">
        인쇄
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="text-xs text-warn">열면 잠깁니다</span>
      <Link href={href} className="btn-primary h-8 px-3 text-xs">발행</Link>
      <button type="button" onClick={() => setAsk(false)} className="btn-quiet h-8 px-2 text-xs">
        그만
      </button>
    </span>
  );
}

/* ---------------------------------------------------------------------------
   인쇄물 회수 기록

   되돌릴 수 없다. 이미 회수로 적힌 것을 안 한 것으로 만들 수 없고 사유도
   고쳐 쓸 수 없다. 그래서 한 번 더 묻는다.
--------------------------------------------------------------------------- */
export function RetrieveForm({ id, woId, label }: { id: string; woId: string; label: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(retrievePrint, {});
  const { open, setOpen } = useDialog(state);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-quiet h-8">
        회수 기록
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="인쇄물 회수"
        note={<span className="font-mono">{label}</span>}
      >
        <form action={action} className="space-y-3">
          <input type="hidden" name="print_id" value={id} />
          <input type="hidden" name="work_order_id" value={woId} />
          <div>
            <label className="label">회수 사유</label>
            <select name="reason" required className="input">
              <option value="">선택하십시오</option>
              <option>재발행으로 앞 종이 회수</option>
              <option>오출력 회수</option>
              <option>파손 · 오염으로 회수</option>
              <option>기타 회수</option>
            </select>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            회수는 되돌릴 수 없습니다. 이미 회수로 기록된 인쇄물은 다시 기록되지 않습니다.
          </p>
          <Msg state={state} />
          <button type="submit" disabled={pending} className="btn-danger w-full">
            {pending ? '기록하는 중' : '회수로 기록한다'}
          </button>
        </form>
      </Dialog>
    </>
  );
}

/* ---------------------------------------------------------------------------
   제품 부적합 기록

   한 개체는 셋 중 하나로만 끝난다. 그래서 결말을 먼저 고르게 한다 - 수량을
   먼저 적게 하면 그 수가 무엇의 수인지가 흐려진다.

     재작업  다시 해서 제품이 된 수량
     특채    부적합인 채로 내보낸 수량. 서면 승인자가 필요하다
     불량    끝내 제품이 되지 못한 수량. 출하 가능 수량이 그만큼 준다

   시스템은 무엇이 부적합인지 정하지 않는다. 서면으로 정해진 결과를 적을 뿐이다.
--------------------------------------------------------------------------- */
const NC_OUTCOMES = [
  { code: 'REWORK',     label: '재작업', note: '다시 해서 제품이 됨' },
  { code: 'CONCESSION', label: '특채',   note: '부적합인 채로 내보냄' },
  { code: 'SCRAP',      label: '불량',   note: '끝내 제품이 안 됨' },
] as const;

const NC_REASONS = [
  '외관 불량', '치수 이탈', '포장 손상', '라벨 오류', '멸균 부적합', '기타',
];

export function NonconformityForm({ lot, woId, today }: {
  lot: LotRow; woId: string; today: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    recordNonconformity, {});
  const { open, setOpen } = useDialog(state);
  const [outcome, setOutcome] = useState<'REWORK' | 'CONCESSION' | 'SCRAP'>('SCRAP');

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-quiet h-8 px-2 text-xs">
        부적합
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} wide
              title="제품 부적합 기록"
              note={<><span className="font-mono">{lot.lot_no}</span> · {lot.item_code} ·
                {' '}출하 가능 <span className="tnum">{lot.qty_available}</span>개</>}>
        <form action={action} className="space-y-4">
          <input type="hidden" name="product_lot_id" value={lot.id} />
          <input type="hidden" name="work_order_id" value={woId} />
          <input type="hidden" name="outcome" value={outcome} />

          <div>
            <span className="label">결말</span>
            <div className="grid gap-2 sm:grid-cols-3">
              {NC_OUTCOMES.map((o) => (
                <button key={o.code} type="button" onClick={() => setOutcome(o.code)}
                        data-on={outcome === o.code}
                        className="tile items-center py-2.5 text-center">
                  <span className="text-sm font-bold">{o.label}</span>
                  <span className="text-xs text-muted">{o.note}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label">수량</label>
              <input name="qty" type="number" min={1}
                     max={outcome === 'SCRAP' ? lot.qty_available : undefined}
                     required className="input tnum" />
            </div>
            <div>
              <label className="label">사유</label>
              <select name="reason_code" required className="input">
                <option value="">선택하십시오</option>
                {NC_REASONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="label">발견일</label>
              <input name="found_at" type="date" defaultValue={today} className="input tnum" />
            </div>
          </div>

          <div>
            <label className="label">상세 (선택)</label>
            <input name="reason_detail" autoComplete="off" className="input" />
          </div>

          {/* 특채는 서면 승인 사항이다. 승인자 없이는 기록되지 않는다 */}
          {outcome === 'CONCESSION' && (
            <div className="grid gap-3 rounded-md border border-warn/30 bg-warn-bg p-3 sm:grid-cols-2">
              {/*
                * 특채 기록지 문서 코드. 이 값이 없으면 특채로 잡지 않는다.
                * 정본은 품질팀이 발행한 기록지이고 여기 적는 것은 그 종이를
                * 가리키는 표지다. 성적서 번호와 같은 자리다 (§2 S02).
                */}
              <div className="sm:col-span-2">
                <label className="label">특채 기록지 문서 코드 (필수)</label>
                <input name="concession_doc_no" required autoComplete="off"
                       placeholder="예: QC-CON-2026-004" className="input font-mono" />
              </div>
              <div>
                <label className="label">서면 승인자 (필수)</label>
                <input name="approved_by" required autoComplete="off"
                       placeholder="품질책임자 이름" className="input" />
              </div>
              <div>
                <label className="label">승인일 (필수)</label>
                <input name="approved_on" type="date" required defaultValue={today}
                       className="input tnum" />
              </div>
              <p className="text-xs leading-relaxed text-ink sm:col-span-2">
                특채는 부적합인 채로 내보내는 결정입니다. 품질팀에서 특채 기록지를 받고
                그 문서 코드를 적어야 특채로 잡힙니다. 코드 없이는 기록되지 않습니다.
                이 기록지는 배치 묶음에 함께 철합니다.
              </p>
            </div>
          )}

          <p className="text-xs leading-relaxed text-muted">
            {outcome === 'SCRAP'
              ? '불량으로 적은 수량만큼 이 제조번호의 출하 가능 수량이 줄어듭니다. 되돌릴 수 없습니다.'
              : '재작업과 특채는 제품으로 나가므로 출하 가능 수량이 줄지 않습니다.'}
            {' '}무엇이 부적합인지는 서면으로 정하고, 시스템은 그 결과를 적습니다.
          </p>

          <Msg state={state} />
          <button type="submit" disabled={pending} className="btn-primary w-full">
            {pending ? '기록하는 중' : '기록한다'}
          </button>
        </form>
      </Dialog>
    </>
  );
}
