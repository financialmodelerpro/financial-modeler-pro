'use client';

import Link from 'next/link';
import { CountdownTimer } from '@/src/components/shared/CountdownTimer';

const NAVY = '#0D2E5A';
const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';
const NAV_HEIGHT = 64;

interface Props {
  variant: 'signin' | 'register';
  launchDate?: string | null;
}

export function ModelingComingSoon({ variant, launchDate }: Props) {
  return (
    <div style={{ minHeight: `calc(100vh - ${NAV_HEIGHT}px)`, background: `linear-gradient(135deg, #0A1F3D 0%, ${NAVY} 50%, #0F3D6E 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ width: '100%', maxWidth: 520, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 20 }}>🚀</div>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          background: 'rgba(27,79,138,0.3)', border: '1px solid rgba(27,79,138,0.6)',
          borderRadius: 20, padding: '5px 16px', fontSize: 12,
          color: '#93C5FD', fontWeight: 700, marginBottom: 24, letterSpacing: '0.04em',
        }}>
          📐 Modeling Hub
        </div>

        <h1 style={{ fontSize: 'clamp(28px,5vw,42px)', fontWeight: 800, color: '#fff', lineHeight: 1.15, marginBottom: 16, letterSpacing: '-0.02em' }}>
          Launching Soon
        </h1>

        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', lineHeight: 1.7, marginBottom: 32, maxWidth: 420, margin: '0 auto 32px' }}>
          {variant === 'register'
            ? 'Registration will open when we launch. Join our waitlist to be the first to know.'
            : "We're putting the finishing touches on our professional financial modeling platform. Be the first to know when we launch."
          }
        </p>

        {launchDate && (
          <div style={{ marginBottom: 32 }}>
            <CountdownTimer
              targetDate={launchDate}
              accentColor="#93C5FD"
              cardBackground="rgba(27,79,138,0.35)"
              cardBorder="rgba(147,197,253,0.3)"
            />
            <div style={{
              marginTop: 14, fontSize: 12,
              color: 'rgba(255,255,255,0.4)', letterSpacing: '0.04em',
            }}>
              Launching {new Date(launchDate).toLocaleString(undefined, {
                dateStyle: 'medium', timeStyle: 'short',
              })}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <a href={`${MAIN_URL}/training`} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#1B4F8A', color: '#fff',
            fontWeight: 700, fontSize: 15, padding: '13px 32px',
            borderRadius: 8, textDecoration: 'none',
            boxShadow: '0 4px 20px rgba(27,79,138,0.4)',
          }}>
            Explore Training Hub →
          </a>

          {variant === 'signin' && (
            <Link href="/signin?bypass=true" style={{
              fontSize: 13, color: 'rgba(255,255,255,0.35)', textDecoration: 'none', marginTop: 8,
            }}>
              Already have access? Sign in →
            </Link>
          )}
        </div>

        <p style={{ marginTop: 32, fontSize: 13, color: 'rgba(255,255,255,0.25)' }}>
          <a href={MAIN_URL} style={{ color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}>← Back to Home</a>
        </p>
      </div>
    </div>
  );
}
