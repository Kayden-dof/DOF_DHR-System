import { createHmac } from 'node:crypto';
import { withActor } from './db';
import { requireUser } from './session';
import { isReadOnly } from './roles';
import { getBrand } from './brand';
import type { PrintMeta } from '@/components/print-frame';

/* ---------------------------------------------------------------------------
   인쇄 등록

   인쇄는 부가 기능이 아니라 1급 기능이다 (§7). 뽑을 때마다 회차가 올라가고
   자료 식별자가 남는다. 같은 자료를 다시 뽑으면 식별자는 같고 회차만 오른다.
   식별자가 다르면 자료가 바뀐 뒤에 다시 뽑았다는 뜻이다.

   화면을 여는 것만으로 회차가 오르는 것이 맞는가: 맞다. 종이가 정본이므로
   화면에 나온 시점의 자료가 곧 발행 후보다. 미리보기와 발행을 나누면 "본 것과
   찍힌 것이 다르다"가 성립할 수 있다.

   ── 다만 이미 나간 종이는 다시 볼 수 있어야 한다 (사용자 요청 2026-09-08) ──
   위 문장 때문에 **다시 보는 길이 통째로 없었다.** 지난 배치의 편철 표지를
   확인만 하려 해도 열면 회차가 오르고 앞 종이가 회수 대상이 되었고,
   품질책임자는 자기가 서명한 종이를 시스템에서 볼 길이 아예 없었다 - 읽기
   전용 세션은 인쇄 화면에 들어오지 못한다.

   열람은 위 걱정과 다른 일이다. 걱정은 **아직 안 나간 것**을 미리 보여 주면
   본 것과 찍힌 것이 갈릴 수 있다는 것이었다. 열람은 **이미 나간 회차**만
   연다. 발행 후보를 만들지 않으므로 그 갈림이 생길 자리가 없다.

   그리고 자료 식별자가 바로 이 자리를 위해 있는 값이다 - "같은 자료가 같은
   값을 내야 재인쇄 때 자료가 바뀌었는지 알 수 있다" (§10). 열람은 지금
   자료로 다시 그린 값을 그때 찍힌 값과 견줘, 그 사이에 자료가 바뀌었는지를
   말한다. 판정하지 않는다 - 두 값이 같은지 다른지만 적는다 (§8.5).

   열람은 대장에 아무것도 남기지 않는다. 대장에는 실제 종이만 남는다 (§10).
--------------------------------------------------------------------------- */

export const KIND_LABEL: Record<string, string> = {
  WORK_ORDER: '작업 지시서',
  DAY_RECORD: '제조기록서',
  COVER: '편철 표지',
  LABEL: '자재 라벨',
  LABEL_REQUEST: '라벨요청서',
  RELEASE_REQUEST: '출하 승인 요청서',
  EQUIPMENT_LOG: '설비 사용 기록',
};

/* ---------------------------------------------------------------------------
   자료 식별자

   인쇄물마다 붙는 열두 자리 값이다. 손에 든 종이가 어느 자료에서 나왔는지를
   되짚는 유일한 고리다.

   ── 왜 무작위가 아닌가 ────────────────────────────────────────────────────
   예측 가능해서는 안 된다는 지적은 옳다 (사용자 · 감사 지적 2). 다만 답은
   무작위가 아니다. 무작위로 뽑으면 §7 이 이 값에 얹은 뜻이 통째로 사라진다.

     같은 자료를 다시 뽑으면 식별자가 같고 회차만 오른다.
     식별자가 다르면 자료가 바뀐 뒤에 다시 뽑았다는 뜻이다.

   이 신호는 종이가 두 장 도는 상황에서 어느 쪽이 무엇인지 가르는 근거다.
   무작위면 재인쇄마다 값이 달라져 "자료가 바뀌었나" 를 영영 알 수 없다.

   그래서 열쇠를 섞는다. 서버만 아는 비밀을 넣은 HMAC 이면 같은 자료가 같은
   값을 내면서도 밖에서는 계산할 수 없다. 자료를 고친 뒤 맞는 식별자를 지어
   내려면 열쇠가 있어야 하고, 열쇠는 자료와 함께 있지 않다.

   ── 열쇠는 바뀌면 안 된다 ─────────────────────────────────────────────────
   열쇠가 바뀌면 같은 자료가 다른 값을 낸다. 그러면 자료가 그대로인데도
   "바뀐 뒤에 다시 뽑았다" 로 읽힌다. PRINT_SECRET 을 따로 두는 이유가 그것이다.
   세션 열쇠는 사고가 나면 갈아야 하지만 인쇄 열쇠는 갈지 않는다.

   PRINT_SECRET 이 없으면 세션 열쇠에서 파생해 쓴다. 배포가 서 버리는 것보다는
   낫다. 다만 그 상태로 세션 열쇠를 갈면 위 신호가 한 번 끊긴다.

   ── 이미 찍혀 나간 종이 ───────────────────────────────────────────────────
   전에 뽑힌 인쇄물은 열쇠 없는 값으로 남아 있다. 저장된 값으로 조회되므로
   되짚는 데는 지장이 없다. 다시 뽑으면 그때부터 새 방식 값이 붙는다.
--------------------------------------------------------------------------- */
/**
 * 인쇄 열쇠.
 *
 * PRINT_SECRET 이 64자 16진수면 그 바이트로 읽는다. 그 밖에는 글자 그대로다.
 *
 * ── 왜 16진수를 따로 보는가 ───────────────────────────────────────────────
 * scripts/print-key.mjs 가 "지금 쓰고 있는 파생 열쇠" 를 16진수로 찍어 준다.
 * 그 값을 PRINT_SECRET 에 넣는 이유는 열쇠를 바꾸지 않고 고정하려는 것이다.
 *
 * 그런데 그것을 글자로 읽으면 32바이트 파생 열쇠가 아니라 64바이트 문자열이
 * 되어 전혀 다른 열쇠가 된다. 고정하려다 갈아 버리는 셈이고, 그러면 같은
 * 자료가 다른 식별자를 내어 §7 의 신호가 끊긴다.
 *
 * 실제로 그럴 뻔했다 (3차 검수 후속 확인). 16진수로 보이면 바이트로 읽는다.
 */
function printKey(): Buffer {
  const own = process.env.PRINT_SECRET;
  if (own && own.length >= 32) {
    return /^[0-9a-f]{64}$/i.test(own)
      ? Buffer.from(own, 'hex')
      : Buffer.from(own, 'utf8');
  }

  const session = process.env.SESSION_SECRET;
  if (!session || session.length < 32) {
    throw new Error('PRINT_SECRET 또는 SESSION_SECRET이 없습니다 (32자 이상)');
  }
  /* 세션 열쇠를 그대로 쓰지 않는다. 용도가 다른 값은 갈라 둔다 */
  return createHmac('sha256', session).update('dhr:print:v1').digest();
}

/**
 * 인쇄 열쇠가 고정되어 있는가. 값은 내보내지 않는다.
 *
 * PRINT_SECRET 이 없으면 위 printKey() 가 세션 열쇠에서 파생해 쓴다. 돌기는
 * 하지만 그 상태는 조용하다. 화면에도 기록에도 아무 표시가 없다.
 *
 * 고정되지 않은 채로 두면 두 가지가 걸린다. 세션 열쇠를 갈면 같은 자료가 다른
 * 식별자를 내고, 그 파생 열쇠는 나중에 되찾을 수 없다 - Vercel 은 저장한
 * 비밀을 다시 읽어 주지 않는다 (2026-08-31 확인). 그래서 알려야 한다.
 */
export function printKeyPinned(): boolean {
  const v = process.env.PRINT_SECRET;
  return !!v && v.length >= 32;
}

export function dataHash(payload: unknown): string {
  return createHmac('sha256', printKey()).update(JSON.stringify(payload)).digest('hex');
}

interface LogArgs {
  actorId: string;
  actorName: string;
  kind: keyof typeof KIND_LABEL;
  payload: unknown;
  workOrderId?: string | null;
  productLotId?: string | null;
  dayNo?: number | null;
  workerId?: string | null;
  materialLotId?: string | null;
  equipmentId?: string | null;
  pages?: number;
  /** 제조기록서는 인쇄와 동시에 그 묶음이 잠긴다 (S04). */
  lockDay?: boolean;

  /**
   * 열람 모드. 대장에 쓰지 않고 **이미 나간 회차**를 연다.
   *
   * true 면 마지막 회차, 숫자면 그 회차. 그런 회차가 없으면 아무것도 열지
   * 않는다 - 아직 안 나간 것을 미리 보여 주는 자리가 아니다.
   */
  view?: boolean | number;
}

/* ---------------------------------------------------------------------------
   누가 어느 모드로 들어올 수 있는가

   전에는 이 문을 app/print/layout.tsx 이 지켰다. 그 자리는 주소의 물음표
   뒤를 못 본다 - Next 의 레이아웃에는 searchParams 가 오지 않는다. 그래서
   "발행은 막고 열람은 연다" 를 거기서 가를 수 없다.

   양식 화면마다 첫 줄에서 부른다. 셈은 여기 하나에 있고 부르는 자리만 일곱이다.

   **진짜 문은 DB 다.** 읽기 전용 세션은 app_readonly 로 돌아 record_print 에
   쓰지 못한다 (0043). 여기서 막는 것은 그 거절을 사람이 읽을 수 있는 말로
   바꾸는 일이다 (4차 감사 B3).
--------------------------------------------------------------------------- */
export async function printGate(view: boolean) {
  const me = await requireUser();
  return { me, denied: !view && isReadOnly(me.roles) };
}

/* ---------------------------------------------------------------------------
   그 회차를 다시 여는 주소

   `record_print` 한 줄이 가리키는 대상만으로 주소가 서는 양식에만 붙는다.

   **출하 승인 요청서는 서지 않는다.** 그 종이에 무엇이 담겼는지가 주소의
   `sel` 에만 있었고 대장에는 남지 않는다 - 어느 제품 로트를 몇 개씩 올렸는지가
   기록되지 않는다. 지어내면 그때 나간 종이와 다른 것을 보여 주게 되므로,
   되살릴 수 없다고 말한다.

   부르는 자리가 둘이다 (배치 상세의 인쇄 이력 · 인쇄물 조회). 셈을 여기 둔다.
--------------------------------------------------------------------------- */
export interface PrintTarget {
  kind: string; seq: number;
  work_order_id?: string | null;
  day_no?: number | null;
  worker_id?: string | null;
  material_lot_id?: string | null;
  equipment_id?: string | null;
}

export function viewHref(p: PrintTarget): string | null {
  const v = `?view=${p.seq}`;
  switch (p.kind) {
    case 'WORK_ORDER':
      return p.work_order_id ? `/print/work-order/${p.work_order_id}${v}` : null;
    case 'COVER':
      return p.work_order_id ? `/print/cover/${p.work_order_id}${v}` : null;
    case 'LABEL_REQUEST':
      return p.work_order_id ? `/print/label-request/${p.work_order_id}${v}` : null;
    case 'DAY_RECORD':
      return p.work_order_id && p.day_no !== null && p.day_no !== undefined && p.worker_id
        ? `/print/day-record/${p.work_order_id}/${p.day_no}/${p.worker_id}${v}` : null;
    case 'LABEL':
      return p.material_lot_id ? `/print/label/${p.material_lot_id}${v}` : null;
    case 'EQUIPMENT_LOG':
      return p.equipment_id ? `/print/equipment-log/${p.equipment_id}${v}` : null;
    default:
      return null;   // RELEASE_REQUEST
  }
}

/** 주소의 view 를 읽는다. `?view=1` 은 마지막 회차, `?view=3` 은 3회차 */
export function viewParam(v?: string | string[]): boolean | number {
  const s = Array.isArray(v) ? v[0] : v;
  if (s === undefined) return false;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : true;
}

/** 종이에 찍히는 시각 표기. 발행과 열람이 같은 자리에서 만든다 (§10) */
function kstStamp(t: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(t);
}

/*
 * 제조소를 가리키는 한 줄 (5차 감사 D1 · 0094).
 *
 * 적힌 것만 이어 붙인다. 다 비면 빈 문자열이고 종이에 아무것도 나오지 않는다 -
 * 서면 양식이 이미 갖고 있으면 시스템이 낼 이유가 없다.
 *
 * ── 주소가 둘이다 ────────────────────────────────────────────────────────
 * 제조기록서에 찍히는 주소는 **그 기록이 만들어진 자리**여야 한다. GMP 제조소는
 * 본사와 다른 자리인 것이 보통이므로 (사용자 지적 2026-09-02) 제조소를 먼저
 * 적고, 본사가 그와 다를 때만 뒤에 붙인다.
 *
 * 제조소가 비어 있으면 본사를 **이름표 없이** 적는다. 본사 주소에 "제조소" 라고
 * 이름을 달면 그것은 종이 위의 거짓말이다.
 *
 * 만드는 자리를 하나로 둔다. 양식마다, 또 발행과 열람이 각자 이어 붙이면
 * 갈라진다 (§10 복제는 갈라진다).
 */
function orgLine(b: Awaited<ReturnType<typeof getBrand>>): string {
  return [
    b.plantAddress ? `제조소 ${b.plantAddress}` : b.address,
    b.plantAddress && b.address && b.address !== b.plantAddress
      ? `본사 ${b.address}` : '',
    b.bizNo ? `사업자등록번호 ${b.bizNo}` : '',
    b.ceoName ? `대표자 ${b.ceoName}` : '',
  ].filter(Boolean).join(' · ');
}

/* ---------------------------------------------------------------------------
   열람 - 그때 나간 회차를 찾아 지금 자료와 견준다
--------------------------------------------------------------------------- */
interface PastPrint {
  seq: number; data_hash: string; printed_at: Date; pages: number;
  printed_by: string; retrieved_at: Date | null; retrieve_reason: string | null;
}

async function pastPrint(a: LogArgs): Promise<PastPrint | null> {
  const want = typeof a.view === 'number' ? a.view : null;
  const row = await withActor(a.actorId, (db) =>
    db.one<PastPrint>(
      `select rp.seq, rp.data_hash, rp.printed_at, rp.pages,
              u.full_name as printed_by, rp.retrieved_at, rp.retrieve_reason
         from record_print rp
         join app_user u on u.id = rp.printed_by
        where rp.kind = $1::print_kind
          and rp.work_order_id   is not distinct from $2::uuid
          and rp.product_lot_id  is not distinct from $3::uuid
          and rp.day_no          is not distinct from $4::int
          and rp.worker_id       is not distinct from $5::uuid
          and rp.material_lot_id is not distinct from $6::uuid
          and rp.equipment_id    is not distinct from $7::uuid
          and ($8::int is null or rp.seq = $8::int)
        order by rp.seq desc limit 1`,
      [a.kind, a.workOrderId ?? null, a.productLotId ?? null, a.dayNo ?? null,
       a.workerId ?? null, a.materialLotId ?? null, a.equipmentId ?? null, want]),
    { readOnly: true, reason: '인쇄물 열람' });
  return row ?? null;
}

export async function logPrint(a: LogArgs): Promise<PrintMeta> {
  const hash = dataHash(a.payload);
  const brand = await getBrand();

  /* -------------------------------------------------------------------------
     읽기 전용 세션은 대장에 쓰지 못한다 (4차 감사 B3)

     전에는 withActor 를 그냥 불러 readOnly 를 주지 않았다. 그래서 품질책임자
     세션도 이 경로에서만은 쓰기 역할(app_role)로 돌았다. 화면 문지기를
     고쳐 두었지만 응용에만 두면 검증이 아니다 (§1-2) - 화면에 구멍이 생겨도
     DB 에서 거부되어야 한다.

     부르는 자리마다 넘기게 하면 빠뜨린다. 여기서 세션을 직접 읽어 정한다 -
     인쇄 화면은 전부 로그인 뒤에 있으므로 세션이 늘 있다.
  ------------------------------------------------------------------------- */
  const me = await requireUser();
  const readOnly = isReadOnly(me.roles);

  /*
   * 열람은 여기서 갈라진다. 아무것도 쓰지 않고, 그때 나간 회차를 그대로
   * 되돌려 준다 - 회차 · 인쇄자 · 일시 · 자료 식별자가 전부 그때 값이다.
   * 지금 자료로 다시 만든 값은 견주기용으로만 따로 싣는다.
   */
  if (a.view) {
    const past = await pastPrint(a);
    const base = {
      kind: a.kind,
      kindLabel: KIND_LABEL[a.kind] ?? a.kind,
      pages: past?.pages ?? a.pages ?? 1,
      companyName: brand.companyName,
      orgLine: orgLine(brand),
      logoUrl: brand.hasLogo ? `/logo?v=${brand.logoUpdatedAt ?? '0'}` : null,
    };
    if (!past) {
      /* 아직 나간 적이 없다. 미리보기를 여는 자리가 아니므로 그렇다고 말한다 */
      return { ...base, seq: 0, dataHash: hash, printedAt: '', printedBy: '',
               view: { neverIssued: true, issuedHash: '', currentHash: hash,
                       changed: false, retrievedAt: null, retrieveReason: null } };
    }
    return {
      ...base,
      seq: past.seq,
      dataHash: past.data_hash,
      printedAt: kstStamp(past.printed_at),
      printedBy: past.printed_by,
      view: {
        neverIssued: false,
        issuedHash: past.data_hash,
        currentHash: hash,
        changed: past.data_hash !== hash,
        retrievedAt: past.retrieved_at ? kstStamp(past.retrieved_at) : null,
        retrieveReason: past.retrieve_reason,
      },
    };
  }

  const row = await withActor(a.actorId, (db) =>
    a.lockDay
      ? db.one<{ seq: number; printed_at: Date }>(
          `select seq, printed_at from print_day_record($1,$2,$3,$4,$5)`,
          [a.workOrderId, a.dayNo, a.workerId, hash, a.pages ?? 1])
      : db.one<{ seq: number; printed_at: Date }>(
          `select seq, printed_at from record_print_log(
             $1::print_kind, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [a.kind, hash, a.workOrderId ?? null, a.productLotId ?? null,
           a.dayNo ?? null, a.workerId ?? null, a.materialLotId ?? null,
           a.pages ?? 1, a.equipmentId ?? null]),
    { readOnly, reason: '인쇄' },
  );

  return {
    kind: a.kind,
    kindLabel: KIND_LABEL[a.kind] ?? a.kind,
    seq: row?.seq ?? 1,
    dataHash: hash,
    printedAt: kstStamp(row?.printed_at ?? new Date()),
    printedBy: a.actorName,
    pages: a.pages ?? 1,
    /* 종이 머리에 나가는 회사 표시. 설정에서 온다 (§2.0 · 0070) */
    companyName: brand.companyName,
    orgLine: orgLine(brand),
    logoUrl: brand.hasLogo ? `/logo?v=${brand.logoUpdatedAt ?? '0'}` : null,
  };
}

/**
 * 일 1회 배치의 문이 잠겨 있는가 (4차 감사 D5).
 *
 * CRON_SECRET 이 없으면 /api/daily 가 인증 없이 열린다. 닫아 버리면 유효기한
 * 만료 표시가 멈추므로 열어 두되, 그 상태가 화면에 보여야 한다.
 */
export function cronKeyPinned(): boolean {
  return !!process.env.CRON_SECRET;
}

/* ---------------------------------------------------------------------------
   이 서버가 뜬 백업인가 (4차 감사 D4)

   복구는 파일이 **스스로와 맞는지**만 봤다. 목록에 적힌 행 수·해시를 실제
   줄에서 다시 셈해 견주는 것이라, 한 줄을 고치고 그 표의 sha256 을 다시
   셈해 목록에 적으면 흠 0건으로 통과했다.

   파일은 이미 사람이 정한 암호로 잠겨 있고 GCM 봉인이 붙어 있다. 그래서 남는
   위험은 하나다 - **암호를 아는 사람이 손으로 지어낸 백업.** 그것으로
   되돌리면 제조기록도 감사추적도 통째로 바뀐다.

   서버 열쇠로 목록에 서명한다. 그 열쇠는 배포 환경에 있고 DB 에 없으므로,
   빈 DB 로 되살리는 재해 복구도 그대로 된다 - 대장의 해시로 문턱을 걸면
   막혔을 자리다.
--------------------------------------------------------------------------- */
export function signManifest(m: Record<string, unknown>): string {
  const { sig: _drop, ...rest } = m as Record<string, unknown> & { sig?: string };
  return createHmac('sha256', printKey())
    .update('dhr:backup:v1')
    .update(JSON.stringify(rest))
    .digest('hex');
}

/** 서명이 이 서버의 것인가. 시간 차로 값을 캐낼 수 없게 길이부터 본다 */
export function verifyManifest(m: Record<string, unknown>): boolean {
  const got = String((m as { sig?: string }).sig ?? '');
  const want = signManifest(m);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i += 1) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}
