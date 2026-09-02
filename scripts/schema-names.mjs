/**
 * 이 스키마가 무엇을 만들었는가 - 이름으로 적는다.
 *
 * IQ 가 "표 35 이상" 처럼 하한만 보고 있었다. 표가 42인 지금 이관 하나가
 * 통째로 빠져도 전건 통과다 (4차 감사 A6).
 *
 * 숫자 대신 **이름**을 견준다. 빠진 이름이 있으면 그것이 곧 빠진 이관이다.
 * 확장이 만든 것은 뺀다 - 운영(Supabase)과 로컬의 확장이 달라 숫자로는
 * 맞출 수 없지만 이름으로는 우리 것만 골라낼 수 있다.
 */

/** 확장이 만든 것을 뺀 public 스키마의 이름들 */
export const NAME_SQL = `
with ext as (
  select objid from pg_depend where deptype = 'e'
)
select 'table' as kind, c.relname as name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.oid not in (select objid from ext)
union all
select 'view', c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'v' and c.oid not in (select objid from ext)
union all
select 'enum', t.typname
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
 where n.nspname = 'public' and t.typtype = 'e' and t.oid not in (select objid from ext)
union all
select 'function', p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.oid not in (select objid from ext)
union all
select 'trigger', c.relname || '.' || tg.tgname
  from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and not tg.tgisinternal
order by 1, 2`;

/** 조회 결과를 { kind: [name...] } 로 모은다 */
export function group(rows) {
  const out = {};
  for (const r of rows) (out[r.kind] ??= []).push(r.name);
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])].sort();
  return out;
}
