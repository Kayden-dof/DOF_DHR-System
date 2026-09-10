'use client';

import { useActionState, useState, useId, useTransition, useEffect } from 'react';
import type { FormState } from '@/lib/forms';
import { ITEM_TYPES } from '@/lib/forms';
import { Msg, Tag } from '@/components/ui';
import { Dialog, useDialog } from '@/components/dialog';
import { createItem, updateItem, bulkItems, generateFinished, previewFinished,
         type GenResult, type PreviewRow } from './actions';

export interface ItemRow {
  /** 어디서 사는가. 발주 화면이 미리 골라 준다 (6차 감사 N7) */
  default_supplier_id: string | null;
  id: string;
  code: string;
  name: string;
  type: string;
  purchase_uom: string;
  usage_uom: string;
  conversion: string;
  min_stock: string | null;
  min_stock_auto: string | null;
  min_stock_basis: string | null;
  lead_days: number | null;
  shelf_life_months: number | null;
  is_active: boolean;
  lot_count: number;
}

const typeLabel = (t: string) => ITEM_TYPES.find((x) => x.code === t)?.label ?? t;

/* -------------------------------------------------------------------------- */

export function NewItemForm({ materialOnly = false }: { materialOnly?: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createItem, {});
  const { open, setOpen } = useDialog(state);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary">품목 등록</button>
      <Dialog open={open} onClose={() => setOpen(false)} wide title="품목 등록">
        <form action={action}>
      <h3 className="mb-3 text-sm font-bold text-ink">새 품목</h3>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="code">품목 코드</label>
          <input id="code" name="code" required autoComplete="off"
                 className="input font-mono" />
        </div>
        <div className="lg:col-span-2">
          <label className="label" htmlFor="name">품목명</label>
          <input id="name" name="name" required autoComplete="off" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="type">유형</label>
          <select id="type" name="type" className="input" defaultValue="REAGENT">
            {(materialOnly ? ITEM_TYPES.filter((x) => x.code !== 'FIN') : ITEM_TYPES).map((x) => (
              <option key={x.code} value={x.code}>{x.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="purchase_uom">구매 단위</label>
          <input id="purchase_uom" name="purchase_uom" required defaultValue="EA"
                 autoComplete="off" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="usage_uom">사용 단위</label>
          <input id="usage_uom" name="usage_uom" required defaultValue="EA"
                 autoComplete="off" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="conversion">환산 계수</label>
          <input id="conversion" name="conversion" type="number" step="any" min="0.0001"
                 defaultValue={1} className="input tnum" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="min_stock">최소 재고선</label>
            <input id="min_stock" name="min_stock" type="number" step="any" className="input tnum" />
          </div>
          <div>
            <label className="label" htmlFor="lead_days">리드타임(일)</label>
            <input id="lead_days" name="lead_days" type="number" className="input tnum" />
          </div>
        </div>
      </div>

      <p className="mt-3 rounded-md bg-canvas px-3 py-2 text-xs leading-relaxed text-muted">
        재고 · 불출 · 단가는 전부 <b className="text-ink">사용 단위</b> 기준으로 다룹니다.
        구매 단위는 입고 등록에서만 받아 환산 계수로 바꿉니다.
        예를 들어 20L 통으로 사서 L 단위로 쓴다면 구매 단위 통, 사용 단위 L, 환산 계수 20입니다.
      </p>

      <Msg state={state} />

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? '등록 중' : '등록'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
      </div>
        </form>
      </Dialog>
    </>
  );
}

/* ---------------------------------------------------------------------------
   품목 붙여넣기 (사용자 요청 2026-09-10)

   한 건씩 넣으면 등록에 성공할 때마다 창이 닫히고 유형 · 단위가 기본값으로
   돌아간다. 처음 세울 때 품목이 스무 종 안팎이라 그 반복이 그대로 셋업
   시간이 된다. 제품표준서의 공정 흐름 적기와 같은 방식이다.
--------------------------------------------------------------------------- */

export function BulkItemForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(bulkItems, {});
  const { open, setOpen } = useDialog(state);

  /*
   * 적은 것을 들고 있는다. 폼에 맡기면 제출할 때마다 비워지는데, 스무 줄을
   * 붙여 넣고 한 줄이 틀리면 그 스무 줄이 통째로 사라진다. 오류 문구가
   * "몇째 줄이 틀렸다" 라고 말해 주는데 고칠 원본이 없으면 소용이 없다.
   */
  const [text, setText] = useState('');
  useEffect(() => { if (state.ok) setText(''); }, [state.ok]);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn">붙여넣기</button>
      <Dialog open={open} onClose={() => setOpen(false)} wide title="품목 붙여넣기">
        <form action={action}>
          <p className="text-xs leading-relaxed text-muted">
            한 줄에 품목 하나입니다.{' '}
            <b className="text-ink">코드 | 품목명 | 유형 | 구매 단위 | 사용 단위 | 환산 계수</b>{' '}
            순이고, 뒤 세 칸은 비워도 됩니다 (EA · EA · 1).
            엑셀에서 붙여 넣어도 됩니다.
          </p>
          {/*
            * 예시를 defaultValue 로 두지 않는다. 그대로 제출되면 이 회사의
            * 품목이 남의 제조소에 들어간다 (전수 감사 2026-09-07 이 공정
            * 흐름에서 짚은 것과 같은 자리다).
            */}
          <textarea
            name="items"
            required
            rows={12}
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`RM-007 | 염화나트륨 | 시약 | kg | g | 1000
RM-009 | 에탄올(99.5%) | 시약 | L | L | 1
PM-002 | PE 파우치 | 포장재
PM-005 | 파우치 라벨 (1차) | 포장재`}
            className="input mt-3 h-auto text-xs leading-relaxed"
          />
          <p className="mt-2 text-xs leading-relaxed text-muted">
            유형은 <b className="text-ink">원재료 · 시약 · 공정 자재 · 포장재</b> 중
            하나입니다. <b className="text-ink">완제품은 여기서 넣지 않습니다</b> -
            형명은 형명 체계에서 규칙으로 만듭니다.
            한 줄이라도 어긋나면 아무것도 넣지 않습니다.
          </p>

          <Msg state={state} />

          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? '넣는 중' : '품목 넣기'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------------------- */

export function ItemRowView({ it, suppliers }: {
  it: ItemRow;
  /** 어디서 사는가. 발주 화면이 이것을 미리 골라 준다 (6차 감사 N7) */
  suppliers: { id: string; name: string }[];
}) {
  /* 라벨과 입력을 잇는다 (4차 감사 G2). 같은 부품이 여러 번 그려져도 겹치지 않는다 */
  const uid = useId();

  const [state, action, pending] = useActionState<FormState, FormData>(updateItem, {});
  const { open, setOpen } = useDialog(state);

  return (
    <>
      <tr className={it.is_active ? '' : 'opacity-55'}>
        <td className="td font-mono text-xs font-semibold">{it.code}</td>
        <td className="td">{it.name}</td>
        <td className="td"><Tag tone={it.type === 'FIN' ? 'brand' : 'quiet'}>{typeLabel(it.type)}</Tag></td>
        <td className="td text-xs text-muted">
          {it.purchase_uom === it.usage_uom
            ? it.usage_uom
            : `${it.purchase_uom} → ${it.usage_uom} (x${Number(it.conversion)})`}
        </td>
        <td className="td tnum text-right">{it.min_stock ? Number(it.min_stock) : ''}</td>
        <td className="td tnum text-right text-muted">{it.lot_count || ''}</td>
        <td className="td text-right">
          <button onClick={() => setOpen(true)} className="btn-quiet h-8 px-2 text-xs">
            수정
          </button>
        </td>
      </tr>

      {/*
        * 팝업으로 띄운다. 표 안에서 줄을 벌리면 뒤의 목록이 통째로 밀려
        * 내려가고, 고친 뒤에도 열린 채로 남아 한 번 더 누르기 쉽다.
        */}
      <Dialog open={open} onClose={() => setOpen(false)} wide
              title="품목 수정"
              note={<><span className="font-mono">{it.code}</span> · {it.name}</>}>
            <form action={action} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="id" value={it.id} />
              <div className="lg:col-span-2">
                <label className="label" htmlFor={`${uid}-name`}>품목명</label>
                <input id={`${uid}-name`} name="name" defaultValue={it.name} required className="input" />
              </div>
              <div>
                <label className="label" htmlFor={`${uid}-min_stock`}>최소 재고선</label>
                <input id={`${uid}-min_stock`} name="min_stock" type="number" step="any"
                       defaultValue={it.min_stock ?? ''} className="input tnum" />
              </div>
              <div>
                <label className="label" htmlFor={`${uid}-lead_days`}>리드타임(일)</label>
                <input id={`${uid}-lead_days`} name="lead_days" type="number"
                       defaultValue={it.lead_days ?? ''} className="input tnum" />
              </div>
              <div>
                <label className="label" htmlFor={`${uid}-default_supplier_id`}>기본 공급자</label>
                <select id={`${uid}-default_supplier_id`} name="default_supplier_id"
                        defaultValue={it.default_supplier_id ?? ''} className="input">
                  <option value="">정하지 않음</option>
                  {suppliers.map((sp) => (
                    <option key={sp.id} value={sp.id}>{sp.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor={`${uid}-shelf_life_months`}>사용기간(개월)</label>
                <input id={`${uid}-shelf_life_months`} name="shelf_life_months" type="number"
                       defaultValue={it.shelf_life_months ?? ''} className="input tnum" />
              </div>

              {/*
                * 단위는 로트가 들어오기 전에만 고친다. 재고 · 불출 · 단가가
                * 전부 사용 단위 기준의 숫자라, 로트가 있는 품목의 단위를
                * 바꾸면 이미 적힌 숫자의 뜻이 바뀐다 (§4.2 · §2.1).
                */}
              {it.lot_count === 0 ? (
                <>
                  <div>
                    <label className="label" htmlFor={`${uid}-purchase_uom`}>구매 단위</label>
                    <input id={`${uid}-purchase_uom`} name="purchase_uom" required
                           defaultValue={it.purchase_uom} autoComplete="off" className="input" />
                  </div>
                  <div>
                    <label className="label" htmlFor={`${uid}-usage_uom`}>사용 단위</label>
                    <input id={`${uid}-usage_uom`} name="usage_uom" required
                           defaultValue={it.usage_uom} autoComplete="off" className="input" />
                  </div>
                  <div>
                    <label className="label" htmlFor={`${uid}-conversion`}>환산 계수</label>
                    <input id={`${uid}-conversion`} name="conversion" type="number"
                           step="any" min="0.0001" defaultValue={Number(it.conversion)}
                           className="input tnum" />
                  </div>
                </>
              ) : (
                <div className="sm:col-span-2 rounded-md bg-canvas px-3 py-2 text-xs leading-relaxed text-muted">
                  단위는 <b className="text-ink">
                    {it.purchase_uom === it.usage_uom
                      ? it.usage_uom
                      : `${it.purchase_uom} → ${it.usage_uom} (x${Number(it.conversion)})`}
                  </b>이고 더 이상 고칠 수 없습니다.
                  이 품목으로 들어온 로트가 {it.lot_count}건 있고, 재고 · 불출 · 단가가
                  모두 사용 단위 기준의 숫자로 적혀 있습니다 - 단위를 바꾸면 이미
                  적힌 숫자의 뜻이 바뀝니다.
                </div>
              )}

              <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
                <input type="checkbox" name="is_active" defaultChecked={it.is_active}
                       className="size-4 accent-brand" />
                사용
              </label>

              <div className="flex items-end gap-2 sm:col-span-2">
                <button type="submit" disabled={pending} className="btn-primary">저장</button>
              </div>

              {it.min_stock_auto && (
                <p className="rounded-md bg-surface px-3 py-2 text-xs leading-relaxed text-muted sm:col-span-2">
                  <b className="text-ink">자동 산출값 {Number(it.min_stock_auto)}</b>
                  {it.min_stock_basis ? ` · ${it.min_stock_basis}` : ''}
                  <br />제안일 뿐이며 최소 재고선을 덮어쓰지 않습니다. 쓰려면 위 항목에 직접 입력하십시오.
                </p>
              )}
              <div className="sm:col-span-2"><Msg state={state} /></div>
            </form>
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------------------- */

export interface SchemeOpt {
  id: string; name: string; prefix: string;
  /** 크기 자리 수 (BAND 가 아닌 자리들의 합) */
  head: number;
  /** 구간 자리 수 (BAND 자리들의 합) */
  tail: number;
  /** 크기 자리 이름들. 라벨을 여기서 짓는다 */
  size_labels: string;
  band_labels: string;
}

/* ---------------------------------------------------------------------------
   완제품 형명 생성

   ── 화면이 체계를 읽는다 ─────────────────────────────────────────────────
   전에는 `크기 (가로2+세로2)` · `제외 조합 (8자리)` 라고 박혀 있었다. DX2401
   의 모양이지 프로그램의 성질이 아니다 - 자리 수와 이름은 형명 체계가 정한다
   (0075). 다른 품목을 올리는 사람은 화면이 시키는 대로 넣다가 틀린 형명을
   만들었다 (사용자 지적 2026-09-07).

   ── 제외를 문자열로 조립하지 않는다 ──────────────────────────────────────
   만들어질 형명을 격자로 펴고 체크를 꺼서 뺀다. 사람이 여덟 자리를 머릿속에서
   붙일 일이 없어지고, **만들기 전에 몇 종이 나오는지와 이름이 어떻게 붙는지가
   보인다.**

   격자의 내용은 `preview_finished_items()` 가 만든다. 화면이 스스로 조합하면
   그것이 두 번째 출처가 되고, 언젠가 보여 준 것과 만들어진 것이 갈라진다
   (§10 - 복제는 갈라진다).
--------------------------------------------------------------------------- */
export function GenerateFinished({ schemes }: { schemes: SchemeOpt[] }) {
  const uid = useId();
  const [state, action, pending] = useActionState<GenResult, FormData>(generateFinished, {});
  const { open, setOpen } = useDialog(state);

  const [schemeId, setSchemeId] = useState(schemes.length === 1 ? schemes[0].id : '');
  const sc = schemes.find((x) => x.id === schemeId) ?? null;

  /* 미리보기. 만들지 않으므로 폼 제출이 아니라 그냥 부른다 */
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [previewErr, setPreviewErr] = useState('');
  const [busy, startPreview] = useTransition();

  function doPreview(form: HTMLFormElement) {
    const fd = new FormData(form);
    startPreview(async () => {
      const r = await previewFinished(fd);
      if (r.error) { setPreviewErr(r.error); setRows(null); return; }
      setPreviewErr('');
      setRows(r.rows ?? []);
      setOff(new Set());
    });
  }

  /* 격자의 축. 미리보기가 돌려준 차례를 그대로 쓴다 */
  const sizes = rows ? [...new Set(rows.map((r) => r.size_part))] : [];
  const bands = rows ? [...new Set(rows.map((r) => r.band_part))] : [];
  const cell = new Map((rows ?? []).map((r) => [`${r.size_part}|${r.band_part}`, r]));
  const chosen = (rows ?? []).filter((r) => !off.has(r.item_code));

  const toggle = (code: string) => setOff((prev) => {
    const next = new Set(prev);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-ghost">완제품 형명 생성</button>
      <Dialog open={open} onClose={() => setOpen(false)} wide title="완제품 형명 생성">
        <form action={action}>
      <h3 className="text-sm font-bold text-ink">완제품 형명 생성</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        형명 규칙은 <b className="text-ink">형명 체계</b>가 정합니다. 크기와 구간을 입력하고
        미리보기를 누르면 만들어질 형명이 격자로 펼쳐집니다. 만들지 않을 칸은 체크를
        끄십시오. 손으로 한 줄씩 등록하지 마십시오. 이미 있는 코드는 건드리지 않으므로
        반복 실행해도 안전합니다.
      </p>

      <div className="mt-3">
        <label className="label" htmlFor={`${uid}-scheme`}>형명 체계</label>
        {schemes.length === 0 ? (
          <p className="rounded-md bg-warn-bg px-3 py-2.5 text-sm text-ink">
            활성 형명 체계가 없습니다. <b>설정 · 형명 체계</b>에서 먼저 등록하십시오.
          </p>
        ) : (
          <select id={`${uid}-scheme`} name="scheme_id" required value={schemeId}
                  onChange={(e) => { setSchemeId(e.target.value); setRows(null); }}
                  className="input">
            {schemes.length > 1 && <option value="">고르십시오</option>}
            {schemes.map((x) => (
              <option key={x.id} value={x.id}>{x.name} · {x.prefix}</option>
            ))}
          </select>
        )}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <label className="label" htmlFor="sizes">
            크기{sc ? ` (${sc.size_labels} · ${sc.head}자리)` : ''}
          </label>
          <textarea id="sizes" name="sizes" rows={3} required
                    onChange={() => setRows(null)}
                    placeholder={sc ? '0'.repeat(sc.head) : ''}
                    className="input font-mono text-xs" />
          <p className="mt-1 text-xs text-faint">
            공백이나 쉼표로 구분{sc ? ` · 한 덩이가 ${sc.head}자리입니다` : ''}
          </p>
        </div>
        <div>
          <label className="label" htmlFor="bands">
            구간{sc ? ` (${sc.band_labels} · ${sc.tail}자리)` : ''}
          </label>
          <textarea id="bands" name="bands" rows={3} required
                    onChange={() => setRows(null)}
                    placeholder={sc ? '0'.repeat(sc.tail) : ''}
                    className="input font-mono text-xs" />
          <p className="mt-1 text-xs text-faint">
            공백이나 쉼표로 구분{sc ? ` · 한 덩이가 ${sc.tail}자리입니다` : ''}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="prefix">이름 앞머리</label>
          {/*
            * 기본값을 두지 않는다 (5차 감사 B4). DX2401 은 이 제조소의 품목이지
            * 프로그램의 성질이 아니다. 무엇을 적을지는 제품 코드가 알려 준다.
            */}
          <input id="prefix" name="prefix" required autoComplete="off"
                 onChange={() => setRows(null)}
                 placeholder="예: 제품 코드" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="shelf_months">사용기간(개월)</label>
          <input id="shelf_months" name="shelf_months" type="number" defaultValue={12}
                 className="input tnum" />
        </div>
        <div className="flex items-end">
          <button type="button" disabled={busy}
                  onClick={(e) => doPreview(e.currentTarget.form!)}
                  className="btn-ghost">
            {busy ? '보는 중' : '미리보기'}
          </button>
        </div>
      </div>

      {previewErr && (
        <p className="mt-3 rounded-md border border-danger/40 bg-danger-bg px-3 py-2 text-sm text-ink">
          {previewErr}
        </p>
      )}

      {/* 제외는 꺼 둔 칸에서 나온다. 사람이 여덟 자리를 조립하지 않는다 */}
      <input type="hidden" name="exclude"
             value={[...off].map((c) => (sc ? c.slice(sc.prefix.length) : c)).join(' ')} />

      {rows && rows.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-muted">
            만들어질 형명 <b className="tnum text-ink">{chosen.length}종</b>
            {off.size > 0 && <> · 뺀 것 <b className="tnum text-ink">{off.size}종</b></>}
            {' · '}이미 있는 것 <b className="tnum text-ink">
              {chosen.filter((r) => r.already).length}종
            </b>
          </p>
          <div className="mt-2 max-h-72 overflow-auto rounded-md border border-line">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th sticky left-0 bg-surface">크기</th>
                  {bands.map((b) => <th key={b} className="th font-mono text-xs">{b}</th>)}
                </tr>
              </thead>
              <tbody>
                {sizes.map((sz) => (
                  <tr key={sz}>
                    <td className="td sticky left-0 bg-surface font-mono text-xs">{sz}</td>
                    {bands.map((b) => {
                      const r = cell.get(`${sz}|${b}`);
                      if (!r) return <td key={b} className="td" />;
                      const on = !off.has(r.item_code);
                      return (
                        <td key={b} className="td">
                          <label className="flex cursor-pointer items-center gap-1.5"
                                 title={`${r.item_code} · ${r.item_name}${r.spec ? ` · ${r.spec}` : ''}`}>
                            <input type="checkbox" checked={on} className="size-4 accent-brand"
                                   onChange={() => toggle(r.item_code)} />
                            <span className={`font-mono text-[11px] ${on ? 'text-ink' : 'text-faint line-through'}`}>
                              {r.item_code}
                            </span>
                            {r.already && <Tag tone="faint">있음</Tag>}
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-faint">
            칸에 마우스를 올리면 이름과 규격이 보입니다. 규격 문구는 종이에 나가는 것과
            같은 자리에서 나옵니다.
          </p>
        </div>
      )}

      <Msg state={state} />

      {state.rows && state.rows.length > 0 && (
        <div className="mt-3 max-h-64 overflow-auto rounded-md border border-line">
          <table className="w-full">
            <thead><tr><th className="th">코드</th><th className="th">이름</th><th className="th">결과</th></tr></thead>
            <tbody>
              {state.rows.map((r) => (
                <tr key={r.item_code}>
                  <td className="td font-mono text-xs">{r.item_code}</td>
                  <td className="td text-xs">{r.item_name}</td>
                  <td className="td">
                    <Tag tone={r.was_created ? 'ok' : 'faint'}>
                      {r.was_created ? '새로 등록' : '이미 있음'}
                    </Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? '생성 중' : rows ? `${chosen.length}종 생성` : '생성'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
      </div>
        </form>
      </Dialog>
    </>
  );
}
