// v-founder-fix-final
/**
 * FMP Public Landing Page
 * Server Component — all CMS text is inline-editable for admins.
 */
import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import Link from 'next/link';
import { HeroScrollBtn } from './HeroScrollBtn';
import { FounderExpand } from './FounderExpand';
import {
  getCmsContent, cms,
  getPublishedArticles,
  getFounderProfile, getSitePages,
  getTestimonialsForPage,
  getSectionStyles,
  getAllPageSections,
} from '@/src/lib/shared/cms';
import { SharedFooter } from '@/src/components/landing/SharedFooter';
import { SectionRenderer } from '@/src/components/cms/SectionRenderer';
import { getServerClient } from '@/src/lib/shared/supabase';
import { ArticleCard, ArticleCardPlaceholder } from '@/src/components/landing/ArticleCard';
import { InlineEdit } from '@/src/components/landing/InlineEdit';
import { AdminEditBar } from '@/src/components/landing/AdminEditBar';
import { Navbar } from '@/src/components/layout/Navbar';

export const revalidate = 0;

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
  const [content, articles, testimonials, founder, session, sitePages, planNames, homePageSections] = await Promise.all([
    getCmsContent(),
    getPublishedArticles(3),
    getTestimonialsForPage('landing'),
    getFounderProfile(), getServerSession(), getSitePages(),
    getPublicPlanNames(),
    getAllPageSections('home'),
  ]);

  // Extract CMS sections (including hidden ones so we can distinguish "hidden" from "not seeded")
  const cmsHeroRaw = homePageSections.find(s => s.section_type === 'hero');
  const heroHidden = cmsHeroRaw?.visible === false;
  const cmsHero = cmsHeroRaw?.visible !== false ? cmsHeroRaw : undefined;
  const h = cmsHero?.content as Record<string, unknown> | undefined;

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

  // ── Founder (CMS page_sections → founder_profile → hardcoded fallback) ──
  const cmsFounderRaw = homePageSections.find(s => s.section_type === 'team');
  const founderHidden = cmsFounderRaw?.visible === false;
  const cmsFounder = cmsFounderRaw?.visible !== false ? cmsFounderRaw : undefined;
  const fc = cmsFounder?.content as Record<string, unknown> | undefined;

  // ── PaceMakers (CMS page_sections → hardcoded fallback) ─────────────────
  const cmsPMRaw = homePageSections.find(s => s.section_type === 'columns' && (s.content as Record<string,unknown>)?.heading?.toString().includes('PaceMakers'));
  const pmHidden = cmsPMRaw?.visible === false;
  const cmsPM = cmsPMRaw?.visible !== false ? cmsPMRaw : undefined;
  const pm = cmsPM?.content as Record<string, unknown> | undefined;

  // ── Hero (CMS page_sections → cms_content → hardcoded fallback) ────────
  const heroBadge          = (h?.badge as string)          || cms(content, 'hero', 'badge_text',       '🚀 Now Live — Free to Use');
  const heroHeadline       = (h?.headline as string)       || cms(content, 'hero', 'headline',         'Build Institutional-Grade Financial Models — Without Starting From Scratch');
  const heroSub            = (h?.subtitle as string)       || cms(content, 'hero', 'subheadline',      'Pre-built, structured financial models for real estate, valuation, and project finance — designed by corporate finance professionals for real-world use.');
  const heroPowerStatement = (h?.powerStatement as string) || cms(content, 'hero', 'power_statement',  'No more rebuilding models. No more broken Excel files. No more wasted hours.');
  const heroSoftCta        = (h?.softCta as string)        || cms(content, 'hero', 'soft_cta',         'Explore the platform');
  const heroTrustLine      = (h?.trustLine as string)      || cms(content, 'hero', 'trust_line',       'Designed by Investment & Corporate Finance Experts  |  12+ Years Experience  |  Used Across KSA & Pakistan');
  const heroTagsRaw        = (h?.tags as string)           || cms(content, 'hero', 'tags',             'Real Estate Models, Business Valuation, Project Finance, Fund Models');
  const heroTags           = heroTagsRaw.split(',').map(t => t.trim()).filter(Boolean);

  // ── Stats (CMS page_sections → cms_content → hardcoded fallback) ────────
  const cmsStatsRaw = homePageSections.find(s => s.section_type === 'stats');
  const statsHidden = cmsStatsRaw?.visible === false;
  const cmsStats = cmsStatsRaw?.visible !== false ? cmsStatsRaw : undefined;
  const cmsStatsItems = cmsStats ? (cmsStats.content as Record<string, unknown>).items as { value: string; label: string; visible?: boolean }[] : null;
  type StatItem = { value: string; label: string; order: number };
  let statsData: StatItem[] = [];
  if (cmsStatsItems?.length) {
    statsData = cmsStatsItems.filter(s => s.visible !== false).map((s, i) => ({ value: s.value, label: s.label, order: i }));
  }
  if (!statsData.length) {
    const statsBarJson = cms(content, 'stats', 'stats_bar_items', '');
    if (statsBarJson) {
      try { statsData = (JSON.parse(statsBarJson) as StatItem[]).sort((a, b) => a.order - b.order); } catch { /* fall through */ }
    }
  }
  if (!statsData.length) {
    statsData = [
      { value: cms(content,'stats','stat1_value','12+'),  label: cms(content,'stats','stat1_label','Years of Experience'),       order: 1 },
      { value: cms(content,'stats','stat2_value','10+'),  label: cms(content,'stats','stat2_label','Modeling Platforms'),         order: 2 },
      { value: cms(content,'stats','stat3_value','20+'),  label: cms(content,'stats','stat3_label','Currencies Supported'),       order: 3 },
      { value: cms(content,'stats','stat4_value','100%'), label: cms(content,'stats','stat4_label','Free Training — No Paywall'), order: 4 },
    ];
  }
  const statsStyles = cmsStats?.styles as Record<string, string> | undefined;

  // ── Text+Image sections (What is FMP, Mission, Vision) from CMS ────────
  const cmsTextImageSections = homePageSections.filter(s => s.section_type === 'text_image').sort((a, b) => a.display_order - b.display_order);

  // ── About (fallback styles only — text now comes from CMS text_image sections) ──

  // ── Pillars (CMS page_sections → cms_content → hardcoded fallback) ──────
  const cmsPillarsRaw = homePageSections.find(s => s.section_type === 'columns' && (s.content as Record<string,unknown>)?.heading?.toString().includes('Two Platforms'));
  const pillarsHidden = cmsPillarsRaw?.visible === false;
  const cmsPillars = cmsPillarsRaw?.visible !== false ? cmsPillarsRaw : undefined;
  const pc = cmsPillars?.content as Record<string, unknown> | undefined;
  const pillarsH2        = (pc?.heading as string)    || cms(content, 'pillars', 'heading',       'Two Platforms. One Destination.');
  const pillarsSub       = (pc?.subheading as string) || cms(content, 'pillars', 'subheading',    'Modeling + Training — everything a financial professional needs in one place.');
  const pillarsCols = (pc?.columns as { id: string; title: string; description: string; borderColor: string; borderSideColor: string; accentColor: string; shadowColor: string; features: string[]; ctaText: string; ctaUrl: string; icon: string }[]) ?? [];
  const modelTitle       = pillarsCols[0]?.title       || cms(content, 'pillars', 'model_title',   'Modeling Platform');
  const modelDesc        = pillarsCols[0]?.description || cms(content, 'pillars', 'model_desc',    'Structured workflows that take you from project setup to investor-ready reports. All outputs link — change one assumption, everything updates.');
  const trainingTitle    = pillarsCols[1]?.title       || cms(content, 'pillars', 'training_title','Training Hub');
  const trainingDesc     = pillarsCols[1]?.description || cms(content, 'pillars', 'training_desc', 'Free video courses taught by finance professionals. Learn the methodology behind the model — from first principles to advanced deal structuring.');

  // ── Articles section ──────────────────────────────────────────────────────
  const cmsArticlesRow = homePageSections.find(s => s.section_type === 'cards' && (s.content as Record<string,unknown>)?._dynamic === 'articles');
  const articlesHidden = cmsArticlesRow?.visible === false;
  const articlesBadge = cms(content, 'articles_section', 'badge',  'Insights');
  const articlesH2    = cms(content, 'articles_section', 'heading', 'Latest Articles');

  // ── Founder section ───────────────────────────────────────────────────────
  const founderBadge = cms(content, 'founder_section', 'badge', 'The Founder');

  // ── Testimonials ──────────────────────────────────────────────────────────
  const cmsTestimonialsRow = homePageSections.find(s => s.section_type === 'cards' && (s.content as Record<string,unknown>)?._dynamic === 'testimonials');
  const testimonialsHidden = cmsTestimonialsRow?.visible === false;
  const testimonialsH2  = cms(content, 'testimonials', 'heading',    'What Professionals Say');
  const testimonialsSub = cms(content, 'testimonials', 'subheading', 'We are collecting feedback from early users of Financial Modeler Pro.');

  // ── Pricing ───────────────────────────────────────────────────────────────
  const cmsPricingRow = homePageSections.find(s => s.section_type === 'cards' && (s.content as Record<string,unknown>)?._dynamic === 'pricing_preview');
  const pricingHidden = cmsPricingRow?.visible === false;
  const pricingBadge = cms(content, 'pricing', 'badge',     'Pricing');
  const pricingH2    = cms(content, 'pricing', 'heading',   'Simple, Transparent Pricing');
  const pricingSub   = cms(content, 'pricing', 'subheading','Join the beta — currently free for all users.');

  // ── CTA ───────────────────────────────────────────────────────────────────
  const cmsCtaRow = homePageSections.find(s => s.section_type === 'cta');
  const ctaSectionHidden = cmsCtaRow?.visible === false;
  const ctaH2    = cms(content, 'cta', 'heading',    'Ready to build your first model?');
  const ctaSub   = cms(content, 'cta', 'subheading', 'Join finance professionals using Financial Modeler Pro to build better models, faster.');
  const ctaBtn   = cms(content, 'cta', 'button',     'Get Started Free →');

  // ── Hero CTA button text (CMS page_sections → cms_content → fallback) ──
  const heroCta1         = (h?.cta1Text as string)   || cms(content, 'hero', 'cta1',         'Launch Platform Free →');
  const heroCta2         = (h?.cta2Text as string)   || cms(content, 'hero', 'cta2',         'Explore Platforms ↓');

  // ── Visibility toggles ────────────────────────────────────────────────────
  const heroCta_visible    = h?.softCtaVisible !== undefined ? !!h.softCtaVisible : cms(content, 'hero', 'cta_visible',     'true') !== 'false';
  const heroCta1_visible   = h?.cta1Visible !== undefined    ? !!h.cta1Visible    : cms(content, 'hero', 'cta1_visible',    'false') === 'true';
  const heroCta2_visible   = h?.cta2Visible !== undefined    ? !!h.cta2Visible    : cms(content, 'hero', 'cta2_visible',    'false') === 'true';
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
      {!heroHidden && <section style={{ padding:'clamp(56px,8vw,96px) 40px clamp(64px,9vw,104px)', textAlign:'center', position:'relative', background:'linear-gradient(180deg,#0D2E5A 0%,#0A2448 100%)', overflow:'hidden', color:'#fff' }}>
        {/* Radial gradient overlay */}
        <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(45,107,168,0.25) 0%, transparent 65%)', pointerEvents:'none' }} />
        {/* Grid pattern */}
        <div style={{ position:'absolute', inset:0, opacity:0.04, backgroundImage:'linear-gradient(rgba(255,255,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.5) 1px,transparent 1px)', backgroundSize:'40px 40px', pointerEvents:'none' }} />

        {(() => {
          const cf = (h?.customFields as { label: string; value: string; visible?: boolean; insertAfter?: string }[] | undefined) ?? [];
          const cfAt = (pos: string) => cf.filter(f => f.visible !== false && f.value && (f.insertAfter || 'end') === pos).map((field, i) => (
            <div key={`cf-${pos}-${i}`} style={{ color:'rgba(255,255,255,0.8)', fontSize:'0.9rem', marginTop:8 }}>
              {field.label && <span style={{ fontWeight:600 }}>{field.label}:{' '}</span>}
              {field.value}
            </div>
          ));
          // Per-field width + alignment wrapper
          const fw = (key: string) => {
            const w = (h?.[`${key}_width`] as string) || '100%';
            return {
              width: w,
              maxWidth: w,
              textAlign: ((h?.[`${key}_align`] as string) || (h?.textAlign as string) || 'center') as React.CSSProperties['textAlign'],
              margin: w === '100%' ? '0' as const : '0 auto' as const,
            };
          };
          return (
          <div style={{ position:'relative', maxWidth:'min(1200px, 90vw)', margin:'0 auto', textAlign: ((h?.textAlign as string) || 'center') as React.CSSProperties['textAlign'] }}>
            {cfAt('top')}

            {/* Badge */}
            <div style={fw('badge')}>
              <div className="ha" style={{ animation:'hero-fade-in 550ms ease-out 0ms both', display:'inline-flex', alignItems:'center', gap:7, background:'rgba(27,79,138,0.5)', border:'1px solid rgba(27,79,138,0.8)', borderRadius:20, padding:'5px 16px', fontSize:12, color:'rgba(255,255,255,0.8)', fontWeight:600, marginBottom:28, letterSpacing:'0.03em' }}>
                <InlineEdit tag="span" section="hero" fieldKey="badge_text" value={heroBadge} isAdmin={isAdmin} darkBg />
              </div>
            </div>
            {cfAt('badge')}

            {/* Headline */}
            <div style={fw('headline')}>
              <InlineEdit
                tag="h1" section="hero" fieldKey="headline" value={heroHeadline} isAdmin={isAdmin} darkBg
                style={{ animation:'hero-fade-up 550ms ease-out 100ms both', fontSize: heroStyles.headingSize ?? 'clamp(2.2rem,4.5vw,3.8rem)', fontWeight:800, lineHeight:1.1, color: heroStyles.headingColor ?? '#fff', marginBottom:22, whiteSpace:'pre-line', display:'block' } as React.CSSProperties}
              />
            </div>
            {cfAt('headline')}

            {/* Subheading */}
            <div style={fw('subtitle')}>
              <InlineEdit
                tag="p" section="hero" fieldKey="subheadline" value={heroSub} isAdmin={isAdmin} darkBg
                style={{ animation:'hero-fade-up 550ms ease-out 200ms both', fontSize:'clamp(1rem,2vw,1.2rem)', color:'rgba(255,255,255,0.75)', lineHeight:1.65, maxWidth:800, margin:'0 auto 26px', display:'block' } as React.CSSProperties}
              />
            </div>
            {cfAt('subtitle')}

            {/* Primary CTA Buttons */}
            <div style={fw('cta1')}>
              {((heroCta1_visible && heroCta1.trim()) || (heroCta2_visible && heroCta2.trim())) && (
                <div className="ha" style={{ animation:'hero-fade-up 550ms ease-out 280ms both', display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap', marginBottom:28 }}>
                  {heroCta1_visible && heroCta1.trim() && (
                    <Link href="/login" style={{ display:'inline-flex', alignItems:'center', gap:8, background:'#2EAA4A', color:'#fff', fontWeight:700, fontSize:15, padding:'14px 36px', borderRadius:8, textDecoration:'none', boxShadow:'0 4px 20px rgba(46,170,74,0.35)' }}>
                      {heroCta1}
                    </Link>
                  )}
                  {heroCta2_visible && heroCta2.trim() && (
                    <Link href={`${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com'}/modeling`} style={{ display:'inline-flex', alignItems:'center', gap:8, background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', color:'rgba(255,255,255,0.9)', fontWeight:600, fontSize:15, padding:'14px 32px', borderRadius:8, textDecoration:'none' }}>
                      {heroCta2}
                    </Link>
                  )}
                </div>
              )}
            </div>

            {/* Power statement */}
            {h?.powerStatement_visible !== false && heroPowerStatement && (
              <div style={fw('powerStatement')}>
                <div className="ha" style={{ animation:'hero-fade-up 550ms ease-out 300ms both', borderBottom:'3px solid #1ABC9C', maxWidth:700, margin:'16px auto 26px', textAlign:'center', paddingBottom:16 }}>
                  <InlineEdit
                    tag="p" section="hero" fieldKey="power_statement" value={heroPowerStatement} isAdmin={isAdmin} darkBg
                    style={{ fontSize:'clamp(0.95rem,1.8vw,1.05rem)', fontWeight:600, color:'rgba(255,255,255,0.9)', margin:0, lineHeight:1.55 }}
                  />
                </div>
              </div>
            )}
            {cfAt('powerStatement')}

            {/* Soft CTA */}
            {h?.softCta_visible !== false && heroCta_visible && heroSoftCta && (
              <div style={fw('softCta')}>
                <div className="ha" style={{ animation:'hero-fade-up 550ms ease-out 400ms both', marginBottom:26 }}>
                  <a href={(h?.softCtaUrl as string) || '#stats-bar'} style={{ fontSize:'0.9rem', fontWeight:500, color:'rgba(255,255,255,0.65)', textDecoration:'none', display:'inline-flex', alignItems:'center', gap:6 }}>
                    {heroSoftCta} <span style={{ fontSize:14 }}>&#8595;</span>
                  </a>
                </div>
              </div>
            )}
            {cfAt('softCta')}

            {/* Trust line */}
            {h?.trustLine_visible !== false && heroTrustLine && (
              <div style={fw('trustLine')}>
                <InlineEdit
                  tag="p" section="hero" fieldKey="trust_line" value={heroTrustLine} isAdmin={isAdmin} darkBg
                  style={{ animation:'hero-fade-in 550ms ease-out 500ms both', fontSize:'0.78rem', fontWeight:400, color:'rgba(255,255,255,0.48)', letterSpacing:'0.025em', margin:'0 auto 22px', display:'block' } as React.CSSProperties}
                />
              </div>
            )}
            {cfAt('trustLine')}

            {/* Specialty tags */}
            {h?.tags_visible !== false && heroTags.length > 0 && (
              <div style={fw('tags')}>
                <div className="ha" style={{ animation:'hero-fade-in 550ms ease-out 600ms both', display:'flex', flexWrap:'wrap', justifyContent:'center', gap:10 }}>
                  {heroTags.map(tag => (
                    <span key={tag} className="hero-tag" style={{ fontSize:'0.72rem', border:'1px solid rgba(255,255,255,0.2)', borderRadius:999, padding:'4px 14px', color:'rgba(255,255,255,0.58)' }}>{tag}</span>
                  ))}
                </div>
              </div>
            )}
            {cfAt('tags')}

            {/* Custom fields at end (default position) */}
            {cfAt('end')}
          </div>
          );
        })()}

      </section>}

      {/* ── Stats Bar ──────────────────────────────────────────────────────── */}
      {!statsHidden && <section id="stats-bar" style={{ borderTop:'1px solid rgba(255,255,255,0.07)', borderBottom:'1px solid rgba(255,255,255,0.07)', padding:`${statsStyles?.paddingY ?? '32px'} 40px`, background: statsStyles?.bgColor ?? '#0A2248', color: statsStyles?.textColor ?? '#fff' }}>
        <div style={{ display:'flex', justifyContent:'center', gap:'clamp(32px,6vw,80px)', flexWrap:'wrap', maxWidth:900, margin:'0 auto' }}>
          {statsData.map((s, i) => (
            <div key={i} style={{ textAlign:'center' }}>
              <div style={{ fontSize:30, fontWeight:800, color: statsStyles?.valueColor ?? '#4A90D9', letterSpacing:'-0.02em' }}>{s.value}</div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginTop:5, letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:500 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>}

      {/* ── Text+Image sections: What is FMP, Mission, Vision (from CMS) ── */}
      {cmsTextImageSections.length > 0 ? (
        cmsTextImageSections.map(s => s.visible === false ? null : (
          <SectionRenderer key={s.id} sections={[s]} />
        ))
      ) : (
        /* Hardcoded fallback when no CMS sections exist */
        <>
          <section style={{ padding:`${aboutStyles.paddingY ?? '88px'} 40px`, maxWidth:1100, margin:'0 auto', color:'#374151' }}>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))', gap:56, alignItems:'center' }}>
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:'#1B4F8A', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:14 }}>The Platform</div>
                <h2 style={{ fontSize:'clamp(24px,3vw,36px)', fontWeight:800, color:'#1B3A6B', marginBottom:20, lineHeight:1.2 }}>What is Financial Modeler Pro?</h2>
                <p style={{ fontSize:15, color:'#4B5563', lineHeight:1.75, marginBottom:20 }}>Financial Modeler Pro is a professional hub for financial modeling across all disciplines — built for analysts, developers, and investors. It replaces complex spreadsheets with a structured, guided workflow that produces audit-ready models in a fraction of the time.</p>
                <p style={{ fontSize:15, color:'#6B7280', lineHeight:1.75 }}>Every assumption is traceable. Every output is formatted for investor presentation. And every model can be exported to a formula-linked Excel workbook or a clean investor PDF — ready to share on day one.</p>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                {['Multi-discipline modeling — real estate, valuation, FP&A, LBO, and more','Structured workflows — from assumptions to investor-ready outputs','Monthly or annual modeling with full period control','Formula-linked Excel export + investor PDF reports','White-label ready for advisory firms and consultants','100% free training on every financial modeling topic'].map(text=>(
                  <div key={text} style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
                    <span style={{ width:22, height:22, borderRadius:'50%', flexShrink:0, background:'#E8F0FB', border:'1px solid #C7D9F2', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#1B4F8A', marginTop:1 }}>✓</span>
                    <span style={{ fontSize:14, color:'#4B5563', lineHeight:1.55 }}>{text}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
          <section style={{ background:'#EFF6FF', padding:'64px 40px' }}>
            <div style={{ maxWidth:1200, margin:'0 auto', display:'flex', gap:40, alignItems:'center', flexWrap:'wrap' }}>
              <div style={{ flex:1, minWidth:280 }}>
                <h2 style={{ fontSize:'clamp(24px,3vw,36px)', fontWeight:800, color:'#1F3864', marginBottom:16, lineHeight:1.2 }}>Our Mission</h2>
                <p style={{ fontSize:15, color:'#374151', lineHeight:1.75 }}>To make professional financial modeling accessible to every finance professional worldwide.</p>
              </div>
              <div style={{ flexShrink:0, width:'50%', minWidth:200, minHeight:220, borderRadius:12, background:'#F3F4F6', border:'2px solid #E5E7EB', display:'flex', alignItems:'center', justifyContent:'center', color:'#9CA3AF', fontSize:15, fontWeight:500 }}>Mission Image</div>
            </div>
          </section>
          <section style={{ background:'#EFF6FF', padding:'64px 40px' }}>
            <div style={{ maxWidth:1200, margin:'0 auto', display:'flex', gap:40, alignItems:'center', flexWrap:'wrap', flexDirection:'row-reverse' }}>
              <div style={{ flex:1, minWidth:280 }}>
                <h2 style={{ fontSize:'clamp(24px,3vw,36px)', fontWeight:800, color:'#1F3864', marginBottom:16, lineHeight:1.2 }}>Our Vision</h2>
                <p style={{ fontSize:15, color:'#374151', lineHeight:1.75 }}>To become the world&apos;s leading financial modeling platform.</p>
              </div>
              <div style={{ flexShrink:0, width:'50%', minWidth:200, minHeight:220, borderRadius:12, background:'#F3F4F6', border:'2px solid #E5E7EB', display:'flex', alignItems:'center', justifyContent:'center', color:'#9CA3AF', fontSize:15, fontWeight:500 }}>Vision Image</div>
            </div>
          </section>
        </>
      )}

      {/* ── Two Pillars ────────────────────────────────────────────────────── */}
      {!pillarsHidden && (() => {
        const APP_URL_P = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';
        const LEARN_URL_P = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
        const cols = pillarsCols.length >= 2 ? pillarsCols : null;
        const mFeatures = cols?.[0]?.features ?? ['Multi-discipline project structure','Debt & equity scheduling','IRR, NPV, and equity multiple','Excel & PDF export'];
        const tFeatures = cols?.[1]?.features ?? ['Always 100% free','Real-world case studies','GCC & international markets','Certificate on completion'];
        const mCtaText = cols?.[0]?.ctaText ?? 'Explore Modeling Hub →';
        const mCtaUrl  = cols?.[0]?.ctaUrl ? cols[0].ctaUrl : `${APP_URL_P}/modeling`;
        const tCtaText = cols?.[1]?.ctaText ?? 'Browse Free Courses →';
        const tCtaUrl  = cols?.[1]?.ctaUrl ? cols[1].ctaUrl : `${LEARN_URL_P}/training`;
        const mBorder  = cols?.[0]?.borderColor ?? '#1B4F8A';
        const mSide    = cols?.[0]?.borderSideColor ?? '#C7D9F2';
        const mAccent  = cols?.[0]?.accentColor ?? '#1B4F8A';
        const mShadow  = cols?.[0]?.shadowColor ?? 'rgba(27,79,138,0.06)';
        const tBorder  = cols?.[1]?.borderColor ?? '#1A7A30';
        const tSide    = cols?.[1]?.borderSideColor ?? '#C3E9CE';
        const tAccent  = cols?.[1]?.accentColor ?? '#1A7A30';
        const tShadow  = cols?.[1]?.shadowColor ?? 'rgba(26,122,48,0.06)';
        return (
        <section style={{ background:'#F5F7FA', padding:`${(cmsPillars?.styles as Record<string,string>)?.paddingY ?? pillarsStyles.paddingY ?? '88px'} 40px` }}>
          <div style={{ maxWidth:1100, margin:'0 auto' }}>
            <div style={{ textAlign:'center', marginBottom:48 }}>
              <h2 style={{ fontSize: pillarsStyles.headingSize ?? 'clamp(24px,3vw,36px)', fontWeight:800, color: pillarsStyles.headingColor ?? '#1B3A6B' }}>{pillarsH2}</h2>
              <p style={{ fontSize:15, color:'#6B7280', marginTop:10 }}>{pillarsSub}</p>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))', gap:24 }}>
              {/* Modeling card */}
              <div style={{ background:'#fff', border:`1px solid ${mSide}`, borderTop:`4px solid ${mBorder}`, borderRadius:16, padding:'36px 32px', boxShadow:`0 2px 12px ${mShadow}` }}>
                {cols?.[0]?.icon ? <div style={{ marginBottom:16 }} dangerouslySetInnerHTML={{ __html: cols[0].icon }} /> : (
                  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom:16, display:'block' }}>
                    <rect x="4" y="26" width="10" height="18" rx="3" fill="#1B4F8A"/><rect x="19" y="16" width="10" height="28" rx="3" fill="#1B4F8A" fillOpacity="0.65"/><rect x="34" y="6" width="10" height="38" rx="3" fill="#1B4F8A" fillOpacity="0.35"/><line x1="2" y1="46" x2="46" y2="46" stroke="#1B4F8A" strokeWidth="2.5" strokeLinecap="round"/>
                  </svg>
                )}
                <h3 style={{ fontSize:22, fontWeight:800, color:'#1B3A6B', marginBottom:12 }}>{modelTitle}</h3>
                <p style={{ fontSize:14, color:'#4B5563', lineHeight:1.7, marginBottom:24 }}>{modelDesc}</p>
                <ul style={{ listStyle:'none', padding:0, margin:'0 0 28px', display:'flex', flexDirection:'column', gap:8 }}>
                  {mFeatures.map(t=>(<li key={t} style={{ fontSize:13, color:'#4B5563', display:'flex', gap:8, alignItems:'center' }}><span style={{ color:mAccent, fontWeight:700 }}>→</span> {t}</li>))}
                </ul>
                <Link href={mCtaUrl} style={{ display:'inline-flex', alignItems:'center', gap:6, background:mAccent, color:'#fff', fontSize:13, fontWeight:700, padding:'10px 22px', borderRadius:7, textDecoration:'none' }}>{mCtaText}</Link>
              </div>
              {/* Training card */}
              <div style={{ background:'#fff', border:`1px solid ${tSide}`, borderTop:`4px solid ${tBorder}`, borderRadius:16, padding:'36px 32px', boxShadow:`0 2px 12px ${tShadow}` }}>
                {cols?.[1]?.icon ? <div style={{ marginBottom:16 }} dangerouslySetInnerHTML={{ __html: cols[1].icon }} /> : (
                  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom:16, display:'block' }}>
                    <path d="M24 10L6 20L24 30L42 20L24 10Z" fill="#1A7A30"/><path d="M13 25.5V35C13 35 17.5 40 24 40C30.5 40 35 35 35 35V25.5" stroke="#1A7A30" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/><line x1="42" y1="20" x2="42" y2="32" stroke="#1A7A30" strokeWidth="3" strokeLinecap="round"/><circle cx="42" cy="33.5" r="2.5" fill="#1A7A30"/>
                  </svg>
                )}
                <h3 style={{ fontSize:22, fontWeight:800, color:'#1B3A6B', marginBottom:12 }}>{trainingTitle}</h3>
                <p style={{ fontSize:14, color:'#4B5563', lineHeight:1.7, marginBottom:24 }}>{trainingDesc}</p>
                <ul style={{ listStyle:'none', padding:0, margin:'0 0 28px', display:'flex', flexDirection:'column', gap:8 }}>
                  {tFeatures.map(t=>(<li key={t} style={{ fontSize:13, color:'#4B5563', display:'flex', gap:8, alignItems:'center' }}><span style={{ color:tAccent, fontWeight:700 }}>→</span> {t}</li>))}
                </ul>
                <Link href={tCtaUrl} style={{ display:'inline-flex', alignItems:'center', gap:6, background:tAccent, color:'#fff', fontSize:13, fontWeight:700, padding:'10px 22px', borderRadius:7, textDecoration:'none' }}>{tCtaText}</Link>
              </div>
            </div>
          </div>
        </section>
        );
      })()}

      {/* ── Founder ────────────────────────────────────────────────────────── */}
      {!founderHidden && (() => {
        const fBadge   = (fc?.badge as string)            || founderBadge;
        const fName    = (fc?.name as string)             || founderName;
        const fTitle   = (fc?.title as string)            || 'Corporate Finance & Transaction Advisory Specialist | Financial Modeling Expert';
        const fBio     = (fc?.bio as string)              || founderShortBio;
        const fQuals   = (fc?.qualifications as string)   || '';
        const fCreds   = (fc?.credentials as string[])    || ['12+ years in Corporate Finance & Advisory','Experience across KSA & Pakistan','Lender-grade models: IRR, DSCR, Feasibility','Real estate, energy, infrastructure & industrial sectors','Transaction advisory & investment support'];
        const fPhoto   = (fc?.photo_url as string)        || founderPhotoUrl;
        const fRadius  = (fc?.photo_radius as string)     || '12px';
        const fFit     = (fc?.photo_fit as string)        || 'contain';
        const fLinkedIn = (fc?.cta_secondary_url as string) || (fc?.linkedin_url as string) || founderLinkedIn;
        const fCtaPri  = (fc?.cta_primary_text as string) || 'Read Full Profile →';
        const fCtaUrl  = (fc?.cta_primary_url as string)  || '/about/ahmad-din';
        const fCtaSec  = (fc?.cta_secondary_text as string) || 'Connect on LinkedIn →';
        const fBookTxt = (fc?.booking_text as string)     || 'Book a Meeting';
        const fBookUrl = (fc?.booking_url as string)      || '';
        const fLongBio = (fc?.long_bio as string)         || '';
        const fExp     = (fc?.experience as string[])     || [];
        const fPhilo   = (fc?.philosophy as string)       || '';
        const fShowMore = fc?.show_read_more !== false;
        const fMoreLabel = (fc?.read_more_label as string) || 'Read Full Profile →';
        const fBg      = (cmsFounder?.styles as Record<string,string>)?.bgColor ?? '#1B3A6B';
        return (
        <section style={{ padding:'64px 40px 80px', background:fBg, color:'#fff' }}>
          <style>{`
            @media (max-width: 640px) {
              .fmp-founder-img-col { order: -1 !important; }
            }
          `}</style>
          <div style={{ maxWidth:1100, margin:'0 auto' }}>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(min(300px,100%),1fr))', gap:56, alignItems:'center' }}>
              <div className="fmp-founder-img-col" style={{ display:'flex', justifyContent:'center', order:1 }}>
                {fPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fPhoto} alt={fName} style={{ width:'100%', maxWidth:400, height:'auto', objectFit:fFit as React.CSSProperties['objectFit'], borderRadius:fRadius, display:'block' }} />
                ) : (
                  <div style={{ width:'100%', maxWidth:400, height:320, borderRadius:fRadius, background:'linear-gradient(135deg,#0D2E5A,#1B4F8A)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <span style={{ fontSize:72, fontWeight:800, color:'rgba(255,255,255,0.9)', letterSpacing:'-2px', fontFamily:"'Inter',sans-serif" }}>AD</span>
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:'#4A90D9', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:14 }}>{fBadge}</div>
                <h2 style={{ fontSize:'clamp(22px,3vw,32px)', fontWeight:800, color:'#fff', marginBottom:6 }}>{fName}</h2>
                {/* Title split on | */}
                <div style={{ marginBottom:4 }}>
                  {fTitle.split('|').map((line, i) => (
                    <div key={i} style={{ fontSize: i===0 ? '1rem' : '0.95rem', color: i===0 ? '#93C5FD' : '#1ABC9C', fontWeight: i===0 ? 500 : 600, marginBottom:2 }}>{line.trim()}</div>
                  ))}
                </div>
                {/* Qualifications */}
                {fQuals && (
                  <div style={{ fontSize:'0.85rem', color:'rgba(255,255,255,0.6)', letterSpacing:'0.05em', marginBottom:16, marginTop:4 }}>{fQuals}</div>
                )}
                <p style={{ fontSize:14.5, color:'rgba(255,255,255,0.65)', lineHeight:1.75, marginBottom:16 }}>{fBio}</p>
                <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:24 }}>
                  {fCreds.map(text=>(
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
                  <Link href={fCtaUrl} style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#1B4F8A', border:'1px solid #1B4F8A', color:'#fff', fontSize:13, fontWeight:700, padding:'9px 20px', borderRadius:7, textDecoration:'none' }}>{fCtaPri}</Link>
                  {fLinkedIn && (
                    <a href={fLinkedIn} target="_blank" rel="noopener noreferrer" style={{ display:'inline-flex', alignItems:'center', gap:6, background:'transparent', border:'1px solid rgba(255,255,255,0.25)', color:'rgba(255,255,255,0.8)', fontSize:13, fontWeight:600, padding:'9px 20px', borderRadius:7, textDecoration:'none' }}>{fCtaSec}</a>
                  )}
                  {fBookUrl && (
                    <Link href="/book-a-meeting" style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#1ABC9C', color:'#fff', fontSize:13, fontWeight:700, padding:'9px 20px', borderRadius:7, textDecoration:'none' }}>📅 {fBookTxt}</Link>
                  )}
                </div>
                {fShowMore && (fLongBio || fExp.length > 0) && (
                  <FounderExpand label={fMoreLabel} longBio={fLongBio} experience={fExp} philosophy={fPhilo} name={fName} photoUrl={fPhoto} photoRadius={fRadius} qualifications={fQuals} bookingUrl={fBookUrl} bookingText={fBookTxt} />
                )}
              </div>
            </div>
          </div>
        </section>
        );
      })()}

      {/* ── PaceMakers ─────────────────────────────────────────────────────── */}
      {!pmHidden && (() => {
        const pmLogo  = (pm?.logo_url as string) || '';
        const pmLogoW = (pm?.logo_width as string) || '180px';
        const pmBadge = (pm?.badge as string) || 'The Firm Behind the Platform';
        const pmHead  = (pm?.heading as string) || 'Powered by PaceMakers Business Consultants';
        const pmDesc  = (pm?.description as string) || 'Financial Modeler Pro is a product of PaceMakers — a corporate finance advisory firm with 12+ years of experience delivering institutional-grade financial solutions across KSA and Pakistan.';
        const pmCta   = (pm?.cta_text as string) || 'Visit PaceMakers →';
        const pmUrl   = (pm?.cta_url as string) || 'https://www.pacemakersglobal.com';
        const pmSvcs  = (pm?.services as { id: string; text: string }[]) ?? [
          { id:'1', text:'Financial Modeling & Valuation' },
          { id:'2', text:'Transaction Advisory & Due Diligence' },
          { id:'3', text:'Fractional CFO Services' },
          { id:'4', text:'Investment Analysis & Feasibility' },
        ];
        const pmBg = (cmsPM?.styles as Record<string,string>)?.bgColor ?? '#0A2248';
        const pmPy = (cmsPM?.styles as Record<string,string>)?.paddingY ?? '88px';
        return (
        <section style={{ padding:`${pmPy} 40px`, background:pmBg, color:'#fff' }}>
          <div style={{ maxWidth:1100, margin:'0 auto' }}>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))', gap:56, alignItems:'center' }}>
              <div>
                {pmLogo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pmLogo} alt="PaceMakers" style={{ width:pmLogoW, height:'auto', marginBottom:16, display:'block' }} />
                )}
                <div style={{ fontSize:12, fontWeight:700, color:'#4A90D9', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:14 }}>{pmBadge}</div>
                <h2 style={{ fontSize:'clamp(22px,3vw,32px)', fontWeight:800, color:'#fff', marginBottom:20, lineHeight:1.2 }}>{pmHead}</h2>
                <p style={{ fontSize:15, color:'rgba(255,255,255,0.6)', lineHeight:1.75, marginBottom:32 }}>{pmDesc}</p>
                <a href={pmUrl} target="_blank" rel="noopener noreferrer" style={{ display:'inline-flex', alignItems:'center', gap:8, background:'#1B4F8A', color:'#fff', fontWeight:700, fontSize:13, padding:'10px 24px', borderRadius:7, textDecoration:'none' }}>{pmCta}</a>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                {pmSvcs.map(svc => (
                  <div key={svc.id} style={{ display:'flex', alignItems:'center', gap:14, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:10, padding:'16px 20px' }}>
                    <span style={{ width:22, height:22, borderRadius:'50%', flexShrink:0, background:'rgba(27,79,138,0.4)', border:'1px solid rgba(74,144,217,0.4)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#4A90D9' }}>✓</span>
                    <span style={{ fontSize:14, fontWeight:600, color:'rgba(255,255,255,0.85)' }}>{svc.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
        );
      })()}

      {/* ── Articles Preview ───────────────────────────────────────────────── */}
      {!articlesHidden && <section style={{ padding:'88px 40px', background:'#fff' }}>
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
      </section>}

      {/* ── Testimonials */}
      {!testimonialsHidden && <section style={{ padding:`${testimonialsStyles.paddingY ?? '88px'} 40px`, background:'#fff' }}>
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
                      {t.linkedin_url && (
                        <a href={t.linkedin_url} target="_blank" rel="noopener noreferrer" style={{ display:'inline-flex', alignItems:'center', gap:6, marginTop:8, padding:'6px 12px', background:'#0A66C2', color:'#fff', borderRadius:6, textDecoration:'none', fontSize:'0.8rem', fontWeight:600 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                          LinkedIn
                        </a>
                      )}
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
        </div>
      </section>}

      {/* ── Pricing teaser ─────────────────────────────────────────────────── */}
      {!pricingHidden && <section id="pricing" style={{ padding:'88px 40px', background:'#F5F7FA' }}>
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
      </section>}

      {/* ── CTA Banner ─────────────────────────────────────────────────────── */}
      {!ctaSectionHidden && ctaSection_visible && (
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

