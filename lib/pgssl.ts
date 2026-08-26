import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/* ---------------------------------------------------------------------------
   원격 DB TLS 설정

   Supabase의 pooler 인증서는 자체 CA(Supabase Root 2021 CA)로 서명돼 있어
   Node의 기본 신뢰 저장소로는 검증되지 않는다. 검증을 끄는 대신 CA를 준다.

   찾는 순서
     1) PGSSLROOTCERT 환경변수가 가리키는 파일
     2) db/supabase-ca.crt  (저장소에 포함 — Vercel에서도 그대로 동작한다)
     3) 없으면 시스템 신뢰 저장소 (자체 CA가 아닌 DB용)

   PGSSL_NO_VERIFY=1 은 검증을 끈다. 진단용이며 운영에 쓰지 말 것.
--------------------------------------------------------------------------- */

const DEFAULT_CA = ['db', 'supabase-ca.crt'];

export function pgSsl(connectionString: string, root = process.cwd()) {
  if (/@(localhost|127\.0\.0\.1)/.test(connectionString)) return undefined;

  if (process.env.PGSSL_NO_VERIFY === '1') {
    return { rejectUnauthorized: false };
  }

  const candidates = [
    process.env.PGSSLROOTCERT,
    path.join(root, ...DEFAULT_CA),
  ].filter((p): p is string => !!p);

  for (const p of candidates) {
    if (existsSync(p)) {
      return { ca: readFileSync(p, 'utf8'), rejectUnauthorized: true };
    }
  }
  return { rejectUnauthorized: true };
}
