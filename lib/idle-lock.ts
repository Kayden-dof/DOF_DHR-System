/* ---------------------------------------------------------------------------
   자동 잠금 시간 (0157 · 사용자 2026-11-25)

   클라이언트 컴포넌트에서도 쓰므로 서버 전용 모듈을 끌어오지 않는다.

   고를 수 있는 값은 DB 제약(app_user_idle_lock_*_min_check)과 같다. 여기만 고치면
   저장할 때 DB 가 거절한다 - 둘을 함께 고친다.

     관리 화면  한 사람이 제 자리에서 쓴다. 기본 30분, 두 시간까지
     현장 화면  여러 사람이 번갈아 쓰는 패드다. 기본 20분, 30분까지
--------------------------------------------------------------------------- */

export type LockPlace = 'desk' | 'pad';

export const LOCK_DEFAULT: Record<LockPlace, number> = { desk: 30, pad: 20 };

export const LOCK_CHOICES: Record<LockPlace, readonly number[]> = {
  desk: [5, 10, 15, 20, 30, 45, 60, 90, 120],
  pad: [5, 10, 15, 20, 30],
};

export const LOCK_PLACE_LABEL: Record<LockPlace, string> = {
  desk: '관리 화면',
  pad: '현장 화면',
};

/** 고른 값이 없거나 목록 밖이면 기본값 */
export function lockMinutes(place: LockPlace, chosen: number | null | undefined): number {
  return chosen != null && LOCK_CHOICES[place].includes(chosen) ? chosen : LOCK_DEFAULT[place];
}

/** 60분 넘으면 시간으로 읽는다 */
export function minutesLabel(m: number): string {
  if (m < 60 || m % 60 !== 0) return `${m}분`;
  return `${m / 60}시간`;
}
