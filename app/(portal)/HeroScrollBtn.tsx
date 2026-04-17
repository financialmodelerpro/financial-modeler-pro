'use client';
import type { CSSProperties, ReactNode } from 'react';

/** Tiny client component - scroll-to-modules button used in the hero section. */
export function HeroScrollBtn({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      className={className}
      style={style}
      onClick={() =>
        document.getElementById('modules')?.scrollIntoView({ behavior: 'smooth' })
      }
    >
      {children}
    </button>
  );
}
