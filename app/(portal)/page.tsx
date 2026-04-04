/**
 * FMP Public Landing Page
 * Server Component — all CMS text is inline-editable for admins.
 */
import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import Link from 'next/link';
import { HeroScrollBtn } from './HeroScrollBtn';
import {
  getCmsContent, cms,
  getPublishedArticles,
  getFounderProfile, getSitePages,
  getTestimonialsForPage,
  getSectionStyles,
} from '@/src/lib/shared/cms';
import { SharedFooter } from '@/src/components/landing/SharedFooter';
import { getServerClient } from '@/src/lib/shared/supabase';
import { ArticleCard, ArticleCardPlaceholder } from '@/src/components/landing/ArticleCard';
import { InlineEdit } from '@/src/components/landing/InlineEdit';
import { AdminEditBar } from '@/src/components/landing/AdminEditBar';
import { Navbar } from '@/src/components/layout/Navbar';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Financial Modeler Pro — The Professional Hub for Financial Modeling',
  description: 'Professional-grade financial modeling across all disciplines.',
  openGraph: { title: 'Financial Modeler Pro', description: 'Structured Modeling. Real-World Finance.', type: 'website' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
// Shorthand so we don't repeat section/isAdmin/darkBg on every field
type IE = { section: string; isAdmin: boolean; darkBg?: boolean };
function ie(props: IE, fieldKey: string, value: string, tag: Parameters<typeof InlineEdit>[0]['tag'] = 'span') {
  return <InlineEdit tag={tag} section={props.section} fieldKey={fieldKey} value={value} isAdmin={props.isAdmin} darkBg={props.darkBg} />;
}

async function getPublicPlanNames(): Promise<string[]> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('pricing_plans')
      .select('name')
      .eq('is_public', true).eq('is_active', true).eq('is_custom_client', false)
      .order('display_order');
    return (data ?? []).map((p: { name: string }) => p.name);
  } catch { return []; }
}

export default async function LandingPage() {
  const [content, articles, testimonials, founder, session, sitePages, planNames] = await Promise.all([
    getCmsContent(),
    getPublishedArticles(3),
    getTestimonialsForPage('landing'),
    getFounderProfile(), getServerSession(), getSitePages(),
    getPublicPlanNames(),
  ]);

  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin';

  // ── Founder ───────────────────────────────────────────────────────────────
  const founderName     = cms(founder, 'bio', 'name',         'Ahmad Din');
  const founderShortBio = cms(founder, 'bio', 'short_bio',    'Corporate Finance and Transaction Advisory specialist with deep expertise in financial modeling across real estate, business valuation, and corporate finance.');
  const founderLinkedIn = cms(founder, 'bio', 'linkedin_url', '');
  const _founderPhotoRaw = cms(founder, 'bio', 'photo_url', '');
  // Normalise: FileReader.readAsDataURL() always returns a full data URI.
  // Guard against raw base64 strings (no prefix) that may have been stored directly.
  const founderPhotoUrl = _founderPhotoRaw.startsWith('data:') || _founderPhotoRaw.startsWith('http')
    ? _founderPhotoRaw
    : _founderPhotoRaw
      ? `data:image/jpeg;base64,${_founderPhotoRaw}`
      : '';

  // ── Hero ──────────────────────────────────────────────────────────────────
  const heroBadge          = cms(content, 'hero', 'badge_text',       '🚀 Now Live — Free to Use');
  const heroHeadline       = cms(content, 'hero', 'headline',         'Build Institutional-Grade Financial Models — Without Starting From Scratch');
  const heroSub            = cms(content, 'hero', 'subheadline',      'Pre-built, structured financial models for real estate, valuation, and project finance — designed by corporate finance professionals for real-world use.');
  const heroPowerStatement = cms(content, 'hero', 'power_statement',  'No more rebuilding models. No more broken Excel files. No more wasted hours.');
  const heroSoftCta        = cms(content, 'hero', 'soft_cta',         'Explore the platform');
  const heroTrustLine      = cms(content, 'hero', 'trust_line',       'Designed by Investment & Corporate Finance Experts  |  12+ Years Experience  |  Used Across KSA & Pakistan');
  const heroTagsRaw        = cms(content, 'hero', 'tags',             'Real Estate Models, Business Valuation, Project Finance, Fund Models');
  const heroTags           = heroTagsRaw.split(',').map(t => t.trim()).filter(Boolean);

  // ── Stats ──────────────────────────────────────────────────────────────────
  type StatItem = { value: string; label: string; order: number };
  const statsBarJson = cms(content, 'stats', 'stats_bar_items', '');
  let statsData: StatItem[] = [];
  if (statsBarJson) {
    try { statsData = (JSON.parse(statsBarJson) as StatItem[]).sort((a, b) => a.order - b.order); } catch { /* fall through */ }
  }
  if (!statsData.length) {
    statsData = [
      { value: cms(content,'stats','stat1_value','12+'),  label: cms(content,'stats','stat1_label','Years of Experience'),       order: 1 },
      { value: cms(content,'stats','stat2_value','10+'),  label: cms(content,'stats','stat2_label','Modeling Platforms'),         order: 2 },
      { value: cms(content,'stats','stat3_value','20+'),  label: cms(content,'stats','stat3_label','Currencies Supported'),       order: 3 },
      { value: cms(content,'stats','stat4_value','100%'), label: cms(content,'stats','stat4_label','Free Training — No Paywall'), order: 4 },
    ];
  }

  // ── About ─────────────────────────────────────────────────────────────────
  const aboutBadge  = cms(content, 'about', 'badge',        'The Platform');
  const aboutH2     = cms(content, 'about', 'heading',      'What is Financial Modeler Pro?');
  const aboutBody1  = cms(content, 'about', 'what_is_fmp',  'Financial Modeler Pro is a professional hub for financial modeling across all disciplines — built for analysts, developers, and investors. It replaces complex spreadsheets with a structured, guided workflow that produces audit-ready models in a fraction of the time.');
  const aboutBody2  = cms(content, 'about', 'what_is_fmp_2','Every assumption is traceable. Every output is formatted for investor presentation. And every model can be exported to a formula-linked Excel workbook or a clean investor PDF — ready to share on day one.');

  // ── Pillars ───────────────────────────────────────────────────────────────
  const pillarsH2        = cms(content, 'pillars', 'heading',       'Two Platforms. One Destination.');
  const pillarsSub       = cms(content, 'pillars', 'subheading',    'Modeling + Training — everything a financial professional needs in one place.');
  const modelTitle       = cms(content, 'pillars', 'model_title',   'Modeling Platform');
  const modelDesc        = cms(content, 'pillars', 'model_desc',    'Structured workflows that take you from project setup to investor-ready reports. All outputs link — change one assumption, everything updates.');
  const trainingTitle    = cms(content, 'pillars', 'training_title','Training Hub');
  const trainingDesc     = cms(content, 'pillars', 'training_desc', 'Free video courses taught by finance professionals. Learn the methodology behind the model — from first principles to advanced deal structuring.');

  // ── Articles section ──────────────────────────────────────────────────────
  const articlesBadge = cms(content, 'articles_section', 'badge',  'Insights');
  const articlesH2    = cms(content, 'articles_section', 'heading', 'Latest Articles');

  // ── Founder section ───────────────────────────────────────────────────────
  const founderBadge = cms(content, 'founder_section', 'badge', 'The Founder');

  // ── Testimonials ──────────────────────────────────────────────────────────
  const testimonialsH2  = cms(content, 'testimonials', 'heading',    'What Professionals Say');
  const testimonialsSub = cms(content, 'testimonials', 'subheading', 'We are collecting feedback from early users of Financial Modeler Pro.');

  // ── Pricing ───────────────────────────────────────────────────────────────
  const pricingBadge = cms(content, 'pricing', 'badge',     'Pricing');
  const pricingH2    = cms(content, 'pricing', 'heading',   'Simple, Transparent Pricing');
  const pricingSub   = cms(content, 'pricing', 'subheading','Join the beta — currently free for all users.');

  // ── CTA ───────────────────────────────────────────────────────────────────
  const ctaH2    = cms(content, 'cta', 'heading',    'Ready to build your first model?');
  const ctaSub   = cms(content, 'cta', 'subheading', 'Join finance professionals using Financial Modeler Pro to build better models, faster.');
  const ctaBtn   = cms(content, 'cta', 'button',     'Get Started Free →');

  // ── Hero CTA button text ──────────────────────────────────────────────────
  const heroCta1         = cms(content, 'hero', 'cta1',         'Launch Platform Free →');
  const heroCta2         = cms(content, 'hero', 'cta2',         'Explore Platforms ↓');

  // ── Visibility toggles ────────────────────────────────────────────────────
  const heroCta_visible    = cms(content, 'hero', 'cta_visible',     'true') !== 'false';
  const heroCta1_visible   = cms(content, 'hero', 'cta1_visible',    'false') === 'true';
  const heroCta2_visible   = cms(content, 'hero', 'cta2_visible',    'false') === 'true';
  const ctaSection_visible = cms(content, 'cta',  'section_visible', 'true') !== 'false';

  // ── Section style overrides ───────────────────────────────────────────────
  const heroStyles         = getSectionStyles(content, 'hero');
  const aboutStyles        = getSectionStyles(content, 'about');
  const pillarsStyles      = getSectionStyles(content, 'pillars');
  const founderStyles      = getSectionStyles(content, 'founder');
  const articlesStyles     = getSectionStyles(content, 'articles');
  const testimonialsStyles = getSectionStyles(content, 'testimonials');
  const pricingStyles      = getSectionStyles(content, 'pricing');
  const ctaStyles          = getSectionStyles(content, 'cta');

  // ── Footer ────────────────────────────────────────────────────────────────
  const footerCompany          = cms(content, 'footer', 'company_line',         'Financial Modeler Pro is a product of PaceMakers Business Consultants');
  const footerFounder          = cms(content, 'footer', 'founder_line',         'Ahmad Din — CEO & Founder');
  const footerCopyright        = cms(content, 'footer', 'copyright',            `${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`);
  const footerHeight           = cms(content, 'footer', 'height',               'standard') as 'compact' | 'standard' | 'large';
  const footerPaddingTop       = cms(content, 'footer', 'padding_top',          '40');
  const footerPaddingBottom    = cms(content, 'footer', 'padding_bottom',       '40');
  const footerShowDescription  = cms(content, 'footer', 'show_description',     'true') !== 'false';
  const footerShowQuickLinks   = cms(content, 'footer', 'show_quick_links',     'true') !== 'false';
  const footerShowCompanyLinks = cms(content, 'footer', 'show_company_links',   'true') !== 'false';
  const footerShowPrivacy      = cms(content, 'footer', 'show_privacy',         'true') !== 'false';
  const footerShowConfidentiality = cms(content, 'footer', 'show_confidentiality', 'true') !== 'false';

  // ── Nav pages ─────────────────────────────────────────────────────────────
  const fallbackPages = [
    { id:'1', label:'Home',             href:'/',         visible:true, display_order:1, can_toggle:false },
    { id:'2', label:'Modeling Hub',     href:'/modeling', visible:true, display_order:2, can_toggle:true },
    { id:'3', label:'Training Hub', href:'/training', visible:true, display_order:3, can_toggle:true },
    { id:'4', label:'Articles',         href:'/articles', visible:true, display_order:4, can_toggle:true },
    { id:'5', label:'About',            href:'/about',    visible:true, display_order:5, can_toggle:true },
    { id:'6', label:'Pricing',          href:'/pricing',  visible:true, display_order:6, can_toggle:true },
  ];
  const navPages = sitePages.length > 0 ? sitePages : fallbackPages;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily:"'Inter',-apple-system,sans-serif", background:'#fff', color:'#374151', overflowX:'hidden' }}>

      {/* ── Admin edit bar ─────────────────────────────────────────────────── */}
      {isAdmin && <AdminEditBar />}

      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <Navbar navPages={navPages} topOffset={isAdmin ? 44 : 0} />

      {/* ── Spacer for fixed navbar ────────────────────────────────────────── */}
      <div style={{ height: isAdmin ? 108 : 64 }} />

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section style={{ paddingTop: heroStyles.paddingY ?? 'max(130px,10vw)', paddingBottom: heroStyles.paddingY ?? 110, paddingLeft:40, paddingRight:40, textAlign:'center', position:'relative', background:'linear-gradient(180deg,#0D2E5A 0%,#0A2448 100%)', overflow:'hidden', color:'#fff' }}>
        {/* Radial gradient overlay */}
        <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(45,107,168,0.25) 0%, transparent 65%)', pointerEvents:'none' }} />
        {/* Grid pattern */}
        <div style={{ position:'absolute', inset:0, opacity:0.04, backgroundImage:'linear-gradient(rgba(255,255,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.5) 1px,transparent 1px)', backgroundSize:'40px 40px', pointerEvents:'none' }} />

        <div style={{ position:'relative', maxWidth:820, margin:'0 auto' }}>
          {/* Badge */}
          <div className="ha" style={{ animation:'hero-fade-in 550ms ease-out 0ms both', display:'inline-flex', alignItems:'center', gap:7, background:'rgba(27,79,138,0.5)', border:'1px solid rgba(27,79,138,0.8)', borderRadius:20, padding:'5px 16px', fontSize:12, color:'rgba(255,255,255,0.8)', fontWeight:600, marginBottom:28, letterSpacing:'0.03em' }}>
            <InlineEdit tag="span" section="hero" fieldKey="badge_text" value={heroBadge} isAdmin={isAdmin} darkBg />
          </div>

          {/* Headline */}
          <InlineEdit
            tag="h1" section="hero" fieldKey="headline" value={heroHeadline} isAdmin={isAdmin} darkBg
            style={{ animation:'hero-fade-up 550ms ease-out 100ms both', fontSize: heroStyles.headingSize ?? 'clamp(2.2rem,4.5vw,3.8rem)', fontWeight:800, lineHeight:1.1, color: heroStyles.headingColor ?? '#fff', marginBottom:22, whiteSpace:'pre-line', display:'block' } as React.CSSProperties}
          />

          {/* Subheading */}
          <InlineEdit
            tag="p" section="hero" fieldKey="subheadline" value={heroSub} isAdmin={isAdmin} darkBg
            style={{ animation:'hero-fade-up 550ms ease-out 200ms both', fontSize:'clamp(1rem,2vw,1.2rem)', color:'rgba(255,255,255,0.75)', lineHeight:1.65, maxWidth:620, margin:'0 auto 26px', display:'block' } as React.CSSProperties}
          />

          {/* Primary CTA Buttons (show/hide controlled from Admin → Hero) */}
          {(heroCta1_visible || heroCta2_visible) && (
            <div className="ha" style={{ animation:'hero-fade-up 550ms ease-out 280ms both', display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap', marginBottom:28 }}>
              {heroCta1_visible && (
                <Link href="/login" style={{ display:'inline-flex', alignItems:'center', gap:8, background:'#2EAA4A', color:'#fff', fontWeight:700, fontSize:15, padding:'14px 36px', borderRadius:8, textDecoration:'none', boxShadow:'0 4px 20px rgba(46,170,74,0.35)' }}>
                  {heroCta1}
                </Link>
              )}
              {heroCta2_visible && (
                <Link href="/modeling" style={{ display:'inline-flex', alignItems:'center', gap:8, background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', color:'rgba(255,255,255,0.9)', fontWeight:600, fontSize:15, padding:'14px 32px', borderRadius:8, textDecoration:'none' }}>
                  {heroCta2}
                </Link>
              )}
            </div>
          )}

          {/* Power statement */}
          {heroPowerStatement && (
            <div className="ha" style={{ animation:'hero-fade-up 550ms ease-out 300ms both', borderLeft:'3px solid #2EAA4A', paddingLeft:16, maxWidth:580, margin:'0 auto 26px', textAlign:'left' }}>
              <InlineEdit
                tag="p" section="hero" fieldKey="power_statement" value={heroPowerStatement} isAdmin={isAdmin} darkBg
                style={{ fontSize:'clamp(0.95rem,1.8vw,1.05rem)', fontWeight:600, color:'rgba(255,255,255,0.9)', margin:0, lineHeight:1.55 }}
              />
            </div>
          )}

          {/* Soft CTA */}
          {heroCta_visible && (
            <div className="ha" style={{ animation:'hero-fade-up 550ms ease-out 400ms both', marginBottom:26 }}>
              <HeroScrollBtn
                className="hero-soft-cta"
                style={{ background:'none', border:'none', cursor:'pointer', fontSize:'0.9rem', fontWeight:500, color:'rgba(255,255,255,0.65)', padding:0, display:'inline-flex', alignItems:'center', gap:6 }}
              >
                <InlineEdit tag="span" section="hero" fieldKey="soft_cta" value={heroSoftCta} isAdmin={isAdmin} darkBg />
                <span className="hero-cta-arrow" style={{ fontSize:14 }}>&#8595;</span>
              </HeroScrollBtn>
            </div>
          )}

          {/* Trust line */}
          <InlineEdit
            tag="p" section="hero" fieldKey="trust_line" value={heroTrustLine} isAdmin={isAdmin} darkBg
            style={{ animation:'hero-fade-in 550ms ease-out 500ms both', fontSize:'0.78rem', fontWeight:400, color:'rgba(255,255,255,0.48)', letterSpacing:'0.025em', margin:'0 auto 22px', display:'block' } as React.CSSProperties}
          />

          {/* Specialty tags */}
          {heroTags.length > 0 && (
            <div className="ha" style={{ animation:'hero-fade-in 550ms ease-out 600ms both', display:'flex', flexWrap:'wrap', justifyContent:'center', gap:10 }}>
              {heroTags.map(tag => (
                <span key={tag} className="hero-tag" style={{ fontSize:'0.72rem', border:'1px solid rgba(255,255,255,0.2)', borderRadius:999, padding:'4px 14px', color:'rgba(255,255,255,0.58)' }}>{tag}</span>
              ))}
            </div>
          )}
        </div>

        {/* Scroll indicator */}
        <div style={{ position:'absolute', bottom:24, left:0, right:0, display:'flex', justifyContent:'center' }}>
          <HeroScrollBtn style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.35)', padding:8, animation:'hero-bounce 2s ease-in-out infinite' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </HeroScrollBtn>
        </div>
      </section>

      {/* ── Stats Bar ──────────────────────────────────────────────────────── */}
      <section id="stats-bar" style={{ borderTop:'1px solid rgba(255,255,255,0.07)', borderBottom:'1px solid rgba(255,255,255,0.07)', padding:'32px 40px', background:'#0A2248', color:'#fff' }}>
        <div style={{ display:'flex', justifyContent:'center', gap:'clamp(32px,6vw,80px)', flexWrap:'wrap', maxWidth:900, margin:'0 auto' }}>
          {statsData.map((s, i) => (
            <div key={i} style={{ textAlign:'center' }}>
              <div style={{ fontSize:30, fontWeight:800, color:'#4A90D9', letterSpacing:'-0.02em' }}>{s.value}</div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginTop:5, letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:500 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── What is FMP ────────────────────────────────────────────────────── */}
      <section style={{ padding:`${aboutStyles.paddingY ?? '88px'} 40px`, maxWidth:1100, margin:'0 auto', color:'#374151' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))', gap:56, alignItems:'center' }}>
          <div>
            <InlineEdit tag="div" section="about" fieldKey="badge" value={aboutBadge} isAdmin={isAdmin}
              style={{ fontSize:12, fontWeight:700, color:'#1B4F8A', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:14 }} />
            <InlineEdit tag="h2" section="about" fieldKey="heading" value={aboutH2} isAdmin={isAdmin}
              style={{ fontSize: aboutStyles.headingSize ?? 'clamp(24px,3vw,36px)', fontWeight:800, color: aboutStyles.headingColor ?? '#1B3A6B', marginBottom:20, lineHeight:1.2 }} />
            <InlineEdit tag="p" section="about" fieldKey="what_is_fmp" value={aboutBody1} isAdmin={isAdmin}
              style={{ fontSize:15, color:'#4B5563', lineHeight:1.75, marginBottom:20 }} />
            <InlineEdit tag="p" section="about" fieldKey="what_is_fmp_2" value={aboutBody2} isAdmin={isAdmin}
              style={{ fontSize:15, color:'#6B7280', lineHeight:1.75 }} />
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {['Multi-discipline modeling — real estate, valuation, FP&A, LBO, and more','Structured workflows — from assumptions to investor-ready outputs','Monthly or annual modeling with full period control','Formula-linked Excel export + investor PDF reports','White-label ready for advisory firms and consultants','100% free training on every financial modeling topic'].map((text)=>(
              <div key={text} style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
                <span style={{ width:22, height:22, borderRadius:'50%', flexShrink:0, background:'#E8F0FB', border:'1px solid #C7D9F2', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#1B4F8A', marginTop:1 }}>✓</span>
                <span style={{ fontSize:14, color:'#4B5563', lineHeight:1.55 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Two Pillars ────────────────────────────────────────────────────── */}
      <section style={{ background:'#F5F7FA', padding:`${pillarsStyles.paddingY ?? '88px'} 40px` }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <div style={{ textAlign:'center', marginBottom:48 }}>
            <InlineEdit tag="h2" section="pillars" fieldKey="heading" value={pillarsH2} isAdmin={isAdmin}
              style={{ fontSize: pillarsStyles.headingSize ?? 'clamp(24px,3vw,36px)', fontWeight:800, color: pillarsStyles.headingColor ?? '#1B3A6B' }} />
            <InlineEdit tag="p" section="pillars" fieldKey="subheading" value={pillarsSub} isAdmin={isAdmin}
              style={{ fontSize:15, color:'#6B7280', marginTop:10 }} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))', gap:24 }}>
            {/* Modeling card */}
            <div style={{ background:'#fff', border:'1px solid #C7D9F2', borderTop:'4px solid #1B4F8A', borderRadius:16, padding:'36px 32px', boxShadow:'0 2px 12px rgba(27,79,138,0.06)' }}>
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom:16, display:'block' }}>
                <rect x="4" y="26" width="10" height="18" rx="3" fill="#1B4F8A"/>
                <rect x="19" y="16" width="10" height="28" rx="3" fill="#1B4F8A" fillOpacity="0.65"/>
                <rect x="34" y="6" width="10" height="38" rx="3" fill="#1B4F8A" fillOpacity="0.35"/>
                <line x1="2" y1="46" x2="46" y2="46" stroke="#1B4F8A" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
              <InlineEdit tag="h3" section="pillars" fieldKey="model_title" value={modelTitle} isAdmin={isAdmin}
                style={{ fontSize:22, fontWeight:800, color:'#1B3A6B', marginBottom:12 }} />
              <InlineEdit tag="p" section="pillars" fieldKey="model_desc" value={modelDesc} isAdmin={isAdmin}
                style={{ fontSize:14, color:'#4B5563', lineHeight:1.7, marginBottom:24 }} />
              <ul style={{ listStyle:'none', padding:0, margin:'0 0 28px', display:'flex', flexDirection:'column', gap:8 }}>
                {['Multi-discipline project structure','Debt & equity scheduling','IRR, NPV, and equity multiple','Excel & PDF export'].map(t=>(
                  <li key={t} style={{ fontSize:13, color:'#4B5563', display:'flex', gap:8, alignItems:'center' }}><span style={{ color:'#1B4F8A', fontWeight:700 }}>→</span> {t}</li>
                ))}
              </ul>
              <Link href="/modeling" style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#1B4F8A', color:'#fff', fontSize:13, fontWeight:700, padding:'10px 22px', borderRadius:7, textDecoration:'none' }}>Explore Modeling Hub →</Link>
            </div>
            {/* Training card */}
            <div style={{ background:'#fff', border:'1px solid #C3E9CE', borderTop:'4px solid #1A7A30', borderRadius:16, padding:'36px 32px', boxShadow:'0 2px 12px rgba(26,122,48,0.06)' }}>
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom:16, display:'block' }}>
                <path d="M24 10L6 20L24 30L42 20L24 10Z" fill="#1A7A30"/>
                <path d="M13 25.5V35C13 35 17.5 40 24 40C30.5 40 35 35 35 35V25.5" stroke="#1A7A30" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="42" y1="20" x2="42" y2="32" stroke="#1A7A30" strokeWidth="3" strokeLinecap="round"/>
                <circle cx="42" cy="33.5" r="2.5" fill="#1A7A30"/>
              </svg>
              <InlineEdit tag="h3" section="pillars" fieldKey="training_title" value={trainingTitle} isAdmin={isAdmin}
                style={{ fontSize:22, fontWeight:800, color:'#1B3A6B', marginBottom:12 }} />
              <InlineEdit tag="p" section="pillars" fieldKey="training_desc" value={trainingDesc} isAdmin={isAdmin}
                style={{ fontSize:14, color:'#4B5563', lineHeight:1.7, marginBottom:24 }} />
              <ul style={{ listStyle:'none', padding:0, margin:'0 0 28px', display:'flex', flexDirection:'column', gap:8 }}>
                {['Always 100% free','Real-world case studies','GCC & international markets','Certificate on completion'].map(t=>(
                  <li key={t} style={{ fontSize:13, color:'#4B5563', display:'flex', gap:8, alignItems:'center' }}><span style={{ color:'#1A7A30', fontWeight:700 }}>→</span> {t}</li>
                ))}
              </ul>
              <Link href="/training" style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#1A7A30', color:'#fff', fontSize:13, fontWeight:700, padding:'10px 22px', borderRadius:7, textDecoration:'none' }}>Browse Free Courses →</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Founder ────────────────────────────────────────────────────────── */}
      <section style={{ padding:'64px 40px 80px', background:'#1B3A6B', color:'#fff' }}>
        {/* eslint-disable-next-line react/no-danger */}
        <style>{`
          @media (max-width: 640px) {
            .fmp-founder-img-col { order: -1 !important; }
            .fmp-founder-circle  { width: min(180px, 60vw) !important; height: min(180px, 60vw) !important; }
          }
        `}</style>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(min(300px,100%),1fr))', gap:56, alignItems:'center' }}>
            <div className="fmp-founder-img-col" style={{ display:'flex', justifyContent:'center', order:1 }}>
              {founderPhotoUrl ? (
                <div className="fmp-founder-circle" style={{ width:220, height:220, borderRadius:'50%', overflow:'hidden', position:'relative', border:'3px solid rgba(255,255,255,0.2)', boxShadow:'0 8px 40px rgba(0,0,0,0.4)', flexShrink:0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={founderPhotoUrl} alt={founderName} style={{ position:'absolute', top:0, left:0, width:'100%', height:'100%', objectFit:'cover', objectPosition:'center' }} />
                </div>
              ) : (
                <div className="fmp-founder-circle" style={{ width:220, height:220, borderRadius:'50%', background:'linear-gradient(135deg,#0D2E5A,#1B4F8A)', display:'flex', alignItems:'center', justifyContent:'center', border:'3px solid rgba(255,255,255,0.2)', boxShadow:'0 8px 40px rgba(0,0,0,0.4)', flexShrink:0 }}>
                  <span style={{ fontSize:56, fontWeight:800, color:'rgba(255,255,255,0.9)', letterSpacing:'-2px', fontFamily:"'Inter',sans-serif" }}>AD</span>
                </div>
              )}
            </div>
            <div>
              <InlineEdit tag="div" section="founder_section" fieldKey="badge" value={founderBadge} isAdmin={isAdmin} darkBg
                style={{ fontSize:12, fontWeight:700, color:'#4A90D9', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:14 }} />
              <h2 style={{ fontSize:'clamp(22px,3vw,32px)', fontWeight:800, color:'#fff', marginBottom:6 }}>{founderName}</h2>
              <div style={{ fontSize:14, color:'#93C5FD', fontWeight:600, marginBottom:20, lineHeight:1.4 }}>
                Corporate Finance &amp; Transaction Advisory Specialist | Financial Modeling Expert
              </div>
              <p style={{ fontSize:14.5, color:'rgba(255,255,255,0.65)', lineHeight:1.75, marginBottom:16 }}>{founderShortBio}</p>
              <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:isAdmin?8:24 }}>
                {[
                  '12+ years in Corporate Finance & Advisory',
                  'Experience across KSA & Pakistan',
                  'Lender-grade models: IRR, DSCR, Feasibility',
                  'Real estate, energy, infrastructure & industrial sectors',
                  'Transaction advisory & investment support',
                ].map(text=>(
                  <div key={text} style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={{ color:'#4A90D9', fontWeight:700, fontSize:12, flexShrink:0 }}>✓</span>
                    <span style={{ fontSize:13.5, color:'rgba(255,255,255,0.6)' }}>{text}</span>
                  </div>
                ))}
              </div>
              {isAdmin && (
                <Link href="/admin/founder" target="_blank" style={{ fontSize:11, color:'#93C5FD', textDecoration:'none', display:'block', marginBottom:20 }}>✏️ Edit founder profile in Admin →</Link>
              )}
              <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>
                <Link href="/about/ahmad-din" style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#1B4F8A', border:'1px solid #1B4F8A', color:'#fff', fontSize:13, fontWeight:700, padding:'9px 20px', borderRadius:7, textDecoration:'none' }}>Read Full Profile →</Link>
                {founderLinkedIn && (
                  <a href={founderLinkedIn} target="_blank" rel="noopener noreferrer" style={{ display:'inline-flex', alignItems:'center', gap:6, background:'transparent', border:'1px solid rgba(255,255,255,0.25)', color:'rgba(255,255,255,0.8)', fontSize:13, fontWeight:600, padding:'9px 20px', borderRadius:7, textDecoration:'none' }}>Connect on LinkedIn →</a>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PaceMakers ─────────────────────────────────────────────────────── */}
      <section style={{ padding:'88px 40px', background:'#0A2248', color:'#fff' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))', gap:56, alignItems:'center' }}>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:'#4A90D9', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:14 }}>
                The Firm Behind the Platform
              </div>
              <h2 style={{ fontSize:'clamp(22px,3vw,32px)', fontWeight:800, color:'#fff', marginBottom:20, lineHeight:1.2 }}>
                Powered by PaceMakers Business Consultants
              </h2>
              <p style={{ fontSize:15, color:'rgba(255,255,255,0.6)', lineHeight:1.75, marginBottom:32 }}>
                Financial Modeler Pro is a product of PaceMakers — a corporate finance advisory firm with 12+ years of experience delivering institutional-grade financial solutions across KSA and Pakistan.
              </p>
              <a
                href="https://www.pacemakersglobal.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display:'inline-flex', alignItems:'center', gap:8, background:'#1B4F8A', color:'#fff', fontWeight:700, fontSize:13, padding:'10px 24px', borderRadius:7, textDecoration:'none' }}
              >
                Visit PaceMakers →
              </a>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              {[
                'Financial Modeling & Valuation',
                'Transaction Advisory & Due Diligence',
                'Fractional CFO Services',
                'Investment Analysis & Feasibility',
              ].map((service) => (
                <div key={service} style={{ display:'flex', alignItems:'center', gap:14, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:10, padding:'16px 20px' }}>
                  <span style={{ width:22, height:22, borderRadius:'50%', flexShrink:0, background:'rgba(27,79,138,0.4)', border:'1px solid rgba(74,144,217,0.4)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#4A90D9' }}>✓</span>
                  <span style={{ fontSize:14, fontWeight:600, color:'rgba(255,255,255,0.85)' }}>{service}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Articles Preview ───────────────────────────────────────────────── */}
      <section style={{ padding:'88px 40px', background:'#fff' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:44, flexWrap:'wrap', gap:16 }}>
            <div>
              <InlineEdit tag="div" section="articles_section" fieldKey="badge" value={articlesBadge} isAdmin={isAdmin}
                style={{ fontSize:12, fontWeight:700, color:'#1B4F8A', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:10 }} />
              <InlineEdit tag="h2" section="articles_section" fieldKey="heading" value={articlesH2} isAdmin={isAdmin}
                style={{ fontSize:'clamp(22px,3vw,34px)', fontWeight:800, color:'#1B3A6B', margin:0 }} />
            </div>
            <Link href="/articles" style={{ fontSize:13, fontWeight:700, color:'#1B4F8A', textDecoration:'none' }}>View All Articles →</Link>
          </div>
          {articles.length > 0 ? (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:20 }}>
              {articles.map((a)=><ArticleCard key={a.id} article={a} />)}
            </div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:20 }}>
              {[0,1,2].map((i)=><ArticleCardPlaceholder key={i} index={i} />)}
            </div>
          )}
        </div>
      </section>

      {/* ── Testimonials */}
      <section style={{ padding:`${testimonialsStyles.paddingY ?? '88px'} 40px`, background:'#fff' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <div style={{ textAlign:'center', marginBottom:52 }}>
            <InlineEdit tag="h2" section="testimonials" fieldKey="heading" value={testimonialsH2} isAdmin={isAdmin}
              style={{ fontSize: testimonialsStyles.headingSize ?? 'clamp(22px,3vw,34px)', fontWeight:800, color: testimonialsStyles.headingColor ?? '#1B3A6B', marginBottom:10 }} />
            <InlineEdit tag="p" section="testimonials" fieldKey="subheading" value={testimonialsSub} isAdmin={isAdmin}
              style={{ fontSize:14, color:'#6B7280' }} />
          </div>
          {testimonials.length > 0 ? (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))', gap:24 }}>
              {testimonials.map(t => (
                <div key={t.id} style={{ background:'#F9FAFB', border:`1px solid ${t.is_featured ? '#C9A84C' : '#E5E7EB'}`, borderRadius:14, padding:'24px', position:'relative', display:'flex', flexDirection:'column' }}>
                  {/* Stars */}
                  <div style={{ display:'flex', gap:2, marginBottom:12 }}>
                    {Array.from({length:5}).map((_,i) => (
                      <span key={i} style={{ fontSize:14, color: i < (t.rating ?? 5) ? '#F59E0B' : '#E5E7EB' }}>★</span>
                    ))}
                    {t.is_featured && <span style={{ marginLeft:'auto', fontSize:10, fontWeight:700, color:'#C9A84C' }}>★ Featured</span>}
                  </div>
                  {/* Video or text */}
                  {t.testimonial_type === 'video' && t.video_url ? (
                    <a href={t.video_url} target="_blank" rel="noopener noreferrer"
                      style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'#0D2E5A', borderRadius:8, padding:'20px', marginBottom:16, textDecoration:'none', gap:6 }}>
                      <span style={{ fontSize:28 }}>▶️</span>
                      <span style={{ fontSize:11, color:'rgba(255,255,255,0.7)', fontWeight:600 }}>Watch video testimonial ↗</span>
                    </a>
                  ) : (
                    <>
                      <div style={{ fontSize:28, color:'#1B4F8A', fontFamily:'Georgia,serif', lineHeight:1, marginBottom:8 }}>&ldquo;</div>
                      <p style={{ fontSize:13.5, color:'#374151', lineHeight:1.75, marginBottom:16, fontStyle:'italic', flex:1 }}>{t.text}</p>
                    </>
                  )}
                  {/* Author */}
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ width:38, height:38, borderRadius:'50%', background:'linear-gradient(135deg,#1B4F8A,#0D2E5A)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:800, color:'#fff', flexShrink:0 }}>
                      {t.name.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:'#1B3A6B', display:'flex', alignItems:'center', gap:5 }}>
                        {t.name}
                        {t.linkedin_url && (
                          <a href={t.linkedin_url} target="_blank" rel="noopener noreferrer"
                            style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:16, height:16, background:'#0A66C2', color:'#fff', borderRadius:3, fontSize:9, fontWeight:800, textDecoration:'none', flexShrink:0 }}>
                            in
                          </a>
                        )}
                      </div>
                      {(t.role || t.company) && (
                        <div style={{ fontSize:11, color:'#9CA3AF', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {[t.role, t.company].filter(Boolean).join(' · ')}
                        </div>
                      )}
                      {t.location && <div style={{ fontSize:10, color:'#B0B8C8', marginTop:1 }}>{t.location}</div>}
                    </div>
                  </div>
                  {/* Verified badge */}
                  {t.source === 'student' && (
                    <div style={{ marginTop:12, paddingTop:10, borderTop:'1px solid #F3F4F6', display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ fontSize:10, color:'#2EAA4A', fontWeight:700 }}>✅ Verified via FMP Training</span>
                      {t.course_name && <span style={{ fontSize:10, color:'#9CA3AF' }}>· {t.course_name}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:20 }}>
              {[0,1,2].map(i=>(
                <div key={i} style={{ background:'#F9FAFB', border:'1px dashed #E5E7EB', borderRadius:12, padding:'32px 24px', textAlign:'center' }}>
                  <div style={{ fontSize:40, color:'#D1D5DB', marginBottom:16, fontFamily:'Georgia,serif' }}>&ldquo;</div>
                  <p style={{ fontSize:14, color:'#9CA3AF', lineHeight:1.7, marginBottom:20, fontStyle:'italic' }}>Testimonial coming soon</p>
                  <p style={{ fontSize:12, color:'#D1D5DB' }}>We are collecting feedback from early users</p>
                </div>
              ))}
            </div>
          )}
          {/* Submit testimonial link */}
          <div style={{ textAlign:'center', marginTop:32 }}>
            <Link href="/training" style={{ fontSize:13, color:'#1B4F8A', fontWeight:600, textDecoration:'none', borderBottom:'1px solid #C7D9F2', paddingBottom:2 }}>
              Join the free course →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Pricing teaser ─────────────────────────────────────────────────── */}
      <section id="pricing" style={{ padding:'88px 40px', background:'#F5F7FA' }}>
        <div style={{ maxWidth:720, margin:'0 auto', textAlign:'center' }}>
          <InlineEdit tag="div" section="pricing" fieldKey="badge" value={pricingBadge} isAdmin={isAdmin}
            style={{ fontSize:12, fontWeight:700, color:'#1B4F8A', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:14 }} />
          <InlineEdit tag="h2" section="pricing" fieldKey="heading" value={pricingH2} isAdmin={isAdmin}
            style={{ fontSize:'clamp(24px,3vw,36px)', fontWeight:800, color:'#1B3A6B', marginBottom:10 }} />
          <InlineEdit tag="p" section="pricing" fieldKey="subheading" value={pricingSub} isAdmin={isAdmin}
            style={{ fontSize:15, color:'#6B7280', marginBottom:36 }} />
          {planNames.length > 0 && (
            <div style={{ display:'flex', justifyContent:'center', gap:12, flexWrap:'wrap', marginBottom:36 }}>
              {planNames.map(name=>(
                <div key={name} style={{ padding:'12px 24px', background:'#fff', border:'1px solid #E5E7EB', borderRadius:10, fontSize:14, fontWeight:600, color:'#374151', boxShadow:'0 1px 4px rgba(0,0,0,0.04)' }}>{name}</div>
              ))}
            </div>
          )}
          <Link href="/pricing" style={{ display:'inline-flex', alignItems:'center', gap:8, background:'#1B4F8A', color:'#fff', fontWeight:700, fontSize:15, padding:'14px 36px', borderRadius:8, textDecoration:'none', boxShadow:'0 4px 20px rgba(27,79,138,0.25)' }}>
            View Full Pricing →
          </Link>
        </div>
      </section>

      {/* ── CTA Banner ─────────────────────────────────────────────────────── */}
      {ctaSection_visible && (
        <section style={{ padding:`${ctaStyles.paddingY ?? '80px'} 40px`, textAlign:'center', background:'#1B4F8A', color:'#fff' }}>
          <div style={{ maxWidth:640, margin:'0 auto' }}>
            <InlineEdit tag="h2" section="cta" fieldKey="heading" value={ctaH2} isAdmin={isAdmin} darkBg
              style={{ fontSize: ctaStyles.headingSize ?? 'clamp(24px,4vw,42px)', fontWeight:800, color: ctaStyles.headingColor ?? '#fff', marginBottom:16, lineHeight:1.15 }} />
            <InlineEdit tag="p" section="cta" fieldKey="subheading" value={ctaSub} isAdmin={isAdmin} darkBg
              style={{ fontSize:16, color:'rgba(255,255,255,0.65)', marginBottom:36, lineHeight:1.65 }} />
            <Link href="/login" style={{ display:'inline-flex', alignItems:'center', gap:8, background:'#fff', color:'#1B4F8A', fontWeight:700, fontSize:16, padding:'16px 44px', borderRadius:8, textDecoration:'none', boxShadow:'0 4px 32px rgba(0,0,0,0.15)' }}>
              <InlineEdit tag="span" section="cta" fieldKey="button" value={ctaBtn} isAdmin={isAdmin} darkBg />
            </Link>
          </div>
        </section>
      )}

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <SharedFooter
        company={footerCompany} founder={footerFounder} copyright={footerCopyright} isAdmin={isAdmin}
        height={footerHeight}
        paddingTop={footerPaddingTop}
        paddingBottom={footerPaddingBottom}
        showDescription={footerShowDescription}
        showQuickLinks={footerShowQuickLinks}
        showCompanyLinks={footerShowCompanyLinks}
        showPrivacy={footerShowPrivacy}
        showConfidentiality={footerShowConfidentiality}
      />
    </div>
  );
}

