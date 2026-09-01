import { NextResponse } from 'next/server';
import { requireUser, hasRole } from '@/lib/session';
import { rawClient, withActor } from '@/lib/db';
import { buildBackup } from '@/lib/backup';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   백업 내려받기 (사용자 요청 2026-09-01)

   시스템관리자가 눌러 파일을 받는다. 서버에 사본을 두지 않는다 - 받은 사람이
   사내 규정대로 보관한다. 사본을 남기지 않으면 밖으로 나가는 길이 하나로
   줄고, 새 저장소 접속 열쇠도 필요 없다 (사용자 선택).

   ── 이 한 번이 무엇인가 ────────────────────────────────────────────────────
   이 회사의 제조기록 전부가 한 파일로 나간다. 그래서 시스템관리자만이고,
   나간 사실이 대장에 남는다 (`backup_log` · 0078). 파일 자체는 담지 않는다 -
   대장은 일어난 사실을 적는 자리이지 내용을 보관하는 자리가 아니다 (§2.2).
--------------------------------------------------------------------------- */

export async function GET() {
  const me = await requireUser();
  if (!hasRole(me, 'SYS_ADMIN')) {
    return NextResponse.json({ error: '시스템관리자만 백업을 뜰 수 있습니다' }, { status: 403 });
  }

  const c = await rawClient();
  let out;
  try {
    /*
     * 역할을 걸지 않는다.
     *
     * 지금은 app_role 도 전 표를 읽지만, 앞으로 읽기 권한이 촘촘해지면 빠지는
     * 표가 생길 수 있다. 빠진 표는 조용히 빠지고 복구 때에야 드러난다 -
     * 백업은 그 성질상 "전부" 여야 하므로 소유자로 읽는다.
     *
     * 읽기 전용 트랜잭션이라 이 경로로는 아무것도 쓰지 못한다
     * (`begin isolation level repeatable read read only`).
     */
    out = await buildBackup(c);
  } finally {
    c.release();
  }

  /* 뜬 사실을 남긴다. 이건 평소 경로로 - 감사추적에도 함께 올라간다 */
  await withActor(me.id, (db) => db.rows(
    `insert into backup_log (taken_by, file_name, byte_size, total_rows,
                             table_count, data_sha256, migration_count)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [me.id, out.fileName, out.gz.byteLength, out.manifest.total_rows,
     Object.keys(out.manifest.tables).length, out.sha256,
     out.manifest.migrations.length]),
    { reason: '백업 내려받기' });

  return new NextResponse(new Uint8Array(out.gz), {
    headers: {
      'content-type': 'application/gzip',
      'content-length': String(out.gz.byteLength),
      'content-disposition': `attachment; filename="${out.fileName}"`,
      /* 중간에 어디도 이 파일을 들고 있지 않게 한다 */
      'cache-control': 'no-store, no-cache, must-revalidate',
    },
  });
}
