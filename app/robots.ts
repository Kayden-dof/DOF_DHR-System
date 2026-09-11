import type { MetadataRoute } from 'next';

/* ---------------------------------------------------------------------------
   검색에 올릴 자리가 아니다

   화면의 metadata 가 이미 noindex 를 달고 있고(app/layout.tsx), 머리글로도
   같은 말을 한다(next.config.ts). 그 둘은 **문서를 받아 간 뒤에** 읽는 말이다.
   여기는 받아 가기 전에 읽는 자리라 한 겹 앞선다.

   주소가 검색에 뜨면 여섯 자리 숫자 문 앞에 서는 사람이 늘어난다. 그 문에
   시도 제한이 걸려 있어도, 줄일 수 있는 것은 줄인다.
--------------------------------------------------------------------------- */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', disallow: '/' }] };
}
