import { inflateSync } from 'node:zlib';

/* ---------------------------------------------------------------------------
   PNG 의 크기와 «그림이 실제로 있는 자리»

   앱 아이콘(app/app-icon)이 쓴다. 올라온 로고는 둘레에 투명한 여백이 넉넉하다
   (지금 로고는 1359×827 가운데 글자가 850×400 남짓). 여백째 정사각에 앉히면
   글자가 아이콘의 절반도 안 된다. 투명하지 않은 픽셀의 상자를 구해 그 상자를
   가운데에 맞춘다.

   RGBA 8비트 · 비월 없음만 읽는다 (로고는 PNG 로 받는다 · 0074). 그 밖의 꼴이면
   상자를 그림 전체로 둔다 - 여백을 못 걷을 뿐 틀리게 자르지는 않는다.
--------------------------------------------------------------------------- */

export interface PngBox {
  width: number;
  height: number;
  /** 투명하지 않은 픽셀을 감싸는 상자. 못 읽으면 그림 전체 */
  box: { x: number; y: number; w: number; h: number };
}

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

export function pngBox(buf: Uint8Array): PngBox | null {
  if (buf.length < 33 || SIG.some((b, i) => buf[i] !== b)) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const width = dv.getUint32(16);
  const height = dv.getUint32(20);
  const depth = buf[24], color = buf[25], interlace = buf[28];
  const whole: PngBox = { width, height, box: { x: 0, y: 0, w: width, h: height } };
  if (!width || !height) return null;
  if (depth !== 8 || color !== 6 || interlace !== 0) return whole;
  /* 너무 큰 그림은 풀지 않는다 (요청마다 푸는 자리다) */
  if (width * height > 4096 * 4096) return whole;

  const parts: Uint8Array[] = [];
  for (let p = 8; p + 8 <= buf.length;) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
    if (type === 'IDAT') parts.push(buf.subarray(p + 8, p + 8 + len));
    if (type === 'IEND') break;
    p += 12 + len;
  }

  let raw: Uint8Array;
  try {
    raw = inflateSync(Buffer.concat(parts));
  } catch {
    return whole;
  }

  const bpp = 4;
  const stride = width * bpp;
  if (raw.length < (stride + 1) * height) return whole;

  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;

  for (let y = 0; y < height; y++) {
    const off = y * (stride + 1);
    const f = raw[off];
    for (let i = 0; i < stride; i++) {
      const v = raw[off + 1 + i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let out: number;
      switch (f) {
        case 0: out = v; break;
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + ((a + b) >> 1); break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: return whole;
      }
      cur[i] = out & 0xff;
    }
    for (let x = 0; x < width; x++) {
      /* 거의 투명한 가장자리 번짐은 그림으로 치지 않는다 */
      if (cur[x * bpp + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    prev.set(cur);
  }

  if (x1 < 0) return whole;
  return { width, height, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}
