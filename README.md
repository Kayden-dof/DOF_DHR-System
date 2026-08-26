# DOF DHR 지원 시스템 — M0

사용자 · 권한 · 감사추적 · 채번 규칙. `CLAUDE.md` §4.1, §4.10, §5(S03), §8 구현.

M1 이후 표(`item`, `material_lot`, `work_order`, `process_record` …)는 만들지 않았다.

---

## 구성

```
db/migrations/
  0001_app_role.sql      응용 접속 역할
  0002_audit.sql         audit_log · trg_audit · 삭제/TRUNCATE 차단 함수 · current_user_id
  0003_users.sql         role_code · app_user · user_role · has_role · 개발계정 QP 금지
  0004_numbering.sql     numbering_rule · numbering_counter · next_number · 규칙/카운터 불변성
  0005_grants.sql        app_role 권한 부여 및 회수 (S03)

test/
  run.mjs                OQ 시험 실행기 (55건)
  concurrency.mjs        동시 채번 · 규칙 교체 경합 시험 (6건, 실제 서버 필요)
  pg.mjs                 실제 PostgreSQL을 띄워 위 둘을 한 번에 돌린다
  harness.mjs            단언 · 역할 전환 · 픽스처
  cases/                 §4.1 / §5 S03 / §4.10 시험 정의

reports/                 실행 결과. 출력이 그대로 OQ 각본이 된다 (§8.1)
```

---

## 실행

```bash
npm install
npm run test:pg
```

`test:pg`가 **실제 PostgreSQL 18**을 띄워 기능 시험 55건과 동시성 시험 6건을
모두 돌린 뒤 서버를 내린다. 관리자 권한도 사전 설치도 필요 없다 —
`embedded-postgres`가 공식 바이너리를 `node_modules`에 들고 있다.

빠른 확인만 필요하면 PGlite(메모리)로 기능 시험만 돌린다. 동시성 시험은 빠진다:

```bash
npm test
```

이미 있는 서버에 대고 돌리려면:

```bash
DATABASE_URL=postgres://user:pw@host:5432/dbname npm test
DATABASE_URL=postgres://user:pw@host:5432/dbname npm run test:concurrency
```

동시 채번 조건은 `SESSIONS`, `PER_SESSION`으로 바꾼다. 기본은 §8.1대로 2세션 × 50회.

> 시험은 데이터를 남기고 지우지 않는다(삭제 자체가 없다). 실운영 DB를 가리키지 말 것.

**initdb 인코딩 주의.** 이 장비는 Windows 사용자명이 한글이라 initdb의
post-bootstrap 단계가 CP949 바이트를 UTF8 클러스터에 밀어넣다가 죽는다
(`FATAL: invalid byte sequence for encoding "UTF8": 0xb1`). `test/pg.mjs`는
클러스터를 `SQL_ASCII`로 만들고 시험 DB만 `template0`에서 UTF8로 뽑아 우회한다.
스키마가 도는 DB는 UTF8이므로 검증 값은 그대로 유효하다.

---

## 배치 전 확인

1. **마이그레이션은 소유자 계정으로 실행하고, 응용은 `app_role`로 접속한다.**
   응용이 소유자로 접속하면 S03의 REVOKE가 통째로 무의미해진다.

   ```sql
   create role dhr_app login password '...';
   grant app_role to dhr_app;
   ```

2. **세션마다 `app.user_id`를 설정한다.** 설정하지 않으면 `audit_log.actor_id`가
   null로 남아 "누가 바꿨는가"가 비게 된다.

   ```sql
   select set_config('app.user_id', '<app_user.id>', false);
   ```

3. **채번 규칙을 등록한다.** M0은 채번 *기구*를 제공할 뿐 규칙은 비어 있다.
   `next_number()`는 규칙이 없으면 예외를 던진다(N-01). M1의 자재 로트 등록
   전에 대상별 패턴을 정해 넣어야 한다.

---

## 시험 결과

**61건 전건 통과** — 기능 55건 + 동시성 6건.
PostgreSQL 18.4 (Windows x86_64), 2026-08-26. 보고서는 `reports/`에 있다.

| 구간 | 건수 | 내용 |
|---|---|---|
| §4.1 사용자·역할 | 12 | 계정 제약, 개발계정 QP 금지(양방향), `current_user_id`, `has_role` |
| §5 S03 | 18 | app_role 권한 회수, 소유자 우회, TRUNCATE 우회, 변경 이력 보존 |
| §4.10 채번 | 25 | 100회 연속, 연도 경계, 품목별 우선, 규칙 미정의, 토큰 치환, 불변성, 순번 승계 |
| §8.1 동시성 | 6 | 2세션 × 50회 중복 0건 · 순번 연속, 규칙 교체 경합 |

동시 채번은 §8.1 조건(2세션 × 50회) 외에 **8세션 × 300회 = 2400건**으로도
확인했다. 중복 0건, 순번 1~2400 연속.

기능 시험은 PGlite(메모리)와 실제 서버 양쪽에서 같은 결과가 나온다.

## 사양과 다르게 구현한 것

`CLAUDE.md`의 코드를 그대로 옮기면 동작하지 않거나 규칙이 새는 지점들이다.
각 항목은 해당 마이그레이션 파일 주석에 근거와 함께 적혀 있다.

### 고치지 않으면 동작하지 않는 것

| # | 위치 | 내용 |
|---|---|---|
| 1 | `trg_audit()` | `record_id`가 `'id'` 컬럼 고정이라 `user_role`(기본키 `(user_id, role)`)에 걸면 NOT NULL 위반으로 INSERT 자체가 막힌다. 트리거 인자로 식별자 컬럼을 받게 했다. 인자 없으면 `'id'`이므로 M1 이후 표는 사양 그대로 붙이면 된다. |
| 2 | `numbering_rule.item_id` | `references item(id)`인데 `item`은 M1 표다. M0에서는 FK 없이 컬럼만 뒀다. M1에서 넣을 `alter table` 한 줄을 `0004` 주석에 적어 뒀다. |
| 3 | `next_number()` | `p_item`이 있으면 패턴에 품목 토큰이 없어도 `item`을 조회한다. 패턴이 실제로 요구할 때만 조회하게 했다. 이게 없으면 §8.1의 "품목별 규칙 우선" 시험을 M0에서 돌릴 수 없다. |

### 새는 것을 막은 것

| # | 위치 | 내용 |
|---|---|---|
| 4 | `next_number()` 시각 | `now()`는 세션 타임존을 탄다. DB가 UTC면 KST 00:00~09:00 채번이 전날 날짜와 전날 `cycle_key`를 받는다. `Asia/Seoul`로 고정했다. 단일 사업장이다. |
| 5 | `security definer` | `trg_audit`, `next_number`에 `search_path`를 고정했다. 미고정 시 호출자가 경로를 바꿔 함수를 가로챌 수 있다. |
| 6 | TRUNCATE | `REVOKE DELETE`는 TRUNCATE를 막지 않고 TRUNCATE는 행 트리거도 타지 않는다. 표를 통째로 비우고 감사기록도 남지 않는다. 문장 트리거로 막았다. CASCADE·다중 표 경로까지 시험한다(S03-10, S03-18). |
| 7 | 소유자 우회 | `REVOKE`는 app_role만 막는다. 소유자·슈퍼유저용으로 삭제 차단 트리거를 함께 걸었다. §2의 S03 구현란이 "REVOKE DELETE + **TRIGGER**"인 이유다. |
| 8 | 개발계정 QP | 사양의 `trg_no_dev_qp()`는 `user_role` 쪽만 막는다. QP를 가진 계정을 나중에 `is_developer=true`로 바꾸는 역방향 경로가 열려 있다. `app_user` 쪽에도 같은 불변식을 걸었다. |
| 9 | `audit_log` UPDATE | 고쳐 쓸 수 있는 감사기록은 감사기록이 아니다. 수정을 막았다. |
| 10 | 규칙 불변성 | §4.10 "기존 행을 수정하지 않는다"를 트리거로 강제. `is_active`를 내리는 것만 허용하고 재활성화도 막는다. |
| 11 | 카운터 역행 금지 | §4.10 "순번을 되돌리면 중복이 발생한다"를 트리거로 강제. 앞으로만 간다. 초기 이관용 시작 순번은 INSERT라 걸리지 않는다. |
| 12 | DELETE 감사 | `app_user`·`user_role`은 §5의 REVOKE DELETE 목록에 **없다** — 역할 회수는 정상 작업이다. 그래서 삭제를 막지 않고, 대신 `after delete`도 감사한다. 회수 시점이 남지 않으면 "누가 언제 어떤 권한을 가졌는가"가 비어 버린다. |
| 13 | 순번 승계 | 규칙을 교체하면 `rule_id`가 바뀌어 카운터가 새로 생기고 순번이 1부터 다시 시작한다. 같은 패턴이면 이미 나간 번호가 재발행된다 — §10이 금지하는 번호 재사용이다. 새 카운터를 만들 때 같은 `(target, item_id, cycle_key)`의 기존 최대값에서 이어받는다. **아래 "순번 승계" 절 참조.** |

### 판단해서 뺀 것

- **`numbering_counter`는 감사 대상에서 제외했다.** 채번 1건마다 감사행이
  1건씩 붙어 `audit_log`가 채번 로그로 뒤덮인다. 발행된 번호는 그 번호를 쓴
  기록에 이미 남으므로 추적에 보태는 것이 없다. 무결성은 역행 금지 트리거와
  권한 회수로 지킨다. 시험 N-25가 이 결정을 확인한다.
- **`app_user`에 DELETE 권한을 주지 않았다.** 계정 정리는 `is_active=false`로
  한다. `user_role`에는 DELETE를 줬다 — 전보·퇴사 처리와 개발계정 전환이
  역할 회수를 전제로 하기 때문이다.

---

## 순번 승계 (규칙 교체 시 번호 재사용 차단)

`numbering_counter`의 기본키가 `(rule_id, cycle_key)`라, §4.10의 "규칙 변경은
신규 행 추가로 한다"를 따르는 순간 새 카운터가 생겨 순번이 1부터 다시 시작한다.
같은 패턴이면 **이미 나간 번호가 그대로 재발행된다** — §10이 금지하는 번호
재사용이다. 대상 표의 unique 제약이 최종적으로는 막지만, `next_number()`가
충돌하는 번호를 건네준 뒤 엉뚱한 지점에서 터진다.

`next_number()`가 새 카운터 행을 만들 때 같은 `(target, item_id, cycle_key)`의
기존 최대값에서 이어받게 했다. `item_id`는 공통 규칙에서 null이므로 `=`가 아니라
`is not distinct from`으로 비교한다.

```sql
select coalesce(max(c.last_seq), 0) into v_base
  from numbering_counter c
  join numbering_rule  nr on nr.id = c.rule_id
 where nr.target = r.target
   and nr.item_id is not distinct from r.item_id
   and c.cycle_key = ck;
```

**함께 막은 경합.** 승계는 "구 규칙 카운터의 **커밋된** 최대값"을 읽는다.
구 규칙으로 아직 발행 중인 트랜잭션이 있는데 그 사이 규칙을 내려 버리면, 커밋
안 된 증가분이 안 보여 같은 번호가 두 번 나간다. 규칙 조회에 `for share`를 걸어
발행 중에는 규칙을 내리지 못하게 했다. 공유 잠금끼리는 충돌하지 않으므로 동시
발행 성능에는 영향이 없고, 규칙 교체만 발행 종료를 기다린다.
시험 C-05·C-06이 실제 두 세션으로 이를 확인한다.

**승계 범위.**

| 경계 | 동작 | 시험 |
|---|---|---|
| 같은 `(target, item, 주기)` | 이어받는다 | N-07, N-24(3세대) |
| 다른 주기 (`cycle_key`) | 이어받지 않는다 | N-21 |
| 다른 품목 | 이어받지 않는다 | N-23 |
| 공통 규칙 (`item_id` null) | 이어받는다 | N-22 |

**남은 구멍 하나.** 승계는 같은 `cycle_key` 안에서만 일어난다. `reset` 주기를
바꿔 규칙을 교체하면(YEARLY → MONTHLY 등) 주기 키가 달라 이어받지 못하고 1부터
시작한다. 주기를 바꾸는 것은 번호 체계를 바꾸는 일이라 보통 패턴도 함께 바뀌지만,
**패턴을 그대로 두고 주기만 바꾸면 충돌한다.** 규칙 등록 화면에서 주기 변경 시
경고를 띄울 것. 구조로 막으려면 카운터 키를 `(target, item_id, cycle_key)`로
바꿔야 하는데 그건 §4.10의 표 정의를 고치는 일이라 하지 않았다.

---

## 남은 판단 (물어볼 것)

### 1. `{SEQ:n}`의 `n`과 `seq_width`가 어긋날 수 있다

토큰표는 "`{SEQ:n}` 순번 n자리"라고 하는데 사양의 함수는 `seq_width` 컬럼으로
채운다. `{SEQ:2}` + `seq_width=7`이면 7자리가 나온다(시험 N-09가 이 동작을
고정해 뒀다). 사양 코드대로 뒀다. 규칙 등록 화면에서 둘을 함께 보여주거나
한쪽만 입력받아 어긋날 수 없게 하는 편이 낫다.

### 2. 사양에 제약이 없어 그대로 둔 것

- `login_code`는 "숫자 문자열"이라고만 되어 있고 형식 제약이 없다. 넣지 않았다.
- QP 계정의 `can_login=false` / `pin_hash is null` 정합성 제약이 없다.
  시험 U-03은 값이 들어가는지만 확인한다.
- `numbering_rule.effective_from`은 기록용이다. 규칙 선택은 `is_active`만 본다.
  활성 규칙이 (target, item)당 하나라서 **미래 일자 규칙을 미리 등록해 둘 수
  없다.** 교체 시점에 사람이 `is_active`를 내리고 새 규칙을 넣어야 한다.

셋 다 차단을 늘리는 일이라 §1("차단하지 않는다")과 §12("완화하지 말고 먼저
물어볼 것")에 따라 임의로 넣지 않았다.

---

## M1로 넘길 것

- `numbering_rule.item_id`의 FK 복구 (`0004_numbering.sql` 주석에 문장 그대로 있음)
- `item` 표 도입 후 `{ITEM}` / `{MODEL}` 토큰 활성화 (현재는 안내 예외, 시험 N-20)
- `revoke delete`를 §5의 나머지 표로 확장, 각 표에 `trg_audit` · 차단 트리거 부착
