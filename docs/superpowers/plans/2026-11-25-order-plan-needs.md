# 주문에서 생산 계획 · 자재 소요 예보 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주문 줄마다 장수 · 배치 · 시작일을 제안해 «일정에 올리기» 한 번으로 배치 계획을 만들고, 자재 › 소요 · 부족 화면에서 계획 · 진행 중 지시가 쓸 자재의 부족과 발주 마감을 보여 준다.

**Architecture:** 셈의 바탕(장당 개수 · 덮인 개수 · 자재 필요 · 부족)은 이관 0164 의 SQL 함수에 두어 PGlite 로 시험한다. 배치 나누기 · 날짜 놓기는 DB 를 읽지 않는 순수 함수 `lib/order-plan.ts` 하나에 두고 `lib/timeline` 의 `planBatch` 를 쓴다. 화면은 생산 › 일정(주문에서 계획 판)과 자재 › 소요 · 부족(새 화면) 둘이다.

**Tech Stack:** Next.js 16 app router (서버 컴포넌트 · 서버 액션), TypeScript, Postgres (원시 SQL, `lib/db.ts` withActor / withUser), PGlite 시험 (`node test/run.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-25-order-plan-needs-design.md`

## Global Constraints

- 보고 · 화면 문구 · 주석은 한글. 긴 줄표(em dash · en dash) 대신 붙임표(-). 화면 문구에 설계 메모를 흘리지 않는다.
- 이관 번호 0164. 운영은 «DB 먼저, 코드 나중». 폴더에 남의 미완성 이관이 있으면 `deploy-db --prod` 대신 0164 파일 하나만 적용한다 (scratchpad `apply-one.mjs` 방식, 시험 실행(rollback) 뒤 commit, ACL 전후 견줌).
- 커밋은 임시 인덱스로 제 파일만: `GIT_INDEX_FILE=.git/index.optimize-tmp; git read-tree HEAD; git add -- <files>; git commit; rm 그 파일; git restore --staged -- <files>`. `git rm` 으로 미리 올려 두지 않는다. 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 다른 세션 몫이라 건드리지 않는 파일: `app/(admin)/shipping/*`, `app/(admin)/production/issue-form.tsx`, `lib/br-form.ts`, `lib/br-sheet.ts`, `app/(work)/work/[id]/br-sheet.tsx`, `app/(admin)/settings/dmr/timeline/*`.
- 새 SQL 함수는 `set search_path = pg_catalog, public, pg_temp`, `app_role` · `app_readonly` 실행 권한 (0159 의 `if exists (select 1 from pg_roles where rolname = 'app_readonly')` 꼴).
- `lib/order-plan.ts` 는 상대 경로로만 import 한다 (`./timeline`) - 시험이 Node 로 바로 읽는다 (`test/cases/22_timeline.mjs` 가 `../../lib/br-scope.ts` 를 읽는 것과 같다).
- 시행 중인 판 = `verified_at is not null and status = 'ACTIVE' and effective_from is not null and effective_from <= (timezone('Asia/Seoul', now()))::date` (`app/(admin)/production/plan/actions.ts` savePlan 과 같은 규칙).
- 이 기능은 아무것도 막지 않는다. 새 차단(raise)은 값의 모양(장수 > 0 · 이은 주문 줄의 형명이 판 밖)만.
- 매 과제 끝: `npx tsc --noEmit` 0, `npm test` 전부 통과. 화면을 고친 과제는 `npm run test:print` 287 일치 · `node scripts/font-check.mjs` 깨끗.

## Review Focus

1. 형명이 유효 크기보다 크거나 코드가 형명 체계에 안 맞는 줄 - 제안이 «이 형명은 한 장에 나오지 않습니다» 로 멈추고 0 장 · 0 으로 나누기를 내지 않는다. (Task 1 OP-01, Task 4 OL-05)
2. 남은 수량이 0 이 된 줄 · 취소된 주문 · 취소된 줄 - 제안 목록에 나오지 않는다. 지시 하나가 줄 여럿에 걸렸을 때 남은 수량 합이 0 이면 0 으로 나누지 않는다. (Task 2 OP-03)
3. 오늘이 휴무일 · 공휴일 - 첫 배치가 다음 근무일에 놓인다. (Task 4 OL-03)
4. 같은 줄을 두 번 «일정에 올리기» - 두 번째에는 덮인 개수에 앞 계획이 들어가 제안이 0 이 되고 단추가 사라진다. (Task 5 OP-07)
5. 유효기한이 필요일 전에 지나는 재고 · 두께 구간이 다른 원료 로트 - 부족 셈의 재고에서 빠진다. (Task 3 OP-05)

---

### Task 1: 이관 0164 - 칸 · 장당 개수 · 계획의 주문 줄

**Files:**
- Create: `db/migrations/0164_order_plan.sql`
- Create: `test/cases/42_order_plan.mjs`
- Modify: `test/run.mjs` (SECTIONS 에 `'42_order_plan.mjs': '[0164] 주문에서 생산 계획 · 자재 소요'`)

**Interfaces:**
- Produces (SQL):
  - `device_master.usable_w numeric`, `usable_h numeric` (각 `> 0`, `check ((usable_w is null) = (usable_h is null))`), `raw_item_id uuid references item(id)` (트리거로 그 품목 type = 'RAW' 확인).
  - `batch_plan.sheets int check (sheets > 0)`, `batch_plan.sales_order_line_id uuid references sales_order_line(id)`.
  - `dm_in_force(p_dm uuid) returns boolean` - 위 «시행 중인 판» 규칙.
  - `model_per_sheet(p_dm uuid, p_item uuid) returns int` - max(⌊W/w⌋·⌊H/h⌋, ⌊W/h⌋·⌊H/w⌋), W·H = usable, w·h = `model_parts(code)` 의 WIDTH · HEIGHT 값. 하나라도 없거나 결과 0 이면 null.
  - 트리거 `trg_batch_plan_so_line` (before insert or update of sales_order_line_id, device_master_id): 이은 줄의 item 이 `dm_models(new.device_master_id)` 에 없으면 raise `'이 주문 줄의 형명은 이 제품표준서 판의 형명이 아닙니다'`.
  - 트리거 `trg_batch_plan_attach_line` (after update of work_order_id): `new.work_order_id` 가 생기고 `new.sales_order_line_id` 가 있고 그 지시에 그 줄이 살아 있게(unlinked_at null) 걸려 있지 않으면 `work_order_so_line` 에 넣는다 (`linked_by = nullif(current_setting('app.user_id', true), '')::uuid`, 없으면 넣지 않음). 넣다가 0159 의 규칙에 걸리면 `begin … exception when others then null; end` 로 넘어간다 (계획 잇기는 그대로).

- [ ] **Step 1: 실패하는 시험을 쓴다** - `test/cases/42_order_plan.mjs`. `masterData` 로 시작하고, 40_sales_order 183~192 줄처럼 꺼진 PD 체계를 켰다가 끝에 되돌린다. 형명 품목이 없으면 `insert into item (code, name, type) values ('PD10182025', 'PD10182025', 'FIN')` 꼴로 넣는다.
  - `OP-01` (통과) «장당 개수는 유효 크기와 형명 크기로 센다»: `update device_master set usable_w = 20, usable_h = 20 where id = m.dm` 뒤 `model_per_sheet(m.dm, PD10182025)` = 2, `PD05050510` = 16, `PD25250510` = null, `PD01020510`(1×2) = 200; `usable_w = null, usable_h = null` 이면 null.
  - `OP-02` (거부) «계획 장수는 0 보다 크고, 이은 주문 줄은 그 판의 형명이어야 한다»: `insert into batch_plan (… sheets) values (… 0 …)` 거부; 판 밖 형명 줄을 이으면 거부 (메시지 `'이 주문 줄의 형명은'` 포함); 판 안 형명(`select id from dm_models(m.dm) limit 1`)의 줄은 들어간다.
  - `OP-06` (통과) «계획에 지시를 이으면 그 주문 줄을 지시에 함께 건다»: 줄을 이은 계획에 `update batch_plan set work_order_id = wo.id` 뒤 `work_order_so_line` 에 그 (wo, line) 이 unlinked_at null 로 한 줄; 이미 걸려 있으면 두 줄이 되지 않는다.
  - `OP-00` (거부) «원료 품목 칸에는 원료(RAW) 품목만»: `update device_master set raw_item_id = m.reagent` 거부, `= m.raw` 는 들어간다.
- [ ] **Step 2: 시험이 실패하는지 본다** - Run: `npm test 2>&1 | grep -E "OP-0|합계"` Expected: OP-00 · 01 · 02 · 06 FAIL (칸 · 함수 없음).
- [ ] **Step 3: `db/migrations/0164_order_plan.sql` 을 쓴다** - 위 Produces 그대로. 머리 주석에 사용자 말(설계 문서 «사용자가 말한 것») 과 왜를 적는다. 다시 돌려도 되게 `add column if not exists` · `create or replace` · `drop trigger if exists`.
- [ ] **Step 4: 시험이 통과하는지 본다** - Run: `npm test 2>&1 | grep -E "OP-0|합계|FAIL"` Expected: OP 넷 PASS, 합계 실패 0.
- [ ] **Step 5: 커밋** - `db/migrations/0164_order_plan.sql test/cases/42_order_plan.mjs test/run.mjs`, 메시지 «주문에서 생산 계획 1 - 유효 크기 · 원료 품목 · 계획의 장수와 주문 줄 · 장당 개수 (0164)».

### Task 2: 덮인 개수와 제안 대상 줄

**Files:**
- Modify: `db/migrations/0164_order_plan.sql`
- Modify: `test/cases/42_order_plan.mjs`

**Interfaces:**
- Consumes: Task 1 의 `model_per_sheet`, `dm_in_force`, `batch_plan.sheets` · `sales_order_line_id`.
- Produces (SQL):
  - `so_line_covered(p_line uuid) returns int` - 설계 «주문 줄 → 만들 개수»의 덮인 개수. 지시마다 몫(share)을 더하고 + 지시 없는 이은 계획의 `sheets × model_per_sheet(plan.dm, line.item)`.
    - 지시 w (status <> 'CANCELLED', `work_order_so_line` 이 살아 있음)에 그 줄 형명의 제품 로트가 있으면: 그 로트들 `qty_available` 합 × left(L) / (w 에 살아 있게 걸린 같은 형명 줄들의 left 합).
    - w 에 제품 로트가 하나도 없으면: ⌊w.sheet_count × left(L) / (w 에 걸린 살아 있는 줄 전부의 left 합) × model_per_sheet(w.device_master_id, L.item)⌋.
    - w 에 로트는 있으나 그 형명이 아니면 0. left 합이 0 이면 그 지시 몫은 0.
  - `order_plan_lines() returns table (line_id uuid, order_id uuid, customer_name text, customer_po_no text, due_on date, item_id uuid, item_code text, line_qty int, left_qty int, covered int, fg_stock int, dm_id uuid, dm_label text, per_sheet int, sheet_min int, sheet_max int, band text, multi_wo boolean)` - 취소 안 된 주문의 취소 안 된 줄 가운데 `so_line_left > 0` 이고 그 형명이 드는 시행 중인 판이 있는 것. 판이 여럿이면 effective_from 이 가장 늦은 판. `fg_stock` = 그 형명 product_lot 의 qty_available 합 (빼지 않고 보이기만 한다). `multi_wo` = 그 줄에 걸린 지시 가운데 다른 살아 있는 줄에도 걸린 것이 있는가. 납기 순(nulls last), 고객 발주번호 순.

- [ ] **Step 1: 시험을 더한다**
  - `OP-03` (통과) «덮인 개수는 걸린 지시 · 이은 계획을 센다» - 장당 16 인 형명 줄 L1(qty 100):
    - 아무것도 없으면 `so_line_covered(L1)` = 0, `order_plan_lines()` 에 L1 의 left 100 · covered 0 · per_sheet 16.
    - 지시 없는 계획 sheets 3 을 이으면 48.
    - 재단 전 지시(sheet_count 2)에 L1 을 걸면 48 + 32 = 80.
    - 같은 지시에 같은 형명 줄 L2(qty 100)를 더 걸면 지시 몫이 반씩: L1 = 48 + 16 = 64, `multi_wo` = true.
    - 줄을 취소하면 `order_plan_lines()` 에서 빠진다. 다른 줄이 모두 left 0 이어도 0 으로 나누기 오류가 나지 않는다.
  - `OP-04` (통과) «재단한 지시는 그 형명 로트의 남은 양만 센다»: 그 지시에 그 형명 product_lot (qty_produced 20, qty_available 12)을 넣으면 그 지시 몫 = 12 (같은 형명 줄이 하나일 때).
- [ ] **Step 2: 실패를 본다** - Run: `npm test 2>&1 | grep -E "OP-0[34]|합계"` Expected: FAIL (함수 없음).
- [ ] **Step 3: 두 함수를 0164 에 더한다.**
- [ ] **Step 4: 통과를 본다** - Run: `npm test 2>&1 | grep -E "OP-|합계|FAIL"` Expected: OP 전부 PASS.
- [ ] **Step 5: 커밋** - 메시지 «주문에서 생산 계획 2 - 덮인 개수 · 제안 대상 줄 (0164)».

### Task 3: 자재 필요 · 부족 셈

**Files:**
- Modify: `db/migrations/0164_order_plan.sql`
- Modify: `test/cases/42_order_plan.mjs`

**Interfaces:**
- Consumes: Task 1 · 2.
- Produces (SQL):
  - `material_needs(p_from date, p_to date) returns table (item_id uuid, band text, need_on date, qty numeric, unit_known boolean, source text, source_id uuid, source_label text)`:
    - `source = 'PLAN'`: 지시 없는 계획 가운데 sheets 가 있고 start_on 이 [p_from, p_to] 인 것. 그 판 공정들의 `dmr_bom` 줄마다 SHEET_TIER 는 `required_qty(op, item, sheets, 0)`, PER_UNIT 는 줄이 이어져 있으면 `required_qty(op, item, sheets, sheets × model_per_sheet(dm, line.item))` (unit_known true), 아니면 qty null · unit_known false. 원료: 판의 `raw_item_id` 가 있으면 (raw_item_id, band = 이은 줄 형명의 `model_band(code)`, qty = sheets). need_on = start_on. source_label = plan.label.
    - `source = 'WO'`: status 가 DONE · CANCELLED 아닌 지시. 품목마다 (구성표 필요 합 `required_qty(op, item, sheet_count, coalesce(planned_units, 0))` − 투입 순량(그 지시 기록의 `material_issue.qty` 합 − 그 투입의 RETURN `stock_movement.qty` 합)) 이 0 보다 큰 것. PER_UNIT 이 있고 planned_units 가 null 이면 unit_known false. 원료는 넣지 않는다 (지시가 이미 로트를 골랐다). need_on = p_from. source_label = batch_no.
  - `material_shortage(p_from date, p_to date) returns table (item_id uuid, item_code text, item_name text, item_type text, usage_uom text, band text, need_qty numeric, unknown boolean, first_need_on date, stock_qty numeric, on_order_qty numeric, next_expected_on date, short_qty numeric, lead_days int, order_by date)`:
    - (item, band) 마다 need_qty = qty 합(unit_known 인 것), unknown = unit_known false 가 하나라도.
    - stock_qty = status 'AVAILABLE' 로트의 qty_available 합 가운데 (expiry_date is null or expiry_date >= first_need_on), RAW 품목은 band 가 있을 때 `thickness_band = band` 인 로트만.
    - on_order_qty = status 'ORDERED' 발주의 (qty − po_received(id)) 합 (사용 단위 그대로), next_expected_on = 그 가운데 가장 이른 expected_at.
    - short_qty = greatest(0, need_qty − stock_qty − on_order_qty). order_by = first_need_on − lead_days (lead_days null 이면 null).
    - 정렬: short_qty > 0 먼저, order_by 이른 순, item_code.

- [ ] **Step 1: 시험을 더한다**
  - `OP-05` (통과) «계획 · 지시가 쓸 자재를 재고 · 발주중과 맞대 부족을 센다»:
    - 계획 sheets 12 (start_on = current_date + 3) → `material_needs` 에 reagent qty 2 (REAGENT_TIERS 11~20 → 2) · source PLAN.
    - reagent 로트 qty 1 (기한 없음) + 기한이 current_date + 1 인 로트 qty 50 → `material_shortage` 의 reagent stock 1, short 1.
    - reagent 발주 ORDERED qty 5 · 입고 0 → on_order 5, short 0, next_expected_on = 그 발주 expected_at.
    - `update item set lead_days = 7` 이면 order_by = current_date + 3 − 7.
    - 판 raw_item_id = m.raw, 이은 줄 형명 두께 '0510': raw 로트 band '0510' qty 5 · band '1020' qty 50 → (raw, '0510') stock 5 · need 12 · short 7.
    - 진행 중 지시 (sheet_count 12, planned_units null): reagent 2 가 WO 로 나오고, 그 지시에 reagent 1 을 투입하면 1 로 준다. PER_UNIT 품목은 unit_known false.
- [ ] **Step 2: 실패를 본다** - Run: `npm test 2>&1 | grep -E "OP-05|합계"` Expected: FAIL.
- [ ] **Step 3: 두 함수를 0164 에 더한다.**
- [ ] **Step 4: 통과를 본다** - Run: `npm test 2>&1 | grep -E "OP-|합계|FAIL"` Expected: PASS · 실패 0.
- [ ] **Step 5: 커밋** - 메시지 «주문에서 생산 계획 3 - 자재 필요 · 부족 셈 (0164)».

### Task 4: 배치 나누기 · 날짜 놓기 순수 함수

**Files:**
- Create: `lib/order-plan.ts`
- Create: `test/cases/43_order_plan_lib.mjs`
- Modify: `test/run.mjs` (SECTIONS 에 `'43_order_plan_lib.mjs': '[0164] 배치 나누기 · 날짜 놓기'`)

**Interfaces:**
- Consumes: `lib/timeline.ts` - `Step`, `WorkCalendar`, `planBatch(steps, startOn, startMin, cal): Plan | null`, `dayIndex`, `addDays`, `isOff(ymd, cal)`, `daysBetween(a, b)`.
- Produces:
  ```ts
  export interface SampleTier { min: number; max: number | null; samples: number }
  export interface ProposeInput {
    units: number;                     // 만들 개수 (시료 빼고)
    perSheet: number | null;           // model_per_sheet
    sheetMin: number | null; sheetMax: number | null;
    sampleTiers: SampleTier[];         // sample_plan (min_qty · max_qty · sample_qty)
    steps: Step[] | null; startMin: number; calendar: WorkCalendar;
    today: string;                     // YYYY-MM-DD (KST)
    dueOn: string | null;
    gapDays: number | null;            // 시간표 없는 판의 배치 간격 (근무일)
  }
  export interface ProposedBatch { sheets: number; units: number; samples: number; startOn: string; workEndOn: string | null; lastOn: string | null }
  export type Proposal =
    | { ok: true; perSheet: number; units: number; samples: number; sheets: number; batches: ProposedBatch[]; lateDays: number | null; noSteril: boolean }
    | { ok: false; reason: 'no-size' | 'no-units' | 'no-dates' };
  export function nextWorkday(ymd: string, cal: WorkCalendar): string;      // 근무일이면 그날
  export function addWorkdays(ymd: string, n: number, cal: WorkCalendar): string;
  export function samplesFor(units: number, tiers: SampleTier[]): number;
  export function proposeBatches(input: ProposeInput): Proposal;
  export function planNote(p: Extract<Proposal, { ok: true }>, i: number, n: number): string;
  ```
  - 장수: 시료가 배치마다 붙으므로 sheets = ⌈(units + Σ samples) / perSheet⌉ 을 배치 수가 바뀌지 않을 때까지 되풀이 (최대 10번). 배치 = sheetMax 씩, 마지막은 나머지, 나머지 < sheetMin 이면 sheetMin. sheetMax null 이면 한 배치.
  - 날짜: 첫 배치 startOn = nextWorkday(today). 시간표가 있으면 각 배치 `planBatch(steps, startOn, startMin, cal)` → workEndOn = addDays(startOn, dayIndex(sendEnd)), lastOn = addDays(startOn, dayIndex(last)); 다음 배치 startOn = nextWorkday(addDays(workEndOn, 1)). 시간표가 없으면 gapDays 로 addWorkdays, workEndOn · lastOn null; gapDays 도 null 이면 `{ ok: false, reason: 'no-dates' }` 가 아니라 장수 · 배치만 채우고 startOn 은 모두 nextWorkday(today) 로 두고 lateDays null *(설계: 사람이 간격을 넣는다 - 화면이 간격 칸을 비워 보인다)*. noSteril = 시간표에 k = 'ext' 단계가 없다.
  - lateDays = dueOn 이 있으면 daysBetween(dueOn, 마지막 배치 lastOn ?? 마지막 startOn + gapDays 근무일) (양수 = 넘김, 0 이하 = 여유).
  - units ≤ 0 → `no-units`, perSheet null · ≤ 0 → `no-size`.
  - planNote: `장당 ${perSheet}개 · ${units}개 + 시료 ${samples}개 → ${sheets}장 · ${i}/${n}`.

- [ ] **Step 1: 실패하는 시험을 쓴다** - `test/cases/43_order_plan_lib.mjs`, `import { proposeBatches, nextWorkday, addWorkdays, samplesFor, planNote } from '../../lib/order-plan.ts'`. DB 는 쓰지 않는다 (t.eq 만).
  - `OL-01` 1,000개 · 장당 16 · 상한 30 · 하한 1 · 시료 없음 → sheets 63, 배치 장수 [30, 30, 3]; 상한 20 → [20, 20, 20, 3]; 하한 5 → 마지막 5.
  - `OL-02` 시료 구간 [{min 1, max 50, samples 3}, {min 51, max null, samples 5}] · 100개 · 장당 10 · 상한 5 → 배치마다 그 배치 개수로 시료를 찾고, Σ(배치 units) ≥ 100 + Σ samples.
  - `OL-03` 날짜: 달력 DEFAULT_CALENDAR + holidays ['2026-11-30'], today '2026-11-28'(토) → 첫 startOn '2026-12-01' (일 · 월 공휴일 건너뜀). 3일짜리 시간표 (work 1일차 · ext 2일차 · work 3일차, sendEnd 가 1일차) 두 배치 → 둘째 startOn = 첫 배치 workEndOn 다음 근무일, lastOn 은 각자 3일차.
  - `OL-04` 시간표 없음 · gapDays 7 · 배치 3 → startOn 이 7 근무일씩 벌어지고 workEndOn · lastOn null; gapDays null → 모든 startOn 같음 · lateDays null.
  - `OL-05` perSheet null → `{ ok: false, reason: 'no-size' }`, units 0 → `no-units`.
  - `OL-06` dueOn 보다 lastOn 이 2일 늦으면 lateDays 2, 3일 이르면 −3. noSteril: ext 단계 없는 시간표면 true.
  - `OL-07` planNote(…, 1, 3) = '장당 16개 · 1000개 + 시료 0개 → 63장 · 1/3'.
- [ ] **Step 2: 실패를 본다** - Run: `npm test 2>&1 | grep -E "OL-0|합계"` Expected: FAIL (모듈 없음).
- [ ] **Step 3: `lib/order-plan.ts` 를 쓴다** (위 Produces).
- [ ] **Step 4: 통과를 본다** - Run: `npm test 2>&1 | grep -E "OL-|합계|FAIL"`; `npx tsc --noEmit` Expected: OL 전부 PASS, tsc 0.
- [ ] **Step 5: 커밋** - 메시지 «주문에서 생산 계획 4 - 배치 나누기 · 날짜 놓기 (lib/order-plan)».

### Task 5: 생산 › 일정 «주문에서 계획» 판 · 일정에 올리기

**Files:**
- Create: `app/(admin)/production/plan/order-plan.tsx` ('use client' - 줄마다 만들 개수 · 간격 칸 · «일정에 올리기» 확인 창)
- Modify: `app/(admin)/production/plan/page.tsx` («배치 계획» 판 위에 «주문에서 계획» 판, 읽기는 기존 withActor 트랜잭션 안에서)
- Modify: `app/(admin)/production/plan/actions.ts` (`addPlansFromOrder` · savePlan 뒤 주문 줄 걸림 알림)
- Modify: `test/cases/42_order_plan.mjs`

**Interfaces:**
- Consumes: `order_plan_lines()` (Task 2), `proposeBatches` · `planNote` · `SampleTier` (Task 4), `loadCalendar(db)` · `loadTimeline(db, dmId)` (`lib/timeline-db.ts`), `requireRole`, `Dialog` (`components/dialog.tsx`).
- Produces:
  - 서버 액션 `addPlansFromOrder(_p: FormState, form: FormData): Promise<FormState>` - form: `line` (uuid), `dm` (uuid), `units` (int), `gap` (int, 빈 값 허용). 서버에서 `order_plan_lines()` 의 그 줄을 다시 읽고(화면 값을 믿지 않는다), sample_plan · 시간표 · 달력으로 `proposeBatches` 를 다시 셈해 한 트랜잭션으로 `batch_plan` n 줄 insert: label `${customer_po_no} ${i}/${n}`, device_master_id, start_on, start_min (시간표 첫 단계 시각, 없으면 480), sheets, sales_order_line_id, note = planNote. reason «주문에서 계획 올림». 성공 메시지 `배치 계획 ${n}개를 올렸습니다`. 판이 시행 중이 아니면 savePlan 과 같은 문구로 거부.
  - savePlan: 저장 뒤 그 계획에 sales_order_line_id 와 work_order_id 가 둘 다 있고 `work_order_so_line` 에 살아 있게 걸렸으면 메시지 끝에 « · 주문 줄도 지시에 걸었습니다», 안 걸렸으면 « · 주문 줄은 지시에 걸지 못했습니다 (형명 · 주문 상태를 확인하십시오)».
- 판 모양 (텍스트 스케치, 부품은 기존 Panel · Table · Tag · btn):
  ```
  주문에서 계획                                               줄 2
  거래처 · 발주번호    형명         남음 · 덮임   납기    제안                               만들 개수  
  시덴코 SD_261110-02 PD05050510  1,000 · 0   11-19  장당 16개 → 63장 → 30 · 30 · 3장        [1000]   [일정에 올리기]
                                                     11-26 · 12-03 · 12-10 시작 · 납기 28일 넘김 예상
  ```
  - per_sheet null → 제안 칸에 «유효 크기를 넣으십시오» (설정 › 제품표준서 고리) 또는 «이 형명은 한 장에 나오지 않습니다». multi_wo → Tag «여러 줄에 걸린 지시». noSteril → «멸균 기간은 셈에 없음». 시간표 없는 판 → 간격 칸 (기본값 = 그 제품의 가장 최근 DONE 지시의 첫 ~ 마지막 기록 work_date 근무일 수).
  - 만들 개수 기본값 = max(0, left − covered). 0 이면 단추를 그리지 않는다. fg_stock > 0 이면 그 줄에 «완제품 재고 n개» 를 보인다 (빼지 않는다).
  - 겹침: 제안 배치의 [startOn, workEndOn ?? startOn] 안에 이미 있는 배치 계획(page 가 읽는 plans 의 start_on)이나 진행 중 지시(status ISSUED · IN_PROCESS · CUT)의 시작일이 들면 «겹침: {label 또는 batch_no}» 를 보인다. 막지 않는다.
  - 확인 창 본문: `배치 계획 ${n}개가 생깁니다. 일정 화면에서 날짜를 옮기거나 지울 수 있습니다.`
  - 쓰기 권한이 없으면(`hasRole(user, 'SYS_ADMIN', 'PROD_MGR')` 아님) 칸 · 단추 없이 제안만.

- [ ] **Step 1: 시험을 더한다** - `OP-07` (통과) «같은 줄을 두 번 올리지 않게 덮인 개수가 계획을 센다»: OP-03 의 줄에 Task 5 가 넣는 모양 그대로 (sheets 30 · 30 · 3, label 'SD 1/3' …) insert 하면 `order_plan_lines()` 의 covered = 63 × 16 = 1008 ≥ left 1000 (만들 개수 0).
- [ ] **Step 2: 실패 · 통과를 본다** - 함수는 Task 2 에 있으므로 이 시험은 바로 PASS 여야 한다. Run: `npm test 2>&1 | grep -E "OP-07|합계"` Expected: PASS.
- [ ] **Step 3: 액션 · 판 · 클라이언트 부품을 쓴다** (위 Produces · 스케치).
- [ ] **Step 4: 검사** - Run: `npx tsc --noEmit`; `node scripts/size-check.mjs`; `node scripts/font-check.mjs`; `npm run test:print 2>&1 | grep "대조 "` Expected: tsc 0, 손 치수 없음, 글꼴 깨끗, 287 일치. 로컬 개발 서버(3100)에서 개발 계정 쿠키로 `/production/plan` 이 200 이고 HTML 에 «주문에서 계획» 이 있는지 `scripts/session-cookie.mjs` 로 확인.
- [ ] **Step 5: 커밋** - 메시지 «주문에서 생산 계획 5 - 일정 화면의 주문에서 계획 · 일정에 올리기».

### Task 6: 제품표준서의 유효 크기 · 원료 품목 칸

**Files:**
- Modify: `app/(admin)/settings/dmr/actions.ts` (`setDmrLimits` 에 usable_w · usable_h · raw_item_id)
- Modify: `app/(admin)/settings/dmr/dmr-forms.tsx` (`DmrLimitsForm` 에 칸 셋 - «유효 가로 (cm)» · «유효 세로 (cm)» · «원료 품목» 고르기(type RAW))
- Modify: `app/(admin)/settings/dmr/workbench.tsx` (조회에 세 칸, RAW 품목 목록, `DmrLimitsForm` 에 넘김)

**Interfaces:**
- Consumes: Task 1 의 칸.
- Produces: `DmrLimitsForm` props 에 `usableW: number | null; usableH: number | null; rawItemId: string | null; rawItems: { id: string; code: string; name: string }[]`. setDmrLimits 는 두 크기를 소수 1자리까지 숫자로, 하나만 넣으면 `'유효 가로 · 세로는 둘 다 넣거나 둘 다 비웁니다'`. reason 문구는 `'제품표준서 장입 범위 · 유효 크기 · 원료 품목 · 멸균 박스 수량 변경'`, 성공 메시지는 그대로 `'장입 범위를 저장했습니다.'`. 저장 단추 글은 «장입 범위 저장» 그대로.

- [ ] **Step 1: 칸 · 저장을 더한다.**
- [ ] **Step 2: 검사** - Run: `npx tsc --noEmit`; `node scripts/size-check.mjs`; `node scripts/font-check.mjs`; `npm test 2>&1 | grep 합계` Expected: 0 · 깨끗 · 실패 0. 로컬 `/settings/dmr` 200.
- [ ] **Step 3: 커밋** - 메시지 «주문에서 생산 계획 6 - 제품표준서에 유효 크기 · 원료 품목».

### Task 7: 자재 › 소요 · 부족 화면

**Files:**
- Create: `app/(admin)/material/needs/page.tsx`
- Modify: `app/(admin)/sections.ts` (MATERIAL_NAV 에 `{ href: '/material/needs', label: '소요 · 부족' }` - 재고 다음)
- Modify: `lib/access.ts` (ACCESS_ROWS 자재 묶음, 재고 다음에 `{ group: '자재', label: '소요 · 부족', path: '/material/needs', marks: '●●-XX' }`)
- Modify: `app/(admin)/rail.tsx` (`'/material/needs'` 아이콘 - 재고와 같은 것)

**Interfaces:**
- Consumes: `material_shortage(p_from, p_to)` · `material_needs(p_from, p_to)` (Task 3), `todayKST()` (`lib/kst.ts`), `blocksScreen`, 발주 화면 `NewOrder` 의 presetItem · presetQty (주소 `/material/orders?item=<id>&qty=<n>` - orders/page.tsx 가 그 쿼리를 이미 읽는지 확인하고, 안 읽으면 이 과제에서 읽게 한다).
- Produces: 화면 `/material/needs?days=30|60|90` (기본 60). 한 withUser 트랜잭션에서 두 함수를 읽는다.
  ```
  소요 · 부족                                       오늘부터 [30 · 60 · 90]일
  품목                  필요     첫 필요일  재고   발주중(예정)    부족   발주 마감
  돼지진피 0.5~1.0mm    63장    11-26     0장    -              63장   11-12 (붉게)  [발주]
  염화나트륨             876 g   11-26     1,200  -              -      -
  20X PBS               4.8 L   11-26     2.0 L  -              2.8 L  자체 제조 필요  [원액 제조]
  파우치 라벨           2,000   11-26     500    1,000 (12-01)  500    11-19 · 리드타임 7일 [발주]
  ```
  - 줄을 펼치면(`<details>`) 출처 줄: 계획 label 또는 배치번호 · 필요일 · 양.
  - 마감이 오늘 이전 → danger 톤, 7일 안 → warn. lead_days null → «리드타임 미설정». unknown → «개수 미정 몫 있음».
  - SOLUTION 품목은 발주 대신 `/material/movement` 고리 «원액 제조». RAW 는 품목 이름 뒤에 두께 구간 표시 (band '0510' → '0.5~1.0mm', 없으면 «구간 미정»).

- [ ] **Step 1: 화면 · 차림표 · 권한을 더한다.**
- [ ] **Step 2: 검사** - Run: `npx tsc --noEmit`; `npm test 2>&1 | grep 합계`; `node scripts/size-check.mjs`; `node scripts/font-check.mjs`; `npm run access 2>&1 | grep -E "기대와 다릅니다|소요"` Expected: 0 · 실패 0 · 깨끗 · 권한 매트릭스에 «소요 · 부족» 줄, 기대 어긋남 없음. 로컬 `/material/needs` 200 (개발 계정), 작업자 계정은 307.
- [ ] **Step 3: 커밋** - 메시지 «주문에서 생산 계획 7 - 자재 › 소요 · 부족».

### Task 8: 운영 반영

**Files:**
- Modify: `db/schema-baseline.json` (`node --env-file=.env.local scripts/schema-baseline.mjs` - 새 칸 · 함수 · 트리거 이름)

- [ ] **Step 1: 로컬 DB** - `git status` 로 폴더의 남의 미완성 이관을 본다. 없으면 `node --env-file=.env.local scripts/deploy-db.mjs`, 있으면 0164 파일 하나만 적용. 이어 `node --env-file=.env.local scripts/schema-baseline.mjs` 와 `git diff --stat db/schema-baseline.json` (줄어든 줄이 없어야 한다).
- [ ] **Step 2: 전체 검사** - `npx tsc --noEmit` 0 · `npm test` 실패 0 · `npm run test:print` 287 일치 · `node scripts/font-check.mjs` 깨끗.
- [ ] **Step 3: 커밋** - `db/schema-baseline.json`, 메시지 «주문에서 생산 계획 8 - 스키마 기준선».
- [ ] **Step 4: 운영 DB** - 남의 미완성 이관이 없으면 `node --env-file=.env.deploy scripts/deploy-db.mjs --prod`, 있으면 0164 하나만 (시험 실행 → commit). 운영에서 `select model_per_sheet(...)` 가 오류 없이 도는지, ACL 전후 확인.
- [ ] **Step 5: 운영 자료** - 개발 계정(SYS_ADMIN) · app_role · `app.change_reason` 으로 DX2401 Rev.00 · Rev.01 `usable_w = 20, usable_h = 20, raw_item_id = (RM-006)`. 먼저 rollback 으로 시험 실행 → commit. 이어 `select * from order_plan_lines()` 에 SD_261110-02 줄이 per_sheet 16 으로 나오는지.
- [ ] **Step 6: push · 배포 확인** - `git fetch` 로 원격과 견주고, 로컬 main 에 남의 미push 커밋이 있으면 그 커밋의 이관이 운영에 있는지 확인한 뒤에만 `git push origin main`. `gh api repos/Kayden-dof/DOF_DHR-System/commits/<sha>/statuses --jq '.[0].state'` = success. 운영 `/login` 200.
