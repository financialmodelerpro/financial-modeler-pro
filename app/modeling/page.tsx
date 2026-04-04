import type { Metadata } from 'next';
import Link from 'next/link';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { PLATFORMS } from '@/src/config/platforms';
import { getCmsContent, cms, getModules, getTestimonialsForPage } from '@/src/lib/shared/cms';
import type { Module } from '@/src/lib/shared/cms';
import { SharedFooter } from '@/src/components/landing/SharedFooter';

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
  const [content, dbModules, testimonials] = await Promise.all([getCmsContent(), getModules(), getTestimonialsForPage('modeling')]);

  // Build a lookup from slug → DB row so the grid respects admin visibility + edits
  const dbMap = new Map<string, Module>(dbModules.map((m) => [m.slug, m]));

  // Only show platforms that exist (and aren't hidden) in the DB
  const visiblePlatforms = PLATFORMS.filter((p) => dbMap.has(p.slug));

  const heroBadge    = cms(content, 'modeling_hub', 'hero_badge',        '📐 Professional Modeling Platform');
  const heroHeadline = cms(content, 'modeling_hub', 'hero_headline',     'Build Institutional-Grade\nFinancial Models');
  const heroSub      = cms(content, 'modeling_hub', 'hero_sub',          'Structured, guided workflows for every financial discipline — real estate, business valuation, LBO, FP&A, and more. Built by practitioners. Free to use.');
  const ctaPrimary   = cms(content, 'modeling_hub', 'cta_primary',       'Register Free →');
  const ctaSecondary = cms(content, 'modeling_hub', 'cta_secondary',     'Login to Dashboard →');
  const whatHeading  = cms(content, 'modeling_hub', 'what_heading',      'What is the Modeling Hub?');
  const whatBody     = cms(content, 'modeling_hub', 'what_body',         'A structured, guided platform that replaces complex manual spreadsheets with professional financial modeling workflows. Built for analysts, investors, and advisory firms who need institutional-grade outputs fast. Every assumption is traceable. Every output is formatted for investor presentation.');
  const bottomCtaH2        = cms(content, 'modeling_hub', 'bottom_cta_heading','Ready to build your first model?');
  const testimonialsH2     = cms(content, 'modeling_hub', 'testimonials_heading', 'What Professionals Say');
  const testimonialsSub    = cms(content, 'modeling_hub', 'testimonials_sub',     'Feedback from finance professionals using the Modeling Hub.');
  const ctaSection_visible = cms(content, 'cta', 'section_visible', 'true') !== 'false';
  const footerCompany      = cms(content, 'footer', 'company_line', 'Financial Modeler Pro is a product of PaceMakers Business Consultants');
  const footerFounder      = cms(content, 'footer', 'founder_line', 'Ahmad Din — CEO & Founder');
  const footerCopyright    = cms(content, 'footer', 'copyright',    `${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`);

  return (
    <>
    <style>{`
      .fmp-modeling-prose { font-size: 15px; color: #374151; line-height: 1.8; }
      .fmp-modeling-prose p { margin-bottom: 1.25rem; }
      .fmp-modeling-prose p:last-child { margin-bottom: 0; }
      .fmp-modeling-prose ul, .fmp-modeling-prose ol { padding-left: 1.5rem; margin-bottom: 1.25rem; }
      .fmp-modeling-prose li { margin-bottom: 0.25rem; }
      .fmp-modeling-prose strong { font-weight: 700; color: #0D2E5A; }
    `}</style>
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#fff', color: '#374151', minHeight: '100vh' }}>
      <NavbarServer />
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
            <div
              className="fmp-modeling-prose"
              dangerouslySetInnerHTML={{ __html: whatBody }}
            />

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
            {visiblePlatforms.map((platform) => {
              // DB row overrides name/description/icon/status; PLATFORMS provides color/shortName
              const db = dbMap.get(platform.slug)!;
              const displayName   = db.name        || platform.name;
              const displayDesc   = db.description || platform.description;
              const displayIcon   = db.icon        || platform.icon;
              const displayStatus = db.status as 'live' | 'coming_soon';
              return (
              <div key={platform.slug} style={{
                background: '#fff', borderRadius: 14,
                border: '1px solid #E5E7EB',
                borderLeft: `4px solid ${platform.color}`,
                padding: '28px 24px',
                boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
              }}>
                {/* Top row: icon + status badge */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                  <span style={{ fontSize: 32 }}>{displayIcon}</span>
                  {displayStatus === 'live' ? (
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
                  {displayName}
                </h3>

                {/* Description */}
                <p style={{ fontSize: 12.5, color: '#6B7280', lineHeight: 1.65, marginBottom: 20, minHeight: 52 }}>
                  {displayDesc}
                </p>

                {/* CTA buttons */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {displayStatus === 'live' && (
                    <Link href="/login" style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      background: platform.color, color: '#fff',
                      fontSize: 12, fontWeight: 700, padding: '8px 18px',
                      borderRadius: 6, textDecoration: 'none',
                    }}>
                      Launch Platform →
                    </Link>
                  )}
                  <Link href={`/modeling/${platform.slug}`} style={{
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
              );
            })}
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

      {/* ── Section 5 — Testimonials ─────────────────────────────────────── */}
      {testimonials.length > 0 && (
        <section style={{ background: '#fff', padding: 'clamp(48px,7vw,80px) 40px' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
              <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 10 }}>{testimonialsH2}</h2>
              <p style={{ fontSize: 14, color: '#6B7280' }}>{testimonialsSub}</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 24 }}>
              {testimonials.map(t => (
                <div key={t.id} style={{ background: '#F9FAFB', border: `1px solid ${t.is_featured ? '#C9A84C' : '#E5E7EB'}`, borderRadius: 14, padding: 24, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', gap: 2, marginBottom: 12 }}>
                    {Array.from({length:5}).map((_,i) => <span key={i} style={{ fontSize: 14, color: i < (t.rating ?? 5) ? '#F59E0B' : '#E5E7EB' }}>★</span>)}
                  </div>
                  {t.testimonial_type === 'video' && t.video_url ? (
                    <a href={t.video_url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#0D2E5A', borderRadius: 8, padding: 20, marginBottom: 16, textDecoration: 'none', gap: 6 }}>
                      <span style={{ fontSize: 28 }}>▶️</span>
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>Watch video testimonial ↗</span>
                    </a>
                  ) : (
                    <>
                      <div style={{ fontSize: 28, color: '#1B4F8A', fontFamily: 'Georgia,serif', marginBottom: 8 }}>&ldquo;</div>
                      <p style={{ fontSize: 13.5, color: '#374151', lineHeight: 1.75, marginBottom: 16, fontStyle: 'italic', flex: 1 }}>{t.text}</p>
                    </>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg,#1B4F8A,#0D2E5A)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                      {t.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1B3A6B' }}>{t.name}</div>
                      {(t.role || t.company) && <div style={{ fontSize: 11, color: '#9CA3AF' }}>{[t.role, t.company].filter(Boolean).join(' · ')}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Section 5b — Submit testimonial CTA ─────────────────────────── */}
      <section style={{ background: '#EEF2FF', padding: 'clamp(28px,4vw,48px) 40px', textAlign: 'center', borderTop: '1px solid #C7D2FE', borderBottom: '1px solid #C7D2FE' }}>
        <div style={{ maxWidth: 540, margin: '0 auto' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#4F46E5', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
            Your Voice Matters
          </div>
          <h2 style={{ fontSize: 'clamp(18px,3vw,24px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 10 }}>
            Using the Modeling Hub? Share Your Experience
          </h2>
          <p style={{ fontSize: 13.5, color: '#6B7280', lineHeight: 1.7, marginBottom: 22 }}>
            Your feedback helps other finance professionals and helps us build a better platform.
          </p>
          <Link href="/modeling/submit-testimonial" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#1B4F8A', color: '#fff', fontWeight: 700, fontSize: 14, padding: '11px 26px', borderRadius: 8, textDecoration: 'none', boxShadow: '0 4px 16px rgba(27,79,138,0.25)' }}>
            ⭐ Submit Your Testimonial
          </Link>
        </div>
      </section>

      {/* ── Section 6 — CTA Banner ────────────────────────────────────────── */}
      {ctaSection_visible && (
        <section style={{ background: '#1B4F8A', padding: 'clamp(48px,7vw,80px) 40px', textAlign: 'center' }}>
          <div style={{ maxWidth: 600, margin: '0 auto' }}>
            <h2 style={{ fontSize: 'clamp(22px,4vw,38px)', fontWeight: 800, color: '#fff', marginBottom: 12, lineHeight: 1.2 }}>
              {bottomCtaH2}
            </h2>
            <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.75)', marginBottom: 36, lineHeight: 1.6 }}>
              Join financial professionals around the world building institutional-grade models — completely free.
            </p>
            <Link href="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', color: '#1B4F8A', fontWeight: 800, fontSize: 16, padding: '14px 40px', borderRadius: 8, textDecoration: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
              Launch Platform Free →
            </Link>
          </div>
        </section>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
    </div>
    </>
  );
}
