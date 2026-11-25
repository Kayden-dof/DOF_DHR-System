/* ---------------------------------------------------------------------------
   현장 기록서 칸 저장의 양식 관문

   saveBrEntry 가 칸을 적기 전에 그 양식(docId)이 그 공정 기록의 것인지 본다.
   다른 공정 · 다른 판 양식의 칸이 이 기록에 붙으면 화면에도 종이에도 안 보이는 값이
   자료 식별자에만 들어간다. import 가 없어 시험(22_timeline TL-06)이 이 함수를 그대로 돌린다.

   범위는 기록서 화면(lib/br-sheet currentForms) · 관리 정정 · 일차 인쇄와 같은
   br_form_in_scope (0137) 하나가 가른다. 판에 묶인 개정안이 있으면 그 판의 지시는 묶인
   양식만, 없으면 묶이지 않은 현행 양식. is_current 만 보면 운영 DX2401 Rev.01 처럼 개정안을
   묶은 판에서 화면의 양식은 막고 화면에 없는 Rev.00 양식은 받는다 (2026-11-25).
--------------------------------------------------------------------------- */

/** lib/db.ts 의 Db 와 시험 도구가 둘 다 맞는 모양 */
interface ValDb {
  val<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
}

/** 그 공정 기록에 이 양식의 칸을 적어도 되는가 - 그 지시의 제품표준서 판이 쓰는 양식만 */
export async function brFormOfRecord(db: ValDb, recordId: string, docId: string): Promise<boolean> {
  const ok = await db.val<boolean>(
    `select exists (select 1 from process_record pr
                      join dmr_operation o on o.id = pr.operation_id
                      join work_order wo on wo.id = pr.work_order_id
                      join device_master dm on dm.id = wo.device_master_id
                      join mfg_doc d on d.product_code = dm.product_code and d.op_code = o.code
                     where pr.id = $1 and d.id = $2 and d.kind = 'BR' and d.form is not null
                       and br_form_in_scope(d.device_master_id, d.is_current, wo.device_master_id))`,
    [recordId, docId]);
  return ok === true;
}
