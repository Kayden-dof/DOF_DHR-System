// lib/pgssl.ts 와 같은 규칙. 스크립트는 TS를 거치지 않으므로 옮겨 둔다.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function pgSsl(connectionString, root) {
  if (/@(localhost|127\.0\.0\.1)/.test(connectionString)) return undefined;
  if (process.env.PGSSL_NO_VERIFY === '1') return { rejectUnauthorized: false };

  for (const p of [process.env.PGSSLROOTCERT, path.join(root, 'db', 'supabase-ca.crt')]) {
    if (p && existsSync(p)) return { ca: readFileSync(p, 'utf8'), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: true };
}
