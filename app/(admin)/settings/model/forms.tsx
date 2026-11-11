'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { Msg } from '@/components/ui';
import type { FormState } from '@/lib/forms';
import { saveScheme, saveSegment } from './actions';

export interface Scheme {
  id: string; name: string; prefix: string;
  spec_pattern: string; name_pattern: string | null;
}
export interface Segment {
  scheme_id: string; seq: number; digits: number;
  divisor: string; decimals: number; label: string; role: string;
}

const ROLES = [
  { v: 'WIDTH', t: '가로' },
  { v: 'HEIGHT', t: '세로' },
  { v: 'BAND', t: '두께' },
  { v: 'OTHER', t: '그 밖' },
];

export function SchemeForm({ scheme }: { scheme: Scheme | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveScheme, {});
  const uid = useId();

  return (
    <form action={action} className="p-4">
      {scheme && <input type="hidden" name="id" value={scheme.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${uid}-name`}>이름</label>
          <input id={`${uid}-name`} name="name" required autoComplete="off"
                 defaultValue={scheme?.name ?? ''} placeholder="완제품 형명 체계 이름"
                 className="input" />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-prefix`}>형명 접두어</label>
          <input id={`${uid}-prefix`} name="prefix" required autoComplete="off"
                 defaultValue={scheme?.prefix ?? ''} placeholder="PD"
                 className="input font-mono uppercase" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${uid}-spec`}>규격 문구</label>
          <input id={`${uid}-spec`} name="spec_pattern" required autoComplete="off"
                 defaultValue={scheme?.spec_pattern ?? ''}
                 placeholder="{1}x{2}cm · 두께 {3}~{4}mm"
                 className="input" />
          <p className="mt-1 text-xs leading-relaxed text-muted">
            <b className="text-ink">이 문구가 종이에 찍힙니다.</b> 라벨요청서와 출하 승인
            요청서의 규격 칸입니다. <code>{'{1}'}</code>은 아래 1번 자리 값으로 바뀝니다.
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${uid}-nm`}>제품명 문구 (비워도 됩니다)</label>
          <input id={`${uid}-nm`} name="name_pattern" autoComplete="off"
                 defaultValue={scheme?.name_pattern ?? ''}
                 placeholder="{P} {1}x{2}cm {3}~{4}mm"
                 className="input" />
          <p className="mt-1 text-xs text-muted">
            <code>{'{P}'}</code>는 제품 이름 접두사입니다. 형명을 한꺼번에 만들 때 씁니다.
          </p>
        </div>
      </div>
      <Msg state={state} />
      <button type="submit" disabled={pending} className="btn-primary mt-3">
        {pending ? '저장하는 중' : scheme ? '고치기' : '등록'}
      </button>
    </form>
  );
}

export function SegmentForm({ schemeId, next, taken = [] }: {
  schemeId: string; next: number;
  /** 이미 정한 자리. 같은 번호를 적으면 칸 바로 아래에서 덮어쓴다고 알린다 */
  taken?: { seq: number; label: string }[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSegment, {});
  const [role, setRole] = useState('OTHER');
  const uid = useId();
  /*
   * 덮어쓰기 경고를 «자리» 칸 옆에 둔다 (UI/UX 검수 2026-11-11 «형명 자리 덮어쓰기 경고
   * 위치»). 전에는 단추 옆 긴 글 속에 섞여 있어, 번호를 고치는 사람이 그 칸에서 보지
   * 못했다. 적은 번호가 이미 있으면 그 자리 이름과 함께 바로 아래에 알린다. 막지 않는다.
   */
  const [seq, setSeq] = useState(String(next));
  /* 자리를 하나 정하면 다음 번호로 넘어간다. 방금 정한 번호에 경고가 남지 않게 */
  useEffect(() => { setSeq(String(next)); }, [next]);
  const hit = taken.find((t) => String(t.seq) === seq.trim());

  return (
    <form action={action} className="grid gap-3 border-t border-line-soft p-4 sm:grid-cols-6">
      <input type="hidden" name="scheme_id" value={schemeId} />
      <div>
        <label className="label" htmlFor={`${uid}-seq`}>자리</label>
        <input id={`${uid}-seq`} name="seq" required inputMode="numeric"
               value={seq} onChange={(e) => setSeq(e.target.value)} className="input tnum" />
        {hit && (
          <p className="mt-1 text-xs leading-relaxed text-warn">
            <span className="tnum">{hit.seq}</span>번 자리 «{hit.label}» 를 덮어씁니다.
          </p>
        )}
      </div>
      <div>
        <label className="label" htmlFor={`${uid}-digits`}>자릿수</label>
        <input id={`${uid}-digits`} name="digits" required inputMode="numeric"
               defaultValue="2" className="input tnum" />
      </div>
      <div>
        <label className="label" htmlFor={`${uid}-div`}>나눌 값</label>
        <input id={`${uid}-div`} name="divisor" required autoComplete="off"
               defaultValue="1" className="input tnum" />
      </div>
      <div>
        <label className="label" htmlFor={`${uid}-dec`}>소수 자리</label>
        <input id={`${uid}-dec`} name="decimals" required inputMode="numeric"
               defaultValue="0" className="input tnum" />
      </div>
      <div>
        <label className="label" htmlFor={`${uid}-role`}>뜻</label>
        <select id={`${uid}-role`} name="role" value={role}
                onChange={(e) => setRole(e.target.value)} className="input">
          {ROLES.map((r) => <option key={r.v} value={r.v}>{r.t}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`${uid}-label`}>이름</label>
        <input id={`${uid}-label`} name="label" required autoComplete="off"
               placeholder="가로 (cm)" className="input" />
      </div>
      <div className="sm:col-span-6">
        <Msg state={state} />
        <button type="submit" disabled={pending} className="btn-ghost">
          {pending ? '저장하는 중' : '자리 정하기'}
        </button>
        <span className="ml-2 text-xs text-muted">
          나눌 값은 형명의 숫자를 실제 값으로
          바꿉니다 - 두께 <code>05</code>가 <code>0.5mm</code>가 되려면 10입니다.
        </span>
      </div>
    </form>
  );
}
