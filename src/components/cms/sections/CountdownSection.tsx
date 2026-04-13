'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

function calcRemaining(target: string) {
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
    expired: false,
  };
}

export function CountdownSection({ content, styles }: Props) {
  const v = (k: string) => content[`${k}_visible`] !== false;
  const heading    = content.heading as string ?? '';
  const subtitle   = content.subtitle as string ?? '';
  const targetDate = content.targetDate as string ?? '';
  const ctaText    = content.ctaText as string ?? '';
  const ctaUrl     = content.ctaUrl as string ?? '';
  const expiredText = content.expiredText as string ?? 'This event has passed.';
  const bgColor   = (styles.bgColor as string) ?? 'linear-gradient(135deg, #0A1F3D 0%, #0D2E5A 100%)';
  const textColor = (styles.textColor as string) ?? '#ffffff';
  const py        = (styles.paddingY as string) ?? 'clamp(48px,7vw,80px)';

  const [remaining, setRemaining] = useState(calcRemaining(targetDate));

  useEffect(() => {
    if (!targetDate) return;
    const timer = setInterval(() => setRemaining(calcRemaining(targetDate)), 1000);
    return () => clearInterval(timer);
  }, [targetDate]);

  if (!targetDate) return null;

  const units = [
    { label: 'Days', value: remaining.days },
    { label: 'Hours', value: remaining.hours },
    { label: 'Minutes', value: remaining.minutes },
    { label: 'Seconds', value: remaining.seconds },
  ];

  return (
    <section style={{ background: bgColor, padding: `${py} 40px`, textAlign: 'center', color: textColor }}>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        {v('heading') && heading && (
          <h2 style={{ fontSize: 'clamp(22px,3.5vw,36px)', fontWeight: 800, marginBottom: 12, lineHeight: 1.2 }}>
            {heading}
          </h2>
        )}
        {v('subtitle') && subtitle && (
          <p style={{ fontSize: 'clamp(14px,2vw,17px)', color: 'rgba(255,255,255,0.6)', marginBottom: 36, lineHeight: 1.6 }}>
            {subtitle}
          </p>
        )}
        {remaining.expired ? (
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>{expiredText}</p>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 36, flexWrap: 'wrap' }}>
            {units.map(u => (
              <div key={u.label} style={{
                background: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: '16px 20px', minWidth: 80,
                backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.15)',
              }}>
                <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1 }}>
                  {String(u.value).padStart(2, '0')}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 600, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {u.label}
                </div>
              </div>
            ))}
          </div>
        )}
        {v('ctaText') && ctaText && ctaUrl && !remaining.expired && (
          <Link href={ctaUrl} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#2EAA4A', color: '#fff', fontWeight: 700, fontSize: 15,
            padding: '13px 32px', borderRadius: 8, textDecoration: 'none',
            boxShadow: '0 4px 20px rgba(46,170,74,0.4)',
          }}>
            {ctaText}
          </Link>
        )}
      </div>
    </section>
  );
}
