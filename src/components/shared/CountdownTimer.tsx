'use client';

import { useEffect, useState } from 'react';

interface Props {
  targetDate: string;
  onComplete?: () => void;
  accentColor?: string;
  labelColor?: string;
  cardBackground?: string;
  cardBorder?: string;
}

function calcRemaining(target: number): { d: number; h: number; m: number; s: number; done: boolean } {
  const diff = target - Date.now();
  if (diff <= 0) return { d: 0, h: 0, m: 0, s: 0, done: true };
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  return { d, h, m, s, done: false };
}

const pad = (n: number) => n.toString().padStart(2, '0');

export function CountdownTimer({
  targetDate,
  onComplete,
  accentColor = '#2DD4BF',
  labelColor = 'rgba(255,255,255,0.55)',
  cardBackground = 'rgba(13,46,90,0.7)',
  cardBorder = 'rgba(45,212,191,0.25)',
}: Props) {
  const target = new Date(targetDate).getTime();
  const valid = Number.isFinite(target);
  const [state, setState] = useState(() => valid ? calcRemaining(target) : { d: 0, h: 0, m: 0, s: 0, done: true });
  const [completedFired, setCompletedFired] = useState(false);

  useEffect(() => {
    if (!valid) return;
    const tick = () => {
      const next = calcRemaining(target);
      setState(next);
      if (next.done && !completedFired) {
        setCompletedFired(true);
        onComplete?.();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target, valid, completedFired, onComplete]);

  if (!valid) return null;

  if (state.done) {
    return (
      <div style={{
        padding: '28px 32px', borderRadius: 14,
        background: 'linear-gradient(135deg, rgba(45,212,191,0.2), rgba(13,148,136,0.2))',
        border: `1px solid ${accentColor}`, textAlign: 'center',
      }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: accentColor, letterSpacing: '-0.01em' }}>
          We&apos;re Live!
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 6 }}>
          Reload this page to sign in.
        </div>
      </div>
    );
  }

  const items: Array<[string, number]> = [
    ['DAYS', state.d],
    ['HRS', state.h],
    ['MIN', state.m],
    ['SEC', state.s],
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      // I15: small gap between the 4 digit cards; maxWidth honors the
      // narrowest of 440px and viewport-minus-gutter so digits don't
      // crush on 320px phones (each cell was ~65px; now 70-75px).
      gap: 'clamp(6px, 2vw, 10px)',
      maxWidth: 'min(440px, 100%)',
      margin: '0 auto',
    }}>
      {items.map(([label, value]) => (
        <div key={label} style={{
          background: cardBackground,
          border: `1px solid ${cardBorder}`,
          borderRadius: 12,
          padding: '18px 8px 14px',
          textAlign: 'center',
          boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
        }}>
          <div style={{
            fontSize: 'clamp(28px, 6vw, 44px)',
            fontWeight: 800,
            color: accentColor,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
            letterSpacing: '-0.02em',
            fontFamily: "'Inter', sans-serif",
          }}>
            {pad(value)}
          </div>
          <div style={{
            marginTop: 8,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.16em',
            color: labelColor,
          }}>
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}
