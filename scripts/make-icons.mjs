/* ---------------------------------------------------------------------------
   앱 아이콘 만들기

   로고 벡터에서 PNG 를 굽는다. 벡터 좌표는 app/layout.tsx 의 파비콘과 같은
   원본(사내 CI next DOF LOGO_type 1.ai)이다. 로고를 다시 그리거나 비슷하게
   흉내 내지 않는다 - 회사 자산이라 임의로 변형하면 안 된다.

   왜 미리 구워서 저장소에 넣는가
     · 바깥에서 받아오지 않는다. 앱이 뜨는 곳이면 아이콘도 온다 (글꼴과 같다)
     · iOS 홈 화면은 SVG 를 받지 않는다. PNG 가 있어야 한다
     · 빌드마다 다시 구우면 같은 그림의 바이트가 달라져 커밋이 지저분해진다

   다시 구울 일
     로고가 바뀔 때만. `node scripts/make-icons.mjs`

   ── 안쪽 여백 ─────────────────────────────────────────────────────────────
   maskable 아이콘은 안드로이드가 원형 · 사각 등으로 잘라 낸다. 잘려도 글자가
   남으려면 안쪽 80% 안에 그림이 들어가야 한다 (W3C 안전 영역). 그래서 일반용과
   maskable 용을 따로 굽는다. 하나로 겸하면 둘 다 어중간해진다.
--------------------------------------------------------------------------- */

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'icons');

const BAND = '#342C68';   // 법인 남보라. 어두운 면
const GRAY = '#9FA0A0';   // CI 회색 원본

/** 로고 도형. 원본 PDF 좌표계(y 가 위로) 그대로 두고 그룹으로 뒤집는다. */
const GLYPHS = `
<path d="M224.6202 147.0424 L224.6202 126.8744 L264.9562 126.8744 L264.9562 147.0424 Z"/>
<path fill="${GRAY}" d="M244.788 106.707 L264.956 106.707 L264.956 126.875 L244.788 126.875 Z"/>
<path d="M181.3278 53.1194 L195.7608 53.1194 L195.7608 71.8964 L221.9148 71.8964 L221.9148 84.1894 L195.7608 84.1894 L195.7608 93.4584 L224.6198 93.4584 L224.6198 106.7064 L181.3278 106.7064 Z"/>
<path d="M146.0408 66.0064 C138.3608 66.0064 132.1338 72.2304 132.1338 79.9124 C132.1338 87.5954 138.3608 93.8194 146.0408 93.8194 C153.7228 93.8194 159.9478 87.5954 159.9478 79.9124 C159.9478 72.2304 153.7228 66.0064 146.0408 66.0064 Z M146.0408 108.4434 C130.2828 108.4434 117.5108 95.6734 117.5108 79.9124 C117.5108 64.1524 130.2828 51.3824 146.0408 51.3824 C161.7988 51.3824 174.5708 64.1524 174.5708 79.9124 C174.5708 95.6734 161.7988 108.4434 146.0408 108.4434 Z"/>
<path d="M82.8005 66.3673 L75.4615 66.3673 L75.4615 93.4583 L82.8005 93.4583 C90.2585 93.4583 96.4165 87.5563 96.4165 79.9133 C96.4165 72.2693 90.1705 66.3673 82.8005 66.3673 Z M84.7545 106.7063 L61.0285 106.7063 L61.0285 53.1193 L84.7545 53.1193 C99.4265 53.3143 111.1675 65.1963 111.1675 79.9133 C111.1675 94.6303 99.4265 106.5113 84.7545 106.7063 Z"/>
`;

/**
 * 워드마크를 한 변 64 의 정사각 안에 앉힌다.
 *
 * 원본 ArtBox 는 x 61.03~264.96 · y 51.38~147.04 이므로 폭 203.93 · 높이 95.66.
 * 가로로 긴 워드마크라 폭을 기준으로 맞추고 세로는 가운데에 둔다.
 *
 * @param pad 가장자리에서 비워 둘 비율. maskable 은 넉넉히 준다
 * @param round 모서리 반지름. maskable 은 0 (안드로이드가 알아서 자른다)
 */
function svg(pad, round) {
  const inner = 64 * (1 - pad * 2);
  const k = inner / 203.9276;                  // 폭을 맞추는 배율
  const x = 64 * pad - 61.0284 * k;
  const y = (64 - 95.659 * k) / 2 - 51.383 * k;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
    + `<rect width="64" height="64"${round ? ` rx="${round}"` : ''} fill="${BAND}"/>`
    + `<g transform="translate(${x} ${y}) scale(${k}) translate(0 198.425) scale(1 -1)" fill="#fff">`
    + GLYPHS
    + `</g></svg>`;
}

async function png(name, size, source) {
  const buf = await sharp(Buffer.from(source), { density: 900 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(OUT, name), buf);
  console.log(`  ${name}  ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
}

await mkdir(OUT, { recursive: true });
console.log('앱 아이콘');

/* 일반용. 모서리는 둥글게 두고 여백은 좁게 */
await png('icon-192.png', 192, svg(0.11, 12));
await png('icon-512.png', 512, svg(0.11, 12));

/* iOS 홈 화면. 애플이 알아서 둥글리므로 사각으로 낸다 */
await png('apple-touch-icon.png', 180, svg(0.13, 0));

/* 안드로이드 maskable. 잘려도 남도록 안쪽 80% 안에 넣는다 */
await png('icon-maskable-512.png', 512, svg(0.20, 0));

console.log('완료. public/icons');
