import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { BackupManifest } from './backup';

/* ---------------------------------------------------------------------------
   백업 파일을 넣어 되돌린다 (사용자 지시 2026-09-01)

   전에는 CLI 만 있었다. 시스템관리자에게 "파일을 backups/ 에 두고 npm run
   restore:check 를 돌리십시오" 라고 안내하는 것은 기능이 아니다 - 아무도 그렇게
   하지 않는다 (사용자 지적).

   ── 이것이 이 시스템에서 가장 위험한 자리다 ────────────────────────────────
   복구는 지금 있는 기록을 통째로 갈아 끼운다. 이 앱의 접속은 원래 소유자
   (postgres) 이고, 매 트랜잭션의 `set local role app_role` 이 그것을 묶는
   유일한 줄이다. 이 파일은 **그 줄을 풀지 않는 유일한 경로**다 - 여기서만
   역할을 걸지 않고 돈다.

   그래서 이 파일에는 두 가지가 없어야 한다.
     · 여기 말고 다른 곳에서 부르는 것
     · "그냥 밀어붙이는" 갈래 (§10 의 force · override · unlock)

   ── 반쯤 복구된 DB 를 만들지 않는다 ────────────────────────────────────────
   전부를 **한 트랜잭션**에서 한다. 중간에 시간이 초과되든 무엇이 터지든 통째로
   되돌아간다. 백업도 아니고 원본도 아닌 상태 - 이 일에서 가장 무서운 결말은
   그것이고, 그건 되살릴 방법이 없다.

   ── 복구 대장은 덮지 않는다 ────────────────────────────────────────────────
   restore_log 를 갈아 끼우면 복구 이력이 매번 사라진다. 감사추적을 지우는 것과
   같다 (0079).
--------------------------------------------------------------------------- */

/** 복구가 손대지 않는 표. 여기 담긴 것은 이 DB 자신의 이력이지 자료가 아니다 */
const KEEP = new Set(['restore_log']);

export interface ParsedBackup {
  manifest: BackupManifest;
  /** 표 이름 → 그 표의 행(한 줄에 한 행, json 문자열) */
  rows: Map<string, string[]>;
  sha256: string;
  byteSize: number;
}

export class BackupError extends Error {}

/**
 * 파일을 읽어 목록과 행을 꺼낸다. **아무것도 쓰지 않는다.**
 *
 * 목록이 없으면 거부한다. 무엇과 대조해야 하는지 모르는 채로 되돌리면, 되돌린
 * 뒤에 그것이 맞는지 물을 수가 없다.
 */
export function parseBackup(gz: Buffer): ParsedBackup {
  let text: string;
  try {
    text = gunzipSync(gz).toString('utf8');
  } catch {
    throw new BackupError('gzip 파일이 아니거나 깨져 있습니다. 내려받은 파일을 그대로 넣으십시오.');
  }

  const lines = text.split('\n');
  const head = lines[0] ?? '';
  if (!head.startsWith('#manifest ')) {
    throw new BackupError(
      '이 파일에는 목록(#manifest)이 없습니다. 이 화면에서 내려받은 백업만 넣을 수 있습니다.');
  }

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(head.slice(10));
  } catch {
    throw new BackupError('목록을 읽지 못했습니다. 파일이 손상되었습니다.');
  }

  const rows = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (let i = 1; i < lines.length; i += 1) {
    const l = lines[i];
    if (!l) continue;
    if (l.startsWith('#table ')) {
      cur = [];
      rows.set(l.split(' ')[1], cur);
      continue;
    }
    if (!cur) throw new BackupError('파일 짜임이 어긋납니다. 표 머리줄 없이 자료가 나옵니다.');
    cur.push(l);
  }

  return {
    manifest,
    rows,
    sha256: createHash('sha256').update(gz).digest('hex'),
    byteSize: gz.byteLength,
  };
}

export interface Flaw { table: string; detail: string }

/**
 * 파일이 스스로와 맞는가.
 *
 * 목록에 적힌 행 수·해시를 실제 줄에서 다시 셈해 견준다. 여기서 어긋나면 그
 * 파일은 보관 중에 상했거나 손을 탄 것이고, **되돌리기 전에 알아야 한다.**
 * 되돌린 뒤에는 견줄 원본이 없다.
 */
export function verifyBackup(b: ParsedBackup): Flaw[] {
  const flaws: Flaw[] = [];
  for (const [t, m] of Object.entries(b.manifest.tables)) {
    const got = b.rows.get(t);
    if (!got) { flaws.push({ table: t, detail: '목록에는 있으나 파일에 없습니다' }); continue; }
    if (got.length !== m.rows) {
      flaws.push({ table: t, detail: `목록 ${m.rows}행 · 파일 ${got.length}행` });
      continue;
    }
    const h = createHash('sha256');
    for (const r of got) h.update(r).update('\n');
    if (h.digest('hex') !== m.sha256) {
      flaws.push({ table: t, detail: '내용 해시가 목록과 다릅니다' });
    }
  }
  for (const t of b.rows.keys()) {
    if (!b.manifest.tables[t]) flaws.push({ table: t, detail: '파일에는 있으나 목록에 없습니다' });
  }
  return flaws;
}

export interface DiffRow { table: string; now: number; file: number; keep: boolean }

/** 지금 담긴 것과 파일에 담긴 것을 나란히 놓는다. 무엇을 덮는지 눈으로 보게 한다 */
export async function diffAgainstNow(c: PoolClient, b: ParsedBackup): Promise<DiffRow[]> {
  const tables: string[] = (await c.query(
    `select cl.relname from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = 'public' and cl.relkind = 'r' order by 1`)).rows.map((r) => r.relname);

  const out: DiffRow[] = [];
  for (const t of tables) {
    const now = Number((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n);
    const file = b.rows.get(t)?.length ?? -1;
    out.push({ table: t, now, file, keep: KEEP.has(t) });
  }
  return out;
}

export interface RestoreResult { rowsBefore: number; rowsAfter: number; tables: number; ms: number }

/**
 * 되돌린다. 한 트랜잭션이다.
 *
 * 실패하면 통째로 되돌아가고 이 DB 는 손대기 전 그대로다.
 */
export async function applyRestore(c: PoolClient, b: ParsedBackup): Promise<RestoreResult> {
  const t0 = Date.now();

  const countAll = async () => {
    const rs = (await c.query(
      `select cl.relname from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
        where n.nspname = 'public' and cl.relkind = 'r'`)).rows.map((r) => r.relname);
    let n = 0;
    for (const t of rs) n += Number((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n);
    return n;
  };

  await c.query('begin');
  try {
    const rowsBefore = await countAll();

    /*
     * 트리거가 물러난다. 복구는 자료를 되살리는 것이지 새로 일어나는 일이
     * 아니므로 감사 트리거가 잡으면 안 되고, S03 의 삭제 금지가 그릇 비우기를
     * 막는다. 트랜잭션 안에서만 물러난다 (`set local`).
     */
    await c.query(`set local session_replication_role = 'replica'`);
    /* 백업이 UTC 로 찍었으므로 넣을 때도 UTC 로 읽는다 */
    await c.query(`set local time zone 'UTC'`);

    /*
     * NOT VALID 검사 제약을 잠시 걷는다. "이미 있는 행은 보지 않는다" 는 뜻이지
     * "앞으로도 보지 않는다" 가 아니라, 그 제약을 만들게 한 옛 행이 백업에 있으면
     * 복구가 통째로 막힌다. 넣고 나서 같은 모양으로 다시 건다.
     */
    const relaxed = (await c.query(`
      select t.relname tbl, co.conname name, pg_get_constraintdef(co.oid) def
        from pg_constraint co
        join pg_class t on t.oid = co.conrelid
        join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = 'public' and co.contype = 'c' and not co.convalidated`)).rows;
    for (const r of relaxed) {
      await c.query(`alter table public.${r.tbl} drop constraint ${r.name}`);
    }

    const tables: string[] = (await c.query(
      `select cl.relname from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
        where n.nspname = 'public' and cl.relkind = 'r' order by 1`)).rows
      .map((r) => r.relname).filter((t: string) => !KEEP.has(t));

    /* 그릇을 비운다. 복구는 "백업에 든 것이 그대로 되살아나는 것" 이다 */
    await c.query(`truncate table ${tables.map((t) => `public.${t}`).join(', ')} cascade`);

    for (const t of tables) {
      const rs = b.rows.get(t);
      if (!rs || rs.length === 0) continue;
      /*
       * 줄을 그대로 배열로 묶어 넘긴다. 자바스크립트가 json 을 해석하지 않으므로
       * numeric 자릿수가 깎이지 않는다 (scripts/backup.mjs 와 같은 이유).
       */
      for (let i = 0; i < rs.length; i += 500) {
        const chunk = rs.slice(i, i + 500);
        await c.query(
          `insert into public.${t}
           select * from jsonb_populate_recordset(null::public.${t}, $1::jsonb)`,
          [`[${chunk.join(',')}]`]);
      }
    }

    /* 다음 번호가 이어지도록 시퀀스를 맞춘다. 빠뜨리면 키가 충돌한다 */
    for (const [, s] of Object.entries(b.manifest.sequences ?? {})) {
      await c.query('select setval($1, $2, true)', [s.seq, s.last]);
    }

    for (const r of relaxed) {
      await c.query(`alter table public.${r.tbl} add constraint ${r.name} ${r.def}`);
    }

    const rowsAfter = await countAll();
    await c.query('commit');
    return { rowsBefore, rowsAfter, tables: tables.length, ms: Date.now() - t0 };
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  }
}
