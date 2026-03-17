/**
 * FMP Public Landing Page — Financial Modeler Pro
 * Server Component with ISR (60s revalidation)
 */

import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import Link from 'next/link';
import {
  getCmsContent, cms,
  getModules, getAssetTypes,
  getPublishedArticles, getPublishedCourses,
  getFounderProfile,
} from '@/src/lib/cms';
import { ArticleCard, ArticleCardPlaceholder } from '@/src/components/landing/ArticleCard';
import { CourseCard } from '@/src/components/landing/CourseCard';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Financial Modeler Pro — The Professional Hub for Financial Modeling',
  description: 'Professional-grade financial modeling across all disciplines. Multi-asset, multi-currency, multi-scenario — with full export to Excel and PDF.',
  openGraph: {
    title: 'Financial Modeler Pro',
    description: 'Structured Modeling. Real-World Finance.',
    type: 'website',
  },
};

export default async function LandingPage() {
  const [content, modules, assetTypes, articles, courses, founder, session] = await Promise.all([
    getCmsContent(),
    getModules(),
    getAssetTypes(),
    getPublishedArticles(3),
    getPublishedCourses(),
    getFounderProfile(),
    getServerSession(),
  ]);

  const founderName     = cms(founder, 'bio', 'name',       'Ahmad Din');
  const founderShortBio = cms(founder, 'bio', 'short_bio',  'Corporate Finance and Transaction Advisory specialist with deep expertise in financial modeling across real estate, business valuation, and corporate finance.');
  const founderLinkedIn = cms(founder, 'bio', 'linkedin_url', '');
  const founderPhotoUrl = cms(founder, 'bio', 'photo_url',  '');

  const heroHeadline = cms(content, 'hero', 'headline',    'The Professional Hub\nfor Financial Modeling');
  const heroSub      = cms(content, 'hero', 'subheadline', 'From real estate to business valuation — structured models, free training, and professional-grade exports. All in one platform.');

  const stats = [
    { value: cms(content, 'stats', 'stat1_value', '10+'),        label: cms(content, 'stats', 'stat1_label', 'Modeling Platforms') },
    { value: cms(content, 'stats', 'stat2_value', '100%'),       label: cms(content, 'stats', 'stat2_label', 'Free Training') },
    { value: cms(content, 'stats', 'stat3_value', 'Excel + PDF'), label: cms(content, 'stats', 'stat3_label', 'Export Formats') },
    { value: cms(content, 'stats', 'stat4_value', '20+'),        label: cms(content, 'stats', 'stat4_label', 'Currencies Supported') },
  ];

  const fallbackModules = [
    { id: '1',  name: 'Real Estate Financial Modeling', slug: 'real-estate',       description: 'Multi-asset real estate development models covering residential, hospitality, retail, commercial, industrial, data centers, and construction.', icon: '🏗️', status: 'live'        as const, display_order: 1,  launch_date: null },
    { id: '2',  name: 'Business Valuation',             slug: 'business-valuation', description: 'DCF analysis, comparable companies, precedent transactions, sum of parts, and LBO quick check.',                                                    icon: '💼', status: 'coming_soon' as const, display_order: 2,  launch_date: null },
    { id: '3',  name: 'FP&A Modeling',                  slug: 'fpa-modeling',       description: 'Annual budgets, rolling forecasts, budget vs actual variance analysis, and department P&L.',                                                         icon: '📊', status: 'coming_soon' as const, display_order: 3,  launch_date: null },
    { id: '4',  name: 'Equity Research',                slug: 'equity-research',    description: 'Financial model templates, initiation of coverage reports, earnings models, and sector-specific models.',                                             icon: '📈', status: 'coming_soon' as const, display_order: 4,  launch_date: null },
    { id: '5',  name: 'Project Finance',                slug: 'project-finance',    description: 'Infrastructure PPP, power and energy models, concession modeling, DSCR analysis, and debt sculpting.',                                               icon: '🏦', status: 'coming_soon' as const, display_order: 5,  launch_date: null },
    { id: '6',  name: 'LBO Modeling',                   slug: 'lbo-modeling',       description: 'Full leveraged buyout models — sources and uses, debt schedule, management equity, returns waterfall.',                                              icon: '🔄', status: 'coming_soon' as const, display_order: 6,  launch_date: null },
    { id: '7',  name: 'Corporate Finance',              slug: 'corporate-finance',  description: 'M&A models, merger consequences, accretion/dilution analysis, synergy modeling, fairness opinions.',                                                 icon: '🌍', status: 'coming_soon' as const, display_order: 7,  launch_date: null },
    { id: '8',  name: 'Energy & Utilities',             slug: 'energy-utilities',   description: 'Solar, wind, oil and gas, utility rate models, carbon credits, and power purchase agreements.',                                                       icon: '⚡', status: 'coming_soon' as const, display_order: 8,  launch_date: null },
    { id: '9',  name: 'Startup & Venture',              slug: 'startup-venture',    description: 'SaaS unit economics, runway and burn analysis, cap table modeling, cohort analysis, VC returns.',                                                     icon: '🚀', status: 'coming_soon' as const, display_order: 9,  launch_date: null },
    { id: '10', name: 'Banking & Credit',               slug: 'banking-credit',     description: 'Credit analysis, loan modeling, NPL workout, Basel compliance, portfolio stress testing.',                                                            icon: '🏛️', status: 'coming_soon' as const, display_order: 10, launch_date: null },
  ];

  const displayModules = modules.length > 0 ? modules : fallbackModules;

  const fallbackAssets = [
    { id: '1', module_id: '', name: 'Residential',                description: 'Apartments, villas, townhouses, compounds. Unit mix, sellable area, phased delivery, sales revenue, equity paydown, IRR.',              icon: '🏘️', visible: true,  display_order: 1 },
    { id: '2', module_id: '', name: 'Hospitality',                description: 'Hotels, serviced apartments, resorts. Room count, ADR, occupancy, RevPAR, operator structures, management fees.',                         icon: '🏨', visible: true,  display_order: 2 },
    { id: '3', module_id: '', name: 'Retail',                     description: 'Malls, strip retail, F&B pads. GLA, tenant mix, lease terms, passing rent, reversionary yield, anchor tenants.',                          icon: '🛍️', visible: true,  display_order: 3 },
    { id: '4', module_id: '', name: 'Commercial Office',          description: 'Office buildings, business parks, co-working. NLA, WALE, cap rate, lease expiry profile, vacancy assumptions.',                           icon: '🏢', visible: false, display_order: 4 },
    { id: '5', module_id: '', name: 'Industrial & Logistics',     description: 'Warehouses, logistics hubs, cold storage, manufacturing. Industrial yields and escalation clauses.',                                       icon: '🏭', visible: false, display_order: 5 },
    { id: '6', module_id: '', name: 'Data Centers',               description: 'Colocation, hyperscale, edge. Power (MW), rack units, PUE, OPEX modeling, cloud revenue streams.',                                        icon: '💾', visible: false, display_order: 6 },
    { id: '7', module_id: '', name: 'Construction & Infrastructure', description: 'Civil works, master plans, mixed developments. Cost phasing, contractor payments, milestone billing.',                                  icon: '🏗️', visible: false, display_order: 7 },
  ];

  const displayAssets = assetTypes.length > 0 ? assetTypes : fallbackAssets;

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: '#fff', color: '#374151', overflowX: 'hidden' }}>

      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        display: 'flex', alignItems: 'center',
        padding: '0 40px', height: 64,
        background: 'rgba(13,46,90,0.97)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 2px 20px rgba(0,0,0,0.4)',
      }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <span style={{ fontSize: 24 }}>📐</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#fff', letterSpacing: '0.01em', lineHeight: 1 }}>Financial Modeler Pro</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 2 }}>Structured Modeling. Real-World Finance.</div>
          </div>
        </Link>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {([
            { label: 'Home',             href: '/' },
            { label: 'Modeling Hub',     href: '#modules' },
            { label: 'Training Academy', href: '/training' },
            { label: 'Articles',         href: '/articles' },
            { label: 'About',            href: '/about' },
            { label: 'Pricing',          href: '#pricing' },
          ] as const).map(({ label, href }) => (
            <Link key={href} href={href} style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 500,
              color: 'rgba(255,255,255,0.75)', textDecoration: 'none',
            }}>
              {label}
            </Link>
          ))}
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.15)', margin: '0 8px' }} />
          <Link href="/portal" style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '7px 16px', borderRadius: 7,
            fontSize: 13, fontWeight: 700, textDecoration: 'none',
            background: '#1B4F8A', color: '#fff',
          }}>
            Go to Portal →
          </Link>
        </div>
      </nav>

      {/* ── Hero (DARK) ────────────────────────────────────────────────────── */}
      <section style={{
        padding: '100px 40px 90px', textAlign: 'center', position: 'relative',
        background: 'linear-gradient(180deg, #0D2E5A 0%, #0A2448 100%)',
        overflow: 'hidden', color: '#fff',
      }}>
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.04,
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '40px 40px', pointerEvents: 'none',
        }} />
        <div style={{ position: 'relative', maxWidth: 820, margin: '0 auto' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: 'rgba(27,79,138,0.5)', border: '1px solid rgba(27,79,138,0.8)',
            borderRadius: 20, padding: '5px 16px', fontSize: 12,
            color: 'rgba(255,255,255,0.8)', fontWeight: 600, marginBottom: 32, letterSpacing: '0.03em',
          }}>
            🚀 The Professional Hub for Financial Modeling
          </div>
          <h1 style={{
            fontSize: 'clamp(36px, 5vw, 58px)', fontWeight: 800, lineHeight: 1.1,
            background: 'linear-gradient(135deg, #ffffff 0%, rgba(255,255,255,0.6) 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            marginBottom: 24, whiteSpace: 'pre-line',
          }}>
            {heroHeadline}
          </h1>
          <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7, marginBottom: 44, maxWidth: 620, margin: '0 auto 44px' }}>
            {heroSub}
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/login" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: '#1B4F8A', color: '#fff', fontWeight: 700, fontSize: 15,
              padding: '14px 32px', borderRadius: 8, textDecoration: 'none',
              boxShadow: '0 4px 24px rgba(27,79,138,0.5)',
            }}>
              Launch Platform Free →
            </Link>
            <Link href="#modules" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.18)',
              color: 'rgba(255,255,255,0.85)', fontWeight: 600, fontSize: 15,
              padding: '14px 32px', borderRadius: 8, textDecoration: 'none',
            }}>
              Explore Platforms ↓
            </Link>
          </div>
        </div>
      </section>

      {/* ── Stats Bar (DARK) ───────────────────────────────────────────────── */}
      <section style={{
        borderTop: '1px solid rgba(255,255,255,0.07)', borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: '32px 40px', background: '#0A2248', color: '#fff',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 'clamp(32px, 6vw, 80px)', flexWrap: 'wrap', maxWidth: 900, margin: '0 auto' }}>
          {stats.map((s) => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 30, fontWeight: 800, color: '#4A90D9', letterSpacing: '-0.02em' }}>{s.value}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 5, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 500 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── What is FMP (WHITE) ────────────────────────────────────────────── */}
      <section style={{ padding: '88px 40px', maxWidth: 1100, margin: '0 auto', color: '#374151' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 56, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>The Platform</div>
            <h2 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 800, color: '#1B3A6B', marginBottom: 20, lineHeight: 1.2 }}>
              What is Financial Modeler Pro?
            </h2>
            <p style={{ fontSize: 15, color: '#4B5563', lineHeight: 1.75, marginBottom: 20 }}>
              {cms(content, 'about', 'what_is_fmp',
                'Financial Modeler Pro is a professional hub for financial modeling across all disciplines — built for analysts, developers, and investors. It replaces complex spreadsheets with a structured, guided workflow that produces audit-ready models in a fraction of the time.'
              )}
            </p>
            <p style={{ fontSize: 15, color: '#6B7280', lineHeight: 1.75 }}>
              {cms(content, 'about', 'what_is_fmp_2',
                'Every assumption is traceable. Every output is formatted for investor presentation. And every model can be exported to a formula-linked Excel workbook or a clean investor PDF — ready to share on day one.'
              )}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              'Multi-discipline modeling — real estate, valuation, FP&A, LBO, and more',
              'Structured workflows — from assumptions to investor-ready outputs',
              'Monthly or annual modeling with full period control',
              'Formula-linked Excel export + investor PDF reports',
              'White-label ready for advisory firms and consultants',
              '100% free training on every financial modeling topic',
            ].map((text) => (
              <div key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  background: '#E8F0FB', border: '1px solid #C7D9F2',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: '#1B4F8A', marginTop: 1,
                }}>✓</span>
                <span style={{ fontSize: 14, color: '#4B5563', lineHeight: 1.55 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Two Pillars (LIGHT GREY) ───────────────────────────────────────── */}
      <section style={{ background: '#F5F7FA', padding: '0 40px 88px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', paddingTop: 88 }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 800, color: '#1B3A6B' }}>Two Platforms. One Destination.</h2>
            <p style={{ fontSize: 15, color: '#6B7280', marginTop: 10 }}>Modeling + Training — everything a financial professional needs in one place.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
            {/* Modeling Platform */}
            <div style={{ background: '#fff', border: '1px solid #C7D9F2', borderTop: '4px solid #1B4F8A', borderRadius: 16, padding: '36px 32px', boxShadow: '0 2px 12px rgba(27,79,138,0.06)' }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>🏗️</div>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: '#1B3A6B', marginBottom: 12 }}>Modeling Platform</h3>
              <p style={{ fontSize: 14, color: '#4B5563', lineHeight: 1.7, marginBottom: 24 }}>
                Structured workflows that take you from project setup to investor-ready reports. All outputs link — change one assumption, everything updates.
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {['Multi-discipline project structure', 'Debt & equity scheduling', 'IRR, NPV, and equity multiple', 'Excel & PDF export'].map(t => (
                  <li key={t} style={{ fontSize: 13, color: '#4B5563', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ color: '#1B4F8A', fontWeight: 700 }}>→</span> {t}
                  </li>
                ))}
              </ul>
              <Link href="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#1B4F8A', color: '#fff', fontSize: 13, fontWeight: 700, padding: '10px 22px', borderRadius: 7, textDecoration: 'none' }}>
                Start Modeling Free →
              </Link>
            </div>
            {/* Training Hub */}
            <div style={{ background: '#fff', border: '1px solid #C3E9CE', borderTop: '4px solid #1A7A30', borderRadius: 16, padding: '36px 32px', boxShadow: '0 2px 12px rgba(26,122,48,0.06)' }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>🎓</div>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: '#1B3A6B', marginBottom: 12 }}>Training Hub</h3>
              <p style={{ fontSize: 14, color: '#4B5563', lineHeight: 1.7, marginBottom: 24 }}>
                Free video courses taught by finance professionals. Learn the methodology behind the model — from first principles to advanced deal structuring.
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {['Always 100% free', 'Real-world case studies', 'GCC & international markets', 'Certificate on completion'].map(t => (
                  <li key={t} style={{ fontSize: 13, color: '#4B5563', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ color: '#1A7A30', fontWeight: 700 }}>→</span> {t}
                  </li>
                ))}
              </ul>
              <Link href="/training" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#1A7A30', color: '#fff', fontSize: 13, fontWeight: 700, padding: '10px 22px', borderRadius: 7, textDecoration: 'none' }}>
                Browse Free Courses →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Modeling Hub Grid (WHITE) ──────────────────────────────────────── */}
      <section id="modules" style={{ padding: '88px 40px', background: '#fff' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>The Platforms</div>
            <h2 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 800, color: '#1B3A6B', marginBottom: 14 }}>
              10+ Professional Modeling Platforms
            </h2>
            <p style={{ fontSize: 15, color: '#6B7280', maxWidth: 560, margin: '0 auto' }}>
              Live now and launching soon — one platform for every financial modeling discipline.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
            {displayModules.map((mod) => (
              <div key={mod.id} style={{
                background: mod.status === 'live' ? '#fff' : '#F9FAFB',
                border: mod.status === 'live' ? '1px solid #C7D9F2' : '1px solid #E5E7EB',
                borderRadius: 12, padding: '24px 22px',
                borderLeft: mod.status === 'live' ? '4px solid #1B4F8A' : '4px solid #D1D5DB',
                boxShadow: mod.status === 'live' ? '0 2px 8px rgba(27,79,138,0.08)' : 'none',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <span style={{ fontSize: 28 }}>{mod.icon}</span>
                  {mod.status === 'live' ? (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: '#E8F7EC', color: '#1A7A30', border: '1px solid #C3E9CE', letterSpacing: '0.04em' }}>
                      ✓ LIVE
                    </span>
                  ) : (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: '#FEF9C3', color: '#854D0E', border: '1px solid #FDE68A', letterSpacing: '0.04em' }}>
                      COMING SOON
                    </span>
                  )}
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: mod.status === 'live' ? '#1B3A6B' : '#6B7280', marginBottom: 8 }}>{mod.name}</h3>
                <p style={{ fontSize: 13, color: '#9CA3AF', lineHeight: 1.65, margin: 0 }}>{mod.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Training Preview (LIGHT GREEN) ────────────────────────────────── */}
      <section style={{ padding: '88px 40px', background: '#E8F7EC' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 44, flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1A7A30', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Free Training</div>
              <h2 style={{ fontSize: 'clamp(22px, 3vw, 34px)', fontWeight: 800, color: '#1B3A6B', margin: 0 }}>
                Learn Financial Modeling — Free
              </h2>
            </div>
            <Link href="/training" style={{ fontSize: 13, fontWeight: 700, color: '#1A7A30', textDecoration: 'none' }}>
              Browse All Courses →
            </Link>
          </div>
          {courses.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
              {courses.slice(0, 3).map((course) => (
                <CourseCard key={course.id} course={course} />
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '56px 24px', background: '#fff', border: '1px dashed #A3D9AE', borderRadius: 12 }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>🎓</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1B3A6B', marginBottom: 8 }}>Courses Coming Soon</div>
              <div style={{ fontSize: 13, color: '#6B7280' }}>Free video training on financial modeling — launching shortly.</div>
            </div>
          )}
        </div>
      </section>

      {/* ── Articles Preview (WHITE) ───────────────────────────────────────── */}
      <section style={{ padding: '88px 40px', background: '#fff' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 44, flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Insights</div>
              <h2 style={{ fontSize: 'clamp(22px, 3vw, 34px)', fontWeight: 800, color: '#1B3A6B', margin: 0 }}>Latest Articles</h2>
            </div>
            <Link href="/articles" style={{ fontSize: 13, fontWeight: 700, color: '#1B4F8A', textDecoration: 'none' }}>View All Articles →</Link>
          </div>
          {articles.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              {articles.map((article) => (
                <ArticleCard key={article.id} article={article} />
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              {[0, 1, 2].map((i) => <ArticleCardPlaceholder key={i} index={i} />)}
            </div>
          )}
        </div>
      </section>

      {/* ── Asset Classes (LIGHT NAVY PALE) ───────────────────────────────── */}
      <section style={{ padding: '88px 40px', background: '#F4F7FC' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>Real Estate Coverage</div>
            <h2 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 800, color: '#1B3A6B', marginBottom: 14 }}>
              Real Estate — All Asset Classes
            </h2>
            <p style={{ fontSize: 15, color: '#6B7280', maxWidth: 560, margin: '0 auto' }}>
              The most comprehensive real estate modeling platform — covering every asset type from residential to data centers.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            {displayAssets.map((a) => (
              <div key={a.id} style={{
                background: a.visible ? '#fff' : '#F9FAFB',
                border: a.visible ? '1px solid #C7D9F2' : '1px solid #E5E7EB',
                borderLeft: a.visible ? '4px solid #1B4F8A' : '4px solid #D1D5DB',
                borderRadius: 14, padding: '28px 24px',
                opacity: a.visible ? 1 : 0.75,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <span style={{ fontSize: 36 }}>{a.icon}</span>
                  {!a.visible && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#F3F4F6', color: '#6B7280', border: '1px solid #E5E7EB', letterSpacing: '0.04em' }}>
                      COMING SOON
                    </span>
                  )}
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: a.visible ? '#1B3A6B' : '#6B7280', marginBottom: 10 }}>{a.name}</h3>
                <p style={{ fontSize: 13, color: '#9CA3AF', lineHeight: 1.7, margin: 0 }}>{a.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Founder Preview (DARK NAVY) ───────────────────────────────────── */}
      <section style={{ padding: '88px 40px', background: '#1B3A6B', color: '#fff' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 56, alignItems: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              {founderPhotoUrl ? (
                <div style={{ width: 220, height: 220, borderRadius: '50%', overflow: 'hidden', border: '3px solid rgba(255,255,255,0.2)', boxShadow: '0 8px 40px rgba(0,0,0,0.4)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={founderPhotoUrl} alt={founderName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ) : (
                <div style={{ width: 220, height: 220, borderRadius: '50%', background: 'linear-gradient(135deg, #1B4F8A, #2D6BA8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 80, border: '3px solid rgba(255,255,255,0.2)', boxShadow: '0 8px 40px rgba(0,0,0,0.4)' }}>
                  👤
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#4A90D9', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>The Founder</div>
              <h2 style={{ fontSize: 'clamp(22px, 3vw, 32px)', fontWeight: 800, color: '#fff', marginBottom: 6 }}>{founderName}</h2>
              <div style={{ fontSize: 14, color: '#93C5FD', fontWeight: 600, marginBottom: 20, lineHeight: 1.4 }}>
                Corporate Finance &amp; Transaction Advisory Specialist | Financial Modeling Expert
              </div>
              <p style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.65)', lineHeight: 1.75, marginBottom: 28 }}>
                {founderShortBio}
              </p>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <Link href="/about/ahmad-din" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', fontSize: 13, fontWeight: 600, padding: '9px 20px', borderRadius: 7, textDecoration: 'none' }}>
                  Read Full Profile →
                </Link>
                {founderLinkedIn && (
                  <a href={founderLinkedIn} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.65)', fontSize: 13, fontWeight: 600, padding: '9px 20px', borderRadius: 7, textDecoration: 'none' }}>
                    LinkedIn ↗
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Testimonials (WHITE) — Coming Soon ────────────────────────────── */}
      <section style={{ padding: '88px 40px', background: '#fff' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <h2 style={{ fontSize: 'clamp(22px, 3vw, 34px)', fontWeight: 800, color: '#1B3A6B', marginBottom: 10 }}>
              What Professionals Say
            </h2>
            <p style={{ fontSize: 14, color: '#6B7280' }}>We are collecting feedback from early users of Financial Modeler Pro.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ background: '#F9FAFB', border: '1px dashed #E5E7EB', borderRadius: 12, padding: '32px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 40, color: '#D1D5DB', marginBottom: 16, fontFamily: 'Georgia, serif' }}>&ldquo;</div>
                <p style={{ fontSize: 14, color: '#9CA3AF', lineHeight: 1.7, marginBottom: 20, fontStyle: 'italic' }}>
                  Testimonial coming soon
                </p>
                <p style={{ fontSize: 12, color: '#D1D5DB' }}>We are collecting feedback from early users</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing (LIGHT GREY) ──────────────────────────────────────────── */}
      <section id="pricing" style={{ padding: '88px 40px', background: '#F5F7FA' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>Pricing</div>
            <h2 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 800, color: '#1B3A6B', marginBottom: 10 }}>
              Simple, Transparent Pricing
            </h2>
            <p style={{ fontSize: 15, color: '#6B7280' }}>Join the beta — currently free for all users.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24 }}>
            {PLANS.map((p) => (
              <div key={p.name} style={{
                background: p.featured ? '#1B4F8A' : '#fff',
                border: p.featured ? 'none' : '1px solid #E5E7EB',
                borderRadius: 14, padding: '32px 28px', position: 'relative',
                boxShadow: p.featured ? '0 8px 40px rgba(27,79,138,0.25)' : '0 2px 8px rgba(0,0,0,0.04)',
              }}>
                {p.featured && (
                  <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: '#1A7A30', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 14px', borderRadius: 20, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
                    MOST POPULAR
                  </div>
                )}
                <h3 style={{ fontSize: 13, fontWeight: 700, color: p.featured ? 'rgba(255,255,255,0.7)' : '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>{p.name}</h3>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: p.featured ? '#fff' : '#1B3A6B', fontStyle: 'italic' }}>Pricing Coming Soon</span>
                </div>
                <p style={{ fontSize: 12, color: p.featured ? 'rgba(255,255,255,0.5)' : '#9CA3AF', marginBottom: 24 }}>We are finalising our pricing plans</p>
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {p.features.map((f) => (
                    <li key={f} style={{ fontSize: 13, color: p.featured ? 'rgba(255,255,255,0.8)' : '#4B5563', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: p.featured ? '#86EFAC' : '#1A7A30', fontWeight: 700, fontSize: 10 }}>✓</span> {f}
                    </li>
                  ))}
                </ul>
                <Link href="/login" style={{
                  display: 'block', textAlign: 'center', textDecoration: 'none',
                  padding: '11px 0', borderRadius: 7, fontWeight: 700, fontSize: 14,
                  background: p.featured ? 'rgba(255,255,255,0.15)' : '#1B4F8A',
                  color: '#fff',
                  border: p.featured ? '1px solid rgba(255,255,255,0.3)' : 'none',
                }}>
                  Join the Beta — Free →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Banner ─────────────────────────────────────────────────────── */}
      <section style={{ padding: '80px 40px', textAlign: 'center', background: '#1B4F8A', color: '#fff' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <h2 style={{ fontSize: 'clamp(24px, 4vw, 42px)', fontWeight: 800, color: '#fff', marginBottom: 16, lineHeight: 1.15 }}>
            Ready to build your first model?
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.65)', marginBottom: 36, lineHeight: 1.65 }}>
            Join finance professionals using Financial Modeler Pro to build better models, faster.
          </p>
          <Link href="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', color: '#1B4F8A', fontWeight: 700, fontSize: 16, padding: '16px 44px', borderRadius: 8, textDecoration: 'none', boxShadow: '0 4px 32px rgba(0,0,0,0.15)' }}>
            Get Started Free →
          </Link>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: '#0D2E5A', padding: '48px 40px', color: '#fff' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 40, marginBottom: 40 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 22 }}>📐</span>
                <span style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>Financial Modeler Pro</span>
              </div>
              <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', lineHeight: 1.7, margin: '0 0 8px' }}>
                {cms(content, 'footer', 'company_line', 'Financial Modeler Pro is a product of PaceMakers Business Consultants')}
              </p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', margin: 0 }}>
                {cms(content, 'footer', 'founder_line', 'Ahmad Din — CEO & Founder')}
              </p>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>Platform</div>
              {[['Modeling Hub', '#modules'], ['Training Academy', '/training'], ['Articles', '/articles'], ['Launch Platform', '/login']].map(([label, href]) => (
                <Link key={href} href={href} style={{ display: 'block', fontSize: 13, color: 'rgba(255,255,255,0.5)', textDecoration: 'none', marginBottom: 8 }}>{label}</Link>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>Company</div>
              {[['About FMP', '/about'], ['Founder', '/about/ahmad-din'], ['Pricing', '#pricing'], ['Sign In', '/login']].map(([label, href]) => (
                <Link key={href} href={href} style={{ display: 'block', fontSize: 13, color: 'rgba(255,255,255,0.5)', textDecoration: 'none', marginBottom: 8 }}>{label}</Link>
              ))}
            </div>
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>
              © {cms(content, 'footer', 'copyright', `${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`)}
            </span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>
              Structured Modeling. Real-World Finance.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ── Static data ────────────────────────────────────────────────────────────────

const PLANS = [
  {
    name: 'Free', featured: false,
    features: ['Up to 3 projects', 'Module 1 — Project Setup', 'JSON save & load', 'Community support'],
  },
  {
    name: 'Professional', featured: true,
    features: ['Up to 20 projects', 'All modeling modules', 'Excel + PDF export', 'Priority support'],
  },
  {
    name: 'Enterprise', featured: false,
    features: ['Unlimited projects', 'All modules', 'White-label branding', 'Team collaboration', 'Dedicated support'],
  },
];
