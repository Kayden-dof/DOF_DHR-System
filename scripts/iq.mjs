/* ---------------------------------------------------------------------------
   설치 적격성 확인 (IQ)

     node --env-file=.env.deploy scripts/iq.mjs        운영
     node --env-file=.env.local  scripts/iq.mjs        로컬

   ── 왜 필요한가 ───────────────────────────────────────────────────────────
   §8.0 이 이렇게 적어 두었다. "IQ 와 PQ 는 아직 문서로 정의되어 있지 않다.
   OQ 만으로 검증을 마쳤다고 하지 않는다."

   OQ 는 "규칙이 작동하는가" 를 묻는다. IQ 는 그 앞의 질문이다 — 지금 이 서버에
   무엇이 깔려 있는가. 엔진이 무엇이고, 확장이 무엇이고, 이관이 몇 개 올라갔고,
   권한이 어떻게 서 있는가. OQ 가 통과했다는 말은 "그때 그 서버에서" 라는 단서를
   달고 있고, 그 단서를 적는 것이 IQ 다.

   ── 이 보고서는 판정하지 않는다 ───────────────────────────────────────────
   적합·부적합을 쓰지 않는다 (§1). 조회한 사실과 기대값을 나란히 적고, 다른
   자리를 눈에 띄게 표시한다. 다르다는 것이 곧 틀렸다는 뜻은 아니다 — 이관
   중이거나 아직 등록 전일 수 있다. 판단은 보는 사람이 한다.

   ── 실무 착수 때 ──────────────────────────────────────────────────────────
   DB 를 새로 올린 직후 한 번 돌려 보고서를 남긴다. 그 보고서가 "이 날 이
   서버는 이런 상태였다" 의 근거가 된다. 그 뒤 OQ 를 같은 서버에 대고 돌리면
   두 보고서가 짝을 이룬다.
--------------------------------------------------------------------------- */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NAME_SQL, group } from './schema-names.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { pgSsl } from './pgssl.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error(
    'DATABASE_URL 이 없습니다.\n' +
    '  node --env-file=.env.deploy scripts/iq.mjs');
  process.exit(2);
}

const out = [];
const say = (l = '') => { out.push(l); console.log(l); };
const RULE = '='.repeat(96);
const THIN = '-'.repeat(96);

const pad = (s, n) => {
  /* 한글은 두 칸을 먹는다. 글자 수로 맞추면 표가 어긋난다 */
  const w = [...String(s)].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2000 ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(1, n - w));
};

const client = new pg.Client({ connectionString: url, ssl: pgSsl(url, ROOT) });
await client.connect();
const q = (sql, p = []) => client.query(sql, p).then((r) => r.rows);

/* --- 머리 ------------------------------------------------------------------ */
const [head] = await q(
  `select version() as v, current_database() as db, current_user as who,
          current_setting('TimeZone') as tz,
          to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD HH24:MI:SS') as now`);

say(RULE);
say(' DOF DHR 지원 시스템 - 설치 적격성 확인 (IQ)');
say(' 근거      : CLAUDE.md §8.0  "엔진 버전 · 확장 · 이관 적용 순서 · 권한 부여 상태를 조회로 증명"');
say(` 실행 일시 : ${head.now} (Asia/Seoul)`);
say(` 대상 DB   : ${url.replace(/\/\/[^@]*@/, '//***@')}`);
say(` 접속 계정 : ${head.who} @ ${head.db}`);
say(` 엔진      : ${head.v.split(' on ')[0]}`);
say(` 서버 시간대: ${head.tz}`);
say(RULE);

const findings = [];
const check = (id, what, expect, actual, ok) => {
  say(` ${pad(id, 8)}${pad(what, 46)}${pad(expect, 20)}${pad(actual, 18)}${ok ? '일치' : '다름'}`);
  if (!ok) findings.push(`${id}  ${what} — 기대 ${expect}, 실제 ${actual}`);
};

/* --- 1. 확장 --------------------------------------------------------------- */
say('');
say('[1] 확장');
say(THIN);
const ext = await q(`select extname, extversion from pg_extension order by extname`);
for (const e of ext) say(`  ${pad(e.extname, 24)}${e.extversion}`);
say('');
check('IQ-01', 'gen_random_uuid() 사용 가능', '가능',
  (await q(`select gen_random_uuid() is not null as ok`))[0].ok ? '가능' : '불가',
  (await q(`select gen_random_uuid() is not null as ok`))[0].ok);

/* --- 2. 이관 --------------------------------------------------------------- */
say('');
say('[2] 이관 파일');
say(THIN);
const mdir = path.join(ROOT, 'db', 'migrations');
const files = readdirSync(mdir).filter((f) => f.endsWith('.sql')).sort();
const all = createHash('sha256');
for (const f of files) {
  const body = readFileSync(path.join(mdir, f));
  all.update(body);
}
say(`  파일 ${files.length}개   ${files[0]}  ~  ${files[files.length - 1]}`);
say(`  묶음 지문 (sha256)   ${all.digest('hex')}`);
say('');
say('  * 적용 이력을 담는 표를 두지 않는다. 이관은 매 배포마다 순서대로 다시 돌며,');
say('    같은 것을 두 번 돌려도 결과가 같게 쓰여 있다. 그래서 "무엇이 돌았는가" 대신');
say('    "무엇이 만들어졌는가" 를 아래에서 조회로 확인한다.');

/* --- 3. 스키마 결과 --------------------------------------------------------- */
say('');
say('[3] 만들어진 것');
say(THIN);
say(` ${pad('ID', 8)}${pad('항목', 46)}${pad('기대', 20)}${pad('실제', 18)}판정`);
const [n] = await q(`
  select (select count(*)::int from pg_tables where schemaname='public')                as tables,
         (select count(*)::int from pg_views  where schemaname='public')                as views,
         (select count(*)::int from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
           where ns.nspname='public')                                                   as funcs,
         (select count(*)::int from pg_type t join pg_namespace ns on ns.oid=t.typnamespace
           where ns.nspname='public' and t.typtype='e')                                 as enums,
         (select count(*)::int from pg_trigger tg join pg_class c on c.oid=tg.tgrelid
            join pg_namespace ns on ns.oid=c.relnamespace
           where ns.nspname='public' and not tg.tgisinternal)                            as triggers`);
/* ---------------------------------------------------------------------------
   숫자 하한이 아니라 이름으로 견준다 (4차 감사 A6)

   전에는 "표 35 이상" "트리거 1 이상" "함수 1 이상" 이었다. 표가 42인 지금
   이관 하나가 통째로 빠져도 전건 통과다. 드리프트를 재라고 둔 자리가 아무것도
   못 보고 있었다.

   db/schema-baseline.json 에 적힌 이름과 견준다. **빠진 이름이 곧 빠진
   이관이다.** 늘어난 것은 참고로만 적는다 - 운영과 로컬의 확장이 달라
   숫자로는 맞출 수 없지만, 이름으로는 우리 것만 골라낼 수 있다.

   이관이 정당하게 늘면 이 파일을 함께 고친다. 그것이 검토에 남는다.
--------------------------------------------------------------------------- */
const nameRows = await q(NAME_SQL);
const have = group(nameRows);
const want = JSON.parse(readFileSync(path.join(ROOT, 'db', 'schema-baseline.json'), 'utf8'));

const KIND_LABEL = { table: '표', view: '뷰', enum: '열거형', function: '함수', trigger: '트리거' };
let idn = 1;
for (const kind of ['table', 'view', 'enum', 'function', 'trigger']) {
  const w = new Set(want[kind] ?? []);
  const h = new Set(have[kind] ?? []);
  const gone = [...w].filter((x) => !h.has(x));
  const extra = [...h].filter((x) => !w.has(x));
  idn += 1;
  check(`IQ-0${idn}`, KIND_LABEL[kind],
        `${w.size}개 전부`,
        gone.length ? `${h.size}개 · 빠짐 ${gone.slice(0, 4).join(', ')}${gone.length > 4 ? ' 외' : ''}`
                    : `${h.size}개`,
        gone.length === 0);
  if (extra.length) {
    say(`          늘어난 것 ${extra.length}개: ${extra.slice(0, 6).join(', ')}${extra.length > 6 ? ' 외' : ''}`);
  }
}

/* --- 4. 다섯 규칙이 DB 에 서 있는가 ----------------------------------------- */
say('');
say('[4] 절대 규칙 (S01 ~ S05) 의 실물');
say(THIN);
say(` ${pad('ID', 8)}${pad('항목', 46)}${pad('기대', 20)}${pad('실제', 18)}판정`);

const notNull = async (tbl, col) => (await q(
  `select attnotnull from pg_attribute
    where attrelid = to_regclass($1) and attname = $2 and attnum > 0`, [tbl, col]))[0]?.attnotnull;

check('IQ-07', 'S01 material_issue.material_lot_id NOT NULL', 'NOT NULL',
  await notNull('material_issue', 'material_lot_id') ? 'NOT NULL' : '허용',
  await notNull('material_issue', 'material_lot_id') === true);
check('IQ-08', 'S02 material_lot.coa_no NOT NULL', 'NOT NULL',
  await notNull('material_lot', 'coa_no') ? 'NOT NULL' : '허용',
  await notNull('material_lot', 'coa_no') === true);

/*
 * §5 가 이름을 적어 둔 표들이다. 기록과 기준정보가 여기 들어 있다.
 *
 * "DELETE 권한이 하나도 없어야 한다" 로 넓게 보면 안 된다. user_role 은 역할을
 * 거두는 자리라 지울 수 있어야 하고, 그것은 기록이 아니다. 넓게 잡은 검사는
 * 정상 상태를 계속 짚어 대고, 그러면 보는 사람이 보고서를 안 믿게 된다.
 */
const S03_TABLES = [
  'item', 'supplier', 'item_supplier', 'price_history', 'shelf_life_history',
  'device_master', 'dmr_operation', 'dmr_bom', 'dmr_bom_tier',
  'purchase_order', 'material_lot', 'material_issue', 'stock_movement',
  'work_order', 'product_lot', 'process_record',
  'steril_batch', 'steril_batch_lot', 'shipment',
  'record_print', 'day_lock', 'audit_log',
];
const delGrants = await q(
  `select table_name from information_schema.role_table_grants
    where table_schema='public' and privilege_type='DELETE' and grantee='app_role'
      and table_name = any($1) order by table_name`, [S03_TABLES]);
check('IQ-09', `S03 기록 ${S03_TABLES.length}개 표의 DELETE 권한`, '0개',
  `${delGrants.length}개`, delGrants.length === 0);
if (delGrants.length) say(`          └─ ${delGrants.map((r) => r.table_name).join(', ')}`);

const s04 = await q(
  `select tgname from pg_trigger where tgname in ('process_record_s04','material_issue_s04')`);
check('IQ-10', 'S04 잠금 트리거', '2개', `${s04.length}개`, s04.length === 2);
check('IQ-11', 'S05 complete_process() 존재', '있음',
  (await q(`select to_regprocedure('public.complete_process(uuid)') is not null as ok`))[0].ok
    ? '있음' : '없음',
  (await q(`select to_regprocedure('public.complete_process(uuid)') is not null as ok`))[0].ok);

/* --- 5. 권한 --------------------------------------------------------------- */
say('');
say('[5] 권한');
say(THIN);
say(` ${pad('ID', 8)}${pad('항목', 46)}${pad('기대', 20)}${pad('실제', 18)}판정`);

const roles = await q(
  `select rolname from pg_roles where rolname in ('app_role','app_readonly') order by rolname`);
check('IQ-12', '역할 app_role · app_readonly', '2개', `${roles.length}개`, roles.length === 2);

/*
 * Supabase 는 anon / authenticated / service_role 에 public 스키마를 통째로
 * 열어 두는 기본값이 있다. 그 상태면 API 열쇠 하나로 표가 그대로 읽힌다.
 * 로컬 시험이 잡지 못하는 자리라 여기서 본다.
 */
const apiGrants = await q(
  `select distinct grantee from information_schema.role_table_grants
    where table_schema='public' and grantee in ('anon','authenticated','service_role')`);
check('IQ-13', 'API 역할의 표 권한', '0개', `${apiGrants.length}개`, apiGrants.length === 0);
if (apiGrants.length) say(`          └─ ${apiGrants.map((r) => r.grantee).join(', ')}`);

const WRITE_FUNCS = [
  'print_day_record(uuid, int, uuid, text, int)',
  'retrieve_print(uuid, text)',
  'amend_material_issue(uuid, numeric, text)',
  'return_material_issue(uuid, numeric, text)',
  'cut_product_lot(uuid, uuid, int, int, date)',
  'complete_process(uuid)',
  'next_number(numbering_target, uuid)',
  'make_solution(uuid[], numeric[], text, text)',
  'purge_demo_data()',
];
const leaky = [];
for (const f of WRITE_FUNCS) {
  const [r] = await q(
    `select to_regprocedure($1) as oid,
            case when to_regprocedure($1) is null then null
                 else has_function_privilege('app_readonly', to_regprocedure($1)::oid, 'EXECUTE')
            end as ro,
            case when to_regprocedure($1) is null then null
                 else has_function_privilege('public', to_regprocedure($1)::oid, 'EXECUTE')
            end as pub`, [`public.${f}`]);
  if (r.oid && (r.ro || r.pub)) leaky.push(f.split('(')[0]);
}
check('IQ-14', '쓰기 함수를 열람 역할이 부를 수 있는가', '0개', `${leaky.length}개`, leaky.length === 0);
if (leaky.length) say(`          └─ ${leaky.join(', ')}`);

/*
 * security definer 함수가 search_path 를 고정하지 않으면, 부르는 쪽이 임시
 * 표를 만들어 그 함수가 보는 자료를 바꿔치기할 수 있다 (§10).
 */
const noPath = await q(
  `select p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname='public' and p.prosecdef
      and (p.proconfig is null or not exists (
            select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
    order by p.proname`);
/*
 * purge_demo_data 는 같은 상태이지만 손대지 않기로 확정되어 있다 (0062).
 * 이름을 적어 두고 그것 하나일 때만 넘어간다. 넘어가는 것과 안 보는 것은
 * 다르다 - 다른 함수가 하나라도 늘면 여기서 걸린다.
 */
const PATH_KNOWN = ['purge_demo_data'];
const pathNames = noPath.map((r) => r.proname);
const pathNew = pathNames.filter((n) => !PATH_KNOWN.includes(n));
check('IQ-15', 'search_path 를 안 박은 definer 함수', '아는 것뿐',
  pathNew.length ? `${pathNew.length}개 더` : '아는 것뿐', pathNew.length === 0);
if (pathNames.length) {
  say(`          └─ ${pathNames.join(', ')}`);
  say(`             (purge_demo_data 는 시연 자료 경로. 그대로 두기로 확정 · 0062)`);
}

/* --- 6. 운영 준비 상태 ------------------------------------------------------ */
say('');
say('[6] 운영 준비 상태');
say(THIN);
say(` ${pad('ID', 8)}${pad('항목', 46)}${pad('기대', 20)}${pad('실제', 18)}판정`);

const [ready] = await q(`
  select (select count(*)::int from numbering_rule where is_active)                 as rules,
         (select count(*)::int from device_master where verified_at is not null)    as dmr,
         (select count(*)::int from app_user where can_login and is_active)         as users,
         (select count(*)::int from app_user u
            join user_role r on r.user_id = u.id
           where r.role='SYS_ADMIN' and not u.is_developer)                          as admins,
         (select count(*)::int from demo_marker)                                     as demo,
         (select count(*)::int from work_order)                                      as batches`);
check('IQ-16', '활성 채번 규칙', '1 이상', String(ready.rules), ready.rules >= 1);
check('IQ-17', '서면 대조 확인된 제품표준서', '1 이상', String(ready.dmr), ready.dmr >= 1);
check('IQ-18', '로그인 가능한 계정', '1 이상', String(ready.users), ready.users >= 1);
/*
 * "시스템관리자가 없다" 가 아니라 "개발 계정 말고는 없다" 다.
 *
 * 첫 계정은 반드시 개발 계정으로 만들어진다 (deploy-db.mjs) - 비밀번호 초기화가
 * 개발 계정만 할 수 있는 일이라, 첫 계정이 개발 계정이 아니면 아무도 초기화를
 * 못 한다. 그래서 새로 올린 직후에는 늘 0 이다.
 *
 * 전 문구는 "개발 계정이 아닌 시스템관리자 0" 이었는데, 계정이 하나도 없다는
 * 뜻으로 읽혔다 (2026-08-31). 보고서가 읽는 사람을 헷갈리게 하면 보고서가 아니다.
 */
check('IQ-19', '운영용 시스템관리자 (개발 계정 제외)', '1 이상',
  String(ready.admins), ready.admins >= 1);
if (ready.admins === 0) {
  const dev = await q(
    `select u.login_code, u.full_name from app_user u join user_role r on r.user_id = u.id
      where r.role = 'SYS_ADMIN' and u.is_developer order by u.login_code`);
  say(`          └─ 지금 시스템관리자: ${
    dev.length ? dev.map((r) => `${r.login_code} ${r.full_name} (개발 계정)`).join(', ') : '없음'}`);
  say('             개발 계정 표시는 켤 수만 있고 끌 수 없다 (0052). 운영용 계정을');
  say('             새로 만들어야 하며, 기준정보는 그 계정으로 등록한다.');
}
check('IQ-20', '시연 자료 표식', '0개', `${ready.demo}개`, ready.demo === 0);

say('');
say(`  등록된 작업 지시 ${ready.batches}건`);
if (ready.demo > 0) {
  say('  * 시연 표식이 서 있습니다. 이 DB 에는 지어낸 배치 기록이 들어 있고,');
  say('    지금 상태의 보고서는 실무 착수 근거가 되지 않습니다.');
}

/* --- 맺음 ------------------------------------------------------------------ */
say('');
say(RULE);
if (findings.length === 0) {
  say(` 조회 20건. 기대와 다른 자리 없음.`);
} else {
  say(` 조회 20건. 기대와 다른 자리 ${findings.length}곳.`);
  say('');
  for (const f of findings) say(`   ${f}`);
}
say(RULE);
say('');
say(' 이 보고서가 답하지 않는 것');
say('   · 규칙이 실제로 막는가        →  test/run.mjs   (OQ · 같은 서버에 대고 한 번)');
say('   · 종이가 자료와 같은가        →  test/print.mjs (OQ §8.2)');
say('   · 배치 1건이 끝까지 흐르는가  →  사내문서/PQ 프로토콜.md');
say(RULE);

const dir = path.join(ROOT, 'reports');
mkdirSync(dir, { recursive: true });
const stamp = head.now.replace(/[-: ]/g, '').slice(0, 15);
const file = path.join(dir, `IQ-${stamp}.txt`);
writeFileSync(file, out.join('\n') + '\n', 'utf8');
console.log(`\n보고서: ${path.relative(ROOT, file)}`);

await client.end();
process.exit(findings.length ? 1 : 0);
