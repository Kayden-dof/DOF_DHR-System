import { getBrand } from '@/lib/brand';

/* ---------------------------------------------------------------------------
   회사 표시 (M5-2 · §2.0)

   설정에 로고가 있으면 그 그림을, 없으면 회사 이름을 글자로 낸다.
   **지어내지 않는다** — 이름도 로고도 없으면 아무것도 그리지 않는다.

   ── 왜 컴포넌트를 따로 두는가 ─────────────────────────────────────────────
   전에는 `components/logo.tsx` 의 DOF 벡터를 화면 네 곳과 인쇄물이 직접 불렀다.
   다른 제조소가 받으면 그 파일을 고쳐 다시 빌드해야 한다. 부르는 자리를 하나로
   모아 두면 설정만 바꿔도 전부 따라온다.

   ── 그림 주소에 갱신 시각을 붙인다 ────────────────────────────────────────
   로고를 바꿨는데 브라우저가 옛 그림을 들고 있으면 바꾼 줄 모른다. 주소가
   달라지면 다시 받아 온다.

   ── 인쇄물은 색을 쓰지 않는다 ─────────────────────────────────────────────
   종이는 흑백으로도 읽혀야 한다. 인쇄에서는 글자를 검게 낸다.
--------------------------------------------------------------------------- */

export async function BrandMark({
  className, dark = false, print = false,
}: { className?: string; dark?: boolean; print?: boolean }) {
  const b = await getBrand();

  if (b.hasLogo) {
    /* 설정에서 온 그림이라 크기를 알 수 없다. 높이는 부르는 쪽이 정한다 */
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={`/logo?v=${b.logoUpdatedAt ?? '0'}`}
        alt={b.companyName || '회사 로고'}
        className={className}
        style={{ objectFit: 'contain', objectPosition: 'left' }}
      />
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

/** 이름만 낸다. 어두운 면처럼 로고가 감당하지 못하는 자리에 쓴다 */
export async function BrandName({ className }: { className?: string }) {
  const b = await getBrand();
  if (!b.companyName) return null;
  return <span className={className}>{b.companyName}</span>;
}

/** 머리줄의 짧은 시스템 이름 (DHR). 비우면 아무것도 그리지 않는다 */
export async function SystemName({ className }: { className?: string }) {
  const b = await getBrand();
  if (!b.systemName) return null;
  return <span className={className}>{b.systemName}</span>;
}
