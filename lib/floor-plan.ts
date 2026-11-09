/* ---------------------------------------------------------------------------
   배치도 셈 (0125)

   방 모양은 사각형 여럿이고 단위는 mm, 좌표는 도면 왼쪽 위가 0 이다.
   화면(그리기 · 옮기기)과 저장(actions)이 같은 셈을 쓰도록 여기 한 곳에 둔다.
--------------------------------------------------------------------------- */

export interface Rect { x: number; y: number; w: number; h: number }

/** 끌어서 그리고 옮길 때 맞추는 격자. 벽 패널 두께(50T)와 같다 */
export const SNAP_MM = 50;

/** 이보다 작은 사각형은 손이 미끄러진 것으로 본다 */
export const MIN_RECT_MM = 300;

export const CLEAN_CLASSES = ['A', 'B', 'C', 'D', 'CNC', 'NC'] as const;

export const snap = (v: number) => Math.round(v / SNAP_MM) * SNAP_MM;

const isRect = (r: unknown): r is Rect =>
  !!r && typeof r === 'object' &&
  ['x', 'y', 'w', 'h'].every((k) => Number.isFinite((r as Record<string, unknown>)[k])) &&
  (r as Rect).w > 0 && (r as Rect).h > 0;

/** DB 의 jsonb 를 믿지 않고 한 번 거른다. 모양이 틀린 칸은 버린다 */
export function cleanRects(v: unknown): Rect[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isRect).map((r) => ({
    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h),
  }));
}

/**
 * «x, y, 가로, 세로» 를 한 줄에 하나씩 받는다. 쉼표 · 탭 · 빈칸 어느 것으로
 * 갈라도 된다. 틀린 줄이 있으면 몇째 줄인지 말한다.
 */
export function parseRects(text: string): { rects: Rect[] } | { error: string } {
  const rects: Rect[] = [];
  const lines = text.split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean);
  for (const [i, line] of lines.entries()) {
    const n = line.split(/[\s,\t]+/).filter(Boolean).map((s) => Number(s.replace(/_/g, '')));
    if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) {
      return { error: `모양 ${i + 1}째 줄은 «x, y, 가로, 세로» 네 숫자여야 합니다: ${line}` };
    }
    const [x, y, w, h] = n;
    if (w < MIN_RECT_MM || h < MIN_RECT_MM) {
      return { error: `모양 ${i + 1}째 줄의 가로 · 세로는 ${MIN_RECT_MM} mm 이상이어야 합니다` };
    }
    rects.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  }
  return { rects };
}

export const rectsText = (rects: Rect[]) =>
  rects.map((r) => `${r.x}, ${r.y}, ${r.w}, ${r.h}`).join('\n');

export function inRects(rects: Rect[], x: number, y: number) {
  return rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
}

/** 가장 큰 사각형. 방 이름과 자리 미정 설비는 여기에 놓는다 */
export function mainRect(rects: Rect[]): Rect | null {
  return rects.reduce<Rect | null>((a, r) => (!a || r.w * r.h > a.w * a.h ? r : a), null);
}

export function bounds(rects: Rect[], points: { x: number; y: number }[] = []) {
  const xs = [...rects.flatMap((r) => [r.x, r.x + r.w]), ...points.map((p) => p.x)];
  const ys = [...rects.flatMap((r) => [r.y, r.y + r.h]), ...points.map((p) => p.y)];
  if (xs.length === 0) return null;
  return {
    x: Math.min(...xs), y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
  };
}

/**
 * 방은 정했는데 자리가 없는 설비를 방 안에 줄 세운다. 저장하지 않는 자리다 -
 * 화면이 «자리 미정» 으로 그리고, 사람이 끌어 놓으면 그때 저장된다.
 */
export function autoSpots(rect: Rect, n: number): { x: number; y: number }[] {
  if (n === 0) return [];
  /* 방 이름이 위쪽에 서므로 점은 아래 절반에 줄 세운다. 좁은 방에서 이름과 겹쳤다 */
  const padX = Math.min(rect.w, rect.h) * 0.15;
  const top = rect.y + rect.h * 0.55;
  const bottom = rect.y + rect.h - Math.min(rect.w, rect.h) * 0.12;
  const iw = Math.max(rect.w - padX * 2, 1);
  const ih = Math.max(bottom - top, 1);
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * (iw / ih))));
  const rows = Math.ceil(n / cols);
  return Array.from({ length: n }, (_, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    return {
      x: Math.round(rect.x + padX + (cols === 1 ? iw / 2 : (iw * c) / (cols - 1))),
      y: Math.round(top + (rows === 1 ? ih / 2 : (ih * r) / (rows - 1))),
    };
  });
}
