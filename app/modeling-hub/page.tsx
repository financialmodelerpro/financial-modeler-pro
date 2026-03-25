import type { Metadata } from 'next';
import Link from 'next/link';
import { Navbar } from '@/src/components/layout/Navbar';
import { PLATFORMS } from '@/src/config/platforms';
import { getCmsContent, cms } from '@/src/lib/cms';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Modeling Hub — Professional Financial Modeling Platforms | Financial Modeler Pro',
  description: 'Build institutional-grade financial models across real estate, business valuation, FP&A, LBO, and more. Free to use, built by finance professionals.',
};

// ── Static data ───────────────────────────────────────────────────────────────

const AUDIENCE = [
  { icon: '💹', role: 'Financial Analysts',         desc: 'Structured workflows replacing manual spreadsheet builds' },
  { icon: '🏢', role: 'Investment Professionals',   desc: 'Due diligence and deal-ready financial models' },
  { icon: '🏘️', role: 'Real Estate Developers',     desc: 'Development feasibilities from land to exit' },
  { icon: '👨‍👩‍👧', role: 'Family Offices',             desc: 'Multi-asset portfolio and investment modeling' },
  { icon: '🏦', role: 'Lenders & Banks',            desc: 'Credit analysis, DSCR, project finance models' },
  { icon: '🎓', role: 'Students & Aspiring Analysts', desc: 'Learn by doing with real professional frameworks' },
];

const WHY_ITEMS = [
  { icon: '⚡', title: 'Instant Outputs',  desc: 'From assumptions to investor-ready model in minutes, not days.' },
  { icon: '🔗', title: 'Fully Linked',     desc: 'Change one input, everything updates automatically across the entire model.' },
  { icon: '📤', title: 'Export Ready',     desc: 'Formula-linked Excel workbook and investor PDF with one click.' },
  { icon: '🆓', title: 'Always Free',      desc: 'No subscription, no paywall, full access from day one.' },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ModelingHubPage() {
  const content = await getCmsContent();

  const logoUrl      = cms(content, 'branding', 'logo_url', '');
  const heroBadge    = cms(content, 'modeling_hub', 'hero_badge',        '📐 Professional Modeling Platform');
  const heroHeadline = cms(content, 'modeling_hub', 'hero_headline',     'Build Institutional-Grade\nFinancial Models');
  const heroSub      = cms(content, 'modeling_hub', 'hero_sub',          'Structured, guided workflows for every financial discipline — real estate, business valuation, LBO, FP&A, and more. Built by practitioners. Free to use.');
  const ctaPrimary   = cms(content, 'modeling_hub', 'cta_primary',       'Launch Platform Free →');
  const ctaSecondary = cms(content, 'modeling_hub', 'cta_secondary',     'Login to Dashboard →');
  const whatHeading  = cms(content, 'modeling_hub', 'what_heading',      'What is the Modeling Hub?');
  const whatBody     = cms(content, 'modeling_hub', 'what_body',         'A structured, guided platform that replaces complex manual spreadsheets with professional financial modeling workflows. Built for analysts, investors, and advisory firms who need institutional-grade outputs fast. Every assumption is traceable. Every output is formatted for investor presentation.');
  const bottomCtaH2  = cms(content, 'modeling_hub', 'bottom_cta_heading','Ready to build your first model?');

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#fff', color: '#374151', minHeight: '100vh' }}>
      <Navbar logoUrl={logoUrl || undefined} />
      <div style={{ height: 64 }} />

      {/* ── Section 1 — Hero ──────────────────────────────────────────────── */}
      <section style={{
        background: 'linear-gradient(135deg, #0A1F3D 0%, #0D2E5A 50%, #0F3D6E 100%)',
        padding: 'clamp(56px,8vw,96px) 40px clamp(64px,9vw,104px)',
        textAlign: 'center',
        color: '#fff',
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {/* Badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: 'rgba(27,79,138,0.18)', border: '1px solid rgba(27,79,138,0.45)',
            borderRadius: 20, padding: '5px 16px', fontSize: 12,
            color: '#93C5FD', fontWeight: 700, marginBottom: 24, letterSpacing: '0.04em',
          }}>
            {heroBadge}
          </div>

          <h1 style={{
            fontSize: 'clamp(28px,5vw,52px)', fontWeight: 800, color: '#fff',
            lineHeight: 1.15, marginBottom: 20, letterSpacing: '-0.02em',
            whiteSpace: 'pre-line',
          }}>
            {heroHeadline}
          </h1>

          <p style={{
            fontSize: 'clamp(14px,2vw,18px)', color: 'rgba(255,255,255,0.6)',
            lineHeight: 1.7, marginBottom: 36, maxWidth: 560, margin: '0 auto 36px',
          }}>
            {heroSub}
          </p>

          {/* CTA buttons */}
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/login" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: '#1B4F8A', color: '#fff',
              fontWeight: 700, fontSize: 15, padding: '13px 32px',
              borderRadius: 8, textDecoration: 'none',
              boxShadow: '0 4px 20px rgba(27,79,138,0.4)',
            }}>
              {ctaPrimary}
            </Link>
            <Link href="/login" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'transparent', color: '#fff',
              fontWeight: 700, fontSize: 15, padding: '13px 32px',
              borderRadius: 8, textDecoration: 'none',
              border: '2px solid rgba(255,255,255,0.35)',
            }}>
              {ctaSecondary}
            </Link>
          </div>

          <p style={{ marginTop: 20, fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>
            Already have an account?{' '}
            <Link href="/login" style={{ color: '#93C5FD', textDecoration: 'none', fontWeight: 600 }}>
              Login →
            </Link>
          </p>
        </div>
      </section>

      {/* ── Section 2 — What is Modeling Hub ─────────────────────────────── */}
      <section style={{ background: '#fff', padding: 'clamp(48px,7vw,80px) 40px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
              The Platform
            </div>
            <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', margin: 0 }}>
              {whatHeading}
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 48, alignItems: 'start' }}>
            {/* Left — description */}
            <div>
              <p style={{ fontSize: 15, color: '#374151', lineHeight: 1.8, marginBottom: 20 }}>
                {whatBody}
              </p>
              <p style={{ fontSize: 15, color: '#374151', lineHeight: 1.8, marginBottom: 20 }}>
                Built for financial professionals who need institutional-grade outputs fast. Every assumption is clearly flagged and traceable, every calculation is auditable, and every output is formatted for investor presentation or lender submission.
              </p>
              <p style={{ fontSize: 15, color: '#374151', lineHeight: 1.8 }}>
                Whether you are a seasoned analyst or learning the craft, the Modeling Hub gives you a reliable, professional framework to build on — without the blank-page problem.
              </p>
            </div>

            {/* Right — audience cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {AUDIENCE.map((a) => (
                <div key={a.role} style={{
                  background: '#F9FAFB', borderRadius: 10,
                  border: '1px solid #E5E7EB',
                  padding: '18px 16px',
                }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>{a.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A', marginBottom: 4, lineHeight: 1.3 }}>
                    {a.role}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#6B7280', lineHeight: 1.55 }}>
                    {a.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 3 — Platforms Grid ────────────────────────────────────── */}
      <section style={{ background: '#F5F7FA', padding: 'clamp(48px,7vw,80px) 40px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
              The Platforms
            </div>
            <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', margin: '0 0 12px' }}>
              10+ Professional Modeling Platforms
            </h2>
            <p style={{ fontSize: 15, color: '#6B7280', maxWidth: 560, margin: '0 auto' }}>
              Live now and launching soon — one platform for every financial modeling discipline.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 24 }}>
            {PLATFORMS.map((platform) => (
              <div key={platform.slug} style={{
                background: '#fff', borderRadius: 14,
                border: '1px solid #E5E7EB',
                borderLeft: `4px solid ${platform.color}`,
                padding: '28px 24px',
                boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
              }}>
                {/* Top row: icon + status badge */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                  <span style={{ fontSize: 32 }}>{platform.icon}</span>
                  {platform.status === 'live' ? (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 10px',
                      borderRadius: 20, background: '#F0FFF4', color: '#15803D',
                      border: '1px solid #BBF7D0', letterSpacing: '0.05em', whiteSpace: 'nowrap',
                    }}>
                      ✓ LIVE
                    </span>
                  ) : (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 10px',
                      borderRadius: 20, background: '#FFFBEB', color: '#B45309',
                      border: '1px solid #FDE68A', letterSpacing: '0.05em', whiteSpace: 'nowrap',
                    }}>
                      COMING SOON
                    </span>
                  )}
                </div>

                {/* shortName */}
                <div style={{
                  fontSize: 10, fontWeight: 700, color: platform.color,
                  letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4,
                }}>
                  {platform.shortName}
                </div>

                {/* Platform name */}
                <h3 style={{ fontSize: 15, fontWeight: 800, color: '#0D2E5A', margin: '0 0 10px', lineHeight: 1.3 }}>
                  {platform.name}
                </h3>

                {/* Description */}
                <p style={{ fontSize: 12.5, color: '#6B7280', lineHeight: 1.65, marginBottom: 20, minHeight: 52 }}>
                  {platform.description}
                </p>

                {/* CTA buttons */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {platform.status === 'live' && (
                    <Link href="/login" style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      background: platform.color, color: '#fff',
                      fontSize: 12, fontWeight: 700, padding: '8px 18px',
                      borderRadius: 6, textDecoration: 'none',
                    }}>
                      Launch Platform →
                    </Link>
                  )}
                  <Link href={`/modeling-hub/${platform.slug}`} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    background: 'transparent', color: platform.color,
                    fontSize: 12, fontWeight: 700, padding: '7px 16px',
                    borderRadius: 6, textDecoration: 'none',
                    border: `1.5px solid ${platform.color}`,
                  }}>
                    Learn More →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 4 — Why Use It ────────────────────────────────────────── */}
      <section style={{ background: '#fff', padding: 'clamp(48px,7vw,80px) 40px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', margin: 0 }}>
              Why Modeling Hub?
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 24 }}>
            {WHY_ITEMS.map((item) => (
              <div key={item.title} style={{
                background: '#F9FAFB', borderRadius: 12,
                border: '1px solid #E5E7EB',
                padding: '28px 22px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 32, marginBottom: 14 }}>{item.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0D2E5A', marginBottom: 8 }}>
                  {item.title}
                </div>
                <div style={{ fontSize: 12.5, color: '#6B7280', lineHeight: 1.6 }}>
                  {item.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 5 — CTA Banner ────────────────────────────────────────── */}
      <section style={{
        background: '#1B4F8A',
        padding: 'clamp(48px,7vw,80px) 40px',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <h2 style={{
            fontSize: 'clamp(22px,4vw,38px)', fontWeight: 800,
            color: '#fff', marginBottom: 12, lineHeight: 1.2,
          }}>
            {bottomCtaH2}
          </h2>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.75)', marginBottom: 36, lineHeight: 1.6 }}>
            Join financial professionals around the world building institutional-grade models — completely free.
          </p>
          <Link href="/login" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#fff', color: '#1B4F8A',
            fontWeight: 800, fontSize: 16, padding: '14px 40px',
            borderRadius: 8, textDecoration: 'none',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          }}>
            Launch Platform Free →
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer style={{
        background: '#0D2E5A',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        padding: '24px 40px',
        display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
      }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>
          © {new Date().getFullYear()} Financial Modeler Pro
        </span>
        <div style={{ display: 'flex', gap: 20 }}>
          <Link href="/" style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}>← Home</Link>
          <Link href="/training" style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}>Training</Link>
          <Link href="/login" style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}>Login</Link>
        </div>
      </footer>
    </div>
  );
}
