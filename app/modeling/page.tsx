// v-cms-modeling-070
import type { Metadata } from 'next';
import Link from 'next/link';
import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { PLATFORMS } from '@/src/config/platforms';
import { getCmsContent, cms, getModules, getTestimonialsForPage, getAllPageSections } from '@/src/shared/cms';
import type { Module } from '@/src/shared/cms';
import { SharedFooter } from '@/src/hubs/main/components/landing/SharedFooter';
import { CmsField, cmsVisible } from '@/src/hubs/main/components/cms/CmsField';

export const revalidate = 0;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

export const metadata: Metadata = {
  title: 'Financial Modeling Platform | Real Estate, Valuation, LBO, Project Finance',
  description: 'Specialized financial modeling platform for every discipline. Structured workflows for Real Estate, Business Valuation, Project Finance, LBO, FP&A, and Corporate Finance. Institutional-grade models in hours, not weeks. Built for professional advisors across KSA, GCC, Pakistan, and global markets.',
  alternates: { canonical: `${APP_URL}/modeling` },
  openGraph: {
    type: 'website',
    url: `${APP_URL}/modeling`,
    title: 'FMP Modeling Hub | Specialized Financial Modeling Platforms',
    description: 'Institutional-grade financial modeling platforms — Real Estate, Valuation, LBO, Project Finance, FP&A, Corporate Finance.',
    images: [{ url: `${APP_URL}/api/og/modeling`, width: 1200, height: 630, alt: 'FMP Modeling Hub — Specialized Financial Modeling Platforms' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FMP Modeling Hub | Specialized Financial Modeling',
    description: 'Institutional-grade financial modeling platforms for analysts across KSA, GCC, Pakistan, and globally.',
    images: [`${APP_URL}/api/og/modeling`],
  },
};

// ── Static fallback data ─────────────────────────────────────────────────────

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

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function ModelingHubPage() {
  const [content, dbModules, testimonials, cmsSections] = await Promise.all([
    getCmsContent(),
    getModules(),
    getTestimonialsForPage('modeling'),
    getAllPageSections('modeling'),
  ]);

  // Build a lookup from slug → DB row so the grid respects admin visibility + edits
  const dbMap = new Map<string, Module>(dbModules.map((m) => [m.slug, m]));
  const visiblePlatforms = PLATFORMS.filter((p) => dbMap.has(p.slug));

  // ── Extract CMS sections (including hidden ones) ─────────────────────────
  const findSection = (type: string, dynamic?: string) =>
    cmsSections.find(s => {
      if (s.section_type !== type) return false;
      if (dynamic) return (s.content as Record<string, unknown>)?._dynamic === dynamic;
      return !(s.content as Record<string, unknown>)?._dynamic;
    });

  const heroRaw      = findSection('hero');
  const audienceRaw  = findSection('text_image');
  const modulesRaw   = findSection('cards', 'modules');
  const whyRaw       = cmsSections.find(s => s.section_type === 'cards' && !(s.content as Record<string, unknown>)?._dynamic && s.display_order >= 4);
  const testimRaw    = findSection('testimonials', 'testimonials');
  const submitCtaRaw = cmsSections.find(s => s.section_type === 'cta' && s.display_order <= 6);
  const bottomCtaRaw = cmsSections.find(s => s.section_type === 'cta' && s.display_order >= 7);

  // Helpers
  const fc = (raw: typeof heroRaw) => raw?.visible !== false ? raw?.content as Record<string, unknown> | undefined : undefined;
  const hidden = (raw: typeof heroRaw) => raw?.visible === false;

  // ── CMS values with fallbacks ────────────────────────────────────────────
  const h = fc(heroRaw);
  const heroBadge    = (h?.badge as string)              || cms(content, 'modeling_hub', 'hero_badge',    '📐 Professional Modeling Platform');
  const heroHeadline = (h?.headline as string)           || cms(content, 'modeling_hub', 'hero_headline', 'Build Institutional-Grade\nFinancial Models');
  const heroSub      = (h?.subtitle as string)           || cms(content, 'modeling_hub', 'hero_sub',      'Structured, guided workflows for every financial discipline - real estate, business valuation, LBO, FP&A, and more. Built by practitioners. Free to use.');
  const ctaPrimary   = (h?.cta_primary_text as string)   || cms(content, 'modeling_hub', 'cta_primary',   'Register Free →');
  const ctaPriUrl    = (h?.cta_primary_url as string)    || '/register';
  const ctaSecondary = (h?.cta_secondary_text as string) || cms(content, 'modeling_hub', 'cta_secondary', 'Login to Dashboard →');
  const ctaSecUrl    = (h?.cta_secondary_url as string)  || '/signin';

  const ac = fc(audienceRaw);
  const whatBadge   = (ac?.badge as string)   || 'The Platform';
  const whatHeading = (ac?.heading as string)  || cms(content, 'modeling_hub', 'what_heading', 'What is the Modeling Hub?');
  const whatBody    = (ac?.body as string)     || cms(content, 'modeling_hub', 'what_body',    'A structured, guided platform that replaces complex manual spreadsheets with professional financial modeling workflows. Built for analysts, investors, and advisory firms who need institutional-grade outputs fast. Every assumption is traceable. Every output is formatted for investor presentation.');
  const audienceItems = (ac?.audience as typeof AUDIENCE) || AUDIENCE;

  const mc = fc(modulesRaw);
  const modulesBadge = (mc?.badge as string)       || 'The Platforms';
  const modulesHead  = (mc?.heading as string)     || '10+ Professional Modeling Platforms';
  const modulesDesc  = (mc?.description as string) || 'Live now and launching soon - one platform for every financial modeling discipline.';

  const wc = fc(whyRaw);
  const whyHead  = (wc?.heading as string) || 'Why Modeling Hub?';
  const whyItems = (wc?.benefits as typeof WHY_ITEMS) || WHY_ITEMS;

  const tc = fc(testimRaw);
  const testimH2  = (tc?.heading as string)    || cms(content, 'modeling_hub', 'testimonials_heading', 'What Professionals Say');
  const testimSub = (tc?.subheading as string) || cms(content, 'modeling_hub', 'testimonials_sub',     'Feedback from finance professionals using the Modeling Hub.');

  // CtaEditor in Page Builder writes to: subtitle, buttonText, buttonUrl,
  // button2Text, button2Url. Older seed data used description / cta_text /
  // cta_url. Read both so new admin edits take effect without breaking any
  // rows still carrying the legacy keys.
  const sc = fc(submitCtaRaw);
  const submitBadge   = (sc?.badge as string)        || 'Your Voice Matters';
  const submitHead    = (sc?.heading as string)      || 'Using the Modeling Hub? Share Your Experience';
  const submitDesc    = (sc?.subtitle as string)     || (sc?.description as string) || 'Your feedback helps other finance professionals and helps us build a better platform.';
  const submitCtaText = (sc?.buttonText as string)   || (sc?.cta_text as string)    || '⭐ Submit Your Testimonial';
  const submitCtaUrl  = (sc?.buttonUrl as string)    || (sc?.cta_url as string)     || '/modeling/submit-testimonial';

  const bc = fc(bottomCtaRaw);
  const bottomH2      = (bc?.heading as string)      || cms(content, 'modeling_hub', 'bottom_cta_heading', 'Ready to build your first model?');
  const bottomSub     = (bc?.subtitle as string)     || (bc?.description as string) || 'Join financial professionals around the world building institutional-grade models - completely free.';
  const bottomCtaText = (bc?.buttonText as string)   || (bc?.cta_text as string)    || 'Launch Platform Free →';
  const bottomCtaUrl  = (bc?.buttonUrl as string)    || (bc?.cta_url as string)     || '/register';

  const bottomCtaVisible = bottomCtaRaw
    ? bottomCtaRaw.visible !== false
    : cms(content, 'cta', 'section_visible', 'true') !== 'false';

  const footerCompany   = cms(content, 'footer', 'company_line', 'Financial Modeler Pro is a product of PaceMakers Business Consultants');
  const footerFounder   = cms(content, 'footer', 'founder_line', 'Ahmad Din - CEO & Founder');
  const footerCopyright = cms(content, 'footer', 'copyright',    `${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`);

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

      {/* ── Section 1 - Hero ──────────────────────────────────────────────── */}
      {!hidden(heroRaw) && (() => {
        // Per-field width + alignment wrapper reading admin VF keys (e.g.
        // h.subtitle_align, h.subtitle_width). Mirrors the helper on the
        // home page so admin alignment / width / visibility all take effect.
        const fw = (key: string): React.CSSProperties => {
          const w = (h?.[`${key}_width`] as string | undefined);
          const a = (h?.[`${key}_align`] as string | undefined);
          const style: React.CSSProperties = {};
          if (a) style.textAlign = a as React.CSSProperties['textAlign'];
          if (w && w !== 'auto' && w !== '100%' && w !== '100') {
            style.maxWidth = w.endsWith('%') ? w : `${w}%`;
            style.marginLeft = 'auto';
            style.marginRight = 'auto';
          } else if (w === 'auto') {
            style.maxWidth = 'none';
          }
          return style;
        };
        return (
        <section style={{
          background: 'linear-gradient(135deg, #0A1F3D 0%, #0D2E5A 50%, #0F3D6E 100%)',
          padding: 'clamp(56px,8vw,96px) 40px clamp(64px,9vw,104px)',
          textAlign: 'center',
          color: '#fff',
        }}>
          <div style={{ maxWidth: 'min(1200px, 90vw)', margin: '0 auto' }}>
            {cmsVisible(h ?? {}, 'badge') && (
              <div style={{ ...fw('badge'),
                display: 'inline-flex', alignItems: 'center', gap: 7,
                background: 'rgba(27,79,138,0.18)', border: '1px solid rgba(27,79,138,0.45)',
                borderRadius: 20, padding: '5px 16px', fontSize: 12,
                color: '#93C5FD', fontWeight: 700, marginBottom: 24, letterSpacing: '0.04em',
              }}>
                {heroBadge}
              </div>
            )}

            {cmsVisible(h ?? {}, 'headline') && (
              <h1 style={{
                fontSize: 'clamp(28px,5vw,52px)', fontWeight: 800, color: '#fff',
                lineHeight: 1.15, marginBottom: 20, letterSpacing: '-0.02em',
                whiteSpace: 'pre-line',
                ...fw('headline'),
              }}>
                {heroHeadline}
              </h1>
            )}

            <CmsField
              content={h ?? { subtitle: heroSub }}
              field="subtitle"
              as="p"
              style={{
                fontSize: 'clamp(14px,2vw,18px)', color: 'rgba(255,255,255,0.6)',
                lineHeight: 1.7, marginBottom: 36, maxWidth: 960, margin: '0 auto 36px',
              }}
            />

            {/* Power statement — highlighted block with teal bottom border */}
            {cmsVisible(h ?? {}, 'powerStatement') && (h?.powerStatement as string) && (
              <div style={{ ...fw('powerStatement'), borderBottom: '3px solid #1ABC9C', maxWidth: 920, margin: '0 auto 26px', textAlign: 'center', paddingBottom: 16 }}>
                <CmsField
                  content={h ?? {}}
                  field="powerStatement"
                  as="p"
                  style={{ fontSize: 'clamp(0.95rem,1.8vw,1.05rem)', fontWeight: 600, color: 'rgba(255,255,255,0.9)', margin: 0, lineHeight: 1.55 }}
                />
              </div>
            )}

            {(cmsVisible(h ?? {}, 'cta_primary') && ctaPrimary.trim() && ctaPriUrl) || (cmsVisible(h ?? {}, 'cta_secondary') && ctaSecondary.trim() && ctaSecUrl) ? (
              <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
                {cmsVisible(h ?? {}, 'cta_primary') && ctaPrimary.trim() && ctaPriUrl && (
                  <a href={`${APP_URL}${ctaPriUrl}`} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    background: '#1B4F8A', color: '#fff',
                    fontWeight: 700, fontSize: 15, padding: '13px 32px',
                    borderRadius: 8, textDecoration: 'none',
                    boxShadow: '0 4px 20px rgba(27,79,138,0.4)',
                  }}>
                    {ctaPrimary}
                  </a>
                )}
                {cmsVisible(h ?? {}, 'cta_secondary') && ctaSecondary.trim() && ctaSecUrl && (
                  <a href={`${APP_URL}${ctaSecUrl}`} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    background: 'transparent', color: '#fff',
                    fontWeight: 700, fontSize: 15, padding: '13px 32px',
                    borderRadius: 8, textDecoration: 'none',
                    border: '2px solid rgba(255,255,255,0.35)',
                  }}>
                    {ctaSecondary}
                  </a>
                )}
              </div>
            ) : null}

            {/* Soft CTA — inline link with downward arrow */}
            {cmsVisible(h ?? {}, 'softCta') && (h?.softCta as string) && (
              <div style={{ ...fw('softCta'), marginTop: 26, marginBottom: 26 }}>
                <a href={(h?.softCtaUrl as string) || '#'} style={{ fontSize: '0.9rem', fontWeight: 500, color: 'rgba(255,255,255,0.65)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {h?.softCta as string} <span style={{ fontSize: 14 }}>&#8595;</span>
                </a>
              </div>
            )}

            {/* Trust line — small muted text */}
            {cmsVisible(h ?? {}, 'trustLine') && (h?.trustLine as string) && (
              <CmsField
                content={h ?? {}}
                field="trustLine"
                as="p"
                style={{ fontSize: '0.78rem', fontWeight: 400, color: 'rgba(255,255,255,0.48)', letterSpacing: '0.025em', margin: '22px auto' }}
              />
            )}

            {/* Tags — comma-separated pill chips */}
            {cmsVisible(h ?? {}, 'tags') && (h?.tags as string) && (() => {
              const tags = ((h?.tags as string) ?? '').split(',').map(t => t.trim()).filter(Boolean);
              if (!tags.length) return null;
              return (
                <div style={{ ...fw('tags'), marginTop: 22 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
                    {tags.map(tag => (
                      <span key={tag} style={{ fontSize: '0.72rem', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 999, padding: '4px 14px', color: 'rgba(255,255,255,0.58)' }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </section>
        );
      })()}

      {/* ── Section 2 - What is Modeling Hub ─────────────────────────────── */}
      {!hidden(audienceRaw) && (
        <section style={{ background: '#fff', padding: 'clamp(48px,7vw,80px) 40px' }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 52 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
                {whatBadge}
              </div>
              <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', margin: 0 }}>
                {whatHeading}
              </h2>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 48, alignItems: 'start' }}>
              <CmsField
                content={(ac ?? { body: whatBody }) as Record<string, unknown>}
                field="body"
                className="fmp-modeling-prose"
              />
              {/* C3: was a hardcoded 2-column grid that stayed 2-col on
                  every viewport — cramped to unreadable on 320px phones.
                  Now auto-collapses via minmax(min(100%, 200px), 1fr). */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 16 }}>
                {audienceItems.map((a) => (
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
      )}

      {/* ── Section 3 - Platforms Grid ────────────────────────────────────── */}
      {!hidden(modulesRaw) && (
        <section style={{ background: '#F5F7FA', padding: 'clamp(48px,7vw,80px) 40px' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 52 }}>
              {cmsVisible(mc ?? {}, 'badge') && (
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
                  {modulesBadge}
                </div>
              )}
              {cmsVisible(mc ?? {}, 'heading') && (
                <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', margin: '0 0 12px' }}>
                  {modulesHead}
                </h2>
              )}
              <CmsField
                content={mc ?? { description: modulesDesc }}
                field="description"
                as="p"
                style={{ fontSize: 15, color: '#6B7280', maxWidth: 560, margin: '0 auto' }}
              />
            </div>

            {/* I2: reduced 300→260 so platform cards breathe at 375px. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 24 }}>
              {visiblePlatforms.map((platform) => {
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
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                      <span style={{ fontSize: 32 }}>{displayIcon}</span>
                      {displayStatus === 'live' ? (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#F0FFF4', color: '#15803D', border: '1px solid #BBF7D0', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>✓ LIVE</span>
                      ) : (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>COMING SOON</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: platform.color, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>{platform.shortName}</div>
                    <h3 style={{ fontSize: 15, fontWeight: 800, color: '#0D2E5A', margin: '0 0 10px', lineHeight: 1.3 }}>{displayName}</h3>
                    <p style={{ fontSize: 12.5, color: '#6B7280', lineHeight: 1.65, marginBottom: 20, minHeight: 52 }}>{displayDesc}</p>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {displayStatus === 'live' && (
                        <a href={`${APP_URL}/signin`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: platform.color, color: '#fff', fontSize: 12, fontWeight: 700, padding: '8px 18px', borderRadius: 6, textDecoration: 'none' }}>Launch Platform →</a>
                      )}
                      <Link href={`/modeling/${platform.slug}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', color: platform.color, fontSize: 12, fontWeight: 700, padding: '7px 16px', borderRadius: 6, textDecoration: 'none', border: `1.5px solid ${platform.color}` }}>Learn More →</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── Section 4 - Why Modeling Hub ──────────────────────────────────── */}
      {!hidden(whyRaw) && (
        <section style={{ background: '#fff', padding: 'clamp(48px,7vw,80px) 40px' }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
              {cmsVisible(wc ?? {}, 'heading') && (
                <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', margin: 0 }}>
                  {whyHead}
                </h2>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 24 }}>
              {whyItems.map((item, i) => (
                <div key={item.title || i} style={{
                  background: '#F9FAFB', borderRadius: 12,
                  border: '1px solid #E5E7EB',
                  padding: '28px 22px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 32, marginBottom: 14 }}>{item.icon}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0D2E5A', marginBottom: 8 }}>
                    {item.title}
                  </div>
                  <CmsField
                    content={item as unknown as Record<string, unknown>}
                    field="desc"
                    style={{ fontSize: 12.5, color: '#6B7280', lineHeight: 1.6 }}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Section 5 - Testimonials ─────────────────────────────────────── */}
      {!hidden(testimRaw) && testimonials.length > 0 && (
        <section style={{ background: '#fff', padding: 'clamp(48px,7vw,80px) 40px' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 48 }}>
              {cmsVisible(tc ?? {}, 'heading') && (
                <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 10 }}>{testimH2}</h2>
              )}
              <CmsField
                content={tc ?? { subheading: testimSub }}
                field="subheading"
                as="p"
                style={{ fontSize: 14, color: '#6B7280' }}
              />
            </div>
            {/* N9 polish: single-column at ≤320px; 280px stays comfortable at 375+ */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 24 }}>
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

      {/* ── Section 6 - Submit Testimonial CTA ────────────────────────────── */}
      {!hidden(submitCtaRaw) && (
        <section style={{ background: '#EEF2FF', padding: 'clamp(28px,4vw,48px) 40px', textAlign: 'center', borderTop: '1px solid #C7D2FE', borderBottom: '1px solid #C7D2FE' }}>
          <div style={{ maxWidth: 540, margin: '0 auto' }}>
            {cmsVisible(sc ?? {}, 'badge') && (
              <div style={{ fontSize: 11, fontWeight: 700, color: '#4F46E5', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                {submitBadge}
              </div>
            )}
            {cmsVisible(sc ?? {}, 'heading') && (
              <h2 style={{ fontSize: 'clamp(18px,3vw,24px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 10 }}>
                {submitHead}
              </h2>
            )}
            <CmsField
              content={{ ...(sc ?? {}), description: submitDesc }}
              field="description"
              as="p"
              style={{ fontSize: 13.5, color: '#6B7280', lineHeight: 1.7, marginBottom: 22 }}
            />
            {cmsVisible(sc ?? {}, 'buttonText') && submitCtaText && submitCtaUrl && (
              <Link href={submitCtaUrl} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#1B4F8A', color: '#fff', fontWeight: 700, fontSize: 14, padding: '11px 26px', borderRadius: 8, textDecoration: 'none', boxShadow: '0 4px 16px rgba(27,79,138,0.25)' }}>
                {submitCtaText}
              </Link>
            )}
          </div>
        </section>
      )}

      {/* ── Section 7 - Bottom CTA ────────────────────────────────────────── */}
      {bottomCtaVisible && (
        <section style={{ background: '#1B4F8A', padding: 'clamp(48px,7vw,80px) 40px', textAlign: 'center' }}>
          <div style={{ maxWidth: 600, margin: '0 auto' }}>
            {cmsVisible(bc ?? {}, 'heading') && (
              <h2 style={{ fontSize: 'clamp(22px,4vw,38px)', fontWeight: 800, color: '#fff', marginBottom: 12, lineHeight: 1.2 }}>
                {bottomH2}
              </h2>
            )}
            <CmsField
              content={{ ...(bc ?? {}), description: bottomSub }}
              field="description"
              as="p"
              style={{ fontSize: 15, color: 'rgba(255,255,255,0.75)', marginBottom: 36, lineHeight: 1.6 }}
            />
            {cmsVisible(bc ?? {}, 'buttonText') && bottomCtaText && bottomCtaUrl && (
              <a href={`${APP_URL}${bottomCtaUrl}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', color: '#1B4F8A', fontWeight: 800, fontSize: 16, padding: '14px 40px', borderRadius: 8, textDecoration: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
                {bottomCtaText}
              </a>
            )}
          </div>
        </section>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
    </div>
    </>
  );
}
