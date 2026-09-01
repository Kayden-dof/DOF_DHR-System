import { NextResponse } from 'next/server';
import { requireUser, hasRole, reauth } from '@/lib/session';
import { lock, PASSPHRASE_MIN, LockError } from '@/lib/backup-lock';
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

/* ---------------------------------------------------------------------------
   POST 로 받는다 (사용자 요청 2026-09-01)

   전에는 주소를 열면 파일이 내려왔다. 로그인한 채로 자리를 비운 사이 누가
   주소만 알면 이 회사의 기록 전부를 가져갈 수 있었다는 뜻이다.

   이제 두 가지를 함께 받는다.

     본인 비밀번호   지금 이 자리에 앉은 사람이 그 계정 본인인가
     파일 암호       내려받는 파일 자체를 잠글 열쇠

   앞의 것은 "누가 눌렀나" 를 다시 묻는 것이고 (로그인만으로는 자리를 비운
   사이를 답하지 못한다), 뒤의 것은 파일이 밖으로 나갔을 때를 대비하는 것이다.
   둘은 다른 물음이므로 다른 값이다.
--------------------------------------------------------------------------- */

export async function POST(req: Request) {
  const me = await requireUser();
  if (!hasRole(me, 'SYS_ADMIN')) {
    return NextResponse.json({ error: '시스템관리자만 백업을 뜰 수 있습니다' }, { status: 403 });
  }

  const form = await req.formData();
  const pin = String(form.get('pin') ?? '');
  const passphrase = String(form.get('passphrase') ?? '');

  const who = await reauth(me, pin);
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: 401 });
  if (passphrase.length < PASSPHRASE_MIN) {
    return NextResponse.json(
      { error: `파일 암호는 ${PASSPHRASE_MIN}자 이상이어야 합니다` }, { status: 400 });
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

  /* 파일을 잠근다. 이 뒤로 이 서버는 그 암호를 갖고 있지 않다 */
  let sealed: Buffer;
  try {
    sealed = await lock(out.gz, passphrase);
  } catch (e) {
    if (e instanceof LockError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  const fileName = out.fileName.replace(/\.ndjson\.gz$/, '.dhrbak');

  /* 뜬 사실을 남긴다. 이건 평소 경로로 - 감사추적에도 함께 올라간다 */
  await withActor(me.id, (db) => db.rows(
    `insert into backup_log (taken_by, file_name, byte_size, total_rows,
                             table_count, data_sha256, migration_count, locked)
     values ($1, $2, $3, $4, $5, $6, $7, true)`,
    [me.id, fileName, sealed.byteLength, out.manifest.total_rows,
     Object.keys(out.manifest.tables).length, out.sha256,
     out.manifest.migrations.length]),
    { reason: '백업 내려받기' });

  return new NextResponse(new Uint8Array(sealed), {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(sealed.byteLength),
      'content-disposition': `attachment; filename="${fileName}"`,
      /* 중간에 어디도 이 파일을 들고 있지 않게 한다 */
      'cache-control': 'no-store, no-cache, must-revalidate',
    },
  });
}
