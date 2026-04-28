'use client';

export function Skeleton({ w, h, radius = 6 }: { w: string | number; h: number; radius?: number }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: radius, flexShrink: 0,
      background: 'linear-gradient(90deg,#E5E7EB 25%,#F3F4F6 50%,#E5E7EB 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
    }} />
  );
}
