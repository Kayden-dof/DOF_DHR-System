# 수주 장부 · 출고 연결 · 형명 일괄 검토 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객 주문(수주)을 주문서 + 형명 줄로 적고, 출고는 «발주 업체 → 열린 주문 줄 → 그 형명의 출고 가능 로트»로만 하며, 출고 전에 주문 형명을 제품 로트 · 작업지시서 · 제조기록서와 맞대 보고 다르면 막는다.

**Architecture:** 이관 0159 가 표 셋(customer · sales_order · sales_order_line), `shipment.sales_order_line_id`, 셈 함수, 장부 규칙과 출고 규칙(DB 가 볼 수 있는 형명 검토 포함)을 건다. 제조기록서 재단 줄 대조는 칸 자리를 양식 코드가 알아서 `lib/ship-check.ts` 순수 함수 + `ship()` 처리 함수가 맡는다. 화면은 `/shipping/orders` 를 새로 두고 `/shipping/ship` 을 업체 중심으로 바꾼다.

**Tech Stack:** Next.js 16 (app router, server actions), PostgreSQL (Supabase 운영 · PGlite 시험), `pg` + `scripts/pgssl.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-25-sales-order-design.md`

## Global Constraints

- 작업 폴더는 `C:\Users\김병휘\Downloads\dof-dhr` 하나. worktree · 복사 폴더를 만들지 않는다.
- 라벨 · 재단 매칭 세션(local_8a56ec12)이 지금 `app/(admin)/shipping/*` · `app/(admin)/sections.ts` · `lib/access.ts` · `test/run.mjs` · `test/fixtures.mjs` · `test/cases/05_genealogy.mjs` · `test/cases/21_rule_harden.mjs` · `0160_ship_without_release.sql` 을 고치는 중이다. **그 세션의 커밋 번호가 노트 폴더(`side-session-notes/local_8a56ec12-…`)에 올라오기 전에는 그 파일들을 열어 고치지 않는다.** 올라오면 `git status` 로 다시 확인한다.
- 커밋은 내가 고친 파일만 `git add <파일>` 로. 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 새 표는 `<표>_audit`(after insert/update/delete, `trg_audit('id')`) · `<표>_no_delete` · `<표>_no_truncate`(`trg_block_delete()`) 를 단다 (0149 꼴). `app_role`: select · insert · update, `app_readonly`: select.
- 차단은 S01~S05 와 사용자가 정한 것(멸균 보고서 · 형명 검토 · 출고는 주문 필수)뿐. 주문 수량 초과는 막지 않고 화면이 경고.
- 화면 문구에 설계 메모를 쓰지 않는다. 되돌릴 수 없는 단추(취소 · 출고 · 주문 바꾸기) 옆에는 무엇이 바뀌는지 적는다. 긴 줄표(—, –) 금지, 붙임표(-)를 쓴다.
- 확인 창은 `components/dialog.tsx` 의 `Dialog` 를 쓴다.
- 권한: `mgr()` (SYS_ADMIN · PROD_MGR). 화면 권한은 `ACCESS_ROWS` 에 `{ group: '출하', label: '수주', path: '/shipping/orders', marks: '●●-XX' }`.
- 운영 반영 순서: 로컬 `deploy-db` → 운영 `deploy-db --prod` → push. 운영 `deploy-db` 는 이관 파일 전부를 다시 돌리므로 0160 이 커밋 · 운영 반영된 뒤에 올린다.
- 운영 자료 변경은 `pg` + `scripts/pgssl.mjs` 한 거래: `set local role app_role`, `app.user_id` = 개발 계정(login_code '000000'), `app.change_reason`, 시험 실행(rollback) 뒤 `--commit`.

## Review Focus

1. 취소한 주문과 같은 거래처 · 같은 고객 발주번호를 다시 등록하면 받아야 한다 → Task 1 `SO-03`.
2. 손으로 적은 제조번호가 붙임표 자리만 다른 경우('GM261110-01' 과 'GM-26111001')도 그 로트의 재단 줄로 찾아야 한다 → Task 3 `SC-02`.
3. 원료 로트에 두께가 비어 있거나 형명에 두께 자리가 없으면 두께 칸 때문에 출고가 막히면 안 된다 → Task 2 `SO-11`.
4. 주문 남은 양보다 많이 출고해도 DB 는 받는다 (화면 경고만) → Task 2 `SO-12`.
5. 출고 뒤 주문 바꾸기에서 사유가 비면 거부, 바꿀 줄도 형명 검토를 다시 받는다 → Task 2 `SO-14`.

---

### Task 1: 이관 0159 - 거래처 · 주문서 · 형명 줄과 장부 규칙

**Files:**
- Create: `db/migrations/0159_sales_order.sql`
- Create: `test/cases/40_sales_order.mjs`
- Modify: `test/run.mjs` (SECTIONS 에 `'40_sales_order.mjs': '[0159] 수주 장부 · 출고는 주문 줄로 · 형명 일괄 검토'` 를 `39_model_udi.mjs` 다음에) - 라벨 세션 커밋 뒤

**Interfaces:**
- Produces (SQL):
  - `customer(id uuid pk, name text not null check btrim<>'', biz_no text, contact_name text, contact_phone text, contact_email text, address text, note text not null default '', is_active boolean not null default true, created_at timestamptz default now(), created_by uuid not null → app_user)`; 부분 유일 색인 `customer_biz_no_uk on (biz_no) where biz_no is not null`.
  - `sales_order(id, customer_id not null → customer, customer_po_no text not null check btrim<>'', ordered_on date not null, ship_to text, due_on date, note text not null default '', created_by not null → app_user, created_at, cancelled_at timestamptz, cancelled_by → app_user, cancel_reason text)`; check `cancelled_at is null or btrim(coalesce(cancel_reason,'')) <> ''`; 부분 유일 색인 `sales_order_live_uk on (customer_id, customer_po_no) where cancelled_at is null`.
  - `sales_order_line(id, sales_order_id not null → sales_order, item_id not null → item, qty int not null check (qty > 0), seq int not null default 0, cancelled_at timestamptz, cancel_reason text)`; `unique (sales_order_id, item_id)`; 취소 사유 check 는 머리와 같다.
  - `so_line_shipped(p_line uuid) returns int` (출고 qty 합, 없으면 0)
  - `so_line_left(p_line uuid) returns int` (줄이나 머리가 취소면 0, 아니면 `qty - shipped`)
  - `so_status(p_order uuid) returns text` - `'CANCELLED' | 'OPEN' | 'PARTIAL' | 'DONE'` (DONE = 취소 안 된 줄이 모두 left <= 0 이고 하나라도 있음, OPEN = 붙은 출고 0)
  - 트리거 `sales_order_line_rules` (before insert or update, `trg_so_line_rules()`): 품목 type 이 'FIN' 아니면 거부 · 수량 < `so_line_shipped` 거부 · 출고가 붙은 줄의 item_id 변경 거부 · 출고가 붙은 줄의 취소 거부.
  - 트리거 `sales_order_rules` (before update, `trg_so_rules()`): `cancelled_at` 을 not null → null 로 되돌리기 거부. 취소할 때 `cancelled_by` 가 비면 `current_user_id()` 로 채운다.
  - 함수 셋은 `language sql stable`, `set search_path = pg_catalog, public, pg_temp`, `grant execute … to app_role, app_readonly`.

- [ ] **Step 1: 시험 `SO-01` ~ `SO-07` 을 `test/cases/40_sales_order.mjs` 에 쓴다**

파일 머리에 근거(사용자 2026-11-25 «DHR 은 주문 장부와 출고 연결에만 집중하면 됨.» · «B 주문서+줄») 주석. 파일 안 도우미 `order(t, m, { po, lines: [[code, qty], …] })` → `{ customer, order, lines: { [code]: lineId } }`, 거래처는 파일 안에서 한 번만 세운다 (`biz_no` '000-00-00001').

```js
// SO-01 남은 수량 · 상태 셈 (출고 없이)
t.eq(await t.val(`select so_line_left($1)`, [l]), 1000, '처음엔 주문 수량');
t.eq(await t.val(`select so_status($1)`, [o]), 'OPEN', '출고 0 이면 접수');
// SO-02 한 주문서에 같은 형명 줄 두 번 → { code: '23505' }
// SO-03 같은 거래처 · 같은 발주번호: 살아 있으면 23505, 취소 뒤에는 받는다
await t.rejects(() => order(t, m, { po: 'SO03' , … }), { code: '23505' });
await t.rows(`update sales_order set cancelled_at = now(), cancel_reason = '시험' where id = $1`, [o1]);
await t.resolves(() => order(t, m, { po: 'SO03', … }));
// SO-04 취소 사유 없이 취소 → 23514 / 취소 되돌리기 → P0001
// SO-05 완제품 아닌 품목(m.reagent) 줄 → P0001, message '완제품'
// SO-06 주문서 취소 뒤 그 줄 so_line_left = 0, so_status = 'CANCELLED'
// SO-07 지우기 차단: delete from sales_order / sales_order_line / customer → 42501 (app_role 로, t.asRole('app_role', …))
```

- [ ] **Step 2: 실패 확인**

Run: `npm test` (run.mjs 에 40 을 올린 뒤. 라벨 세션 커밋 전이면 이 단계만 기다린다)
Expected: `40_sales_order.mjs` 가 `relation "customer" does not exist` 로 FAIL.

- [ ] **Step 3: `db/migrations/0159_sales_order.sql` 에 위 Interfaces 의 표 · 색인 · 함수 · 트리거 · 감사 · 권한을 쓴다**

머리 주석에 사용자 결정 넷(장부와 출고 연결만 · B · 생산팀 전용 · 출고는 주문 필수)을 원문으로. 이관은 두 번 돌아도 되게 `if not exists` · `create or replace` · `drop trigger if exists`.

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: `합계 … 실패 0`, `SO-01` ~ `SO-07` PASS.

- [ ] **Step 5: 커밋** (`db/migrations/0159_sales_order.sql test/cases/40_sales_order.mjs test/run.mjs`) - push 는 Task 6 에서.

---

### Task 2: 출고는 주문 줄로 - 연결 규칙 · DB 형명 검토 · 주문 바꾸기

**Files:**
- Modify: `db/migrations/0159_sales_order.sql` (뒤에 덧붙임)
- Modify: `test/cases/40_sales_order.mjs` (`SO-08` ~ `SO-14`)
- Modify: `test/fixtures.mjs` (`orderLine` 더함), `test/cases/05_genealogy.mjs`, `test/cases/06_review.mjs` (출고 insert 마다 `sales_order_line_id`) - 라벨 세션 커밋 뒤
- Modify: `scripts/seed-flow.mjs:624,1012`, `scripts/seed-second.mjs:380`, `scripts/volume-check.mjs:241` (출고 insert 에 주문 줄)

**Interfaces:**
- Consumes: Task 1 의 표 · `so_line_left`.
- Produces:
  - `shipment.sales_order_line_id uuid references sales_order_line(id)` (null 허용 - 옛 자료), 색인 `shipment_so_line_idx`.
  - `ship_spec_check(p_lot uuid, p_line uuid) returns table (kind text, label text, expected text, actual text, ok boolean)` - 줄 셋, `ok` null = 볼 수 없음:
    - `'LOT'`, '제품 로트 형명', 주문 줄 item code, 로트 item code, 같은 item_id 인가
    - `'DMR'`, '작업지시서 제품', 주문 줄 item code, 지시의 제품표준서 `product_code` (없으면 대표 품목 code), `exists (select 1 from dm_models(wo.device_master_id) where id = 줄 item_id)`
    - `'BAND'`, '작업지시서 원료 두께', `model_band(줄 code)`, 원료 로트 `thickness_band`, 둘 다 있으면 같은가 아니면 null
  - 트리거 `shipment_order_line` (before insert or update of sales_order_line_id, `trg_shipment_order_line()`):
    - insert 에서 `sales_order_line_id` 가 null 이면 거부 ('출고는 주문 줄을 골라야 합니다')
    - 줄이나 머리가 취소면 거부
    - `ship_spec_check` 에 `ok = false` 가 하나라도 있으면 거부, 메시지에 label · expected · actual
    - update 에서 줄이 바뀌면 `app.change_reason` 이 비면 거부, null 로 바꾸기 거부
  - `test/fixtures.mjs`: `export async function orderLine(t, m, itemId, qty = 100000)` → 줄 id. 거래처 '시험 거래처' 하나 · 주문서는 부를 때마다 새로(발주번호 `'T-' || md5(random()::text)` 앞 10자).

- [ ] **Step 1: 시험 `SO-08` ~ `SO-14` 를 쓴다**

파일 안 도우미 `readyLot(t, m, { band = '0510', code = 'PD05050510', qty = 30 })` → `{ lot, wo }`: `newMaterialLot(…, { thickness_band: band })` · `newWorkOrder` · 05 `runBatch` 와 같은 차례로 `cut_product_lot` · `status = 'PACKED'` · `sterilReport(t, m, wo.id)`.

```js
// SO-08 주문 줄 없이 출고 → P0001 '주문 줄'
// SO-09 형명이 다른 줄(PD10150510 줄에 PD05050510 로트) → P0001 '제품 로트 형명'
// SO-10 원료 두께 1015 로 만든 PD05050510 로트 → P0001 '원료 두께'
// SO-11 원료 두께가 빈 배치(band: null) → 들어간다, ship_spec_check 의 BAND ok 는 null
// SO-12 남은 양보다 많이(줄 qty 5, 출고 10) → 들어간다, so_line_left = -5, so_status = 'DONE'
// SO-13 취소된 주문서의 줄에 출고 → P0001
// SO-14 주문 바꾸기: 사유 없이 update → P0001 '사유'; set_config('app.change_reason','시험',true) 뒤 같은 형명 다른 줄 → 받고 첫 줄 left 가 돌아온다;
//       형명이 다른 줄로 바꾸기 → P0001; null 로 바꾸기 → P0001
```

- [ ] **Step 2: 실패 확인** - Run: `npm test` / Expected: `SO-08` ~ `SO-14` FAIL (`column "sales_order_line_id" does not exist`).

- [ ] **Step 3: 0159 에 칸 · `ship_spec_check` · `trg_shipment_order_line` 을 덧붙이고, `orderLine` 픽스처를 더하고, 기존 출고 insert(05 · 06 · scripts 넷)에 `sales_order_line_id` 를 넣는다**

기존 시험의 출고는 `await orderLine(t, m, <그 로트의 item_id>)` 로 줄을 세워 넣는다. 일부러 거부를 보는 시험(05 SH-*)은 거부 이유가 바뀌지 않게 줄을 넣고 원래 조건만 어긴다.

- [ ] **Step 4: 통과 확인** - Run: `npm test` / Expected: 실패 0.

- [ ] **Step 5: 커밋** (0159 · 40 · fixtures · 05 · 06 · scripts 넷).

---

### Task 3: 순수 함수 - 형명 찾기 · 제조기록서 재단 줄 대조

**Files:**
- Create: `lib/model-find.ts`
- Create: `lib/ship-check.ts`
- Modify: `test/cases/40_sales_order.mjs` (`SC-01` ~ `SC-04`, `import … from '../../lib/ship-check.ts'` · `'../../lib/model-find.ts'`)

**Interfaces:**
- Produces:
  - `lib/model-find.ts` (가져오는 것 없음):
    - `export function gtinOf(input: string): string | null` - `(01)` 뒤 14자리 · `01`+14자리로 시작하는 더 긴 글 · 14자리 · 13자리는 앞에 0. 재단 폼(batch-forms.tsx 91~93줄)과 같은 셈.
    - `export function findModel<T extends { code: string; udi?: string | null }>(input: string, pool: T[]): T | undefined` - 띄어쓰기 빼고 대문자로 code 같음, 또는 `gtinOf` 와 udi 같음.
  - `lib/ship-check.ts` (가져오는 것 없음):
    - `export interface CutRowCell { row: number; role: 'cutlot' | 'model' | 'qty'; value: string }` (적은 값, 없으면 채운 값)
    - `export const alnum = (s: string) => s.replace(/[^0-9A-Za-z]/g, '').toUpperCase()`
    - `export function cutRowCheck(cells: CutRowCell[], lotNo: string, lotIndex: number, orderCode: string): { ok: boolean | null; actual: string | null; row: number | null }` - 칸이 하나도 없으면 `{ ok: null }`(양식 없음). 재단 줄 가운데 cutlot 의 `alnum` 이 `alnum(lotNo)` 와 같은 줄, 없으면 `lotIndex` 번째 줄(줄 번호 차례). 그 줄도 없으면 `{ ok: false, actual: null }`. 있으면 model 칸 `alnum` 과 `alnum(orderCode)` 가 같은가.

- [ ] **Step 1: 시험 `SC-01` ~ `SC-04`**

```js
// SC-01 gtinOf: '(01)08809911220376' · '0108809911220376…' · '08809911220376' · '8809911220376' → '08809911220376'; 'PD05050510' → null
//       findModel('pd 0505 0510', pool) 과 findModel('(01)08809911220376', pool) 가 같은 형명
// SC-02 손으로 적은 'GM261110-01' 줄이 로트 'GM-26111001' 로 찾아지고, 모델명 'PD10182025' 와 주문 'PD10182025' → ok true
// SC-03 모델명이 'PD05050510' 인데 주문 'PD10182025' → ok false, actual 'PD05050510'
// SC-04 칸 없음 → ok null; 줄 1 개에 로트 index 1 이고 제조번호도 안 맞음 → ok false, row null
```

- [ ] **Step 2: 실패 확인** - Run: `npm test` / Expected: `Cannot find module …/lib/ship-check.ts` 로 FAIL.
- [ ] **Step 3: 두 파일을 Interfaces 대로 쓴다** (TS 는 Node 가 타입만 지우고 돌 수 있게 `interface` · `type` 만, enum · namespace 없이).
- [ ] **Step 4: 통과 확인** - Run: `npm test` 와 `npx tsc --noEmit` / Expected: 둘 다 오류 0.
- [ ] **Step 5: 커밋** (`lib/model-find.ts lib/ship-check.ts test/cases/40_sales_order.mjs`).

---

### Task 4: 수주 화면 `/shipping/orders`

**Files:**
- Create: `app/(admin)/shipping/orders/page.tsx`
- Create: `app/(admin)/shipping/orders/order-forms.tsx` (`'use client'`)
- Create: `app/(admin)/shipping/orders/actions.ts` (`'use server'`)
- Modify: `app/(admin)/sections.ts` (`SHIPPING_NAV` 맨 앞에 `{ href: '/shipping/orders', label: '수주' }`), `lib/access.ts` (멸균 위탁 줄 앞에 수주 줄) - 라벨 세션 커밋 뒤

**Interfaces:**
- Consumes: Task 1 표 · `so_line_shipped` · `so_line_left` · `so_status`, Task 3 `findModel`.
- Produces (actions, 모두 `(_p: FormState, form: FormData) => Promise<FormState>`, `mgr()` 를 actions.ts 안에 같은 꼴로 둔다):
  - `createOrder` - 폼 칸 `customer_id` 또는 (`new_customer_name`, `new_biz_no`), `customer_po_no`, `ordered_on`, `ship_to`, `due_on`, `note`, 줄 `line_item_<n>` · `line_qty_<n>`. 한 거래에서 거래처(새것이면) · 머리 · 줄.
  - `updateOrder` - `id`, 머리 값, 줄 수량(`qty_<lineId>`), 새 줄(`line_item_<n>` · `line_qty_<n>`).
  - `cancelOrder` - `id`, `reason` (빈 값 거부), `withActor(…, { reason })`.
  - `cancelLine` - `id`, `reason`.
  - `saveCustomer` - `id`(없으면 새로), 상호 · 사업자번호 · 담당자 · 연락처 · 이메일 · 주소 · 메모 · `is_active`.
  - 끝나면 `revalidatePath('/shipping/orders')` · `('/shipping/ship')`.

- [ ] **Step 1: 페이지 · 폼 · 처리 함수를 쓴다** - 패널 넷(주문 등록 · 진행 중인 주문 · 끝난 주문 · 거래처)은 설계 «화면» 절 그대로. 형명 칸은 재단과 같은 «형명 · UDI» 입력 + 고르기(`findModel` 로 맞으면 고른다). 형명 목록은 `type = 'FIN' and is_active` 완제품 전부(`code · name · udi_di`). 취소는 `Dialog` 확인 창, 단추 옆 «남은 수량이 0 이 되고 되돌릴 수 없습니다». 진행 중인 주문의 줄을 펼치면 붙은 출고(출고일 · 제조번호 · 수량).
- [ ] **Step 2: 확인** - Run: `npx tsc --noEmit` · `npm test` · `node scripts/font-check.mjs` / Expected: 오류 0, 실패 0.
- [ ] **Step 3: 커밋** (orders 셋 · sections.ts · access.ts).

---

### Task 5: 출고 화면 - 업체 → 주문 줄 → 로트 · 형명 일괄 검토 · 주문 바꾸기

**Files:**
- Modify: `app/(admin)/shipping/ship/page.tsx`, `app/(admin)/shipping/shipping-forms.tsx` (`ShipList` · `ShipRowForm`), `app/(admin)/shipping/actions.ts` (`ship`, 새 `relinkShipment`) - 라벨 세션 커밋 뒤
- Create: `lib/ship-review.ts` (서버 전용)

**Interfaces:**
- Consumes: Task 2 `ship_spec_check` · 트리거, Task 3 `cutRowCheck`, `lib/br-sheet.ts` `brSheet(db, recordId)`.
- Produces:
  - `lib/ship-review.ts`: `export interface SpecRow { kind: 'LOT' | 'DMR' | 'BAND' | 'BR' | 'STERIL'; label: string; expected: string | null; actual: string | null; ok: boolean | null }` 과 `export async function shipReview(db: Db, lotId: string, lineId: string): Promise<SpecRow[]>` - `ship_spec_check` 셋 + 재단 기록서(그 로트 work_order 의 재단 공정 기록 → `brSheet` 로 채운 칸 가운데 section 'cut' · role cutlot/model/qty → `cutRowCheck`, 로트 index 는 그 지시 로트들의 `lot_no` 차례) + 멸균 보고서(`lot_steril_report`). 재단 공정 기록이 여럿이면 모두 보고 하나라도 다르면 false.
  - `ship(_p, form)`: 칸 `sales_order_line_id`, `product_lot_id`, `qty`, `shipped_at`. `shipReview` 에 `ok === false` 가 있으면 그 label 로 거부. `customer_name` 은 그 줄의 거래처 상호.
  - `relinkShipment(_p, form)`: 칸 `id`, `sales_order_line_id`, `reason`(빈 값 거부). `shipReview` 를 새 줄로 다시 보고, `withActor(…, { reason })` 로 update.
- 화면: 설계 «화면 - 출고 화면» 1 · 2 · 3 그대로. 업체 · 줄 고르기는 주소 검색값(`?c=<customer_id>&l=<line_id>`)으로 서버가 다시 그린다. 로트 줄마다 검토 다섯 칸(맞음 · 다름 · 볼 수 없음), 다름이 있으면 출고 단추를 끄고 단추 옆에 다른 칸의 label · 주문 형명 · 실제 값. 출고 이력에 «주문»(고객 발주번호) 열과 «주문 바꾸기»(`Dialog`, 같은 형명 열린 줄 고르기 + 사유).

- [ ] **Step 1: `lib/ship-review.ts` 와 처리 함수 둘을 쓴다**
- [ ] **Step 2: 화면을 쓴다** - 멸균 보고서 대기 패널은 라벨 세션 것을 그대로 둔다.
- [ ] **Step 3: 확인** - Run: `npx tsc --noEmit` · `npm test` · `npm run test:print` (dhr-dev 3100) · `node scripts/font-check.mjs` / Expected: 오류 0, 실패 0, 인쇄 대조 전부 일치.
- [ ] **Step 4: 커밋** (ship/page.tsx · shipping-forms.tsx · actions.ts · lib/ship-review.ts).

---

### Task 6: 운영 반영 · 시덴코 주문

**Files:**
- Modify: `db/schema-baseline.json` (`node --env-file=.env.local scripts/schema-baseline.mjs`)
- Create (scratchpad, 커밋 안 함): `reg_seadnco.mjs`

- [ ] **Step 1: 로컬 DB** - Run: `node --env-file=.env.local scripts/deploy-db.mjs` 뒤 `node --env-file=.env.local scripts/schema-baseline.mjs` / Expected: 0159 적용, 기준선 갱신.
- [ ] **Step 2: 0160 이 커밋 · 운영 반영됐는지 노트로 확인한 뒤 운영 DB** - Run: `node --env-file=.env.deploy scripts/deploy-db.mjs --prod` / Expected: 0159 적용 오류 없음.
- [ ] **Step 3: 커밋 · push** - 설계 문서 · 이 계획 · 기준선을 함께. Vercel 확인: `gh api repos/Kayden-dof/DOF_DHR-System/commits/<sha>/statuses --jq '.[0].state'` → `success`.
- [ ] **Step 4: 시덴코 주문 등록 (시험 실행 → `--commit`)** - 거래처 «시덴코(SEADNCO)» 836-26-02090, 주문 SD_261110-02 · 발주일 2026-11-19 · 납품처 ㈜성원메딕스 · 납품요청일 2026-11-19 · 메모 «결제 월말 마감 익월 말 · 거래명세서 동봉 · 포장에 유효기간 · LOT 표기», 줄 PD05050510 × 1000. 변경 사유 «시덴코 발주서 SD_261110-02 등록 (2026-11-25 접수)». Expected: 시험 실행에서 so_status 'OPEN' · left 1000 을 찍고 rollback, `--commit` 에서 같은 값.
- [ ] **Step 5: 노트 · 메모리** - 노트 파일(`side-session-notes/local_5572f5e4-…/print-test-work-order-261120.md`)에 커밋 번호 · 0159 · 시덴코 등록을 덧붙이고, 메모리 `seadnco-first-order.md` 의 «수주 관리가 없다»를 고친다.

---

### Task 7: 작업지시서를 주문 줄에 건다 (추가 결정 2026-11-25)

**Files:**
- Modify: `db/migrations/0159_sales_order.sql` (덧붙임 - 아직 운영 전), `test/cases/40_sales_order.mjs` (`SO-15` ~ `SO-18`)
- Modify: `app/(admin)/production/issue-form.tsx` · `app/(admin)/production/page.tsx` · `app/(admin)/production/actions.ts` (issueWorkOrder)
- Create: `app/(admin)/production/[id]/order-links.tsx`; Modify: `app/(admin)/production/[id]/page.tsx` (한 자리)
- Modify: `app/(admin)/shipping/orders/actions.ts` (`linkWorkOrderLine` · `unlinkWorkOrderLine`), `app/(admin)/shipping/orders/page.tsx`, `app/(admin)/shipping/ship/page.tsx` · `shipping-forms.tsx` (표시)

**Interfaces:**
- `work_order_so_line(id, work_order_id → work_order, sales_order_line_id → sales_order_line, linked_by → app_user, linked_at, unlinked_at, unlinked_by, unlink_reason)`, check 뗀 사유, 부분 유일 `work_order_so_line_live_uk (work_order_id, sales_order_line_id) where unlinked_at is null`, 감사 · 지우기 차단.
- 트리거 `work_order_so_line_rules` (`trg_wo_so_line_rules()`): insert 에서 줄 형명 ∉ `dm_models(지시 제품표준서)` 거부 ('형명이 아닙니다'), 취소된 주문 · 줄 거부 ('취소'); update 에서 지시 · 줄 바꾸기 거부, 떼기 되돌리기 거부.
- 처리 함수: `linkWorkOrderLine(_p, form)` 칸 `work_order_id`, `sales_order_line_id`; `unlinkWorkOrderLine(_p, form)` 칸 `id`, `reason`.
- 발행 폼 prop `orderLines: { id: string; label: string; dm_ids: string[] }[]`, 칸 이름 `so_line` (여럿).

- [ ] SO-15 여러 줄 걸기 · 같은 줄 두 번 23505 / SO-16 다른 제품 형명 · 취소된 줄 거부 / SO-17 떼기 사유 · 되돌리기 거부 · 뗀 뒤 다시 걸기 / SO-18 걸린 줄이 아닌 주문으로도 출고 → 실패 확인 → 이관 → 통과
- [ ] 화면 넷 → tsc · npm test · test:print · font-check · 권한 표 → 커밋 (`git commit -- <파일>`)
