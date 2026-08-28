'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   시연 자료 비우기

   실 운영 전에 지어낸 배치 기록을 비워야 한다. 터미널 명령을 안내해 두었더니
   그걸 실행할 자리가 없다는 지적을 받았다 - 화면에서 눌러 끝나야 한다.

   판단은 전부 DB 함수 purge_demo_data() 안에 있다 (0050). 여기서는 부르기만
   한다. 응용에서 조건을 한 번 더 쓰면 두 곳이 갈라지고, 갈라지면 응용 쪽이
   느슨한 쪽으로 흐른다.

   자물쇠는 세 겹이다 - 표시가 있어야 하고, 표시 뒤로 감사추적이 조용해야 하고,
   시스템관리자여야 한다. 한 번 돌면 표시가 사라져 두 번째 호출은 늘 거부된다.
--------------------------------------------------------------------------- */
export async function purgeDemoData(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await requireUser();
    if (!hasRole(me, 'SYS_ADMIN')) {
      return { error: '시스템관리자만 시연 자료를 비울 수 있습니다' };
    }

    /*
     * 눌러서 지워지는 자리이므로 손이 미끄러질 여지를 없앤다. 정해진 말을
     * 그대로 적어야 넘어간다 - 확인 단추 하나로는 실수로 눌린 것과 뜻을 가진
     * 것을 가릴 수 없다.
     */
    if (String(form.get('confirm') ?? '').trim() !== '비웁니다') {
      return { error: '확인란에 "비웁니다" 를 그대로 적어 주십시오' };
    }

    const msg = await withActor(me.id, (db) =>
      db.val<string>(`select purge_demo_data()`));

    /* 띠도 숫자도 모든 화면에 걸려 있다. 한 곳만 고치면 나머지가 거짓말을 한다 */
    revalidatePath('/', 'layout');
    return { ok: true, message: msg ?? '시연 자료를 비웠습니다' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
