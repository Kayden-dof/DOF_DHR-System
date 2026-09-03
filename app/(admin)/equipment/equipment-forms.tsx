'use client';

import { useActionState, useState, useId } from 'react';
import type { FormState } from '@/lib/forms';
import { Msg, Tag } from '@/components/ui';
import { Dialog, useDialog } from '@/components/dialog';
import Link from 'next/link';
import { fmtDate } from '@/lib/fmt';
import { saveEquipment, linkOperation, saveValidation } from './actions';

/** 구입 정보와 감가상각. 원가에만 쓰이고 기록에는 나가지 않는다 */
export interface EquipBuy {
  purchased_on: string | null;
  purchase_price: string | number | null;
  useful_life_months: number | null;
  salvage_value: string | number | null;
  monthly_hours: string | number | null;
  vendor_name: string | null;
  vendor_contact_name: string | null;
  vendor_phone: string | null;
  vendor_email: string | null;
  vendor_site: string | null;
  vendor_address: string | null;
  /** 시간당 감가상각비. 셋 중 하나라도 비면 null */
  hourly_cost: string | number | null;
}

export interface EquipRow extends EquipBuy {
  id: string; code: string; name: string; note: string | null; is_active: boolean;
  ops: { operation_id: string; code: string; name: string }[];
  used: number;
  /** 최신 밸리데이션. 없으면 전부 null */
  performed_on: string | null; valid_until: string | null; report_no: string | null;
  days_left: number | null;
  history: { performed_on: string; valid_until: string; report_no: string;
             note: string | null; registered_by_name: string }[];
}

/* ---------------------------------------------------------------------------
   구입과 감가상각 (사용자 요청 2026-09-01)

   생산 단가에 설비 몫을 얹으려면 얼마에 사서 몇 년 쓰는지가 있어야 한다.

   ── 비워 두어도 된다 ──────────────────────────────────────────────────────
   막지 않는다. 취득원가 · 내용연수 · 기준 월 가동시간 셋이 다 있어야 시간당
   상각비가 나오고, 하나라도 비면 그 설비 몫을 원가에 얹지 않는다. 0 으로
   채우지 않는다 - 0 은 "공짜" 라는 뜻이고 빈 칸은 "아직 모른다" 다.

   ── 판 곳은 자재 공급자와 다른 자리다 ─────────────────────────────────────
   supplier 표에 넣지 않는다. 그쪽은 자재 입고 화면의 선택지가 되고 승인 상태가
   경고에 쓰인다. 설비를 판 곳이 그 목록에 뜰 이유가 없다.
--------------------------------------------------------------------------- */

function BuyFields({ e }: { e?: EquipBuy }) {
  /* 라벨과 입력을 잇는다 (4차 감사 G2). 같은 부품이 여러 번 그려져도 겹치지 않는다 */
  const uid = useId();

  const v = (k: keyof EquipBuy) => (e?.[k] ?? '') as string;

  return (
    <>
      <div className="mt-4 border-t border-line-soft pt-3">
        <h4 className="text-xs font-bold text-ink">구입과 감가상각</h4>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          생산 단가에 설비 몫을 얹는 데 씁니다. 기록에는 나가지 않습니다.
          <b className="text-ink"> 취득원가 · 내용연수 · 기준 월 가동시간</b> 이 다
          있어야 시간당 상각비가 나옵니다. 비워 두면 얹지 않습니다.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="label" htmlFor={`${uid}-purchased_on`}>구입일</label>
            <input id={`${uid}-purchased_on`} type="date" name="purchased_on" defaultValue={v('purchased_on')}
                   className="input tnum" />
          </div>
          <div>
            <label className="label" htmlFor={`${uid}-purchase_price`}>취득원가 (원)</label>
            <input id={`${uid}-purchase_price`} name="purchase_price" inputMode="numeric" autoComplete="off"
                   defaultValue={v('purchase_price')} placeholder="12000000"
                   className="input tnum" />
          </div>
          <div>
            <label className="label" htmlFor={`${uid}-useful_life_months`}>내용연수 (개월)</label>
            <input id={`${uid}-useful_life_months`} name="useful_life_months" inputMode="numeric" autoComplete="off"
                   defaultValue={v('useful_life_months')} placeholder="60"
                   className="input tnum" />
          </div>
          <div>
            <label className="label" htmlFor={`${uid}-salvage_value`}>잔존가치 (원)</label>
            <input id={`${uid}-salvage_value`} name="salvage_value" inputMode="numeric" autoComplete="off"
                   defaultValue={v('salvage_value')} placeholder="0"
                   className="input tnum" />
          </div>
          <div>
            <label className="label" htmlFor={`${uid}-monthly_hours`}>기준 월 가동시간</label>
            <input id={`${uid}-monthly_hours`} name="monthly_hours" inputMode="decimal" autoComplete="off"
                   defaultValue={v('monthly_hours')} placeholder="160"
                   className="input tnum" />
          </div>
        </div>

        {e?.hourly_cost != null && (
          <p className="mt-2 text-xs text-muted">
            지금 값으로 시간당{' '}
            <b className="tnum text-ink">{won(e.hourly_cost)}</b> 원입니다.
          </p>
        )}
      </div>

      <div className="mt-4 border-t border-line-soft pt-3">
        <h4 className="text-xs font-bold text-ink">판 곳</h4>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label" htmlFor={`${uid}-vendor_name`}>업체명</label>
            <input id={`${uid}-vendor_name`} name="vendor_name" autoComplete="off" defaultValue={v('vendor_name')}
                   className="input" />
          </div>
          <div>
            <label className="label" htmlFor={`${uid}-vendor_contact_name`}>담당자</label>
            <input id={`${uid}-vendor_contact_name`} name="vendor_contact_name" autoComplete="off"
                   defaultValue={v('vendor_contact_name')} className="input" />
          </div>
          <div>
            <label className="label" htmlFor={`${uid}-vendor_phone`}>연락처</label>
            <input id={`${uid}-vendor_phone`} name="vendor_phone" autoComplete="off" defaultValue={v('vendor_phone')}
                   className="input tnum" />
          </div>
          <div>
            <label className="label" htmlFor={`${uid}-vendor_email`}>이메일</label>
            <input id={`${uid}-vendor_email`} type="email" name="vendor_email" autoComplete="off"
                   defaultValue={v('vendor_email')} className="input" />
          </div>
          <div>
            <label className="label" htmlFor={`${uid}-vendor_site`}>사이트 <span className="text-faint">(선택)</span></label>
            <input id={`${uid}-vendor_site`} type="url" name="vendor_site" autoComplete="off" placeholder="https://"
                   defaultValue={v('vendor_site')} className="input" />
          </div>
          <div>
            <label className="label" htmlFor={`${uid}-vendor_address`}>주소 <span className="text-faint">(선택)</span></label>
            <input id={`${uid}-vendor_address`} name="vendor_address" autoComplete="off"
                   defaultValue={v('vendor_address')} className="input" />
          </div>
        </div>
      </div>
    </>
  );
}

/** 원 단위 숫자를 세 자리마다 끊는다. 소수 넷째 자리까지 남는 값이라 반올림한다 */
function won(v: string | number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n).toLocaleString('ko-KR') : String(v);
}

export interface OpOption {
  id: string; code: string; name: string; seq: number;
  dm_id: string; revision: string; item_code: string; item_name: string;
  /** 제품 최상위 관리 코드 (DX2401). 없으면 형명으로 떨어진다 */
  product_code: string | null; product_name: string | null;
}

/* -------------------------------------------------------------------------- */

export function NewEquipment() {
  /* 라벨과 입력을 잇는다 (4차 감사 G2). 같은 부품이 여러 번 그려져도 겹치지 않는다 */
  const uid = useId();

  const [state, action, pending] = useActionState<FormState, FormData>(saveEquipment, {});
  const { open, setOpen } = useDialog(state);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary">설비 등록</button>
      <Dialog open={open} onClose={() => setOpen(false)} wide title="설비 등록">
        <form action={action}>
      <h3 className="text-sm font-bold text-ink">설비 등록</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label">설비 코드</label>
          {/*
            * 기록에 적히는 값이다. 등록한 뒤에는 고칠 수 없다 - 이미 그 코드로
            * 적힌 기록이 있으면 그 기록이 가리키는 대상이 바뀌어 버린다.
            */}
          <input name="code" required autoComplete="off" placeholder="FD-01"
                 className="input font-mono" />
        </div>
        <div className="lg:col-span-2">
          <label className="label" htmlFor={`${uid}-name`}>설비명</label>
          <input id={`${uid}-name`} name="name" required autoComplete="off" placeholder="동결건조기 1호"
                 className="input" />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-note`}>비고</label>
          <input id={`${uid}-note`} name="note" autoComplete="off" className="input" />
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        코드는 등록 후 수정할 수 없습니다. 제조기록서에 이 값이 그대로 기재됩니다.
      </p>

      <BuyFields />
      <Msg state={state} />
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary h-9 px-4 text-xs">
          {pending ? '등록하는 중' : '등록'}
        </button>
      </div>
        </form>
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------------------- */

export function EquipCard({ e, ops, warnDays }: {
  e: EquipRow; ops: OpOption[];
  /** 며칠 남으면 눈에 띄게 하는가. 설정이 정한다 (6차 감사 N1) */
  warnDays: number;
}) {
  /* 라벨과 입력을 잇는다 (4차 감사 G2). 같은 부품이 여러 번 그려져도 겹치지 않는다 */
  const uid = useId();

  const [state, action, pending] = useActionState<FormState, FormData>(saveEquipment, {});
  const [linkState, linkAction] = useActionState<FormState, FormData>(linkOperation, {});
  const [edit, setEdit] = useState(false);

  const linked = new Set(e.ops.map((o) => o.operation_id));

  return (
    <section className="card">
      <header className="section-head">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-sm font-bold text-ink">{e.code}</span>
          <span className="text-sm text-body">{e.name}</span>
          {!e.is_active && <Tag tone="quiet">내림</Tag>}
          {e.note && <span className="text-xs text-faint">{e.note}</span>}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          {/*
            * 밸리데이션 상태. 이 카드에서 가장 먼저 보여야 하는 값이다.
            * 판정 문구가 아니라 날짜와 남은 일수라는 사실만 적는다.
            */}
          {e.valid_until === null ? (
            <Tag tone="danger">밸리데이션 기록 없음</Tag>
          ) : e.days_left !== null && e.days_left < 0 ? (
            <Tag tone="danger">기한 경과 {fmtDate(e.valid_until)}</Tag>
          ) : e.days_left !== null && e.days_left <= warnDays ? (
            <Tag tone="warn">만료 {e.days_left}일 전</Tag>
          ) : (
            <span className="tnum text-xs text-muted">만료 {fmtDate(e.valid_until)}</span>
          )}
          <span className="tnum text-xs text-muted">기록 {e.used}건</span>
          <Link href={`/print/equipment-log/${e.id}`} className="btn-ghost h-8 px-3 text-xs">
            사용 기록
          </Link>
          {!edit && (
            <button onClick={() => setEdit(true)} className="btn-quiet h-8 px-2 text-xs">고치기</button>
          )}
        </div>
      </header>

      {edit && (
        <form action={action} className="border-b border-line-soft bg-surface-sub px-4 py-3">
          <input type="hidden" name="id" value={e.id} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/*
              * 코드는 아직 쓰이지 않은 설비만 고칠 수 있다. 기록에 문자열로
              * 적히므로 쓰인 뒤 바꾸면 그 기록이 가리키는 대상이 사라지고,
              * 기록은 되돌릴 수 없다. DB 트리거가 같은 것을 막는다 (0031).
              */}
            <div>
              <label className="label" htmlFor={`${uid}-code`}>설비 코드</label>
              <input id={`${uid}-code`} name="code" defaultValue={e.code} disabled={e.used > 0}
                     autoComplete="off" className="input font-mono" />
              {e.used > 0 && (
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  제조기록 {e.used}건에 <span className="font-mono">{e.code}</span> 로
                  적혀 있어 코드를 바꿀 수 없습니다.
                </p>
              )}
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-name`}>설비명</label>
              <input id={`${uid}-name`} name="name" defaultValue={e.name} required className="input" />
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-note`}>비고</label>
              <input id={`${uid}-note`} name="note" defaultValue={e.note ?? ''} className="input" />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="is_active" defaultChecked={e.is_active}
                       className="size-4 accent-brand" />
                쓰는 설비
              </label>
            </div>
          </div>

          <BuyFields e={e} />

          <Msg state={state} />
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={pending} className="btn-primary h-9 px-4 text-xs">
              저장
            </button>
            <button type="button" onClick={() => setEdit(false)}
                    className="btn-ghost h-9 px-3 text-xs">
              취소
            </button>
          </div>
        </form>
      )}

      {/*
        * 어느 공정에서 쓰는가.
        *
        * 현장 화면은 여기 걸린 것만 타일로 보여 준다. 전부 늘어놓으면 장갑 낀
        * 손이 긴 목록에서 하나를 찾아야 한다.
        */}
      <ValidationPanel e={e} />

      {/*
        * 쓰는 공정 · 제품별.
        *
        * 제품(표준서)을 펼치면 그 공정이 주르륵 나오고 거기서 건다. 제품마다
        * 따로 걸 수 있으므로 같은 설비가 여러 제품에 걸리는 것이 자연스럽다.
        * 이미 걸린 공정이 있는 제품은 펼쳐진 채로 시작한다 - 접힌 묶음 안에
        * 걸림이 숨으면 이 설비가 어디 쓰이는지 한눈에 못 본다.
        */}
      <div className="border-t border-line-soft px-4 py-3">
        <p className="label mb-2">쓰는 공정 · 제품별</p>
        {(() => {
          const groups: { dm_id: string; label: string; sub: string; ops: OpOption[] }[] = [];
          for (const o of ops) {
            let g = groups.find((x) => x.dm_id === o.dm_id);
            if (!g) {
              // 제품 자리에는 최상위 관리 코드가 나간다. 형명(PD…)은 규격이다
              g = { dm_id: o.dm_id,
                    label: `${o.product_code ?? o.item_code} ${o.revision}`,
                    sub: o.product_name ?? o.item_name, ops: [] };
              groups.push(g);
            }
            g.ops.push(o);
          }
          if (groups.length === 0) {
            return (
              <p className="text-xs text-faint">
                서면 대조가 확인된 제품표준서가 없습니다.
              </p>
            );
          }
          return groups.map((g) => {
            const cnt = g.ops.filter((o) => linked.has(o.id)).length;
            return (
              <details key={g.dm_id} open={cnt > 0}
                       className="group rounded-md border border-line-soft [&+details]:mt-1.5">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md px-3 py-2 hover:bg-canvas">
                  <span aria-hidden
                        className="text-xs text-faint transition-transform group-open:rotate-90">
                    &rsaquo;
                  </span>
                  <span className="font-mono text-[0.8125rem] font-bold text-ink">{g.label}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted">{g.sub}</span>
                  <span className={`tnum text-xs ${cnt ? 'font-bold text-brand' : 'text-faint'}`}>
                    {cnt ? `공정 ${cnt}곳에 걸림` : '걸린 공정 없음'}
                  </span>
                </summary>
                <div className="flex flex-wrap gap-1.5 border-t border-line-soft px-3 py-2.5">
                  {g.ops.map((o) => {
                    const on = linked.has(o.id);
                    return (
                      <form key={o.id} action={linkAction}>
                        <input type="hidden" name="equipment_id" value={e.id} />
                        <input type="hidden" name="operation_id" value={o.id} />
                        <input type="hidden" name="on" value={on ? '0' : '1'} />
                        <button type="submit"
                                className={`chip transition-colors ${
                                  on ? 'bg-brand text-white' : 'bg-canvas text-muted hover:text-ink'}`}>
                          {o.name}
                        </button>
                      </form>
                    );
                  })}
                </div>
              </details>
            );
          });
        })()}
        {linkState.error && (
          <p role="alert" className="mt-2 text-sm text-danger">{linkState.error}</p>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
   밸리데이션 등록과 이력

   서면 보고서가 근거다. 여기에는 번호와 날짜만 옮겨 적는다. 이력은 고치지
   않는다 - 잘못 넣었으면 바른 값을 다시 등록하고, 최신 만료일이 상태가 된다.
--------------------------------------------------------------------------- */
function ValidationPanel({ e }: { e: EquipRow }) {
  /* 라벨과 입력을 잇는다 (4차 감사 G2). 같은 부품이 여러 번 그려져도 겹치지 않는다 */
  const uid = useId();

  const [state, action, pending] = useActionState<FormState, FormData>(saveValidation, {});
  const { open, setOpen } = useDialog(state);

  return (
    <div className="border-t border-line-soft">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <p className="label mb-0">밸리데이션</p>
        <button onClick={() => setOpen(true)} className="btn-ghost h-8 px-3 text-xs">
          등록
        </button>
        {e.history.length === 0 && (
          <span className="text-xs text-faint">등록된 이력이 없습니다.</span>
        )}
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} wide
              title="밸리데이션 등록"
              note={<><span className="font-mono">{e.code}</span> · {e.name}</>}>
        <form action={action}>
          <input type="hidden" name="equipment_id" value={e.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor={`${uid}-performed_on`}>수행일</label>
              <input id={`${uid}-performed_on`} name="performed_on" type="date" required className="input tnum" />
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-valid_until`}>만료일</label>
              <input id={`${uid}-valid_until`} name="valid_until" type="date" required className="input tnum" />
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-report_no`}>보고서 번호 (필수)</label>
              <input id={`${uid}-report_no`} name="report_no" required autoComplete="off"
                     placeholder="VAL-2026-001" className="input font-mono" />
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-note`}>비고</label>
              <input id={`${uid}-note`} name="note" autoComplete="off" className="input" />
            </div>
          </div>
          <Msg state={state} />
          <p className="mt-2 text-xs leading-relaxed text-muted">
            이력은 지워지지 않습니다. 잘못 입력했으면 바른 값을 다시 등록하고,
            최신 만료일이 상태가 됩니다.
          </p>
          <button type="submit" disabled={pending} className="btn-primary mt-3 w-full">
            {pending ? '등록하는 중' : '등록'}
          </button>
        </form>
      </Dialog>

      {e.history.length > 0 && (
        <ul className="divide-y divide-line-soft border-t border-line-soft">
          {e.history.map((h, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-xs">
              <span className="tnum text-body">수행 {fmtDate(h.performed_on)}</span>
              <span className={`tnum font-semibold ${i === 0 ? 'text-ink' : 'text-muted'}`}>
                만료 {fmtDate(h.valid_until)}
              </span>
              <span className="font-mono text-body">{h.report_no}</span>
              {h.note && <span className="text-muted">{h.note}</span>}
              <span className="ml-auto text-faint">{h.registered_by_name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
