/*
 * 워터마크 문구. 계정 · 사번 · 본 시각.
 *
 * 서버(레이아웃이 첫 그림)와 화면(30분 갱신 · components/watermark.tsx)이 같이 부른다.
 * 'use client' 파일에 두면 서버가 부를 때 운영에서 죽으므로 여기 둔다.
 */
export function stamp(name: string, loginCode: string, at: Date = new Date()) {
  const t = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at);
  return `${name} ${loginCode} · ${t}`;
}
