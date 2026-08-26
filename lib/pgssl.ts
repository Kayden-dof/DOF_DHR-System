import { existsSync, readFileSync } from 'node:fs';
import { SUPABASE_ROOT_CA } from './supabase-ca';

/* ---------------------------------------------------------------------------
   원격 DB TLS 설정

   Supabase의 pooler 인증서는 자체 CA(Supabase Root 2021 CA)로 서명돼 있어
   Node의 기본 신뢰 저장소로는 검증되지 않는다. 검증을 끄는 대신 CA를 준다.

   찾는 순서
     1) PGSSLROOTCERT 가 가리키는 파일 (다른 호스팅으로 옮길 때의 탈출구)
     2) 번들에 박힌 Supabase 루트 CA
   PGSSL_NO_VERIFY=1 은 검증을 끈다. 진단용이며 운영에 쓰지 말 것.
--------------------------------------------------------------------------- */

export function pgSsl(connectionString: string) {
  if (/@(localhost|127\.0\.0\.1)/.test(connectionString)) return undefined;

  if (process.env.PGSSL_NO_VERIFY === '1') return { rejectUnauthorized: false };

  const override = process.env.PGSSLROOTCERT;
  if (override && existsSync(override)) {
    return { ca: readFileSync(override, 'utf8'), rejectUnauthorized: true };
  }
  return { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true };
}
