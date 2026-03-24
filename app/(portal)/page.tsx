/**
 * FMP Public Landing Page
 * Server Component — all CMS text is inline-editable for admins.
 */
import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import Link from 'next/link';
import {
  getCmsContent, cms,
  getModules, getAssetTypes,
  getPublishedArticles, getPublishedCourses,
  getFounderProfile, getSitePages,
} from '@/src/lib/cms';
import { ArticleCard, ArticleCardPlaceholder } from '@/src/components/landing/ArticleCard';
import { CourseCard } from '@/src/components/landing/CourseCard';
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

export default async function LandingPage() {
  const [content, modules, assetTypes, articles, courses, founder, session, sitePages] = await Promise.all([
    getCmsContent(), getModules(), getAssetTypes(),
    getPublishedArticles(3), getPublishedCourses(),
    getFounderProfile(), getServerSession(), getSitePages(),
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
  const heroBadge     = cms(content, 'hero', 'badge_text',   '🚀 Now Live — Free to Use');
  const heroHeadline  = cms(content, 'hero', 'headline',     'The Operating System\nfor Financial Modeling');
  const heroSub       = cms(content, 'hero', 'subheadline',  'Learn. Build. Execute. — structured financial models, free professional training, and investor-ready outputs. All in one platform.');
  const heroCta1      = cms(content, 'hero', 'cta1',         'Launch Platform Free →');
  const heroCta2      = cms(content, 'hero', 'cta2',         'Explore Platforms ↓');

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = [
    { v: cms(content,'stats','stat1_value','12+'),  vk:'stat1_value', l: cms(content,'stats','stat1_label','Years of Experience'),        lk:'stat1_label' },
    { v: cms(content,'stats','stat2_value','10+'),  vk:'stat2_value', l: cms(content,'stats','stat2_label','Modeling Platforms'),          lk:'stat2_label' },
    { v: cms(content,'stats','stat3_value','20+'),  vk:'stat3_value', l: cms(content,'stats','stat3_label','Currencies Supported'),        lk:'stat3_label' },
    { v: cms(content,'stats','stat4_value','100%'), vk:'stat4_value', l: cms(content,'stats','stat4_label','Free Training — No Paywall'), lk:'stat4_label' },
  ];

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

  // ── Modules ───────────────────────────────────────────────────────────────
  const modulesBadge = cms(content, 'modules_section', 'badge',     'The Platforms');
  const modulesH2    = cms(content, 'modules_section', 'heading',   '10+ Professional Modeling Platforms');
  const modulesSub   = cms(content, 'modules_section', 'subheading','Live now and launching soon — one platform for every financial modeling discipline.');

  // ── Training section ──────────────────────────────────────────────────────
  const trainingBadge = cms(content, 'training_section', 'badge',  'Free Training');
  const trainingH2    = cms(content, 'training_section', 'heading', 'Learn Financial Modeling — Free');

  // ── Articles section ──────────────────────────────────────────────────────
  const articlesBadge = cms(content, 'articles_section', 'badge',  'Insights');
  const articlesH2    = cms(content, 'articles_section', 'heading', 'Latest Articles');

  // ── Assets ────────────────────────────────────────────────────────────────
  const assetsBadge = cms(content, 'assets', 'badge',     'Real Estate Coverage');
  const assetsH2    = cms(content, 'assets', 'heading',   'Real Estate — All Asset Classes');
  const assetsSub   = cms(content, 'assets', 'subheading','The most comprehensive real estate modeling platform — covering every asset type from residential to data centers.');

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

  // ── Footer ────────────────────────────────────────────────────────────────
  const footerCompany   = cms(content, 'footer', 'company_line', 'Financial Modeler Pro is a product of PaceMakers Business Consultants');
  const footerFounder   = cms(content, 'footer', 'founder_line', 'Ahmad Din — CEO & Founder');
  const footerCopyright = cms(content, 'footer', 'copyright',    `${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`);

  // ── Fallbacks ─────────────────────────────────────────────────────────────
  const fallbackModules = [
    { id:'1',  name:'Real Estate Financial Modeling', slug:'real-estate',        description:'Multi-asset real estate development models covering residential, hospitality, retail, commercial, industrial, data centers, and construction.', icon:'🏗️', status:'live'        as const, display_order:1,  launch_date:null },
    { id:'2',  name:'Business Valuation',             slug:'business-valuation', description:'DCF analysis, comparable companies, precedent transactions, sum of parts, and LBO quick check.',                                                    icon:'💼', status:'coming_soon' as const, display_order:2,  launch_date:null },
    { id:'3',  name:'FP&A Modeling',                  slug:'fpa-modeling',       description:'Annual budgets, rolling forecasts, budget vs actual variance analysis, and department P&L.',                                                         icon:'📊', status:'coming_soon' as const, display_order:3,  launch_date:null },
    { id:'4',  name:'Equity Research',                slug:'equity-research',    description:'Financial model templates, initiation of coverage reports, earnings models, and sector-specific models.',                                             icon:'📈', status:'coming_soon' as const, display_order:4,  launch_date:null },
    { id:'5',  name:'Project Finance',                slug:'project-finance',    description:'Infrastructure PPP, power and energy models, concession modeling, DSCR analysis, and debt sculpting.',                                               icon:'🏦', status:'coming_soon' as const, display_order:5,  launch_date:null },
    { id:'6',  name:'LBO Modeling',                   slug:'lbo-modeling',       description:'Full leveraged buyout models — sources and uses, debt schedule, management equity, returns waterfall.',                                              icon:'🔄', status:'coming_soon' as const, display_order:6,  launch_date:null },
    { id:'7',  name:'Corporate Finance',              slug:'corporate-finance',  description:'M&A models, merger consequences, accretion/dilution analysis, synergy modeling, fairness opinions.',                                                 icon:'🌍', status:'coming_soon' as const, display_order:7,  launch_date:null },
    { id:'8',  name:'Energy & Utilities',             slug:'energy-utilities',   description:'Solar, wind, oil and gas, utility rate models, carbon credits, and power purchase agreements.',                                                       icon:'⚡', status:'coming_soon' as const, display_order:8,  launch_date:null },
    { id:'9',  name:'Startup & Venture',              slug:'startup-venture',    description:'SaaS unit economics, runway and burn analysis, cap table modeling, cohort analysis, VC returns.',                                                     icon:'🚀', status:'coming_soon' as const, display_order:9,  launch_date:null },
    { id:'10', name:'Banking & Credit',               slug:'banking-credit',     description:'Credit analysis, loan modeling, NPL workout, Basel compliance, portfolio stress testing.',                                                            icon:'🏛️', status:'coming_soon' as const, display_order:10, launch_date:null },
  ];
  const fallbackAssets = [
    { id:'1', module_id:'', name:'Residential',                  description:'Apartments, villas, townhouses, compounds. Unit mix, sellable area, phased delivery, sales revenue, equity paydown, IRR.',           icon:'🏘️', visible:true,  display_order:1 },
    { id:'2', module_id:'', name:'Hospitality',                  description:'Hotels, serviced apartments, resorts. Room count, ADR, occupancy, RevPAR, operator structures, management fees.',                      icon:'🏨', visible:true,  display_order:2 },
    { id:'3', module_id:'', name:'Retail',                       description:'Malls, strip retail, F&B pads. GLA, tenant mix, lease terms, passing rent, reversionary yield, anchor tenants.',                       icon:'🛍️', visible:true,  display_order:3 },
    { id:'4', module_id:'', name:'Commercial Office',            description:'Office buildings, business parks, co-working. NLA, WALE, cap rate, lease expiry profile, vacancy assumptions.',                        icon:'🏢', visible:false, display_order:4 },
    { id:'5', module_id:'', name:'Industrial & Logistics',       description:'Warehouses, logistics hubs, cold storage, manufacturing. Industrial yields and escalation clauses.',                                    icon:'🏭', visible:false, display_order:5 },
    { id:'6', module_id:'', name:'Data Centers',                 description:'Colocation, hyperscale, edge. Power (MW), rack units, PUE, OPEX modeling, cloud revenue streams.',                                     icon:'💾', visible:false, display_order:6 },
    { id:'7', module_id:'', name:'Construction & Infrastructure', description:'Civil works, master plans, mixed developments. Cost phasing, contractor payments, milestone billing.',                                icon:'🏗️', visible:false, display_order:7 },
  ];
  const displayModules = modules.length > 0 ? modules : fallbackModules;
  const displayAssets  = assetTypes.length > 0 ? assetTypes : fallbackAssets;

  // ── Nav pages ─────────────────────────────────────────────────────────────
  const fallbackPages = [
    { id:'1', label:'Home',             href:'/',         visible:true, display_order:1, can_toggle:false },
    { id:'2', label:'Modeling Hub',     href:'#modules',  visible:true, display_order:2, can_toggle:true },
    { id:'3', label:'Training Academy', href:'/training', visible:true, display_order:3, can_toggle:true },
    { id:'4', label:'Articles',         href:'/articles', visible:true, display_order:4, can_toggle:true },
    { id:'5', label:'About',            href:'/about',    visible:true, display_order:5, can_toggle:true },
    { id:'6', label:'Pricing',          href:'#pricing',  visible:true, display_order:6, can_toggle:true },
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
      <section style={{ padding:'100px 40px 90px', textAlign:'center', position:'relative', background:'linear-gradient(180deg,#0D2E5A 0%,#0A2448 100%)', overflow:'hidden', color:'#fff' }}>
        <div style={{ position:'absolute', inset:0, opacity:0.04, backgroundImage:'linear-gradient(rgba(255,255,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.5) 1px,transparent 1px)', backgroundSize:'40px 40px', pointerEvents:'none' }} />
        <div style={{ position:'relative', maxWidth:820, margin:'0 auto' }}>
          <div style={{ display:'inline-flex', alignItems:'center', gap:7, background:'rgba(27,79,138,0.5)', border:'1px solid rgba(27,79,138,0.8)', borderRadius:20, padding:'5px 16px', fontSize:12, color:'rgba(255,255,255,0.8)', fontWeight:600, marginBottom:32, letterSpacing:'0.03em' }}>
            <InlineEdit tag="span" section="hero" fieldKey="badge_text" value={heroBadge} isAdmin={isAdmin} darkBg />
          </div>
          <InlineEdit
            tag="h1" section="hero" fieldKey="headline" value={heroHeadline} isAdmin={isAdmin} darkBg
            style={{ fontSize:'clamp(36px,5vw,58px)', fontWeight:800, lineHeight:1.1, color:'#fff', marginBottom:24, whiteSpace:'pre-line' }}
          />
          <InlineEdit
            tag="p" section="hero" fieldKey="subheadline" value={heroSub} isAdmin={isAdmin} darkBg
            style={{ fontSize:18, color:'rgba(255,255,255,0.55)', lineHeight:1.7, maxWidth:620, margin:'0 auto 44px' }}
          />
          <div style={{ display:'flex', gap:14, justifyContent:'center', flexWrap:'wrap' }}>
            <Link href="/login" style={{ display:'inline-flex', alignItems:'center', gap:8, background:'#1B4F8A', color:'#fff', fontWeight:700, fontSize:15, padding:'14px 32px', borderRadius:8, textDecoration:'none', boxShadow:'0 4px 24px rgba(27,79,138,0.5)' }}>
              <InlineEdit tag="span" section="hero" fieldKey="cta1" value={heroCta1} isAdmin={isAdmin} darkBg />
            </Link>
            <Link href="#modules" style={{ display:'inline-flex', alignItems:'center', gap:8, background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.18)', color:'rgba(255,255,255,0.85)', fontWeight:600, fontSize:15, padding:'14px 32px', borderRadius:8, textDecoration:'none' }}>
              <InlineEdit tag="span" section="hero" fieldKey="cta2" value={heroCta2} isAdmin={isAdmin} darkBg />
            </Link>
          </div>
          <p style={{ fontSize:12, color:'rgba(255,255,255,0.3)', marginTop:24, letterSpacing:'0.02em' }}>
            Built by Corporate Finance Professionals · 12+ Years of Experience · Trusted across KSA &amp; Pakistan
          </p>
        </div>
      </section>

      {/* ── Stats Bar ──────────────────────────────────────────────────────── */}
      <section style={{ borderTop:'1px solid rgba(255,255,255,0.07)', borderBottom:'1px solid rgba(255,255,255,0.07)', padding:'32px 40px', background:'#0A2248', color:'#fff' }}>
        <div style={{ display:'flex', justifyContent:'center', gap:'clamp(32px,6vw,80px)', flexWrap:'wrap', maxWidth:900, margin:'0 auto' }}>
          {stats.map((s)=>(
            <div key={s.lk} style={{ textAlign:'center' }}>
              <div style={{ fontSize:30, fontWeight:800, color:'#4A90D9', letterSpacing:'-0.02em' }}>
                <InlineEdit tag="span" section="stats" fieldKey={s.vk} value={s.v} isAdmin={isAdmin} darkBg />
              </div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginTop:5, letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:500 }}>
                <InlineEdit tag="span" section="stats" fieldKey={s.lk} value={s.l} isAdmin={isAdmin} darkBg />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── What is FMP ────────────────────────────────────────────────────── */}
      <section style={{ padding:'88px 40px', maxWidth:1100, margin:'0 auto', color:'#374151' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))', gap:56, alignItems:'center' }}>
          <div>
            <InlineEdit tag="div" section="about" fieldKey="badge" value={aboutBadge} isAdmin={isAdmin}
              style={{ fontSize:12, fontWeight:700, color:'#1B4F8A', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:14 }} />
            <InlineEdit tag="h2" section="about" fieldKey="heading" value={aboutH2} isAdmin={isAdmin}
              style={{ fontSize:'clamp(24px,3vw,36px)', fontWeight:800, color:'#1B3A6B', marginBottom:20, lineHeight:1.2 }} />
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
      <section style={{ background:'#F5F7FA', padding:'88px 40px' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <div style={{ textAlign:'center', marginBottom:48 }}>
            <InlineEdit tag="h2" section="pillars" fieldKey="heading" value={pillarsH2} isAdmin={isAdmin}
              style={{ fontSize:'clamp(24px,3vw,36px)', fontWeight:800, color:'#1B3A6B' }} />
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
              <Link href="/login" style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#1B4F8A', color:'#fff', fontSize:13, fontWeight:700, padding:'10px 22px', borderRadius:7, textDecoration:'none' }}>Start Modeling Free →</Link>
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

      {/* ── Modules Grid ───────────────────────────────────────────────────── */}
      <section id="modules" style={{ padding:'88px 40px', background:'#fff' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <div style={{ textAlign:'center', marginBottom:56 }}>
            <InlineEdit tag="div" section="modules_section" fieldKey="badge" value={modulesBadge} isAdmin={isAdmin}
              style={{ fontSize:12, fontWeight:700, color:'#1B4F8A', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:14 }} />
            <InlineEdit tag="h2" section="modules_section" fieldKey="heading" value={modulesH2} isAdmin={isAdmin}
              style={{ fontSize:'clamp(24px,3vw,36px)', fontWeight:800, color:'#1B3A6B', marginBottom:14 }} />
            <InlineEdit tag="p" section="modules_section" fieldKey="subheading" value={modulesSub} isAdmin={isAdmin}
              style={{ fontSize:15, color:'#6B7280', maxWidth:560, margin:'0 auto' }} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))', gap:20 }}>
            {displayModules.map((mod)=>(
              <div key={mod.id} style={{ background:mod.status==='live'?'#fff':'#F9FAFB', border:mod.status==='live'?'1px solid #C7D9F2':'1px solid #E5E7EB', borderRadius:12, padding:'24px 22px', borderLeft:mod.status==='live'?'4px solid #1B4F8A':'4px solid #D1D5DB', boxShadow:mod.status==='live'?'0 2px 8px rgba(27,79,138,0.08)':'none', position:'relative' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
                  <span style={{ fontSize:28 }}>{mod.icon}</span>
                  {mod.status==='live'
                    ? <span style={{ fontSize:9, fontWeight:700, padding:'3px 8px', borderRadius:20, background:'#E8F7EC', color:'#1A7A30', border:'1px solid #C3E9CE', letterSpacing:'0.04em' }}>✓ LIVE</span>
                    : <span style={{ fontSize:9, fontWeight:700, padding:'3px 8px', borderRadius:20, background:'#FEF9C3', color:'#854D0E', border:'1px solid #FDE68A', letterSpacing:'0.04em' }}>COMING SOON</span>}
                </div>
                <h3 style={{ fontSize:15, fontWeight:700, color:mod.status==='live'?'#1B3A6B':'#6B7280', marginBottom:8 }}>{mod.name}</h3>
                <p style={{ fontSize:13, color:'#9CA3AF', lineHeight:1.65, margin:0 }}>{mod.description}</p>
                {isAdmin && <Link href="/admin/modules" target="_blank" style={{ fontSize:10, color:'#1B4F8A', textDecoration:'none', display:'block', marginTop:10, opacity:0.7 }}>✏️ Edit in Admin →</Link>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Training Preview ───────────────────────────────────────────────── */}
      <section style={{ padding:'88px 40px', background:'#E8F7EC' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:44, flexWrap:'wrap', gap:16 }}>
            <div>
              <InlineEdit tag="div" section="training_section" fieldKey="badge" value={trainingBadge} isAdmin={isAdmin}
                style={{ fontSize:12, fontWeight:700, color:'#1A7A30', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:10 }} />
              <InlineEdit tag="h2" section="training_section" fieldKey="heading" value={trainingH2} isAdmin={isAdmin}
                style={{ fontSize:'clamp(22px,3vw,34px)', fontWeight:800, color:'#1B3A6B', margin:0 }} />
            </div>
            <Link href="/training" style={{ fontSize:13, fontWeight:700, color:'#1A7A30', textDecoration:'none' }}>Browse All Courses →</Link>
          </div>
          {courses.length > 0 ? (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:20 }}>
              {courses.slice(0,3).map((c)=><CourseCard key={c.id} course={c} />)}
            </div>
          ) : (
            <div style={{ textAlign:'center', padding:'56px 24px', background:'#fff', border:'1px dashed #A3D9AE', borderRadius:12 }}>
              <div style={{ fontSize:40, marginBottom:16 }}>🎓</div>
              <div style={{ fontSize:16, fontWeight:700, color:'#1B3A6B', marginBottom:8 }}>Courses Coming Soon</div>
              <div style={{ fontSize:13, color:'#6B7280' }}>Free video training on financial modeling — launching shortly.</div>
            </div>
          )}
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

      {/* ── Asset Classes ──────────────────────────────────────────────────── */}
      <section style={{ padding:'88px 40px', background:'#F4F7FC' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <div style={{ textAlign:'center', marginBottom:56 }}>
            <InlineEdit tag="div" section="assets" fieldKey="badge" value={assetsBadge} isAdmin={isAdmin}
              style={{ fontSize:12, fontWeight:700, color:'#1B4F8A', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:14 }} />
            <InlineEdit tag="h2" section="assets" fieldKey="heading" value={assetsH2} isAdmin={isAdmin}
              style={{ fontSize:'clamp(24px,3vw,36px)', fontWeight:800, color:'#1B3A6B', marginBottom:14 }} />
            <InlineEdit tag="p" section="assets" fieldKey="subheading" value={assetsSub} isAdmin={isAdmin}
              style={{ fontSize:15, color:'#6B7280', maxWidth:560, margin:'0 auto' }} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:20 }}>
            {displayAssets.filter(a => isAdmin || a.visible).map((a)=>(
              <div key={a.id} style={{ background:a.visible?'#fff':'#F3F4F6', border:a.visible?'1px solid #C7D9F2':'1px solid #E5E7EB', borderLeft:a.visible?'4px solid #1B4F8A':'4px solid #D1D5DB', borderRadius:14, padding:'28px 24px', opacity:a.visible?1:0.7, position:'relative' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                  <span style={{ fontSize:36 }}>{a.icon}</span>
                  {!a.visible && <span style={{ fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:20, background:'#F3F4F6', color:'#6B7280', border:'1px solid #E5E7EB', letterSpacing:'0.04em' }}>{isAdmin ? '🔒 HIDDEN' : 'COMING SOON'}</span>}
                </div>
                <h3 style={{ fontSize:16, fontWeight:800, color:a.visible?'#1B3A6B':'#6B7280', marginBottom:10 }}>{a.name}</h3>
                <p style={{ fontSize:13, color:'#9CA3AF', lineHeight:1.7, margin:0 }}>{a.description}</p>
                {isAdmin && <Link href="/admin/modules" target="_blank" style={{ fontSize:10, color:'#1B4F8A', textDecoration:'none', display:'block', marginTop:10, opacity:0.7 }}>✏️ Edit in Admin →</Link>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Founder ────────────────────────────────────────────────────────── */}
      <section style={{ padding:'64px 40px 80px', background:'#1B3A6B', color:'#fff' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))', gap:56, alignItems:'center' }}>
            <div style={{ display:'flex', justifyContent:'center' }}>
              {founderPhotoUrl ? (
                <div style={{ width:220, height:220, borderRadius:'50%', overflow:'hidden', position:'relative', border:'3px solid rgba(255,255,255,0.2)', boxShadow:'0 8px 40px rgba(0,0,0,0.4)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={founderPhotoUrl} alt={founderName} style={{ position:'absolute', top:0, left:0, width:'100%', height:'100%', objectFit:'cover', objectPosition:'center' }} />
                </div>
              ) : (
                <div style={{ width:220, height:220, borderRadius:'50%', background:'linear-gradient(135deg,#0D2E5A,#1B4F8A)', display:'flex', alignItems:'center', justifyContent:'center', border:'3px solid rgba(255,255,255,0.2)', boxShadow:'0 8px 40px rgba(0,0,0,0.4)' }}>
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

      {/* ── Testimonials ───────────────────────────────────────────────────── */}
      <section style={{ padding:'88px 40px', background:'#fff' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <div style={{ textAlign:'center', marginBottom:52 }}>
            <InlineEdit tag="h2" section="testimonials" fieldKey="heading" value={testimonialsH2} isAdmin={isAdmin}
              style={{ fontSize:'clamp(22px,3vw,34px)', fontWeight:800, color:'#1B3A6B', marginBottom:10 }} />
            <InlineEdit tag="p" section="testimonials" fieldKey="subheading" value={testimonialsSub} isAdmin={isAdmin}
              style={{ fontSize:14, color:'#6B7280' }} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:20 }}>
            {[0,1,2].map((i)=>(
              <div key={i} style={{ background:'#F9FAFB', border:'1px dashed #E5E7EB', borderRadius:12, padding:'32px 24px', textAlign:'center' }}>
                <div style={{ fontSize:40, color:'#D1D5DB', marginBottom:16, fontFamily:'Georgia,serif' }}>&ldquo;</div>
                <p style={{ fontSize:14, color:'#9CA3AF', lineHeight:1.7, marginBottom:20, fontStyle:'italic' }}>Testimonial coming soon</p>
                <p style={{ fontSize:12, color:'#D1D5DB' }}>We are collecting feedback from early users</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────────────────── */}
      <section id="pricing" style={{ padding:'88px 40px', background:'#F5F7FA' }}>
        <div style={{ maxWidth:1000, margin:'0 auto' }}>
          <div style={{ textAlign:'center', marginBottom:52 }}>
            <InlineEdit tag="div" section="pricing" fieldKey="badge" value={pricingBadge} isAdmin={isAdmin}
              style={{ fontSize:12, fontWeight:700, color:'#1B4F8A', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:14 }} />
            <InlineEdit tag="h2" section="pricing" fieldKey="heading" value={pricingH2} isAdmin={isAdmin}
              style={{ fontSize:'clamp(24px,3vw,36px)', fontWeight:800, color:'#1B3A6B', marginBottom:10 }} />
            <InlineEdit tag="p" section="pricing" fieldKey="subheading" value={pricingSub} isAdmin={isAdmin}
              style={{ fontSize:15, color:'#6B7280' }} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:24 }}>
            {PLANS.map((p)=>(
              <div key={p.name} style={{ background:p.featured?'#1B4F8A':'#fff', border:p.featured?'none':'1px solid #E5E7EB', borderRadius:14, padding:'32px 28px', position:'relative', boxShadow:p.featured?'0 8px 40px rgba(27,79,138,0.25)':'0 2px 8px rgba(0,0,0,0.04)' }}>
                {p.featured && <div style={{ position:'absolute', top:-12, left:'50%', transform:'translateX(-50%)', background:'#1A7A30', color:'#fff', fontSize:10, fontWeight:700, padding:'3px 14px', borderRadius:20, letterSpacing:'0.08em', whiteSpace:'nowrap' }}>MOST POPULAR</div>}
                <h3 style={{ fontSize:13, fontWeight:700, color:p.featured?'rgba(255,255,255,0.7)':'#6B7280', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:14 }}>{p.name}</h3>
                <div style={{ marginBottom:8 }}><span style={{ fontSize:15, fontWeight:700, color:p.featured?'rgba(255,255,255,0.55)':'#9CA3AF' }}>Price: Coming Soon</span></div>
                <p style={{ fontSize:12, color:p.featured?'rgba(255,255,255,0.4)':'#9CA3AF', marginBottom:24 }}>Finalising pricing — currently free for all users.</p>
                <ul style={{ listStyle:'none', padding:0, margin:'0 0 28px', display:'flex', flexDirection:'column', gap:10 }}>
                  {p.features.map((f)=>(
                    <li key={f} style={{ fontSize:13, color:p.featured?'rgba(255,255,255,0.8)':'#4B5563', display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ color:p.featured?'#86EFAC':'#1A7A30', fontWeight:700, fontSize:10 }}>✓</span> {f}
                    </li>
                  ))}
                </ul>
                <Link href="/login" style={{ display:'block', textAlign:'center', textDecoration:'none', padding:'11px 0', borderRadius:7, fontWeight:700, fontSize:14, background:p.featured?'rgba(255,255,255,0.15)':'#1B4F8A', color:'#fff', border:p.featured?'1px solid rgba(255,255,255,0.3)':'none' }}>
                  Join the Beta — Free →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Banner ─────────────────────────────────────────────────────── */}
      <section style={{ padding:'80px 40px', textAlign:'center', background:'#1B4F8A', color:'#fff' }}>
        <div style={{ maxWidth:640, margin:'0 auto' }}>
          <InlineEdit tag="h2" section="cta" fieldKey="heading" value={ctaH2} isAdmin={isAdmin} darkBg
            style={{ fontSize:'clamp(24px,4vw,42px)', fontWeight:800, color:'#fff', marginBottom:16, lineHeight:1.15 }} />
          <InlineEdit tag="p" section="cta" fieldKey="subheading" value={ctaSub} isAdmin={isAdmin} darkBg
            style={{ fontSize:16, color:'rgba(255,255,255,0.65)', marginBottom:36, lineHeight:1.65 }} />
          <Link href="/login" style={{ display:'inline-flex', alignItems:'center', gap:8, background:'#fff', color:'#1B4F8A', fontWeight:700, fontSize:16, padding:'16px 44px', borderRadius:8, textDecoration:'none', boxShadow:'0 4px 32px rgba(0,0,0,0.15)' }}>
            <InlineEdit tag="span" section="cta" fieldKey="button" value={ctaBtn} isAdmin={isAdmin} darkBg />
          </Link>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer style={{ borderTop:'1px solid rgba(255,255,255,0.07)', background:'#0D2E5A', padding:'48px 40px', color:'#fff' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:40, marginBottom:40 }}>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
                <span style={{ fontSize:22 }}>📐</span>
                <span style={{ fontWeight:800, fontSize:14, color:'#fff' }}>Financial Modeler Pro</span>
              </div>
              <InlineEdit tag="p" section="footer" fieldKey="company_line" value={footerCompany} isAdmin={isAdmin} darkBg
                style={{ fontSize:12.5, color:'rgba(255,255,255,0.35)', lineHeight:1.7, margin:'0 0 8px' }} />
              <InlineEdit tag="p" section="footer" fieldKey="founder_line" value={footerFounder} isAdmin={isAdmin} darkBg
                style={{ fontSize:12, color:'rgba(255,255,255,0.25)', margin:0 }} />
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:'rgba(255,255,255,0.35)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14 }}>Platform</div>
              {[['Modeling Hub','#modules'],['Training Academy','/training'],['Articles','/articles'],['Launch Platform','/login']].map(([label,href])=>(
                <Link key={href} href={href} style={{ display:'block', fontSize:13, color:'rgba(255,255,255,0.5)', textDecoration:'none', marginBottom:8 }}>{label}</Link>
              ))}
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:'rgba(255,255,255,0.35)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:14 }}>Company</div>
              {[['About FMP','/about'],['Founder','/about/ahmad-din'],['Pricing','#pricing'],['Sign In','/login']].map(([label,href])=>(
                <Link key={href} href={href} style={{ display:'block', fontSize:13, color:'rgba(255,255,255,0.5)', textDecoration:'none', marginBottom:8 }}>{label}</Link>
              ))}
            </div>
          </div>
          <div style={{ borderTop:'1px solid rgba(255,255,255,0.07)', paddingTop:24, display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12 }}>
            <span style={{ fontSize:12, color:'rgba(255,255,255,0.25)' }}>
              © <InlineEdit tag="span" section="footer" fieldKey="copyright" value={footerCopyright} isAdmin={isAdmin} darkBg />
            </span>
            <span style={{ fontSize:12, color:'rgba(255,255,255,0.25)', fontStyle:'italic' }}>Structured Modeling. Real-World Finance.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

const PLANS = [
  { name:'Free',         featured:false, features:['Up to 3 projects','Module 1 Project Setup','Basic PDF export','Community support'] },
  { name:'Professional', featured:true,  features:['Up to 10 projects','All modeling modules','Excel + PDF export','AI Assist','Priority support'] },
  { name:'Enterprise',   featured:false, features:['Unlimited projects','All modules','Formula Excel export','White-label branding','AI Research','Dedicated support'] },
];
