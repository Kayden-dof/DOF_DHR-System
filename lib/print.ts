import { createHash } from 'node:crypto';
import { withActor } from './db';
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

export function dataHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
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
  };
}
