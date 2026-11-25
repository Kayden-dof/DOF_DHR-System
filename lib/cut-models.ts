/* ---------------------------------------------------------------------------
   현장 재단에서 고를 형명

   두께는 원재료가 정하므로 이 배치에서 나올 형명은 그 두께의 것뿐이다 (§3 ③).
   고를 형명은 이 제품의 것만이다 (0138 dm_models) - 늑연골 배치에 진피 형명이 섞이지 않는다.
   import 가 없어 시험(23_split_op SP-07)이 이 함수를 그대로 돌린다.

   두께 구간은 형명 체계가 정한다 (0075 model_band · 관리 화면 재단 목록과 같다). 전에는 뒤
   네 자리를 잘라 견줬는데, 두께 자리가 없는 체계(PC 늑연골)에서는 그 네 자리가 길이 · 너비라
   원료 로트에 두께가 적히면 숫자가 우연히 맞는 형명 하나만 남았다 (2026-11-25). 두께 자리가
   없는 형명은 두께로 견줄 수 없으므로 거르지 않는다 - 관리 화면도 그때 전부를 보인다.
--------------------------------------------------------------------------- */

/** lib/db.ts 의 Db 와 시험 도구가 둘 다 맞는 모양 */
interface RowsDb {
  rows<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface CutModel { id: string; code: string; name: string; udi: string | null }

/** 그 제품표준서 판의 형명 중 원재료 두께 구간(band)의 것. band 가 없으면 전부 */
export function cutModels(db: RowsDb, dm: string, band: string | null): Promise<CutModel[]> {
  return db.rows<CutModel>(
    `select m.id, m.code, m.name, i.udi_di as udi from dm_models($2) m join item i on i.id = m.id
      where ($1::text is null or model_band(m.code) is null or model_band(m.code) = $1)
      order by m.code`, [band, dm]);
}
