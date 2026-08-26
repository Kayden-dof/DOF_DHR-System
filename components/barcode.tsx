/* ---------------------------------------------------------------------------
   Code 128-B 바코드 (SVG)

   자재 라벨의 바코드 값은 사내 로트번호 그대로다 (§4.4).
   외부 라이브러리를 쓰지 않는다. 인쇄물은 정본이므로 렌더링이 빌드나 네트워크
   상태에 좌우되면 안 된다. SVG로 직접 그려 어느 프린터에서도 같게 나온다.

   패턴표는 Code 128 표준값이다. 각 항목은 굵기 6개(바-공백-바-공백-바-공백)이며
   합이 11모듈이다. 마지막 정지 패턴만 13모듈이다.
--------------------------------------------------------------------------- */

const PATTERNS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
];

const START_B = 104;
const STOP = 106;

export default function Barcode({
  value, height = 48, module = 2, showText = false,
}: { value: string; height?: number; module?: number; showText?: boolean }) {
  const chars = [...value];
  const ok = chars.every((c) => {
    const n = c.charCodeAt(0);
    return n >= 32 && n <= 126;
  });

  if (!ok || chars.length === 0) {
    return <span className="font-mono text-lg font-bold tracking-widest">{value}</span>;
  }

  const codes = [START_B, ...chars.map((c) => c.charCodeAt(0) - 32)];
  const check = codes.reduce(
    (sum, code, i) => sum + (i === 0 ? code : code * i), 0) % 103;
  const seq = [...codes, check, STOP];

  const bars: { x: number; w: number }[] = [];
  let x = 0;
  for (const code of seq) {
    const widths = PATTERNS[code];
    for (let i = 0; i < widths.length; i++) {
      const w = Number(widths[i]) * module;
      if (i % 2 === 0) bars.push({ x, w });   // 짝수 자리가 바, 홀수가 공백
      x += w;
    }
  }

  const quiet = module * 10;   // 좌우 여백. 스캐너가 시작을 잡으려면 필요하다
  const width = x + quiet * 2;
  const textH = showText ? 14 : 0;

  return (
    <svg
      width={width}
      height={height + textH}
      viewBox={`0 0 ${width} ${height + textH}`}
      role="img"
      aria-label={`바코드 ${value}`}
      shapeRendering="crispEdges"
    >
      <rect x={0} y={0} width={width} height={height + textH} fill="#fff" />
      {bars.map((b, i) => (
        <rect key={i} x={b.x + quiet} y={0} width={b.w} height={height} fill="#000" />
      ))}
      {showText && (
        <text
          x={width / 2}
          y={height + 11}
          textAnchor="middle"
          fontSize={11}
          fontFamily="monospace"
          fill="#000"
        >
          {value}
        </text>
      )}
    </svg>
  );
}
