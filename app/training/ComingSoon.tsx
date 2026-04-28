'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { CountdownTimer } from '@/src/shared/components/CountdownTimer';

const NAVY = '#0D2E5A';
const GREEN = '#2EAA4A';
const TEAL = '#2DD4BF';
const GOLD = '#F5B942';
const NAV_HEIGHT = 64;

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';
const LINKEDIN_URL = 'https://www.linkedin.com/company/financial-modeler-pro';
const YOUTUBE_URL = 'https://www.youtube.com/@FinancialModelerPro';

interface Props {
  variant: 'signin' | 'register';
  launchDate: string | null;
}

export function TrainingComingSoon({ variant, launchDate }: Props) {
  const [email, setEmail] = useState('');
  const [subState, setSubState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function subscribe(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubState('loading');
    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), hubs: ['training'] }),
      });
      const data = await res.json() as { ok?: boolean; message?: string };
      if (data.ok) {
        setSubState('success');
        setMessage(data.message ?? "You're on the waitlist!");
      } else {
        setSubState('error');
        setMessage(data.message ?? 'Subscription failed. Please try again.');
      }
    } catch {
      setSubState('error');
      setMessage('Subscription failed. Please try again.');
    }
  }

  return (
    <div style={{
      minHeight: `calc(100vh - ${NAV_HEIGHT}px)`,
      background: `linear-gradient(135deg, #071530 0%, ${NAVY} 50%, #0F3D6E 100%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '40px 20px',
      fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{ width: '100%', maxWidth: 560, textAlign: 'center' }}>

        {/* Context pill (logo lives in the navbar above) */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: 'rgba(45,212,191,0.12)',
          border: '1px solid rgba(45,212,191,0.4)',
          borderRadius: 20, padding: '5px 14px',
          fontSize: 11.5, color: TEAL, fontWeight: 700,
          letterSpacing: '0.08em',
          marginBottom: 20,
        }}>
          🎓 TRAINING HUB
        </div>

        <h1 style={{
          fontSize: 'clamp(28px, 5.5vw, 44px)',
          fontWeight: 800, color: '#fff',
          lineHeight: 1.12, marginBottom: 14,
          letterSpacing: '-0.02em',
        }}>
          Training Hub Launching Soon
        </h1>

        <p style={{
          fontSize: 15.5, color: 'rgba(255,255,255,0.65)',
          lineHeight: 1.65, marginBottom: 32,
          maxWidth: 460, margin: '0 auto 32px',
        }}>
          FMP Real-World Financial Modeling is coming soon. Get ready for practitioner-built
          courses that teach the way deals are actually structured.
        </p>

        {launchDate && (
          <div style={{ marginBottom: 34 }}>
            <CountdownTimer targetDate={launchDate} />
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

        {/* Newsletter */}
        <div style={{
          background: 'rgba(13,46,90,0.55)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 14,
          padding: '22px 24px',
          marginBottom: 28,
          backdropFilter: 'blur(6px)',
        }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: '#fff',
            marginBottom: 6, letterSpacing: '0.02em',
          }}>
            Get notified when we launch
          </div>
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.55)', marginBottom: 14 }}>
            Be the first to know when Training Hub opens.
          </div>

          {subState === 'success' ? (
            <div style={{
              fontSize: 13, color: GREEN, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 18 }}>✓</span> {message}
            </div>
          ) : (
            <form onSubmit={subscribe} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="email" required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={{
                  flex: '1 1 220px',
                  padding: '11px 14px', fontSize: 14,
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.06)',
                  color: '#fff', outline: 'none',
                  fontFamily: "'Inter', sans-serif",
                }}
              />
              <button
                type="submit"
                disabled={subState === 'loading'}
                style={{
                  padding: '11px 22px', fontSize: 13, fontWeight: 700,
                  background: GREEN, color: '#fff',
                  border: 'none', borderRadius: 8,
                  cursor: subState === 'loading' ? 'not-allowed' : 'pointer',
                  opacity: subState === 'loading' ? 0.6 : 1,
                }}
              >
                {subState === 'loading' ? 'Subscribing…' : 'Notify Me'}
              </button>
            </form>
          )}
          {subState === 'error' && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#FCA5A5' }}>{message}</div>
          )}
        </div>

        {/* Social + nav */}
        <div style={{
          display: 'flex', gap: 12, justifyContent: 'center',
          flexWrap: 'wrap', marginBottom: 24,
        }}>
          <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" style={socialBtn(TEAL)}>
            LinkedIn
          </a>
          <a href={YOUTUBE_URL} target="_blank" rel="noopener noreferrer" style={socialBtn(GOLD)}>
            YouTube
          </a>
          {variant === 'signin' && (
            <Link href="/signin?bypass=true" style={socialBtn('rgba(255,255,255,0.25)')}>
              Already have access? Sign in →
            </Link>
          )}
        </div>

        <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.3)', margin: 0 }}>
          <a href={MAIN_URL} style={{ color: 'rgba(255,255,255,0.45)', textDecoration: 'none' }}>
            ← Back to Home
          </a>
        </p>
      </div>
    </div>
  );
}

function socialBtn(accent: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 18px',
    fontSize: 12.5, fontWeight: 600,
    color: '#fff',
    background: 'rgba(255,255,255,0.04)',
    border: `1px solid ${accent}`,
    borderRadius: 999, textDecoration: 'none',
  };
}
