// db/supabase-ca.crt 를 lib/supabase-ca.ts 로 옮긴다.
//   node scripts/ca-sync.mjs
// 서버리스 번들은 Next의 파일 추적에 잡힌 파일만 싣는다. 런타임에 경로를
// 계산해 읽는 인증서는 함수에 딸려가지 않아 TLS 검증이 실패한다. 모듈로 두면
// 번들에 반드시 포함된다.
import { readFileSync, writeFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pem = readFileSync(path.join(ROOT, 'db', 'supabase-ca.crt'), 'utf8').trim() + '\n';
const x = new X509Certificate(pem);

const header = [
  '// 이 파일은 db/supabase-ca.crt 에서 생성한다: node scripts/ca-sync.mjs',
  '// 손으로 고치지 말 것.',
  '//',
  '//   ' + x.subject.split('\n').pop(),
  '//   SHA256 ' + x.fingerprint256,
  '//   유효   ' + x.validFrom + ' ~ ' + x.validTo,
  '//',
  '// 파일이 아니라 모듈인 이유: 서버리스 번들은 Next의 파일 추적에 잡힌 파일만',
  '// 싣는다. 런타임에 경로를 계산해 읽는 인증서는 추적되지 않아 함수에',
  '// 딸려가지 않고, 그러면 TLS 검증이 조용히 실패한다.',
  '',
  'export const SUPABASE_ROOT_CA = ' + JSON.stringify(pem) + ';',
  '',
].join('\n');

writeFileSync(path.join(ROOT, 'lib', 'supabase-ca.ts'), header, 'utf8');
console.log('lib/supabase-ca.ts 생성 · ' + x.subject.split('\n').pop() + ' · ' + pem.length + 'B');
