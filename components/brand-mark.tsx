import { getBrand } from '@/lib/brand';

/* ---------------------------------------------------------------------------
   회사 표시 (M5-2 · §2.0)

   설정에 로고가 있으면 그 그림을, 없으면 회사 이름을 글자로 낸다.
   **지어내지 않는다** - 이름도 로고도 없으면 아무것도 그리지 않는다.

   ── 왜 컴포넌트를 따로 두는가 ─────────────────────────────────────────────
   전에는 DOF 벡터(components/logo.tsx)를 화면 아홉 곳과 인쇄물이 직접 불렀다.
   그 파일은 부르는 곳이 없어져 지웠다.
   다른 제조소가 받으면 그 파일을 고쳐 다시 빌드해야 한다. 부르는 자리를 하나로
   모아 두면 설정만 바꿔도 전부 따라온다.

   ── 그림 주소에 갱신 시각을 붙인다 ────────────────────────────────────────
   로고를 바꿨는데 브라우저가 옛 그림을 들고 있으면 바꾼 줄 모른다. 주소가
   달라지면 다시 받아 온다.

   ── 인쇄물은 색을 쓰지 않는다 ─────────────────────────────────────────────
   종이는 흑백으로도 읽혀야 한다. 인쇄에서는 글자를 검게 낸다.

   ── 어두운 바탕 ───────────────────────────────────────────────────────────
   현장 화면의 머리띠와 로그인 왼쪽 면은 어둡다. 올라온 로고가 짙은 색이면 그
   위에서 사라진다 - 실제로 DOF 로고가 그랬다 (2026-09-01).

   로고 한 장으로 두 바탕을 다 감당할 수 없고, 색을 뒤집는 손질은 여러 색이 든
   로고를 한 가지 흰색으로 뭉갠다. 그래서 **어두운 바탕용 로고를 따로 받는다**
   (0074 · 사용자 선택).

     올렸으면   그 로고를 그대로 얹는다. 판이 없다
     안 올렸으면 밝은 판을 깔고 밝은 바탕용 로고를 얹는다

   뒤의 것은 어떤 로고가 올라와도 읽힌다. 회사가 흰 로고를 마련하기 전까지
   화면이 비지 않는다.

   글자로 낼 때는 판이 필요 없다. 흰 글자면 그대로 읽힌다.
--------------------------------------------------------------------------- */

export async function BrandMark({
  className, dark = false, print = false,
}: { className?: string; dark?: boolean; print?: boolean }) {
  const b = await getBrand();

  const onDark = dark && b.hasDarkLogo;

  if (b.hasLogo || onDark) {
    /* 설정에서 온 그림이라 크기를 알 수 없다. 높이는 부르는 쪽이 정한다 */
    // eslint-disable-next-line @next/next/no-img-element
    const img = (
      <img
        src={`/logo?v=${b.logoUpdatedAt ?? '0'}${onDark ? '&dark=1' : ''}`}
        alt={b.companyName || '회사 로고'}
        className={className}
        style={{ objectFit: 'contain', objectPosition: 'left' }}
      />
    );
    if (!dark || onDark) return img;
    return (
      <span className="inline-flex items-center rounded-md bg-white/92 px-2 py-1.5">
        {img}
      </span>
    );
  }

  if (!b.companyName) return null;

  return (
    <span
      className={`display leading-none ${className ?? ''}`}
      style={{
        color: print ? '#000' : dark ? '#fff' : 'var(--color-brand)',
        fontSize: 'inherit',
      }}
    >
      {b.companyName}
    </span>
  );
}

/** 바닥글의 `© 2026 회사이름`. 이름이 없으면 연도만 낸다 */
export async function BrandCopyright({ year }: { year: number | string }) {
  const b = await getBrand();
  return <>&copy; {year}{b.companyName ? ` ${b.companyName}` : ''}</>;
}


/** 머리줄의 짧은 시스템 이름 (DHR). 비우면 아무것도 그리지 않는다 */
export async function SystemName({ className }: { className?: string }) {
  const b = await getBrand();
  if (!b.systemName) return null;
  return <span className={className}>{b.systemName}</span>;
}
