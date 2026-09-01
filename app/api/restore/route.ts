import { NextResponse } from 'next/server';
import { requireUser, hasRole } from '@/lib/session';
import { rawClient, withActor } from '@/lib/db';
import {
  parseBackup, verifyBackup, diffAgainstNow, applyRestore, BackupError,
} from '@/lib/restore';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/* ---------------------------------------------------------------------------
   백업 파일을 넣어 살펴보고, 되돌린다 (사용자 지시 2026-09-01)

   문이 둘이다.

     살펴보기  파일을 읽어 무엇이 들었는지 말한다. 아무것도 쓰지 않는다
     되돌리기  실제로 갈아 끼운다

   ── 되돌리기 앞에 두 개의 문턱 ────────────────────────────────────────────
   ① 직전 30분 안에 뜬 백업이 있어야 한다. 되돌릴 길 없이는 누를 수 없다
   ② 파일 이름을 그대로 타이핑해야 한다. 어느 파일인지 보게 만드는 장치다

   이 둘은 "예외 경로" 가 아니다 (§10). 건너뛰는 갈래가 없고, 플래그로 끌 수
   없다. 조건을 만족시키는 길은 실제로 백업을 뜨는 것 하나뿐이다.
--------------------------------------------------------------------------- */

/** 되돌리기 전에 이만큼 안에 뜬 백업이 있어야 한다 */
const FRESH_MINUTES = 30;

export async function POST(req: Request) {
  const me = await requireUser();
  if (!hasRole(me, 'SYS_ADMIN')) {
    return NextResponse.json({ error: '시스템관리자만 할 수 있습니다' }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get('file');
  const mode = String(form.get('mode') ?? 'inspect');
  const typed = String(form.get('confirm') ?? '').trim();

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: '백업 파일을 고르십시오' }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseBackup(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof BackupError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  const flaws = verifyBackup(parsed);

  /* 되돌릴 길이 있는가. 살펴보기에서도 미리 알려 준다 */
  const fresh = await withActor(me.id, (db) => db.one<{ n: number; mins: number }>(
    `select count(*)::int as n,
            coalesce(min(extract(epoch from (now() - taken_at)) / 60)::int, 999999) as mins
       from backup_log where taken_at > now() - interval '${FRESH_MINUTES} minutes'`),
    { readOnly: true, reason: '복구 전 백업 확인' });

  const hasFresh = (fresh?.n ?? 0) > 0;

  if (mode === 'inspect') {
    const c = await rawClient();
    try {
      const diff = await diffAgainstNow(c, parsed);
      return NextResponse.json({
        ok: true,
        fileName: file.name,
        byteSize: parsed.byteSize,
        sha256: parsed.sha256,
        takenAt: parsed.manifest.taken_at,
        database: parsed.manifest.database,
        engine: parsed.manifest.engine,
        migrations: parsed.manifest.migrations.length,
        totalRows: parsed.manifest.total_rows,
        flaws,
        diff,
        hasFresh,
        freshMinutes: FRESH_MINUTES,
      });
    } finally {
      c.release();
    }
  }

  /* --- 여기서부터는 실제로 갈아 끼운다 ----------------------------------- */

  if (flaws.length) {
    return NextResponse.json({
      error: '파일이 스스로와 맞지 않습니다. 상한 백업으로는 되돌리지 않습니다.',
    }, { status: 400 });
  }
  if (!hasFresh) {
    return NextResponse.json({
      error: `되돌리기 전에 지금 상태를 백업해 두어야 합니다 (${FRESH_MINUTES}분 안).`,
    }, { status: 400 });
  }
  if (typed !== file.name) {
    return NextResponse.json({
      error: '확인란에 파일 이름을 그대로 적어야 합니다.',
    }, { status: 400 });
  }

  const c = await rawClient();
  let out;
  try {
    out = await applyRestore(c, parsed);
  } catch (e) {
    c.release();
    return NextResponse.json({
      error: `되돌리지 못했습니다. 이 DB 는 손대기 전 그대로입니다. ${(e as Error).message}`,
    }, { status: 500 });
  }
  c.release();

  /*
   * 복구한 사실을 남긴다. 복구 뒤에 적는다 - 복구가 다른 표를 다 갈아 끼우므로
   * 미리 적으면 그 줄까지 사라진다. restore_log 만은 복구가 손대지 않는다.
   *
   * 사람을 FK 로 걸지 않는다. 지금 로그인한 계정이 그 백업 시점에는 없던
   * 계정일 수 있다.
   */
  await withActor(null, (db) => db.rows(
    `insert into restore_log (restored_by_name, restored_by_code, file_name, data_sha256,
                              backup_taken_at, rows_before, rows_after, table_count, elapsed_ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [me.full_name, me.login_code, file.name, parsed.sha256, parsed.manifest.taken_at,
     out.rowsBefore, out.rowsAfter, out.tables, out.ms]),
    { reason: '백업으로 되돌림' });

  return NextResponse.json({ ok: true, restored: true, ...out });
}
