import { NextResponse } from 'next/server';
import { withActor, rawClient } from '@/lib/db';
import { buildBackup } from '@/lib/backup';
import { lock } from '@/lib/backup-lock';
import { storeMissing, storeConfig, putBackup } from '@/lib/backup-store';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   일 1회 배치 (§6)

   사양 §6이 "일 1회 배치로 자재는 EXPIRED"라고 정한다. 함수는 있었지만 재고
   화면의 단추로만 돌았고, 아무도 누르지 않으면 기한이 지난 자재가 계속 사용
   가능으로 남았다.

   판정이 아니다. 날짜를 지난 것에 지났다고 표시하는 것뿐이다. 그래서 자동으로
   돌아도 §2의 차단 다섯 개와 무관하다.

   실행자는 사람이 아니므로 app.user_id 를 비워 둔다. 감사추적에는 수행자가
   빈 채로 남는데, 그것이 사실이다. 사람이 한 일처럼 꾸미지 않는다.

   Vercel 예약 작업이 부른다 (vercel.json). 바깥에서 아무나 부르지 못하게
   CRON_SECRET 을 확인한다.
--------------------------------------------------------------------------- */

export async function GET(req: Request) {
  /*
   * 열쇠가 없으면 아예 닫는다 (4차 감사 D5).
   *
   * 전에는 `if (secret)` 이라 CRON_SECRET 을 안 세우면 인증 없이 열렸다.
   * 개발노트가 그것을 "선택" 이라 적어 배포 점검에서 빠졌다.
   *
   * 실제 노출은 "멱등한 유지보수를 몇 시간 일찍 돌릴 수 있다" 에 그치지만,
   * 열쇠를 빠뜨린 것이 조용히 열린 문이 되어서는 안 된다. 빠뜨리면 닫힌다.
   */
  const secret = process.env.CRON_SECRET;
  let trusted = false;
  if (secret) {
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    trusted = true;
  } else {
    /*
     * 열쇠가 없으면 이 문은 인증 없이 열린다.
     *
     * 닫아 버리면 유효기한 만료 표시가 멈춘다 - 그쪽이 더 나쁘다. 대신
     * **조용히 열려 있지 않게** 한다. 서버 로그에 남기고, 설정 > 개요가
     * 그 상태를 화면에 적는다 (PRINT_SECRET 을 다루는 방식과 같다).
     *
     * 실제 노출은 "멱등한 유지보수를 몇 시간 일찍 돌릴 수 있다" 에 그친다.
     * 문제는 크기가 아니라 개발노트가 그것을 "선택" 이라 적어 배포 점검에서
     * 빠졌다는 것이다 (4차 감사 D5).
     */
    console.warn('[daily] CRON_SECRET 이 없어 인증 없이 열려 있습니다');
  }

  try {
    const out = await withActor(null, async (db) => ({
      expired: await db.val<number>(`select expire_material_lots()`),
      swept: await db.val<number>(`select login_attempt_sweep()`),
    }));

    /*
     * 백업은 유지보수 뒤에 뜬다 (5차 감사 C3).
     *
     * 순서가 중요하다 - 백업이 오래 걸려 함수가 끊기면 앞의 것까지 함께
     * 죽는다. 유효기한 표시가 멈추는 쪽이 더 나쁘므로 그것을 먼저 끝낸다.
     * 그리고 백업 실패가 이 응답을 실패로 만들지 않는다.
     */
    /*
     * 백업은 **믿을 수 있는 부름일 때만** 뜬다 (5차 감사 C3).
     *
     * 열쇠가 없으면 이 문은 인증 없이 열려 있다 (위 참고). 유지보수는 멱등해서
     * 몇 번을 불러도 같지만, 백업은 DB 를 통째로 읽고 파일을 올린다. 바깥에서
     * 아무나 되풀이해 부를 수 있는 자리에 그것을 두지 않는다.
     *
     * 열쇠를 세우면 그날부터 뜬다. 안 세우면 왜 안 뜨는지 그대로 적힌다 -
     * 조용히 안 하는 것과 못 하는 것을 가려야 한다.
     */
    const backup = trusted
      ? await dailyBackup()
      : { done: false, why: 'CRON_SECRET 이 없어 백업은 뜨지 않습니다' };
    console.log('[daily]', JSON.stringify({ ...out, backup }));
    return NextResponse.json({ ok: true, ...out, backup });
  } catch (e) {
    console.error('[daily] 실패', e);
    return NextResponse.json(
      { error: (e as Error).message ?? 'failed' }, { status: 500 });
  }
}

/* ---------------------------------------------------------------------------
   하루 한 번 백업을 떠서 보관소에 둔다 (5차 감사 C3)

   전에는 자동으로 도는 것이 사람 PC 의 작업 스케줄러뿐이었다. 그 PC 가 꺼져
   있으면 백업이 없었다.

   ── 설정이 없으면 아무것도 하지 않는다 ────────────────────────────────
   보관소 주소 · 열쇠 · 파일 암호 셋이 다 있어야 돈다. 없으면 **그 사실을
   그대로 돌려준다.** 조용히 넘어가면 "백업이 돌고 있다" 고 믿게 된다.
   설정 화면이 이 상태를 읽어 적는다.

   ── 실패가 이 문을 죽이지 않는다 ──────────────────────────────────────
   보관소가 거부하거나 시간이 모자라도 유효기한 표시까지 함께 죽으면 안 된다.
   여기서 잡아 이유만 남긴다.

   ── 사람이 뜬 것처럼 적지 않는다 ──────────────────────────────────────
   `taken_by` 를 비우고 `source = 'AUTO'` 로 남긴다 (0092).
--------------------------------------------------------------------------- */
async function dailyBackup() {
  const missing = storeMissing();
  if (missing) return { done: false, why: `설정 없음 (${missing})` };

  const cfg = storeConfig()!;
  const started = Date.now();
  const c = await rawClient();
  try {
    const out = await buildBackup(c);
    const sealed = await lock(out.gz, cfg.passphrase);
    const at = await putBackup(cfg, out.fileName, sealed);

    await c.query(
      `insert into backup_log (taken_by, file_name, byte_size, total_rows,
                               table_count, data_sha256, migration_count,
                               locked, source, stored_at)
       values (null, $1, $2, $3, $4, $5, $6, true, 'AUTO', $7)`,
      [out.fileName, sealed.byteLength, out.manifest.total_rows,
       Object.keys(out.manifest.tables).length, out.sha256,
       out.manifest.migrations.length, at]);

    return {
      done: true, at, rows: out.manifest.total_rows,
      bytes: sealed.byteLength, ms: Date.now() - started,
    };
  } catch (e) {
    console.error('[daily] 백업 실패', e);
    return { done: false, why: (e as Error).message ?? '알 수 없는 실패' };
  } finally {
    c.release();
  }
}
