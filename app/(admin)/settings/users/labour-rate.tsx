'use client';

import { useActionState, useId } from 'react';
import { addLabourRate } from './actions';
import { Msg, Empty } from '@/components/ui';
import { Table, Th, Td } from '@/components/table';
import { ROLE_LABEL, ROLE_ORDER, type RoleCode } from '@/lib/roles';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   공수 단가 (사용자 요청 2026-09-01 · 0076)

   역할별 시간당 단가를 여기서 넣는다. 사용자 화면에 두는 이유는 그 단가가
   역할에 매기는 값이기 때문이고, 이 화면이 시스템관리자에게만 열려 있어
   급여에 가까운 숫자를 두기에 맞기 때문이다.

   ── 고쳐 쓰지 않는다 ──────────────────────────────────────────────────────
   바꾸려면 새 줄을 넣는다. 목록에 지난 단가가 그대로 남아, 어느 기간에 무엇을
   썼는지 나중에 되짚을 수 있다.

   ── 무엇에 쓰이는가 ───────────────────────────────────────────────────────
   기록의 시작 · 종료 시각으로 시간을 재어 곱한다. 시각이 비어 있는 기록은
   0 시간이고, 원가 화면이 그런 기록이 몇 건인지 적는다 - 조용히 빼면 적게
   나온 줄 모른다.
--------------------------------------------------------------------------- */

export interface RateRow {
  id: string;
  role: RoleCode;
  hourly_rate: string | number;
  effective_from: string;
  note: string | null;
  registered_by_name: string;
  registered_at: string;
  /** 그 역할에서 지금 쓰이는 줄인가 */
  current: boolean;
}

const won = (v: string | number) => Number(v).toLocaleString('ko-KR');

export function LabourRates({ rows, today, writable = true }: {
  rows: RateRow[]; today: string;
  /** 이 세션이 쓸 수 있는가. 못 쓰면 등록 칸을 그리지 않는다 */
  writable?: boolean;
}) {
  /* 라벨과 입력을 잇는다 (4차 감사 G2). 같은 부품이 여러 번 그려져도 겹치지 않는다 */
  const uid = useId();

  const [state, action, pending] = useActionState<FormState, FormData>(addLabourRate, {});

  /* 단가가 아직 없는 역할. 있는 것만 적고 없으면 아무것도 적지 않는다 */
  const missing = ROLE_ORDER.filter(
    (r) => r !== 'VIEWER' && r !== 'QP' && !rows.some((x) => x.role === r));

  return (
    <section className="card overflow-hidden">
      <div className="section-head">
        <h3 className="text-sm font-bold text-ink">공수 단가</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          역할별 시간당 단가입니다. 기록의 시작 · 종료 시각으로 시간을 재어
          생산 원가에 얹습니다. <b className="text-ink">고쳐 쓰지 않습니다</b> -
          바꾸려면 새 줄을 넣고, 지난 단가는 그대로 남습니다.
        </p>
      </div>

      {writable && (
      <form action={action} className="grid gap-3 border-b border-line-soft px-4 py-3
                                       sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="label" htmlFor={`${uid}-role`}>역할</label>
          <select id={`${uid}-role`} name="role" required className="input">
            {ROLE_ORDER.filter((r) => r !== 'VIEWER').map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-hourly_rate`}>시간당 단가 (원)</label>
          <input id={`${uid}-hourly_rate`} name="hourly_rate" inputMode="numeric" autoComplete="off"
                 required placeholder="25000" className="input tnum" />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-effective_from`}>적용일</label>
          <input id={`${uid}-effective_from`} type="date" name="effective_from" defaultValue={today}
                 required className="input tnum" />
        </div>
        <div className="lg:col-span-2">
          <label className="label" htmlFor={`${uid}-note`}>비고</label>
          <input id={`${uid}-note`} name="note" autoComplete="off" className="input" />
        </div>

        <div className="sm:col-span-2 lg:col-span-5">
          <Msg state={state} />
          <button type="submit" disabled={pending} className="btn-ghost h-9 px-3 text-xs">
            {pending ? '등록하는 중' : '단가 등록'}
          </button>
        </div>
      </form>
      )}

      {missing.length > 0 && (
        <p className="border-b border-line-soft px-4 py-2.5 text-xs leading-relaxed text-muted">
          <b className="text-ink">
            {missing.map((r) => ROLE_LABEL[r]).join(' · ')}
          </b>{' '}
          단가가 아직 없습니다. 그 역할이 한 기록은 공수가 0원으로 잡힙니다.
        </p>
      )}

      {rows.length === 0 ? (
        <Empty>등록된 공수 단가가 없습니다.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>역할</Th>
              <Th right>시간당</Th>
              <Th>적용일</Th>
              <Th>비고</Th>
              <Th>등록</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.current ? '' : 'text-muted'}>
                <Td>
                  {ROLE_LABEL[r.role]}
                  {r.current && (
                    <span className="ml-1.5 text-xs text-brand">지금</span>
                  )}
                </Td>
                <Td right><span className="tnum font-semibold">{won(r.hourly_rate)}</span></Td>
                <Td><span className="tnum">{r.effective_from}</span></Td>
                <Td><span className="text-xs">{r.note}</span></Td>
                <Td>
                  <span className="text-xs text-muted">
                    {r.registered_at} · {r.registered_by_name}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}
