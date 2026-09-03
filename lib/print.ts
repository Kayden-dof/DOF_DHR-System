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
    printedAt: new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(row?.printed_at ?? new Date()),
    printedBy: a.actorName,
    pages: a.pages ?? 1,
    /* 종이 머리에 나가는 회사 표시. 설정에서 온다 (§2.0 · 0070) */
    companyName: brand.companyName,
    /*
     * 제조소를 가리키는 한 줄 (5차 감사 D1 · 0094).
     *
     * 적힌 것만 이어 붙인다. 다 비면 빈 문자열이고 종이에 아무것도 나오지
     * 않는다 - 서면 양식이 이미 갖고 있으면 시스템이 낼 이유가 없다.
     *
     * ── 주소가 둘이다 ──────────────────────────────────────────────────
     * 제조기록서에 찍히는 주소는 **그 기록이 만들어진 자리**여야 한다. GMP
     * 제조소는 본사와 다른 자리인 것이 보통이므로 (사용자 지적 2026-09-02)
     * 제조소를 먼저 적고, 본사가 그와 다를 때만 뒤에 붙인다.
     *
     * 제조소가 비어 있으면 본사를 **이름표 없이** 적는다. 본사 주소에
     * "제조소" 라고 이름을 달면 그것은 종이 위의 거짓말이다.
     *
     * 만드는 자리를 여기 하나로 둔다. 양식마다 각자 이어 붙이면 갈라진다
     * (§10 복제는 갈라진다).
     */
    orgLine: [
      brand.plantAddress ? `제조소 ${brand.plantAddress}` : brand.address,
      brand.plantAddress && brand.address && brand.address !== brand.plantAddress
        ? `본사 ${brand.address}` : '',
      brand.bizNo ? `사업자등록번호 ${brand.bizNo}` : '',
      brand.ceoName ? `대표자 ${brand.ceoName}` : '',
    ].filter(Boolean).join(' · '),
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
