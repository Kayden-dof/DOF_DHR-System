/* ---------------------------------------------------------------------------
   백업 파일을 서버 바깥의 보관소에 둔다 (5차 감사 C3)

   자동 백업의 유일한 경로가 누군가의 PC 에 걸린 작업 스케줄러였다. 그 PC 가
   꺼져 있으면 백업이 없다. 예약 작업이 떠서 보관소에 올리면 사람과 무관해진다.

   ── 어디에 두는가 ──────────────────────────────────────────────────────
   Supabase Storage. 자료가 이미 그 회사의 DB 에 있으므로 **새로 나가는 곳이
   아니다.** 다른 곳에 두면 그때 §2.2 를 다시 물어야 한다.

   SDK 를 붙이지 않는다. Storage 는 평범한 REST 라 `fetch` 하나면 된다.
   의존성 하나가 늘면 그것도 검증 범위에 들어온다.

   ── 잠가서 올린다 ──────────────────────────────────────────────────────
   파일은 화면에서 내려받는 것과 같은 방식으로 잠근다 (`lib/backup-lock`).
   그래서 **보관소에서 파일을 가져가도 열지 못하고**, 되살릴 때는 화면의 복구
   자리에 그 암호를 적으면 된다 - 형식이 하나라 갈라질 데가 없다.

   암호는 `BACKUP_PASSPHRASE` 로 온다. 이 값이 없으면 아무것도 올리지 않는다.
   잠그지 않은 백업을 대신 올리는 길은 만들지 않는다 (§10 예외 경로 금지).

   ── 안 되어 있으면 조용히 넘어가지 않는다 ──────────────────────────────
   설정이 없으면 그 사실을 그대로 돌려준다. 부르는 쪽이 `backup_log` 와 화면에
   적는다. "안 했다" 와 "못 했다" 를 가리지 못하면 아무도 알아채지 못한다.
--------------------------------------------------------------------------- */

export interface StoreConfig {
  url: string;
  key: string;
  bucket: string;
  passphrase: string;
}

/** 왜 못 올리는가. 갖춰졌으면 null */
export function storeMissing(): string | null {
  const miss: string[] = [];
  if (!process.env.SUPABASE_URL) miss.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_KEY) miss.push('SUPABASE_SERVICE_KEY');
  if (!process.env.BACKUP_PASSPHRASE) miss.push('BACKUP_PASSPHRASE');
  return miss.length ? miss.join(' · ') : null;
}

export function storeConfig(): StoreConfig | null {
  if (storeMissing()) return null;
  return {
    url: String(process.env.SUPABASE_URL).replace(/\/+$/, ''),
    key: String(process.env.SUPABASE_SERVICE_KEY),
    bucket: process.env.BACKUP_BUCKET || 'dhr-backup',
    passphrase: String(process.env.BACKUP_PASSPHRASE),
  };
}

/**
 * 파일 하나를 올린다. 둔 자리(버킷/이름)를 돌려준다.
 *
 * 같은 이름이 있으면 덮지 않는다 - 백업 파일 이름에 시각이 들어 있으므로
 * 같은 이름이 온다는 것은 무언가 잘못된 것이고, 덮으면 그 사실이 사라진다.
 */
export async function putBackup(
  cfg: StoreConfig, fileName: string, body: Buffer,
): Promise<string> {
  const path = `${new Date().getUTCFullYear()}/${fileName}`;
  const r = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cfg.key}`,
      'content-type': 'application/octet-stream',
      'cache-control': 'no-store',
      /* 덮어쓰기를 켜지 않는다. 있으면 409 로 돌아온다 */
      'x-upsert': 'false',
    },
    body: new Uint8Array(body),
  });

  if (!r.ok) {
    const detail = (await r.text()).slice(0, 300);
    throw new Error(`보관소가 거부했습니다 (${r.status}) ${detail}`);
  }
  return `${cfg.bucket}/${path}`;
}
