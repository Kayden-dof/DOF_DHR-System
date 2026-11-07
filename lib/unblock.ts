import { ACCESS_ROWS, canOpen, openTo } from './access';
import type { RoleCode } from './roles';

/* ---------------------------------------------------------------------------
   막힌 단추에서 푸는 자리로 (사용자 요청 2026-11-07)

   "이렇게 버튼 비활성만 남겨두지 말고, 비활성을 풀기 위해 어디로 가서 작업을
   해야 하는지 연결 버튼이 같이 붙어 있으면 좋을 것 같은데."

   단추가 회색이 되고 "무엇이 필요합니다" 한 줄만 남으면, 읽는 사람은 그것이
   어느 화면에 있는지를 따로 알아야 한다. 화면이 알고 있는 것을 사람에게
   찾게 하지 않는다.

   ── 열 수 있는 사람에게만 길을 낸다 ──────────────────────────────────────
   갈 자리를 못 여는 사람에게 단추를 주면 누르고 나서 "권한 없음" 을 본다.
   그래서 판정은 서버에서 한다 - 차림표와 문지기가 쓰는 canOpen 과 같은 값
   (§4.12). 못 열면 단추 대신 그 화면이 누구에게 열려 있는지를 적는다.

   판정하지 않는다 (§1). 무엇이 비어서 막혔는지와 그것을 채우는 자리만 말한다.
--------------------------------------------------------------------------- */

export interface Fix {
  /** 갈 주소. 이 사람이 못 여는 화면이면 null */
  href: string | null;
  /** 차림표에 보이는 자리 이름. "설정 › 제품표준서" */
  place: string;
  /** 그 화면이 열리는 역할들. 못 열 때 누구에게 물을지 */
  who: string;
}

export function fixAt(
  user: { roles: RoleCode[]; screens: ReadonlyMap<string, boolean> },
  path: string,
  query = '',
): Fix {
  const row = ACCESS_ROWS.find((r) => r.path === path);
  return {
    href: canOpen(path, user.roles, user.screens) ? path + query : null,
    place: row ? `${row.group} › ${row.label}` : path,
    who: row ? openTo(row) : '',
  };
}
