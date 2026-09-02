import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Db } from './db';

/* ---------------------------------------------------------------------------
   코드와 스키마가 어긋나 있는가 (4차 감사 C5)

   코드 배포와 스키마 이관이 따로 논다. 실제로 그것 때문에 화면이 죽었다 -
   이관 하나를 만들어 운영에 올리고, 다음 이관은 로컬에만 넣은 채 코드를
   배포했더니 운영에 없는 표를 화면이 찾았다 (2026-09-01).

   그때 아무 장치도 없었다. 사용자가 "화면 왜이래" 라고 알려 줄 때까지
   몰랐다. IQ 가 그 자리를 메운다고 했으나 임계값이 하한이라 이관 하나가
   통째로 빠져도 통과했다 (A6 에서 고쳤다).

   IQ 는 사람이 돌리는 것이다. 화면이 스스로도 말해야 한다.
   설정 > 개요가 이것을 읽어 어긋나면 크게 알린다.

   빌드에 함께 실려 나가는 db/schema-baseline.json 이 "이 코드가 기대하는
   스키마" 다. 지금 DB 에 그 이름들이 다 있는지 조회로 확인한다.
--------------------------------------------------------------------------- */

export interface SchemaDrift {
  ok: boolean;
  /** 코드가 기대하는데 DB 에 없는 것. 이관이 덜 올라갔다는 뜻이다 */
  missing: { kind: string; names: string[] }[];
  checked: number;
}

const KIND_LABEL: Record<string, string> = {
  table: '표', view: '뷰', enum: '열거형', function: '함수', trigger: '트리거',
};

export const kindLabel = (k: string) => KIND_LABEL[k] ?? k;

export async function schemaDrift(db: Db): Promise<SchemaDrift> {
  let want: Record<string, string[]>;
  try {
    want = JSON.parse(
      readFileSync(path.join(process.cwd(), 'db', 'schema-baseline.json'), 'utf8'));
  } catch {
    /* 기준 파일이 없으면 대조하지 않는다. 없다고 통과라고 말하지도 않는다 */
    return { ok: true, missing: [], checked: 0 };
  }

  const rows = await db.rows<{ kind: string; name: string }>(`
    with ext as (select objid from pg_depend where deptype = 'e')
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
     where n.nspname = 'public' and not tg.tgisinternal`);

  const have = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!have.has(r.kind)) have.set(r.kind, new Set());
    have.get(r.kind)!.add(r.name);
  }

  const missing: { kind: string; names: string[] }[] = [];
  let checked = 0;
  for (const [kind, names] of Object.entries(want)) {
    checked += names.length;
    const h = have.get(kind) ?? new Set<string>();
    const gone = names.filter((x) => !h.has(x));
    if (gone.length) missing.push({ kind, names: gone });
  }

  return { ok: missing.length === 0, missing, checked };
}
