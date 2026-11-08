'use client';

import { forwardRef, type ReactNode, type SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  absoluteStrokeWidth?: boolean;
};

/** Phosphor Regular uses filled outlines. Legacy stroke options must not thicken them. */
export function createIcon(name: string, shape: ReactNode) {
  const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon({
    size, color = 'currentColor', children, className, style,
    strokeWidth, absoluteStrokeWidth, ...props
  }, ref) {
    void strokeWidth;
    void absoluteStrokeWidth;
    const named = props['aria-label'] || props['aria-labelledby'] || props.role === 'img';
    return (
      <svg
        ref={ref} xmlns="http://www.w3.org/2000/svg" width={size ?? 20} height={size ?? 20}
        viewBox="0 0 256 256" color={color} aria-hidden={named ? undefined : true}
        focusable="false" {...props} fill="currentColor" stroke="none"
        data-qd-icon={name} className={['qd-phosphor-icon', className].filter(Boolean).join(' ')}
        data-qd-default-size={size === undefined && props.width === undefined && props.height === undefined ? '' : undefined}
        style={{ display: 'inline-block', flexShrink: 0, verticalAlign: 'var(--qd-icon-align, -0.18em)', ...style }}
      >
        {shape}{children}
      </svg>
    );
  });
  Icon.displayName = name;
  return Icon;
}

/** Kept for source compatibility with product icon slots. */
export type LucideIcon = ReturnType<typeof createIcon>;
