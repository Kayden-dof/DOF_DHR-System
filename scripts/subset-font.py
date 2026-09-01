"""
한글 가변 폰트를 자주 쓰는 것과 드문 것으로 가른다.

    pip install fonttools brotli
    python scripts/subset-font.py

── 왜 필요한가 ─────────────────────────────────────────────────────────────
PretendardVariable.woff2 가 2,057,688 바이트다. 이 앱이 내려보내는 나머지 전부를
합친 것의 열 배가 넘고, 처음 들어오는 사람은 매번 이것을 받는다 (사용자 지적
2026-09-01 "버튼 활성 반응이 더디다"). 하이드레이션에 쓸 대역을 이것이 가져가
버튼이 살아나는 데 0.9초가 걸리고 있었다.

── 글자를 버리지 않는다 ────────────────────────────────────────────────────
이 시스템은 사람이 적은 것을 그대로 보여 준다 - 품목 이름, 작업자 이름, 일탈
경위, 공급자 이름. 오늘 없는 글자가 내일 들어온다.

흔히 하듯 자주 쓰는 2,350자만 남기고 나머지를 버리면, 드문 음절이 든 이름이
그 글자만 다른 글꼴로 그려진다. **종이에 나가는 시스템에서 이름 한 글자가 다른
모양으로 찍히는 것은 그냥 틀린 것이다.** 그래서 하나도 버리지 않고 나누기만
한다.

── 왜 유니코드 구역으로 자르지 않는가 ──────────────────────────────────────
처음에는 AC00~D7A3 을 스무 조각으로 균등하게 잘랐다. 재 보니 실제 화면 열네
개가 **스무 조각 전부**를 건드렸다 (음절 343자가 고루 퍼져 있다). 받는 양이
2,149KB 로 오히려 늘었다. 한글은 구역 순서와 사용 빈도가 무관하다.

── 그래서 빈도로 가른다 ────────────────────────────────────────────────────
KS X 1001 이 정한 2,350자가 실제 글에서 압도적으로 많이 쓰인다. 이것을 한
조각에 모으고, 나머지 8,822자를 여덟 조각으로 나눈다. `unicode-range` 에 음절을
낱낱이 적어 두면 브라우저가 필요한 조각만 받는다.

  보통 화면      기본 + 자주 쓰는 것        두 조각
  드문 이름      + 그 글자가 든 조각 하나   세 조각

── 만들어지는 것 ───────────────────────────────────────────────────────────
  public/fonts/pretendard/*.woff2   조각들
  app/fonts.css                     @font-face. globals.css 가 @import 한다

원본은 지우지 않는다. 다시 나눌 일이 있다.
"""
import os
import shutil
import sys

from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'fonts-src', 'PretendardVariable.woff2')
OUT = os.path.join(ROOT, 'public', 'fonts', 'pretendard')
CSS = os.path.join(ROOT, 'app', 'fonts.css')

# 한글 음절 밖의 것들. 어느 화면에서나 쓰이므로 한 조각에 모은다
BASE = [
    (0x0020, 0x007E),   # 라틴 기본
    (0x00A0, 0x00FF),   # 라틴 보충 (± ° × ÷)
    (0x0100, 0x017F),   # 라틴 확장 A
    (0x02B0, 0x02FF),   # 수정 문자
    (0x1100, 0x11FF),   # 한글 자모
    (0x2010, 0x205E),   # 문장부호 (… – — ' ' " " ·)
    (0x2070, 0x209F),   # 위·아래 첨자 (H₂O₂ 의 ₂)
    (0x20A0, 0x20BF),   # 통화 (₩ € $)
    (0x2100, 0x214F),   # ℃ ™ №
    (0x2190, 0x21FF),   # 화살표
    (0x2200, 0x22FF),   # 수학
    (0x2300, 0x23FF),   # 기술 기호 (⌫ 지우기 단추)
    (0x2460, 0x24FF),   # ①②③
    (0x25A0, 0x25FF),   # □ ■ ● ○
    (0x2600, 0x26FF),
    (0x2700, 0x27BF),   # ✓ ✔
    (0x3000, 0x303F),   # CJK 문장부호
    (0x3130, 0x318F),   # 한글 호환 자모
    (0x3200, 0x32FF),   # ㈜ ㎏ ㎜
    (0xA960, 0xA97F),
    (0xD7B0, 0xD7FF),
    (0xFF00, 0xFFEF),   # 전각
]

HANGUL = range(0xAC00, 0xD7A4)
RARE_PIECES = 8

if not os.path.exists(SRC):
    print(f'no source: {SRC}')
    sys.exit(2)


def is_common(cp):
    """KS X 1001 이 2바이트로 적는 2,350자인가.

    python 의 euc_kr 은 나머지 음절도 8바이트 조합열로 적어 내므로 '적히는가'
    로는 가를 수 없다. 길이를 봐야 한다.
    """
    try:
        return len(chr(cp).encode('euc_kr')) == 2
    except UnicodeEncodeError:
        return False


common = [cp for cp in HANGUL if is_common(cp)]
rare = [cp for cp in HANGUL if not is_common(cp)]


def runs(points):
    """이어지는 것은 범위로 묶는다. unicode-range 가 짧아진다."""
    out = []
    for cp in points:
        if out and cp == out[-1][1] + 1:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return [(a, b) for a, b in out]


def rng(pairs):
    return ','.join(f'U+{a:04X}' if a == b else f'U+{a:04X}-{b:04X}' for a, b in pairs)


groups = [('base', BASE), ('ks', runs(common))]
step = (len(rare) + RARE_PIECES - 1) // RARE_PIECES
for i in range(RARE_PIECES):
    part = rare[i * step:(i + 1) * step]
    if part:
        groups.append((f'r{i + 1}', runs(part)))

if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)

before = os.path.getsize(SRC)
css = []
sizes = {}

for name, pairs in groups:
    dst = os.path.join(OUT, f'pretendard-{name}.woff2')
    subset.main([
        SRC,
        f'--unicodes={rng(pairs)}',
        '--flavor=woff2',
        f'--output-file={dst}',
        '--no-hinting',
        '--layout-features=kern,liga,calt,tnum',
        '--name-IDs=*',
        '--drop-tables+=DSIG',
    ])
    sizes[name] = os.path.getsize(dst)
    css.append(
        '@font-face {\n'
        "  font-family: 'Pretendard Variable';\n"
        f"  src: url('/fonts/pretendard/pretendard-{name}.woff2') format('woff2-variations');\n"
        '  font-weight: 100 900;\n'
        '  font-style: normal;\n'
        '  font-display: fallback;\n'
        f'  unicode-range: {rng(pairs)};\n'
        '}'
    )
    n = sum(b - a + 1 for a, b in pairs)
    print(f'  {name:>4}  {sizes[name]:>9,} B  {n:>6} glyphs')

HEAD = [
    '/* scripts/subset-font.py 가 만든다. 손으로 고치지 않는다.',
    '   글자는 하나도 버리지 않았다 - 자주 쓰는 것과 드문 것으로 나누기만 했다.',
    '   브라우저가 그 화면에 실제로 쓰인 조각만 내려받는다.',
    '   원본 한 벌은 fonts-src/ 에 있다. public/ 밖이라 내보내지 않는다. */',
    '',
    '',
]
head = chr(10).join(HEAD)
path = CSS
with open(path, 'w', encoding='utf-8') as f:
    f.write(head + (chr(10) * 2).join(css) + chr(10))

usual = sizes['base'] + sizes['ks']
print()
print(f'  one file was   {before:>10,} B')
print(f'  usual screen   {usual:>10,} B  ({usual / before:.0%})  base + ks')
print(f'  css            {os.path.getsize(path):>10,} B')
