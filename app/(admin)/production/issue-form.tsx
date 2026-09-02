'use client';

import { useActionState, useEffect, useState, useId } from 'react';
import type { FormState } from '@/lib/forms';
import { Msg, Warnings } from '@/components/ui';
import { issueWorkOrder } from './actions';
import { previewIssue, type IssuePreview } from './preview';

export interface DmOpt {
  id: string; revision: string; item_code: string; item_name: string;
  product_code: string | null; product_name: string | null;
  sheet_min: number | null; sheet_max: number | null;
  verified_at: Date | null; op_count: number;
}
export interface RawLotOpt {
  id: string; lot_no: string; item_code: string; item_name: string;
  qty_available: string; thickness_band: string | null;
  supplier_name: string; supplier_status: string; expiry_date: string | null;
}
export interface UserOpt { id: string; full_name: string; roles: string[] }
export interface FinOpt { id: string; code: string; name: string }

/* ---------------------------------------------------------------------------
   작업 지시 발행

   관리자가 책상에서 쓰는 화면이다. 키보드 입력을 그대로 둔다.
   장입 장수를 넣으면 자재 구성표로 소요량을 미리 계산해 보여 준다. 이 값이
   작업 지시서에 인쇄된다. 경고는 표시만 하고 발행을 막지 않는다 (§2).
--------------------------------------------------------------------------- */
export default function IssueForm({ masters, rawLots, finished, users, today }: {
  masters: DmOpt[]; rawLots: RawLotOpt[]; finished: FinOpt[];
  users: UserOpt[]; today: string;
}) {
  /* 라벨과 입력을 잇는다 (4차 감사 G2). 같은 부품이 여러 번 그려져도 겹치지 않는다 */
  const uid = useId();

  const [state, action, pending] = useActionState<FormState, FormData>(issueWorkOrder, {});
  const [open, setOpen] = useState(false);
  const [dm, setDm] = useState('');
  const [lot, setLot] = useState('');
  const [sheets, setSheets] = useState(20);
  const [prod, setProd] = useState('');
  const [qa, setQa] = useState('');
  const [pv, setPv] = useState<IssuePreview>({});

  /* 고른 제품표준서가 정한 장입 범위. 고르기 전에는 울타리만 안다 (0069) */
  const chosen = masters.find((m) => m.id === dm);
  const lo = chosen?.sheet_min ?? 1;
  const hi = chosen?.sheet_max ?? null;

  /*
   * 예정 형명. 한 배치에서 여러 규격이 나온다 (§3 ③). 두께는 원재료가 정하므로
   * 배치 하나가 두께 구간 하나에 묶이고 그 안에서 크기별로 갈린다.
   *
   * 어디까지나 예정이다. 실제 형명과 수량은 재단에서 정해지고, 달라도 시스템이
   * 고치지 않는다 (§7). 두 값이 나란히 남는다.
   */
  /* 예정 생산 수량. 형명이 아니라 개수만 받는다 (§3 ① 형명은 재단에서 정해진다) */
  const [units, setUnits] = useState('');
  const plannedUnits = Number(units) || 0;

  const ready = masters.filter((m) => m.verified_at);
  const dmSel = ready.find((m) => m.id === dm) ?? ready[0];
  const lotSel = rawLots.find((l) => l.id === lot) ?? rawLots[0];

  // 발행자는 아무나 고를 수 없다. 지시서에는 생산과 품질 두 사람의 서명란이
  // 나가므로, 그 역할을 가진 사람이 먼저 나와야 한다. 다만 목록을 잘라 내지는
  // 않는다. 역할이 아직 부여되지 않은 초기에 발행이 통째로 막히면 곤란하다.
  const prodOpts = byRole(users, ['PROD_MGR', 'SYS_ADMIN']);
  const qaOpts = byRole(users, ['QP']);

  useEffect(() => {
    if (!dmSel || !lotSel) return;
    const id = setTimeout(() => {
      previewIssue(dmSel.id, lotSel.id, sheets, plannedUnits).then(setPv);
    }, 200);
    return () => clearTimeout(id);
  }, [dmSel?.id, lotSel?.id, sheets]);

  useEffect(() => { if (state.ok) setOpen(false); }, [state.ok]);

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-2">
        <button onClick={() => setOpen(true)} className="btn-primary"
                disabled={ready.length === 0 || rawLots.length === 0}>
          작업 지시 발행
        </button>
        <div className="max-w-lg"><Msg state={state} /></div>
        {ready.length === 0 && (
          <p className="text-xs text-faint">서면 대조가 확인된 제품표준서가 필요합니다.</p>
        )}
        {ready.length > 0 && rawLots.length === 0 && (
          <p className="text-xs text-faint">사용 가능한 원재료 로트가 없습니다.</p>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="card w-full p-4">
      <h3 className="text-sm font-bold text-ink">작업 지시 발행</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        지시서번호와 배치번호는 채번 규칙이 만듭니다. 원재료 로트는 배치당 하나입니다.
      </p>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div>
          <label className="label" htmlFor={`${uid}-device_master_id`}>제품표준서</label>
          <select id={`${uid}-device_master_id`} name="device_master_id" required value={dmSel?.id ?? ''}
                  onChange={(e) => setDm(e.target.value)} className="input">
            {ready.map((m) => (
              <option key={m.id} value={m.id}>
                {m.product_code ?? m.item_code} {m.revision} · 공정 {m.op_count}
              </option>
            ))}
          </select>
        </div>
        <div className="lg:col-span-2">
          <label className="label" htmlFor={`${uid}-material_lot_id`}>원재료 로트</label>
          <select id={`${uid}-material_lot_id`} name="material_lot_id" required value={lotSel?.id ?? ''}
                  onChange={(e) => setLot(e.target.value)} className="input">
            {rawLots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.lot_no} · {l.item_name} · 잔여 {Number(l.qty_available)}
                {l.thickness_band ? ` · 두께 ${l.thickness_band}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/*
          * 범위는 제품표준서가 정한다 (M5-1 · §2.0). 전에는 1~30 이 이 화면과
          * 표 정의 두 곳에 박혀 있었다. 다른 품목을 올리려면 개발자를 불러야
          * 했다.
          *
          * 화면이 막는 것은 예의이고 실제 차단은 DB 다 (0069).
          */}
        <div>
          <label className="label" htmlFor={`${uid}-sheet_count`}>
            장입 장수{' '}
            <span className="text-faint">
              ({lo}
              {hi === null ? '장 이상' : `~${hi}`})
            </span>
          </label>
          <input id={`${uid}-sheet_count`} name="sheet_count" type="number" min={lo} max={hi ?? undefined} required
                 value={sheets} onChange={(e) => setSheets(Number(e.target.value))}
                 className="input tnum" />
        </div>
        <div className="sm:col-span-2">
          {/*
            * 예정 생산 수량. 형명이 아니라 개수만 받는다.
            *
            * 형명은 재단에서 정해진다 (§3 ①). 착수 전에 발행하는 종이에 형명을
            * 적으면 작업자가 재료가 허락하는 대로 자르는 대신 그 수에 맞추려
            * 하게 된다 (사용자 지적).
            *
            * 개수는 필요하다. 포장재가 제품 1개당 기준이라 (PER_UNIT) 이 값이
            * 없으면 지시서에 소요량이 서지 않는다. 비워 두면 "재단 후 확정"
            * 으로 인쇄되고 그것도 정상이다.
            */}
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <label className="label mb-0">예정 생산 수량</label>
            <span className="text-xs text-muted">
              포장재 소요량 계산에 씁니다. 비워 두면 재단 후 확정으로 인쇄됩니다.
            </span>
          </div>
          <input
            name="planned_units"
            type="number"
            min={1}
            inputMode="numeric"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            placeholder="예: 204"
            className="input mt-1.5 w-44 tnum"
          />
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            어떤 형명이 몇 개 나올지는 재단에서 정해집니다. 지시서에는 개수만
            나가고, 형명별 수량은 재단 기록에 남습니다.
          </p>
        </div>

        <div>
          <label className="label" htmlFor={`${uid}-issued_by_prod`}>생산 서명란</label>
          <select id={`${uid}-issued_by_prod`} name="issued_by_prod" required value={prod || prodOpts[0]?.id}
                  onChange={(e) => setProd(e.target.value)} className="input">
            <IssuerOptions users={users} roles={['PROD_MGR', 'SYS_ADMIN']} />
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-issued_by_qa`}>품질 서명란</label>
          <select id={`${uid}-issued_by_qa`} name="issued_by_qa" required value={qa || qaOpts[0]?.id}
                  onChange={(e) => setQa(e.target.value)} className="input">
            <IssuerOptions users={users} roles={['QP']} />
          </select>
        </div>
      </div>

      {/*
        * 고르는 사람이 한 명이라는 사실을 화면이 숨기지 않는다 (감사 지적 6).
        *
        * 전에는 "발행자" 라고만 적혀 있어, 두 사람이 시스템에서 각자 확인한
        * 것처럼 읽혔다. 실제로는 지금 로그인한 한 사람이 이름 둘을 고르는
        * 것이고, 두 번째 사람의 인증은 없다. 확인은 종이 위 서명에서
        * 일어나므로 여기서 정하는 것은 서명란에 인쇄될 이름이다.
        *
        * 시스템이 보증하는 것처럼 읽히면 그것이 더 위험하다.
        */}
      <p className="mt-2 text-xs leading-relaxed text-muted">
        여기서 고른 두 이름이 지시서 서명란에 인쇄됩니다. 확인은 인쇄물에 직접
        서명하는 것으로 이루어집니다. 시스템은 두 사람이 확인했는지를 알지
        못하며, 이름을 종이에 옮길 뿐입니다.
      </p>

      {(prod || prodOpts[0]?.id) === (qa || qaOpts[0]?.id) && (
        <p className="mt-2 rounded-md bg-danger-bg px-3 py-2 text-xs text-danger">
          생산과 품질 서명란이 같은 사람입니다. 서로 다른 사람이어야 저장됩니다.
        </p>
      )}

      {pv.warnings && pv.warnings.length > 0 && (
        <div className="mt-3"><Warnings items={pv.warnings} /></div>
      )}

      {pv.requirements && pv.requirements.length > 0 && (
        <div className="mt-3 rounded-md border border-line bg-canvas p-3">
          <p className="text-xs font-bold text-ink">
            장입 {sheets}장 기준 소요량 (작업 지시서에 인쇄됩니다)
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">공정</th>
                  <th className="th">자재</th>
                  <th className="th">기준</th>
                  <th className="th text-right">소요량</th>
                </tr>
              </thead>
              <tbody>
                {pv.requirements.map((r, i) => (
                  <tr key={i}>
                    <td className="td text-xs text-muted">{r.operation_name}</td>
                    <td className="td text-xs">
                      <span className="font-mono">{r.item_code}</span> {r.item_name}
                    </td>
                    <td className="td text-xs text-muted">
                      {r.basis === 'PER_UNIT' ? '제품 개수 기준' : '장입 구간 기준'}
                    </td>
                    <td className="td tnum text-right text-xs font-semibold">
                      {r.required === null
                        ? <span className="text-warn">구간 없음</span>
                        : `${Number(r.required)} ${r.usage_uom}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-faint">
            제품 개수 기준 자재는 재단 후 수량이 정해지므로 여기서는 계산하지 않습니다.
            지시서에는 예정이, 기록서에는 실제가 나옵니다.
          </p>
        </div>
      )}

      <Msg state={state} />

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? '발행 중' : '발행'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

/** 해당 역할을 가진 사람을 앞으로 뺀다. */
function byRole(users: UserOpt[], roles: string[]) {
  return users.filter((u) => u.roles.some((r) => roles.includes(r)));
}

/**
 * 발행자 선택지.
 *
 * 역할을 가진 사람을 먼저 보여 주고, 나머지는 "그 외"로 내린다. 잘라 내지
 * 않는 이유는 §2 때문이다. 차단은 다섯 개뿐이고 나머지는 표시로 처리한다.
 * 역할을 아직 안 넣은 상태에서 발행이 막히면 그건 설계 오류다.
 */
function IssuerOptions({ users, roles }: { users: UserOpt[]; roles: string[] }) {
  const has = byRole(users, roles);
  const rest = users.filter((u) => !has.includes(u));
  const label = roles.includes('QP') ? '품질책임자' : '생산관리자';

  return (
    <>
      {has.length > 0 && (
        <optgroup label={label}>
          {has.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </optgroup>
      )}
      {rest.length > 0 && (
        <optgroup label={has.length > 0 ? '그 외' : `${label} 역할 없음`}>
          {rest.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </optgroup>
      )}
    </>
  );
}
