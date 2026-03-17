'use client';

import React from 'react';
import { useSession } from 'next-auth/react';
import { useBrandingStore } from '@/src/core/core-state';
import { useWhiteLabel } from '@/src/hooks/useWhiteLabel';

export default function LandingPage() {
  const { data: session } = useSession();
  const branding                      = useBrandingStore((s) => s.branding);
  const { displayName, displayLogo, displayLogoEmoji } = useWhiteLabel();

  // Logo element — image upload or emoji fallback (1 inch × 2.25 inch at 96 dpi = 96×216px)
  const logoEl = branding.portalLogoType === 'image' && branding.portalLogoImage ? (
    <div style={{
      width: 216, height: 96, borderRadius: 12, overflow: 'hidden', flexShrink: 0,
      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.18)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 8, boxSizing: 'border-box',
      boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
    }}>
      <img src={branding.portalLogoImage} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} alt="logo" />
    </div>
  ) : (
    <div style={{
      width: 216, height: 96, borderRadius: 12, flexShrink: 0,
      background: 'var(--color-primary)', border: '1px solid rgba(255,255,255,0.18)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 42,
      boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
    }}>
      {displayLogoEmoji}
    </div>
  );

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', background: 'var(--color-primary-navy)', minHeight: '100vh', color: '#fff' }}>

      {/* ── Navbar ── */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        display: 'flex', alignItems: 'center',
        padding: '0 var(--sp-4)', height: 112,
        background: 'var(--color-primary-deep)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 2px 16px rgba(0,0,0,0.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {logoEl}
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: '0.02em', color: '#fff', lineHeight: 1 }}>
              {displayName}
            </div>
            {branding.portalSubtitle && (
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.42)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 2 }}>
                {branding.portalSubtitle}
              </div>
            )}
          </div>
          <span style={{
            marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
            background: 'rgba(59,130,246,0.2)', color: '#93c5fd',
            border: '1px solid rgba(59,130,246,0.3)', borderRadius: 4, padding: '2px 7px',
          }}>BETA</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {session?.user ? (
            <a href="/portal" style={navBtnStyle(true)}>Go to Portal →</a>
          ) : (
            <>
              <a href="/login" style={navBtnStyle(false)}>Sign In</a>
              <a href="/login" style={navBtnStyle(true)}>Get Started Free</a>
            </>
          )}
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ padding: '96px var(--sp-4) 80px', textAlign: 'center', maxWidth: 860, margin: '0 auto' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 20, padding: '5px 14px', fontSize: 12, color: 'rgba(255,255,255,0.75)',
          fontWeight: 600, marginBottom: 28, letterSpacing: '0.03em',
        }}>
          🚀 Real Estate Financial Modeling — Reimagined
        </div>
        <h1 style={{
          fontSize: 52, fontWeight: 800, lineHeight: 1.1,
          background: 'linear-gradient(135deg, #ffffff 0%, rgba(255,255,255,0.55) 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          marginBottom: 24,
        }}>
          Build Smarter<br />Real Estate Models
        </h1>
        <p style={{ fontSize: 19, color: 'rgba(255,255,255,0.55)', lineHeight: 1.65, marginBottom: 40, maxWidth: 660, margin: '0 auto 40px' }}>
          Professional-grade financial modeling for real estate developers.
          Multi-asset, multi-currency, multi-scenario — with full export to Excel and PDF.
        </p>
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="/login" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'var(--color-primary)',
            color: '#fff', fontWeight: 700, fontSize: 15,
            padding: '14px 32px', borderRadius: 8,
            textDecoration: 'none', boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
            transition: 'opacity 0.15s',
          }}>
            Start Free Today →
          </a>
          <a href="#features" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
            color: 'rgba(255,255,255,0.85)', fontWeight: 600, fontSize: 15,
            padding: '14px 32px', borderRadius: 8, textDecoration: 'none',
          }}>
            Explore Features
          </a>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <section style={{ borderTop: '1px solid rgba(255,255,255,0.07)', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '28px var(--sp-4)', background: 'rgba(0,0,0,0.15)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 64, flexWrap: 'wrap', maxWidth: 800, margin: '0 auto' }}>
          {[
            { label: 'Modules', value: '6+' },
            { label: 'Asset Types', value: '3' },
            { label: 'Export Formats', value: 'Excel + PDF' },
            { label: 'Currencies', value: '20+' },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--color-primary)' }}>{s.value}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 4, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" style={{ padding: '80px var(--sp-4)', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <h2 style={{ fontSize: 36, fontWeight: 800, color: '#fff', marginBottom: 14 }}>Everything You Need to Model a Deal</h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', maxWidth: 560, margin: '0 auto' }}>
            From land acquisition to returns analysis — all in one platform.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
          {FEATURES.map(f => (
            <div key={f.title} style={{
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: 12, padding: '28px 24px',
            }}>
              <div style={{ fontSize: 32, marginBottom: 14 }}>{f.icon}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#fff', margin: 0 }}>{f.title}</h3>
                {f.badge && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: f.badge === '✓ Ready' ? 'rgba(22,101,52,0.4)' : 'rgba(120,53,15,0.4)',
                    color: f.badge === '✓ Ready' ? '#86EFAC' : '#FCD34D',
                    border: f.badge === '✓ Ready' ? '1px solid rgba(134,239,172,0.3)' : '1px solid rgba(252,211,77,0.3)',
                    letterSpacing: '0.05em',
                  }}>{f.badge}</span>
                )}
              </div>
              <p style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.65, margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Platforms ── */}
      <section style={{ padding: '80px var(--sp-4)', background: 'rgba(0,0,0,0.15)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontSize: 36, fontWeight: 800, color: '#fff', marginBottom: 14 }}>Asset Classes Covered</h2>
            <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', maxWidth: 500, margin: '0 auto' }}>
              Model residential, hospitality, and retail — standalone or mixed-use.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            {ASSET_TYPES.map(a => (
              <div key={a.name} style={{
                background: `linear-gradient(135deg, ${a.bg}22, ${a.bg}08)`,
                border: `1px solid ${a.bg}33`,
                borderRadius: 12, padding: '28px 24px',
              }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>{a.icon}</div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 8 }}>{a.name}</h3>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, margin: 0 }}>{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Workflow ── */}
      <section style={{ padding: '80px var(--sp-4)', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h2 style={{ fontSize: 36, fontWeight: 800, color: '#fff', marginBottom: 14 }}>How It Works</h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {STEPS.map((step, i) => (
            <div key={step.title} style={{ display: 'flex', gap: 24, alignItems: 'flex-start', position: 'relative', paddingBottom: i < STEPS.length - 1 ? 32 : 0 }}>
              {i < STEPS.length - 1 && (
                <div style={{ position: 'absolute', left: 19, top: 44, bottom: 0, width: 2, background: 'rgba(255,255,255,0.1)' }} />
              )}
              <div style={{
                width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                background: 'var(--color-primary)', opacity: 0.85,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 800, color: '#fff',
              }}>{i + 1}</div>
              <div style={{ paddingTop: 8 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 6 }}>{step.title}</h3>
                <p style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.65, margin: 0 }}>{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pricing ── */}
      <section style={{ padding: '80px var(--sp-4)', background: 'rgba(0,0,0,0.15)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontSize: 36, fontWeight: 800, color: '#fff', marginBottom: 14 }}>Simple, Transparent Pricing</h2>
            <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)' }}>Start free, scale when you need to.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24 }}>
            {PLANS.map(p => (
              <div key={p.name} style={{
                background: p.featured ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
                border: p.featured ? '1px solid rgba(255,255,255,0.25)' : '1px solid rgba(255,255,255,0.09)',
                borderRadius: 14, padding: '32px 28px', position: 'relative',
              }}>
                {p.featured && (
                  <div style={{
                    position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                    background: 'var(--color-primary)', color: '#fff', fontSize: 10, fontWeight: 700,
                    padding: '3px 12px', borderRadius: 20, letterSpacing: '0.07em',
                    whiteSpace: 'nowrap',
                  }}>MOST POPULAR</div>
                )}
                <h3 style={{ fontSize: 14, fontWeight: 700, color: p.featured ? '#fff' : 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>{p.name}</h3>
                <div style={{ marginBottom: 20 }}>
                  <span style={{ fontSize: 36, fontWeight: 800, color: '#fff' }}>{p.price}</span>
                  {p.period && <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginLeft: 6 }}>{p.period}</span>}
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {p.features.map(f => (
                    <li key={f} style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: '#34D399', fontWeight: 700, fontSize: 11 }}>✓</span> {f}
                    </li>
                  ))}
                </ul>
                <a href="/login" style={{
                  display: 'block', textAlign: 'center', textDecoration: 'none',
                  padding: '11px 0', borderRadius: 7, fontWeight: 700, fontSize: 14,
                  background: p.featured ? 'var(--color-primary)' : 'rgba(255,255,255,0.07)',
                  color: '#fff',
                  border: p.featured ? 'none' : '1px solid rgba(255,255,255,0.15)',
                  transition: 'opacity 0.15s',
                }}>{p.cta}</a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: '80px var(--sp-4)', textAlign: 'center' }}>
        <div style={{ maxWidth: 620, margin: '0 auto' }}>
          <h2 style={{ fontSize: 38, fontWeight: 800, color: '#fff', marginBottom: 16 }}>
            Ready to build your first model?
          </h2>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.5)', marginBottom: 36 }}>
            Join real estate professionals already using {displayName} to underwrite deals faster and more accurately.
          </p>
          <a href="/login" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'var(--color-primary)',
            color: '#fff', fontWeight: 700, fontSize: 16,
            padding: '16px 40px', borderRadius: 8,
            textDecoration: 'none', boxShadow: '0 4px 32px rgba(0,0,0,0.4)',
          }}>
            Get Started Free →
          </a>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{
        borderTop: '1px solid rgba(255,255,255,0.07)',
        background: 'var(--color-primary-deep)',
        padding: '28px var(--sp-4)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {branding.portalLogoType === 'image' && branding.portalLogoImage ? (
            <div style={{ width: 28, height: 28, borderRadius: 7, overflow: 'hidden', padding: 3, background: 'rgba(255,255,255,0.08)', boxSizing: 'border-box' }}>
              <img src={branding.portalLogoImage} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} alt="logo" />
            </div>
          ) : (
            <span style={{ fontSize: 20 }}>{displayLogoEmoji}</span>
          )}
          <span style={{ fontWeight: 700, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{displayName}</span>
          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>© {new Date().getFullYear()}</span>
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          <a href="/login" style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}>Sign In</a>
          <a href="/login" style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}>Get Started</a>
        </div>
      </footer>
    </div>
  );
}

// ── Static data ───────────────────────────────────────────────────────────────

function navBtnStyle(filled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center',
    padding: '7px 16px', borderRadius: 7,
    fontSize: 13, fontWeight: 700, textDecoration: 'none',
    background: filled ? 'var(--color-primary)' : 'transparent',
    color: '#fff',
    border: filled ? 'none' : '1px solid rgba(255,255,255,0.2)',
    cursor: 'pointer',
  };
}

const FEATURES = [
  { icon: '🧱', title: 'Module 1 — Project Setup', badge: '✓ Ready', desc: 'Define timeline, land parcels, area hierarchy, development costs and financing structure. Multi-asset, monthly or annual model.' },
  { icon: '💰', title: 'Module 2 — Revenue Analysis', badge: 'Coming Soon', desc: 'Unit-level sales, rental pricing, phased delivery schedules. Residential, hospitality, and retail revenue streams.' },
  { icon: '📉', title: 'Module 3 — Operating Expenses', badge: 'Coming Soon', desc: 'Property management, maintenance, staff costs, and overheads. Linked directly to the revenue schedule.' },
  { icon: '📈', title: 'Module 4 — Returns & Valuation', badge: 'Coming Soon', desc: 'IRR, NPV, equity multiple, cash-on-cash return, cap rate, and yield on cost. Multi-scenario comparison.' },
  { icon: '📑', title: 'Module 5 — Financial Statements', badge: 'Coming Soon', desc: 'Profit & Loss, Balance Sheet, Cash Flow Statement — all auto-generated from the model.' },
  { icon: '📊', title: 'Module 6 — Reports & Export', badge: 'Coming Soon', desc: 'Investor-ready PDF reports and formula-linked Excel workbooks. White-label branding for your firm.' },
];

const ASSET_TYPES = [
  { icon: '🏠', name: 'Residential', bg: '#3B82F6', desc: 'Apartments, villas, townhouses. Unit mix, sellable area, phased delivery, sales revenue, and equity paydown.' },
  { icon: '🏨', name: 'Hospitality', bg: '#8B5CF6', desc: 'Hotels, serviced apartments, resorts. Room count, ADR, occupancy, RevPAR, and operator structures.' },
  { icon: '🏬', name: 'Retail', bg: '#10B981', desc: 'Malls, strip retail, F&B pads. GLA, tenant mix, lease terms, passing rent, and reversionary yield.' },
];

const STEPS = [
  { title: 'Create a Project', desc: 'Set up your project with name, location, asset mix, and modeling currency. Save multiple versions for scenario comparison.' },
  { title: 'Define Land & Area', desc: 'Enter land parcels, FAR, roads allocation, and GFA split by asset class. All area metrics cascade automatically.' },
  { title: 'Input Development Costs', desc: 'Add cost line items using fixed amounts, rates per sqm, or percentages. Assign phasing profiles across construction periods.' },
  { title: 'Structure the Financing', desc: 'Set debt/equity ratios per cost line, interest rate, capitalization, and repayment schedule. Runs per asset class.' },
  { title: 'Export & Share', desc: 'Download a fully-formatted Excel workbook or a clean investor PDF report. White-label with your firm\'s branding.' },
];

const PLANS = [
  {
    name: 'Free', price: '$0', period: 'forever', featured: false, cta: 'Get Started Free',
    features: ['Up to 3 projects', 'Module 1 — Setup', 'JSON export', 'Single user'],
  },
  {
    name: 'Professional', price: '$49', period: '/ month', featured: true, cta: 'Start Free Trial',
    features: ['Up to 20 projects', 'All 6 modules', 'Excel + PDF export', 'AI assistant', 'Priority support'],
  },
  {
    name: 'Enterprise', price: 'Custom', period: '', featured: false, cta: 'Contact Sales',
    features: ['Unlimited projects', 'All modules', 'White-label branding', 'Team collaboration', 'Dedicated support'],
  },
];
