import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { signManifest } from './print';

/* ---------------------------------------------------------------------------
   한 시점의 자료를 통째로 뜬다 (사용자 요청 2026-09-01)

   `scripts/backup.mjs` 가 하던 일을 화면에서도 할 수 있게 옮긴 것이다. 두
   자리에서 만드니 갈라질 수 있다 (§10 "복제는 갈라진다"). 그래서 **모양을
   똑같이 맞추고, 복구 훈련이 양쪽을 다 되살릴 수 있는지로 확인한다** -
   훈련이 통과하지 못하면 그 백업은 백업이 아니다.

   ── 한 트랜잭션에서 전부 읽는다 ────────────────────────────────────────────
   표를 하나씩 따로 읽으면 읽는 사이에 다른 표가 바뀔 수 있다. 그러면 계보가
   어긋난 백업이 나온다 - 공정 기록은 있는데 그 배치가 없는 식이다.

   ── 시각을 UTC 로 찍는다 ───────────────────────────────────────────────────
   to_jsonb 는 timestamptz 를 세션 시간대로 옮겨 적는다. 같은 순간이 운영에서
   +00, 로컬에서 +09 로 찍히면 글자가 달라져 내용 해시가 어긋난다. 해시는
   순간을 가리켜야지 보는 자리를 가리키면 안 된다.

   ── 줄 순서를 못 박는다 ────────────────────────────────────────────────────
   order by 없이 읽으면 물리적 순서로 나오고, 그 순서는 보장되지 않는다.
   기본키로 정렬하지 않는다 - 표마다 키가 달라 여기서 알 수 없다. 줄 자체를
   정렬하면 어느 표든 한 가지로 정해진다.
--------------------------------------------------------------------------- */

export interface BackupManifest {
  version: number;
  taken_at: string;
  database: string;
  engine: string;
  migrations: string[];
  tables: Record<string, { rows: number; sha256: string }>;
  sequences: Record<string, { seq: string; last: string }>;
  total_rows: number;
  /** 이 서버가 뜬 것이라는 표. 서버 열쇠로 만든다 (4차 감사 D4) */
  sig?: string;
}

export interface Backup {
  fileName: string;
  gz: Buffer;
  manifest: BackupManifest;
  sha256: string;
}

/**
 * 소유자 권한으로 붙은 클라이언트를 받는다.
 *
 * 백업은 전 표를 읽으므로 `set local role app_role` 밑에서도 돌지만, 앞으로
 * 읽기 권한이 촘촘해지면 빠지는 표가 생길 수 있다. 빠진 표는 조용히 빠지고
 * 복구 때에야 드러난다. 그래서 부르는 쪽이 역할을 정하고, 여기서는 정하지
 * 않는다.
 */
export async function buildBackup(c: PoolClient): Promise<Backup> {
  const info = (await c.query(
    `select version() v, current_database() d,
            to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD"T"HH24:MI:SS') t,
            to_char(timezone('Asia/Seoul', now()), 'YYYYMMDD-HH24MISS') stamp`)).rows[0];

  await c.query('begin isolation level repeatable read read only');
  try {
    await c.query(`set local time zone 'UTC'`);

    const tables: string[] = (await c.query(
      `select cl.relname from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
        where n.nspname = 'public' and cl.relkind = 'r' order by 1`)).rows.map((r) => r.relname);

    const manifest: BackupManifest = {
      version: 1,
      taken_at: info.t,
      database: info.d,
      engine: String(info.v).split(' on ')[0],
      migrations: readdirSync(path.join(process.cwd(), 'db', 'migrations'))
        .filter((f) => f.endsWith('.sql')).sort(),
      tables: {},
      sequences: {},
      total_rows: 0,
    };

    /* 되살린 뒤 다음 번호가 이어지도록 시퀀스 현재값도 적는다 */
    for (const s of (await c.query(
      `select cl.relname tbl, a.attname col,
              pg_get_serial_sequence('public.' || cl.relname, a.attname) seq
         from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
         join pg_attribute a on a.attrelid = cl.oid and a.attnum > 0 and not a.attisdropped
        where n.nspname = 'public' and cl.relkind = 'r'
          and pg_get_serial_sequence('public.' || cl.relname, a.attname) is not null`)).rows) {
      manifest.sequences[`${s.tbl}.${s.col}`] = {
        seq: s.seq,
        last: String((await c.query(`select last_value from ${s.seq}`)).rows[0].last_value),
      };
    }

    /* 표마다 한 줄에 한 행. 앞에 어느 표인지 적는 머리줄을 둔다 */
    const body: string[] = [];
    for (const t of tables) {
      const rows = (await c.query(
        `select to_jsonb(x)::text as j from public.${t} x order by j`)).rows;
      const h = createHash('sha256');
      for (const r of rows) h.update(r.j).update('\n');
      manifest.tables[t] = { rows: rows.length, sha256: h.digest('hex') };
      body.push(`#table ${t} ${rows.length}`);
      for (const r of rows) body.push(r.j);
    }
    manifest.total_rows = Object.values(manifest.tables).reduce((a, x) => a + x.rows, 0);

    await c.query('commit');

    /*
     * 목록을 파일 안에 넣는다.
     *
     * CLI 는 `.manifest.json` 을 옆에 따로 쓴다. 브라우저로 두 파일을 내려받게
     * 하면 둘이 갈라져 보관될 수 있고, 목록 없는 백업은 대조할 수 없어 반쪽이
     * 된다. 한 파일에 담으면 갈라질 수가 없다.
     *
     * 복구 훈련은 옆에 놓인 목록 파일이 있으면 그것을, 없으면 이 줄을 읽는다.
     */
    /* 목록에 서명한다. 줄은 목록의 해시가 지키므로 목록만 서명하면 된다 */
    manifest.sig = signManifest(manifest as unknown as Record<string, unknown>);

    const text = `#manifest ${JSON.stringify(manifest)}\n${body.join('\n')}\n`;
    const gz = gzipSync(Buffer.from(text, 'utf8'), { level: 9 });

    return {
      fileName: `dhr-${info.stamp}.ndjson.gz`,
      gz,
      manifest,
      sha256: createHash('sha256').update(gz).digest('hex'),
    };
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  }
}
