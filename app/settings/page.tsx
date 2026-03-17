'use client';

import React, { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { PLAN_META, STATUS_META, CONTACT_SALES_EMAIL } from '@/src/constants/app';

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
        <div className="state-loading">Loading…</div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    router.replace('/login');
    return null;
  }

  const user = session!.user;
  const plan = PLAN_META[user.subscription_plan]    ?? PLAN_META.free;
  const stat = STATUS_META[user.subscription_status] ?? STATUS_META.trial;

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut({ callbackUrl: '/portal' });
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>

      {/* ── Top bar ── */}
      <header style={{
        background: 'var(--color-primary-deep)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        height: 52, display: 'flex', alignItems: 'center',
        padding: '0 var(--sp-4)', gap: 'var(--sp-2)',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <span style={{ fontSize: 16 }}>⚙️</span>
        <span style={{ color: 'white', fontWeight: 700, fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Settings
        </span>
        <div style={{ flex: 1 }} />
        <a href="/refm"   style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, textDecoration: 'none', marginRight: 8 }}>← Platform</a>
        <a href="/portal" style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, textDecoration: 'none', marginRight: 16 }}>← Portal</a>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          style={{
            background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)',
            color: '#fca5a5', borderRadius: 'var(--radius-sm)', padding: '5px 12px',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter,sans-serif',
          }}
        >
          {signingOut ? 'Signing out…' : 'Sign Out'}
        </button>
      </header>

      <main style={{ maxWidth: 680, margin: '0 auto', padding: 'var(--sp-5) var(--sp-4)' }}>

        {/* ── Profile card ── */}
        <div className="card" style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-3)' }}>
          <h2 className="section-header">Profile</h2>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'var(--color-primary)', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 26, color: 'white', fontWeight: 700, flexShrink: 0,
              boxShadow: '0 4px 12px rgba(30,58,138,0.3)',
            }}>
              {(user.name?.[0] ?? user.email[0]).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-heading)' }}>
                {user.name ?? 'No name set'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-meta)', marginTop: 2 }}>
                {user.email}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-2)' }}>
            <div style={fieldStyle}>
              <div style={fieldLabel}>Full Name</div>
              <div style={fieldValue}>{user.name ?? '—'}</div>
            </div>
            <div style={fieldStyle}>
              <div style={fieldLabel}>Email</div>
              <div style={fieldValue}>{user.email}</div>
            </div>
            <div style={fieldStyle}>
              <div style={fieldLabel}>User ID</div>
              <div style={{ ...fieldValue, fontSize: 11, fontFamily: 'monospace', color: 'var(--color-muted)' }}>
                {user.id}
              </div>
            </div>
            <div style={fieldStyle}>
              <div style={fieldLabel}>Role</div>
              <span style={{
                display: 'inline-block', padding: '3px 10px',
                borderRadius: 20, fontSize: 11, fontWeight: 700,
                background: user.role === 'admin' ? '#fee2e2' : 'var(--color-navy-pale)',
                color:      user.role === 'admin' ? 'var(--color-negative)' : 'var(--color-navy-mid)',
              }}>
                {user.role === 'admin' ? '👑 Admin' : '👤 User'}
              </span>
            </div>
          </div>
        </div>

        {/* ── Subscription card ── */}
        <div className="card" style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-3)' }}>
          <h2 className="section-header">Subscription</h2>

          <div style={{ display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <div style={{
              flex: 1, minWidth: 180, padding: 'var(--sp-2) var(--sp-3)',
              background: plan.bg, borderRadius: 'var(--radius-md)',
              border: `1px solid ${plan.color}30`,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: plan.color, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
                Current Plan
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: plan.color }}>
                {plan.label}
              </div>
            </div>

            <div style={{
              flex: 1, minWidth: 180, padding: 'var(--sp-2) var(--sp-3)',
              background: stat.bg, borderRadius: 'var(--radius-md)',
              border: `1px solid ${stat.color}30`,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: stat.color, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
                Status
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: stat.color }}>
                {stat.label}
              </div>
            </div>
          </div>

          <div style={{ fontSize: 13, color: 'var(--color-body)', lineHeight: 1.8 }}>
            {[
              `Projects: ${plan.limit === -1 ? 'Unlimited' : plan.limit}`,
              user.subscription_plan === 'free'       ? 'Module 1 only'              : 'All modules',
              user.subscription_plan !== 'free'       ? 'Excel + PDF export'         : 'No exports',
              user.subscription_plan !== 'free'       ? 'AI assistant included'      : 'AI assistant not included',
              user.subscription_plan === 'enterprise' ? 'White-label branding'       : '',
            ].filter(Boolean).map((f) => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>✓</span> {f}
              </div>
            ))}
          </div>

          {user.subscription_plan !== 'enterprise' && (
            <div style={{ marginTop: 'var(--sp-3)', padding: 'var(--sp-2) var(--sp-3)', background: '#f0f9ff', borderRadius: 'var(--radius-sm)', border: '1px solid #bae6fd' }}>
              <span style={{ fontSize: 12, color: '#0369a1' }}>
                Want more? Contact your administrator or{' '}
                <a href={`mailto:${CONTACT_SALES_EMAIL}`} style={{ color: '#0369a1', fontWeight: 700 }}>contact sales</a>{' '}
                to upgrade your plan.
              </span>
            </div>
          )}
        </div>

        {/* ── Danger zone ── */}
        <div className="card" style={{ padding: 'var(--sp-4)', border: '1px solid #fecaca' }}>
          <h2 className="section-header" style={{ color: 'var(--color-danger)' }}>Account</h2>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-heading)' }}>Sign out of your account</div>
              <div style={{ fontSize: 12, color: 'var(--color-meta)' }}>You will be redirected to the portal.</div>
            </div>
            <button onClick={handleSignOut} disabled={signingOut} className="btn-danger">
              {signingOut ? 'Signing out…' : 'Sign Out'}
            </button>
          </div>
        </div>

        {user.role === 'admin' && (
          <div style={{ textAlign: 'center', marginTop: 'var(--sp-3)' }}>
            <a href="/admin" style={{ fontSize: 13, color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 600 }}>
              🛡️ Go to Admin Panel →
            </a>
          </div>
        )}
      </main>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  padding:      'var(--sp-2)',
  background:   'var(--color-row-alt)',
  borderRadius: 'var(--radius-sm)',
  border:       '1px solid var(--color-border)',
};
const fieldLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.07em', color: 'var(--color-muted)', marginBottom: 4,
};
const fieldValue: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: 'var(--color-heading)',
};
